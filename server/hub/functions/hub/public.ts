// KWS Hub public endpoint: booking pages and website forms (no login).
// GET  ?op=calendar&a=<account>&c=<calendar>         -> calendar details
// GET  ?op=slots&a=&c=&date=YYYY-MM-DD&days=7        -> open times
// POST {op:"book", a, c, start, name, phone, email, notes}
// GET  ?op=manage&m=<token>   POST {op:"cancel"|"reschedule", m, start}
// GET  ?op=formcfg&a=&f=                            -> fields and button text for the website form
// GET  ?op=unsub&t=<token>                           -> email opt-out page
// POST {op:"form", a, f, ...fields}                   -> contact, pipeline card, instant reply, owner alert
import {
  Account, accountBySlug, addDays, cors, db, deliver, email, json, localDate, log, notifyOwner, phone,
  manageLink, render, upsertContact, weekdayKey, when, zoned,
} from "../_shared/hub.ts";

const STEP_MIN = 30;

async function calendarFor(a: Account, slug: string) {
  const { data } = await db.from("hub_calendars").select("*").eq("account_id", a.id).eq("slug", slug).eq("active", true).maybeSingle();
  return data;
}

async function openSlots(a: Account, cal: any, fromDate: string, days: number) {
  const tz = a.timezone, now = Date.now();
  const earliest = now + cal.min_notice_hours * 3600_000;
  const lastDay = addDays(localDate(now, tz), cal.max_days_ahead);
  const start = zoned(fromDate, "00:00", tz), end = zoned(addDays(fromDate, days), "00:00", tz);
  const { data: booked } = await db.from("hub_appointments").select("start_at,end_at")
    .eq("calendar_id", cal.id).eq("status", "booked")
    .gte("end_at", new Date(start - 86400_000).toISOString()).lte("start_at", new Date(end + 86400_000).toISOString());
  const busy = (booked ?? []).map((b) => [Date.parse(b.start_at) - cal.buffer_min * 60_000, Date.parse(b.end_at) + cal.buffer_min * 60_000]);
  const out: Record<string, string[]> = {};
  for (let i = 0; i < days; i++) {
    const day = addDays(fromDate, i);
    if (day > lastDay) break;
    const list: string[] = [];
    for (const [from, to] of (cal.availability?.[weekdayKey(day)] ?? []) as [string, string][]) {
      const wEnd = zoned(day, to, tz);
      for (let t = zoned(day, from, tz); t + cal.duration_min * 60_000 <= wEnd; t += Math.min(STEP_MIN, cal.duration_min) * 60_000) {
        const e = t + cal.duration_min * 60_000;
        if (t < earliest) continue;
        if (busy.some(([bs, be]) => t < be && e > bs)) continue;
        list.push(new Date(t).toISOString());
      }
    }
    if (list.length) out[day] = list;
  }
  return out;
}

async function scheduleReminders(a: Account, cal: any, appt: any, c: any) {
  await db.from("hub_outbox").update({ status: "cancelled" }).eq("ref_id", appt.id).eq("kind", "reminder").eq("status", "queued");
  const rows = [];
  for (const h of cal.reminder_hours ?? []) {
    const at = Date.parse(appt.start_at) - h * 3600_000;
    if (at < Date.now() + 10 * 60_000) continue;
    const ch = c.phone && a.sms_number ? "sms" : c.email ? "email" : null;
    if (!ch) continue;
    rows.push({ account_id: a.id, contact_id: c.id, channel: ch, to_addr: ch === "sms" ? c.phone : c.email,
      subject: `Reminder: your appointment with ${a.name}`, body: a.reminder_text, send_at: new Date(at).toISOString(), kind: "reminder", ref_id: appt.id });
  }
  if (rows.length) await db.from("hub_outbox").insert(rows);
}

