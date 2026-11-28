// KWS Hub Twilio webhooks. Every request is checked against the Twilio signature.
// ?t=voice  incoming call   -> ring the owner's cell, caller ID passed through
// ?t=dial   ring finished   -> missed? text the caller back right away, offer voicemail
// ?t=vm     voicemail saved -> log it, tell the owner
// ?t=sms    incoming text   -> conversation, STOP/START, stop follow-ups, forward to owner; owner replies are relayed
// ?t=status delivery report -> update the message status
import { Account, appName, db, deliver, esc, FN, log, notifyOwner, render, sendSms, twilioValid, upsertContact, xml } from "../_shared/hub.ts";

const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;
const START = /^\s*(start|unstop|yes)\s*$/i;

async function accountFor(num: string) {
  const { data } = await db.from("hub_accounts").select("*").eq("sms_number", num).maybeSingle();
  return data as Account | null;
}

export default async function handler(req: Request): Promise<Response> {
  const t = new URL(req.url).searchParams.get("t");
  const p = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  if (!(await twilioValid(req, p))) return new Response("bad signature", { status: 403 });

  try {
    if (t === "status") {
      if (p.MessageSid) await db.from("hub_messages").update({ status: p.MessageStatus + (p.ErrorCode ? ` (${p.ErrorCode})` : "") }).eq("provider_id", p.MessageSid);
      return new Response("ok");
    }

    const a = await accountFor(t === "dial" || t === "voice" || t === "vm" ? p.To || p.Called : p.To);
    if (!a) return xml("<Say>This number is not in service.</Say>");

    if (t === "voice") {
      const c = await upsertContact(a, { phone: p.From, source: "call" });
      await log(a, c.id, { channel: "call", direction: "in", body: "Incoming call", provider_id: p.CallSid, kind: "call" });
      if (!a.owner_phone) return xml(`<Redirect method="POST">${FN}/hub?fn=twilio&amp;t=dial</Redirect>`);
      return xml(`<Dial timeout="${a.missed_call_ring_seconds}" answerOnBridge="true" callerId="${esc(p.From)}" action="${FN}/hub?fn=twilio&amp;t=dial"><Number>${esc(a.owner_phone)}</Number></Dial>`);
    }

    if (t === "dial") {
      const status = p.DialCallStatus ?? "no-answer";
      const { data: c } = await db.from("hub_contacts").select("*").eq("account_id", a.id).eq("phone", p.From).maybeSingle();
      if (status === "completed" || status === "answered") {
        await db.from("hub_messages").update({ body: `Answered call (${p.DialCallDuration ?? "?"}s)` }).eq("provider_id", p.CallSid);
        return xml("<Hangup/>");
      }
      await db.from("hub_messages").update({ body: "Missed call", status: status }).eq("provider_id", p.CallSid);
      // text them back once per 15 minutes
      if (c && a.missed_call_on && !c.dnd_sms) {
        const since = new Date(Date.now() - 15 * 60_000).toISOString();
        const { data: recent } = await db.from("hub_messages").select("id").eq("contact_id", c.id).eq("kind", "missed_call").gte("created_at", since).limit(1);
        if (!recent?.length) await deliver(a, c, "sms", render(a.missed_call_text, a, c), { kind: "missed_call" });
      }
      await notifyOwner(a, `Missed call from ${p.From}`, `You missed a call from ${p.From}${a.missed_call_on ? ". They were texted back automatically." : "."}`);
      return xml(`<Say voice="Polly.Joanna">Sorry we missed your call. We just sent you a text. You can also leave a message after the tone.</Say><Record maxLength="120" playBeep="true" action="${FN}/hub?fn=twilio&amp;t=vm" /><Hangup/>`);
    }

    if (t === "vm") {
      const { data: c } = await db.from("hub_contacts").select("id").eq("account_id", a.id).eq("phone", p.From).maybeSingle();
      if (p.RecordingUrl && Number(p.RecordingDuration ?? 0) > 1) {
        await log(a, c?.id ?? null, { channel: "call", direction: "in", body: `Voicemail (${p.RecordingDuration}s): ${p.RecordingUrl}.mp3`, kind: "voicemail", meta: { url: p.RecordingUrl } });
        await notifyOwner(a, `New voicemail from ${p.From}`, `Voicemail from ${p.From} (${p.RecordingDuration}s). It's in the conversation in ${appName()}.`);
      }
      return xml("<Hangup/>");
    }

    if (t === "sms") {
      const body = (p.Body ?? "").trim();
      // the owner texting the business number: relay to the last customer who texted in
      if (a.owner_phone && p.From === a.owner_phone) {
        const { data: last } = await db.from("hub_messages").select("contact_id").eq("account_id", a.id).eq("channel", "sms").eq("direction", "in")
          .not("contact_id", "is", null).order("created_at", { ascending: false }).limit(1);
        const { data: c } = last?.length ? await db.from("hub_contacts").select("*").eq("id", last[0].contact_id).single() : { data: null };
        if (!c) return xml("<Message>No customer conversation to reply to yet.</Message>");
        const r = await deliver(a, c, "sms", body, { kind: "owner_relay" });
        return r.ok ? xml("") : xml(`<Message>Not sent: ${esc(r.error ?? "")}</Message>`);
      }
      const c = await upsertContact(a, { phone: p.From, source: "sms" });
      await log(a, c.id, { channel: "sms", direction: "in", body, provider_id: p.MessageSid, kind: "sms", meta: p.NumMedia && p.NumMedia !== "0" ? { media: p.MediaUrl0 } : {} });
      if (STOP.test(body)) {
        await db.from("hub_contacts").update({ dnd_sms: true }).eq("id", c.id);
        await db.from("hub_outbox").update({ status: "cancelled" }).eq("contact_id", c.id).eq("channel", "sms").eq("status", "queued");
        await db.from("hub_enrollments").update({ status: "stopped", stopped_reason: "opted out" }).eq("contact_id", c.id).eq("status", "active");
        return xml("");
      }
      if (START.test(body) && c.dnd_sms) await db.from("hub_contacts").update({ dnd_sms: false }).eq("id", c.id);
      // a reply stops follow-ups that are set to stop on reply
      const { data: seqs } = await db.from("hub_sequences").select("id").eq("account_id", a.id).eq("stop_on_reply", true);
      if (seqs?.length) await db.from("hub_enrollments").update({ status: "stopped", stopped_reason: "replied" })
        .eq("contact_id", c.id).eq("status", "active").in("sequence_id", seqs.map((s) => s.id));
      if (a.forward_sms_to_owner && a.owner_phone) {
        const who = [c.first_name, c.last_name].filter(Boolean).join(" ") || p.From;
        await sendSms(a, a.owner_phone, `${who}: ${body.slice(0, 300)}\n(Reply to this text to answer them.)`);
      }
      return xml("");
    }
    return xml("");
  } catch (err) {
    console.error(err);
    return xml("");
  }
}
