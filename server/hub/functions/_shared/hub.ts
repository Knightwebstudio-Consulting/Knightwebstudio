// KWS Hub shared helpers (Supabase project kws-growth). No secrets in this file:
// Twilio keys live in public.hub_secrets (service role only), email keys in public.settings.
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const db: SupabaseClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export const FN = `${SUPABASE_URL}/functions/v1`;
export const SITE = "https://knightwebstudio.com";

export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
export const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...cors } });
export const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { "content-type": "text/xml" } });
export const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));

export type Account = Record<string, any>;
export type Contact = Record<string, any>;

export async function secret(key: string): Promise<string | null> {
  const { data } = await db.from("hub_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
export async function setting<T = unknown>(key: string): Promise<T | null> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? null) as T | null;
}

// US numbers to E.164; anything else with a + is kept as is.
export function phone(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const d = s.replace(/\D/g, "");
  if (s.startsWith("+") && d.length >= 8) return "+" + d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return null;
}
export const email = (raw?: string | null) => {
  const e = (raw ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
};
export function splitName(full?: string | null) {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { first_name: parts[0] ?? null, last_name: parts.slice(1).join(" ") || null };
}

export const bookingLink = (a: Account) => a.booking_url || `${SITE}/book/?a=${a.slug}`;
export function when(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(iso));
}
export function render(tpl: string, a: Account, c?: Contact | null, extra: Record<string, string> = {}) {
  const vars: Record<string, string> = {
    first_name: c?.first_name || "there",
    last_name: c?.last_name || "",
    name: [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "there",
    business: a.name,
    business_phone: a.business_phone || "",
    review_link: a.review_link || "",
    booking_link: bookingLink(a),
    website: a.website || "",
    ...extra,
  };
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

export async function accountBySlug(slug: string) {
  const { data } = await db.from("hub_accounts").select("*").eq("slug", slug).maybeSingle();
  return data as Account | null;
}

// Find a contact by phone or email in this account, or create one. Fills blanks on a match.
export async function upsertContact(a: Account, f: { name?: string; first_name?: string; last_name?: string; email?: string | null; phone?: string | null; company?: string; source?: string }) {
  const p = phone(f.phone), e = email(f.email);
  let found: Contact | null = null;
  if (p) found = (await db.from("hub_contacts").select("*").eq("account_id", a.id).eq("phone", p).limit(1)).data?.[0] ?? null;
  if (!found && e) found = (await db.from("hub_contacts").select("*").eq("account_id", a.id).ilike("email", e).limit(1)).data?.[0] ?? null;
  const n = f.first_name ? { first_name: f.first_name, last_name: f.last_name ?? null } : splitName(f.name);
  if (found) {
    const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
    if (!found.phone && p) patch.phone = p;
    if (!found.email && e) patch.email = e;
    if (!found.first_name && n.first_name) Object.assign(patch, n);
    if (!found.company && f.company) patch.company = f.company;
    const { data } = await db.from("hub_contacts").update(patch).eq("id", found.id).select().single();
    return data as Contact;
  }
  const { data, error } = await db.from("hub_contacts").insert({
    account_id: a.id, ...n, email: e, phone: p, company: f.company || null, source: f.source || null,
  }).select().single();
  if (error) throw error;
  return data as Contact;
}

export async function log(a: Account, contactId: string | null, m: { channel: string; direction: string; body?: string; subject?: string; status?: string; provider_id?: string; kind?: string; meta?: unknown }) {
  await db.from("hub_messages").insert({ account_id: a.id, contact_id: contactId, ...m });
  if (contactId) {
    const { data: c } = await db.from("hub_contacts").select("unread").eq("id", contactId).single();
    await db.from("hub_contacts").update({
      last_activity_at: new Date().toISOString(),
      ...(m.direction === "in" ? { unread: (c?.unread ?? 0) + 1 } : {}),
    }).eq("id", contactId);
  }
}

// ---- Twilio ----
async function twilioCreds() {
  const sid = await secret("twilio_sid"), token = await secret("twilio_token");
  return sid && token ? { sid, token } : null;
}
export async function twilio(path: string, params?: Record<string, string>, method = params ? "POST" : "GET") {
  const c = await twilioCreds();
  if (!c) return { ok: false, status: 0, data: { message: "Twilio is not connected yet" } };
  const url = path.startsWith("http") ? path : `https://api.twilio.com/2010-04-01/Accounts/${c.sid}${path}`;
  const r = await fetch(url, {
    method,
    headers: { authorization: "Basic " + btoa(`${c.sid}:${c.token}`), ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
export async function sendSms(a: Account, to: string, body: string) {
  if (!a.sms_number) return { ok: false, error: "No texting number on this account" };
  const r = await twilio("/Messages.json", { From: a.sms_number, To: to, Body: body, StatusCallback: `${FN}/hub?fn=twilio&t=status` });
  return r.ok ? { ok: true, id: r.data.sid as string } : { ok: false, error: `${r.status} ${r.data?.message ?? ""}`.trim() };
}
// X-Twilio-Signature: base64(HMAC-SHA1(token, url + sorted key/value pairs))
export async function twilioValid(req: Request, params: Record<string, string>) {
  const token = await secret("twilio_token");
  if (!token) return false;
  const u = new URL(req.url);
  const url = `${FN}/${u.pathname.split("/").pop()}${u.search}`;
  const payload = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  const expect = btoa(String.fromCharCode(...sig));
  return expect === (req.headers.get("x-twilio-signature") ?? "");
}

// ---- Email (Resend, same key and verified domain as the other KWS automations) ----
export async function sendEmail(a: Account | null, to: string, subject: string, text: string, replyTo?: string | null) {
  const key = Deno.env.get("RESEND_API_KEY") ?? (await setting<string>("kws_resend_key"));
  if (!key) return { ok: false, error: "No email key" };
  const from = (await setting<string>("kws_from_email")) ?? "KnightWebstudio <christian@knightwebstudio.com>";
  const addr = from.match(/<([^>]+)>/)?.[1] ?? from;
  const name = (a?.name ?? "KnightWebstudio").replace(/[<>"]/g, "");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: `${name} <${addr}>`, to: [to], reply_to: replyTo || a?.notify_email || undefined, subject, text }),
  });
  const d = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, id: d.id as string } : { ok: false, error: `${r.status} ${d?.message ?? ""}`.trim() };
}

// Send to a contact on a channel, honour do-not-contact, and log it in the conversation.
export async function deliver(a: Account, c: Contact | null, channel: "sms" | "email", body: string, opts: { subject?: string; kind?: string; to?: string } = {}) {
  // no texting number yet: fall back to email when we have one
  if (channel === "sms" && !a.sms_number && c?.email && !c.dnd_email) { channel = "email"; opts = { ...opts, to: c.email, subject: opts.subject || a.name }; }
  const to = opts.to ?? (channel === "sms" ? c?.phone : c?.email);
  if (!to) return { ok: false, error: `No ${channel === "sms" ? "phone" : "email"} for this contact` };
  if (c && channel === "sms" && c.dnd_sms) return { ok: false, error: "Contact opted out of texts" };
  if (c && channel === "email" && c.dnd_email) return { ok: false, error: "Contact opted out of email" };
  const r = channel === "sms" ? await sendSms(a, to, body) : await sendEmail(a, to, opts.subject || a.name, body);
  await log(a, c?.id ?? null, { channel, direction: "out", body, subject: opts.subject, status: r.ok ? "sent" : `failed: ${r.error}`, provider_id: r.ok ? r.id : undefined, kind: opts.kind });
  return r;
}

// Tell the business owner (email always; text too when asked and possible).
export async function notifyOwner(a: Account, subject: string, text: string, sms?: string) {
  if (a.notify_email) await sendEmail(a, a.notify_email, subject, text + `\n\nOpen KWS Hub: ${SITE}/hub/`);
  if (sms && a.owner_phone && a.sms_number && a.forward_sms_to_owner) await sendSms(a, a.owner_phone, sms);
}

// ---- time zones (no libraries) ----
function offsetMs(ts: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}
// "2026-12-01" + "08:30" in tz -> epoch ms
export function zoned(date: string, time: string, tz: string) {
  const [y, m, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return t;
}
export function localDate(ts: number, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}
export function weekdayKey(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
export const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
