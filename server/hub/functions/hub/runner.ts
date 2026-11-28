// KWS Hub scheduler, called by pg_cron only when something is due.
// 1. advance follow-up sequences (queue the next step)   2. send due outbox rows (reminders, reviews, follow-ups, campaigns)
// Campaigns are expanded into outbox rows by the SQL function hub_launch_campaign (pg_cron or "Send now").
import { db, deliver, FN, json, manageLink, render, secret, when } from "../_shared/hub.ts";

export default async function handler(req: Request): Promise<Response> {
  const s = await secret("cron_secret");
  if (!s || req.headers.get("x-hub-cron") !== s) return json({ error: "forbidden" }, 403);
  const done = { steps: 0, sent: 0, failed: 0, skipped: 0 };

  // 1. sequences
  const { data: due } = await db.rpc("hub_claim_enrollments", { n: 100 });
  for (const e of due ?? []) {
    const { data: steps } = await db.from("hub_sequence_steps").select("*").eq("sequence_id", e.sequence_id).order("position");
    const step = steps?.[e.next_step];
    const { data: seq } = await db.from("hub_sequences").select("active").eq("id", e.sequence_id).single();
    if (!step || !seq?.active) { await db.from("hub_enrollments").update({ status: "done", next_run_at: null }).eq("id", e.id); continue; }
    const { data: c } = await db.from("hub_contacts").select("phone,email").eq("id", e.contact_id).single();
    await db.from("hub_outbox").insert({ account_id: e.account_id, contact_id: e.contact_id, channel: step.channel,
      to_addr: step.channel === "sms" ? c?.phone : c?.email, subject: step.subject, body: step.body, kind: "sequence", ref_id: e.id });
    const next = steps?.[e.next_step + 1];
    await db.from("hub_enrollments").update(next
      ? { next_step: e.next_step + 1, next_run_at: new Date(Date.now() + next.delay_minutes * 60_000).toISOString() }
      : { next_step: e.next_step + 1, status: "done", next_run_at: null }).eq("id", e.id);
    done.steps++;
  }

  // 2. outbox
  const { data: rows } = await db.rpc("hub_claim_outbox", { n: 100 });
  const accounts = new Map<string, any>();
  for (const o of rows ?? []) {
    let a = accounts.get(o.account_id);
    if (!a) { a = (await db.from("hub_accounts").select("*").eq("id", o.account_id).single()).data; accounts.set(o.account_id, a); }
    const { data: c } = o.contact_id ? await db.from("hub_contacts").select("*").eq("id", o.contact_id).single() : { data: null };
    const extra: Record<string, string> = {};
    if (o.kind === "reminder") {
      const { data: ap } = await db.from("hub_appointments").select("*").eq("id", o.ref_id).maybeSingle();
      if (!ap || ap.status !== "booked") { await db.from("hub_outbox").update({ status: "skipped", error: "appointment not booked" }).eq("id", o.id); done.skipped++; continue; }
      extra.when = when(ap.start_at, a.timezone);
      extra.manage_link = manageLink(ap.manage_token);
    }
    if (o.kind === "sequence") {
      const { data: en } = await db.from("hub_enrollments").select("status,stopped_reason").eq("id", o.ref_id).maybeSingle();
      if (en?.status === "stopped") { await db.from("hub_outbox").update({ status: "skipped", error: `follow-up stopped: ${en.stopped_reason}` }).eq("id", o.id); done.skipped++; continue; }
    }
    let body = render(o.body, a, c, extra);
    // a text with no texting number on the account goes out by email (see deliver)
    const ch = o.channel === "sms" && !a.sms_number && c?.email ? "email" : o.channel;
    // marketing messages carry their opt-out: STOP for texts, an unsubscribe link and the mailing address for email
    if (o.kind === "campaign" && ch === "sms") body += "\nReply STOP to opt out.";
    if (ch === "email" && c && ["campaign", "sequence", "review"].includes(o.kind ?? "")) {
      body += `\n\n--\n${a.name}${a.mailing_address ? `, ${a.mailing_address}` : ""}\nUnsubscribe: ${FN}/hub?op=unsub&t=${c.unsub_token}`;
    }
    const subject = o.subject ? render(o.subject, a, c, extra) : undefined;
    const r = await deliver(a, c, o.channel, body, { subject, kind: o.kind, to: o.to_addr ?? undefined });
    await db.from("hub_outbox").update(r.ok ? { status: "sent", sent_at: new Date().toISOString() } : { status: "failed", error: r.error }).eq("id", o.id);
    r.ok ? done.sent++ : done.failed++;
  }
  return json(done);
}