async function confirm(a: Account, appt: any, c: any, verb = "booked") {
  const vars = { when: when(appt.start_at, a.timezone), manage_link: manageLink(appt.manage_token) };
  const body = render(a.confirm_text, a, c, vars);
  if (c.phone && a.sms_number && !c.dnd_sms) await deliver(a, c, "sms", body, { kind: "confirmation" });
  else if (c.email) await deliver(a, c, "email", body, { kind: "confirmation", subject: `You're ${verb} with ${a.name}` });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const u = new URL(req.url);
    const b: Record<string, any> = req.method === "POST"
      ? ((req.headers.get("content-type") ?? "").includes("json") ? await req.json().catch(() => ({})) : Object.fromEntries(new URLSearchParams(await req.text())))
      : Object.fromEntries(u.searchParams);
    const op = b.op;

    if (op === "manage" || op === "cancel" || op === "reschedule") {
      const { data: appt } = await db.from("hub_appointments").select("*").eq("manage_token", String(b.m ?? "")).maybeSingle();
      if (!appt) return json({ error: "That booking link isn't valid." }, 404);
      const { data: a } = await db.from("hub_accounts").select("*").eq("id", appt.account_id).single();
      const { data: cal } = await db.from("hub_calendars").select("*").eq("id", appt.calendar_id).single();
      const { data: c } = await db.from("hub_contacts").select("*").eq("id", appt.contact_id).maybeSingle();
      if (op === "manage") {
        return json({ business: a.name, color: a.brand_color, calendar: { name: cal.name, slug: cal.slug, duration: cal.duration_min, timezone: a.timezone },
          account: a.slug, start: appt.start_at, status: appt.status, when: when(appt.start_at, a.timezone) });
      }
      if (appt.status !== "booked") return json({ error: "This appointment is already cancelled." }, 409);
      if (op === "cancel") {
        await db.from("hub_appointments").update({ status: "cancelled" }).eq("id", appt.id);
        await db.from("hub_outbox").update({ status: "cancelled" }).eq("ref_id", appt.id).eq("status", "queued");
        await log(a, c?.id ?? null, { channel: "system", direction: "in", body: `Cancelled their ${cal.name} on ${when(appt.start_at, a.timezone)}`, kind: "booking" });
        await notifyOwner(a, `Cancelled: ${c?.first_name ?? "A customer"} ${c?.last_name ?? ""}`.trim(),
          `${c?.first_name ?? "A customer"} cancelled their ${cal.name} on ${when(appt.start_at, a.timezone)}.`);
        return json({ ok: true });
      }
      const start = Date.parse(String(b.start));
      const day = localDate(start, a.timezone);
      const slots = await openSlots(a, cal, day, 1);
      if (!(slots[day] ?? []).includes(new Date(start).toISOString())) return json({ error: "That time was just taken. Please pick another." }, 409);
      const { data: moved } = await db.from("hub_appointments").update({
        start_at: new Date(start).toISOString(), end_at: new Date(start + cal.duration_min * 60_000).toISOString(),
      }).eq("id", appt.id).select().single();
      if (c) { await scheduleReminders(a, cal, moved, c); await confirm(a, moved, c, "rescheduled"); }
      await log(a, c?.id ?? null, { channel: "system", direction: "in", body: `Moved their ${cal.name} to ${when(moved.start_at, a.timezone)}`, kind: "booking" });
      await notifyOwner(a, `Rescheduled: ${c?.first_name ?? "A customer"}`, `${c?.first_name ?? "A customer"} moved their ${cal.name} to ${when(moved.start_at, a.timezone)}.`);
      return json({ ok: true, when: when(moved.start_at, a.timezone) });
    }

    if (op === "unsub") {
      const page = (msg: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribed</title><body style="font:17px/1.5 -apple-system,system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;text-align:center"><p>${msg}</p></body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
      const { data: c } = await db.from("hub_contacts").select("id,account_id,email").eq("unsub_token", String(b.t ?? "")).maybeSingle();
      if (!c) return page("That link isn't valid anymore.");
      await db.from("hub_contacts").update({ dnd_email: true }).eq("id", c.id);
      await db.from("hub_outbox").update({ status: "cancelled" }).eq("contact_id", c.id).eq("channel", "email").eq("status", "queued");
      await db.from("hub_messages").insert({ account_id: c.account_id, contact_id: c.id, channel: "system", direction: "in", body: "Unsubscribed from emails", kind: "unsub" });
      return page("You're unsubscribed. You won't get marketing emails from us again.");
    }

    const a = await accountBySlug(String(b.a ?? ""));
    if (!a) return json({ error: "Unknown business" }, 404);

    if (op === "calendar" || op === "slots" || op === "book") {
      const cal = await calendarFor(a, String(b.c ?? "estimate"));
      if (!cal) return json({ error: "This booking page is turned off." }, 404);
      if (op === "calendar") {
        return json({ business: a.name, color: a.brand_color, phone: a.business_phone, timezone: a.timezone,
          calendar: { name: cal.name, slug: cal.slug, description: cal.description, location: cal.location, duration: cal.duration_min } });
      }
      if (op === "slots") {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(b.date ?? "") ? b.date : localDate(Date.now(), a.timezone);
        return json({ timezone: a.timezone, slots: await openSlots(a, cal, from, Math.min(Number(b.days) || 7, 14)) });
      }
      // book
      if (b.website_url) return json({ ok: true }); // honeypot
      const p = phone(b.phone), e = email(b.email);
      if (!String(b.name ?? "").trim() || (!p && !e)) return json({ error: "Please add your name and a phone number or email." }, 400);
      const start = Date.parse(String(b.start));
      const day = localDate(start, a.timezone);
      const slots = await openSlots(a, cal, day, 1);
      if (!(slots[day] ?? []).includes(new Date(start).toISOString())) return json({ error: "That time was just taken. Please pick another." }, 409);
      const c = await upsertContact(a, { name: b.name, phone: p, email: e, source: "booking" });
      const { data: appt, error } = await db.from("hub_appointments").insert({
        account_id: a.id, calendar_id: cal.id, contact_id: c.id, start_at: new Date(start).toISOString(),
        end_at: new Date(start + cal.duration_min * 60_000).toISOString(), notes: String(b.notes ?? "").slice(0, 2000) || null,
      }).select().single();
      if (error) throw error;
      await log(a, c.id, { channel: "system", direction: "in", body: `Booked ${cal.name} for ${when(appt.start_at, a.timezone)}${appt.notes ? `\nNotes: ${appt.notes}` : ""}`, kind: "booking" });
      // pipeline: move their open card to the calendar's stage, or start one
      if (cal.pipeline_stage_id) {
        const { data: st } = await db.from("hub_stages").select("pipeline_id").eq("id", cal.pipeline_stage_id).single();
        const { data: open } = await db.from("hub_opportunities").select("id").eq("contact_id", c.id).eq("status", "open").limit(1);
        if (open?.length) await db.from("hub_opportunities").update({ stage_id: cal.pipeline_stage_id }).eq("id", open[0].id);
        else await db.from("hub_opportunities").insert({ account_id: a.id, contact_id: c.id, pipeline_id: st!.pipeline_id, stage_id: cal.pipeline_stage_id, title: `${b.name} – ${cal.name}` });
      }
      // they booked: stop "new lead" nurture, start any booking sequences
      await db.from("hub_enrollments").update({ status: "stopped", stopped_reason: "booked" }).eq("contact_id", c.id).eq("status", "active")
        .in("sequence_id", ((await db.from("hub_sequences").select("id").eq("account_id", a.id).eq("trigger", "form")).data ?? []).map((x) => x.id));
      await enrollTrigger(a, c.id, "booking");
      await confirm(a, appt, c);
      await scheduleReminders(a, cal, appt, c);
      await notifyOwner(a, `New booking: ${b.name}, ${when(appt.start_at, a.timezone)}`,
        `${b.name} booked ${cal.name} for ${when(appt.start_at, a.timezone)}.\nPhone: ${p ?? ""}\nEmail: ${e ?? ""}\nNotes: ${appt.notes ?? ""}`,
        `New booking: ${b.name}, ${when(appt.start_at, a.timezone)}. ${p ?? e ?? ""}`);
      return json({ ok: true, when: when(appt.start_at, a.timezone), manage: manageLink(appt.manage_token) });
    }

    if (op === "formcfg") {
      const { data: form } = await db.from("hub_forms").select("fields,button_text").eq("account_id", a.id).eq("slug", String(b.f ?? "contact")).eq("active", true).maybeSingle();
      return json(form ? { fields: form.fields, button: form.button_text, color: a.brand_color } : { error: "This form is turned off." }, form ? 200 : 404);
    }

    if (op === "form") {
      const { data: form } = await db.from("hub_forms").select("*").eq("account_id", a.id).eq("slug", String(b.f ?? "contact")).eq("active", true).maybeSingle();
      if (!form) return json({ error: "This form is turned off." }, 404);
      if (b.website_url) return json({ ok: true, message: form.thank_you }); // honeypot
      const p = phone(b.phone), e = email(b.email);
      const name = String(b.name ?? [b.first_name, b.last_name].filter(Boolean).join(" ")).trim();
      if (!p && !e) return json({ error: "Please add a phone number or email so we can reach you." }, 400);
      const since = new Date(Date.now() - 2 * 60_000).toISOString();
      const c = await upsertContact(a, { name, phone: p, email: e, company: b.company, source: `form:${form.slug}` });
      const { data: recent } = await db.from("hub_messages").select("id").eq("contact_id", c.id).eq("kind", "form").gte("created_at", since).limit(1);
      if (recent?.length) return json({ ok: true, message: form.thank_you, duplicate: true });
      const skip = new Set(["op", "a", "f", "website_url", "redirect"]);
      const lines = Object.entries(b).filter(([k, v]) => !skip.has(k) && String(v ?? "").trim()).map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v).slice(0, 2000)}`);
      await log(a, c.id, { channel: "system", direction: "in", body: `Form "${form.name}"\n${lines.join("\n")}`, kind: "form", meta: { page: req.headers.get("referer") } });
      if (form.stage_id) {
        const { data: open } = await db.from("hub_opportunities").select("id").eq("contact_id", c.id).eq("status", "open").limit(1);
        if (!open?.length) {
          const { data: st } = await db.from("hub_stages").select("pipeline_id").eq("id", form.stage_id).single();
          await db.from("hub_opportunities").insert({ account_id: a.id, contact_id: c.id, pipeline_id: st!.pipeline_id, stage_id: form.stage_id, title: name || p || e || "New lead" });
        }
      }
      if (a.form_reply_on) {
        if (c.phone && a.sms_number) await deliver(a, c, "sms", render(a.form_reply_sms, a, c), { kind: "autoreply" });
        else if (c.email) await deliver(a, c, "email", render(a.form_reply_email, a, c), { kind: "autoreply", subject: render(a.form_reply_subject, a, c) });
      }
      await enrollTrigger(a, c.id, "form");
      await notifyOwner(a, `New lead: ${name || p || e}`, `New ${form.name} submission for ${a.name}.\n\n${lines.join("\n")}`,
        `New lead for ${a.name}: ${name || ""} ${p ?? e ?? ""}. ${String(b.message ?? "").slice(0, 200)}`);
      if (b.redirect && /^https:\/\//.test(b.redirect)) return Response.redirect(b.redirect, 303);
      return json({ ok: true, message: form.thank_you });
    }
    return json({ error: "Unknown op" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong. Please call us instead." }, 500);
  }
}

async function enrollTrigger(a: Account, contactId: string, trigger: string) {
  const { data: seqs } = await db.from("hub_sequences").select("id").eq("account_id", a.id).eq("trigger", trigger).eq("active", true);
  for (const s of seqs ?? []) {
    const { data: first } = await db.from("hub_sequence_steps").select("delay_minutes").eq("sequence_id", s.id).eq("position", 0).maybeSingle();
    if (!first) continue;
    // the partial unique index (one active enrollment per sequence and contact) rejects repeats
    await db.from("hub_enrollments").insert({ account_id: a.id, sequence_id: s.id, contact_id: contactId, next_step: 0,
      next_run_at: new Date(Date.now() + first.delay_minutes * 60_000).toISOString() });
  }
}
