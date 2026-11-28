// KWS Hub private API for the app. POST {op, ...}.
// Sign-in without email links: request_code -> 6-digit code by email -> set_password.
// Everything else needs the user's session (Authorization: Bearer <jwt>) and access to the account.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { db, deliver, FN, json, cors, sendEmail, SITE, SUPABASE_URL, twilio } from "../_shared/hub.ts";

const sha = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");

async function userFrom(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const { data } = await db.auth.getUser(auth.slice(7));
  if (!data.user) return null;
  const as = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { authorization: auth } } });
  return { user: data.user, as };
}
async function isAgencyAdmin(uid: string) {
  const { data } = await db.from("hub_members").select("role, hub_accounts!inner(kind)").eq("user_id", uid).in("role", ["owner", "admin"]).eq("hub_accounts.kind", "agency");
  return (data?.length ?? 0) > 0;
}
async function canUse(as: any, accountId: string) {
  const { data } = await as.rpc("hub_can", { acct: accountId });
  return data === true;
}
async function allowedEmail(e: string) {
  const { data: admin } = await db.from("admin_users").select("email").ilike("email", e).limit(1);
  if (admin?.length) return true;
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const u = list?.users.find((x) => x.email?.toLowerCase() === e);
  if (!u) return false;
  const { data: m } = await db.from("hub_members").select("user_id").eq("user_id", u.id).limit(1);
  return (m?.length ?? 0) > 0;
}
const hooks = { VoiceUrl: `${FN}/hub?fn=twilio&t=voice`, VoiceMethod: "POST", SmsUrl: `${FN}/hub?fn=twilio&t=sms`, SmsMethod: "POST" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const op = String(b.op ?? "");

    // ---- sign-in codes (no session yet) ----
    if (op === "request_code") {
      const e = String(b.email ?? "").trim().toLowerCase();
      if (e && (await allowedEmail(e))) {
        const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
        await db.from("hub_login_codes").upsert({ email: e, code_hash: await sha(code), expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), tries: 0 });
        await sendEmail(null, e, `Your KWS Hub code: ${code}`, `Your KWS Hub sign-in code is ${code}\n\nIt works for 15 minutes. If you didn't ask for it, ignore this email.`);
      }
      return json({ ok: true }); // same answer either way
    }
    if (op === "set_password") {
      const e = String(b.email ?? "").trim().toLowerCase(), pw = String(b.password ?? "");
      if (pw.length < 10) return json({ error: "Use at least 10 characters." }, 400);
      const { data: row } = await db.from("hub_login_codes").select("*").eq("email", e).maybeSingle();
      if (!row || Date.parse(row.expires_at) < Date.now() || row.tries >= 5) return json({ error: "That code has expired. Ask for a new one." }, 400);
      if (row.code_hash !== (await sha(String(b.code ?? "").trim()))) {
        await db.from("hub_login_codes").update({ tries: row.tries + 1 }).eq("email", e);
        return json({ error: "That code isn't right." }, 400);
      }
      await db.from("hub_login_codes").delete().eq("email", e);
      const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
      let u = list?.users.find((x) => x.email?.toLowerCase() === e);
      if (u) await db.auth.admin.updateUserById(u.id, { password: pw, email_confirm: true });
      else u = (await db.auth.admin.createUser({ email: e, password: pw, email_confirm: true })).data.user!;
      // the studio's admin becomes owner of the agency account
      const { data: admin } = await db.from("admin_users").select("email").ilike("email", e).limit(1);
      if (admin?.length) {
        const { data: ag } = await db.from("hub_accounts").select("id").eq("kind", "agency").limit(1).single();
        await db.from("hub_members").upsert({ account_id: ag!.id, user_id: u.id, role: "owner" });
      }
      return json({ ok: true });
    }

    const me = await userFrom(req);
    if (!me) return json({ error: "Please sign in again." }, 401);
    const acct = b.account_id ? String(b.account_id) : null;
    if (acct && !(await canUse(me.as, acct))) return json({ error: "No access to that account." }, 403);
    const agency = await isAgencyAdmin(me.user.id);

    if (op === "send") {
      const { data: a } = await db.from("hub_accounts").select("*").eq("id", acct).single();
      const { data: c } = await db.from("hub_contacts").select("*").eq("id", b.contact_id).eq("account_id", acct).single();
      if (!a || !c) return json({ error: "Not found" }, 404);
      const r = await deliver(a, c, b.channel === "email" ? "email" : "sms", String(b.body ?? "").slice(0, 1500), { subject: b.subject, kind: "manual" });
      await db.from("hub_contacts").update({ unread: 0 }).eq("id", c.id);
      return json(r, r.ok ? 200 : 400);
    }

    if (op === "enroll") {
      const { data: first } = await db.from("hub_sequence_steps").select("delay_minutes").eq("sequence_id", b.sequence_id).eq("position", 0).maybeSingle();
      if (!first) return json({ error: "That follow-up has no steps yet." }, 400);
      const { error } = await db.from("hub_enrollments").insert({ account_id: acct, sequence_id: b.sequence_id, contact_id: b.contact_id,
        next_run_at: new Date(Date.now() + first.delay_minutes * 60_000).toISOString() });
      return error ? json({ error: "Already in that follow-up." }, 409) : json({ ok: true });
    }

    if (op === "twilio_status") {
      if (!agency) return json({ connected: false });
      const r = await twilio(".json");
      if (!r.ok) return json({ connected: false, message: r.data?.message });
      const nums = await twilio("/IncomingPhoneNumbers.json?PageSize=100");
      const { data: used } = await db.from("hub_accounts").select("name,sms_number").not("sms_number", "is", null);
      return json({ connected: true, name: r.data.friendly_name, status: r.data.status, type: r.data.type,
        numbers: (nums.data?.incoming_phone_numbers ?? []).map((n: any) => ({ number: n.phone_number, name: n.friendly_name,
          wired: n.voice_url === hooks.VoiceUrl && n.sms_url === hooks.SmsUrl, account: used?.find((u) => u.sms_number === n.phone_number)?.name ?? null })) });
    }
    if (op === "save_twilio") {
      if (!agency) return json({ error: "Only the studio owner can connect Twilio." }, 403);
      const sid = String(b.sid ?? "").trim(), token = String(b.token ?? "").trim();
      if (!/^AC[0-9a-f]{32}$/i.test(sid) || token.length < 20) return json({ error: "That doesn't look like a Twilio Account SID and Auth Token." }, 400);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers: { authorization: "Basic " + btoa(`${sid}:${token}`) } });
      if (!r.ok) return json({ error: "Twilio didn't accept those keys." }, 400);
      await db.from("hub_secrets").upsert([{ key: "twilio_sid", value: sid }, { key: "twilio_token", value: token }]);
      return json({ ok: true });
    }
    if (op === "search_numbers") {
      if (!agency) return json({ error: "Only the studio owner can buy numbers." }, 403);
      const area = String(b.area_code ?? "").replace(/\D/g, "").slice(0, 3);
      const r = await twilio(`/AvailablePhoneNumbers/US/Local.json?SmsEnabled=true&VoiceEnabled=true&PageSize=10${area ? `&AreaCode=${area}` : ""}`);
      return r.ok ? json({ numbers: (r.data.available_phone_numbers ?? []).map((n: any) => ({ number: n.phone_number, city: n.locality, state: n.region })) })
        : json({ error: r.data?.message ?? "Search failed" }, 400);
    }
    if (op === "buy_number" || op === "connect_number") {
      if (!agency) return json({ error: "Only the studio owner can manage numbers." }, 403);
      const num = String(b.number ?? "");
      const { data: a } = await db.from("hub_accounts").select("id,name").eq("id", acct).single();
      let sid: string | null = null;
      if (op === "buy_number") {
        const r = await twilio("/IncomingPhoneNumbers.json", { PhoneNumber: num, FriendlyName: `KWS Hub: ${a!.name}`, ...hooks });
        if (!r.ok) return json({ error: r.data?.message ?? "Couldn't buy that number" }, 400);
        sid = r.data.sid;
      } else {
        const r = await twilio(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(num)}`);
        sid = r.data?.incoming_phone_numbers?.[0]?.sid ?? null;
        if (!sid) return json({ error: "That number isn't in your Twilio account." }, 404);
        const u = await twilio(`/IncomingPhoneNumbers/${sid}.json`, { FriendlyName: `KWS Hub: ${a!.name}`, ...hooks });
        if (!u.ok) return json({ error: u.data?.message ?? "Couldn't update the number" }, 400);
      }
      await db.from("hub_accounts").update({ sms_number: null }).eq("sms_number", num);
      await db.from("hub_accounts").update({ sms_number: num }).eq("id", acct);
      return json({ ok: true, number: num });
    }

    if (op === "invite") {
      if (!agency) return json({ error: "Only the studio owner can add people." }, 403);
      const e = String(b.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return json({ error: "Enter an email address." }, 400);
      const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
      let u = list?.users.find((x) => x.email?.toLowerCase() === e);
      if (!u) u = (await db.auth.admin.createUser({ email: e, email_confirm: true, password: crypto.randomUUID() + "Aa1!" })).data.user!;
      await db.from("hub_members").upsert({ account_id: acct, user_id: u.id, role: b.role === "admin" ? "admin" : "member" });
      const { data: a } = await db.from("hub_accounts").select("name").eq("id", acct).single();
      await sendEmail(null, e, `You're set up in KWS Hub for ${a!.name}`,
        `Hi,\n\nYou now have access to KWS Hub for ${a!.name}: your leads, texts, bookings and follow-ups in one place.\n\nTo sign in, open ${SITE}/hub/ , choose "First time or forgot password", and enter this email. We'll send you a code.\n\nChristian\nKnightWebstudio`);
      return json({ ok: true });
    }

    if (op === "test_email") {
      const r = await sendEmail(null, me.user.email!, "KWS Hub test email", "Email sending from KWS Hub works.");
      return json(r, r.ok ? 200 : 400);
    }
    return json({ error: "Unknown op" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong." }, 500);
  }
}
