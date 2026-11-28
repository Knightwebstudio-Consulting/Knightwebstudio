// KWS Hub app. Plain ES module, no build step. Data comes straight from Supabase (row-level
// security decides what each person sees); anything needing a key goes through the hub function.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://uhmyfoibrwdkdhrnnaah.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVobXlmb2licndka2Rocm5uYWFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODYwMTUsImV4cCI6MjExMDI2MjAxNX0.qcM1s6smmKavFEOZ8MthpQa_uciMjL6lZSo5w8zOTVw";
const FN = `${SUPABASE_URL}/functions/v1/hub`;
const SITE = "https://knightwebstudio.com";
const sb = createClient(SUPABASE_URL, ANON, { auth: { persistSession: true, storageKey: "kws-hub" } });

// ---------- tiny helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = $("#app");
const modal = $("#modal");
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }
const fail = (e) => { console.error(e); toast(e?.message || "Something went wrong"); };
const name = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(" ") || fmtPhone(c?.phone) || c?.email || "Unknown";
const initials = (c) => (name(c).match(/\b\w/g) || ["?"]).slice(0, 2).join("").toUpperCase();
function fmtPhone(p) { const d = String(p ?? "").replace(/\D/g, ""); return d.length === 11 && d[0] === "1" ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : p || ""; }
function e164(p) { const d = String(p ?? "").replace(/\D/g, ""); if (!d) return null; if (d.length === 10) return "+1" + d; if (d.length === 11 && d[0] === "1") return "+" + d; return String(p).trim().startsWith("+") ? "+" + d : null; }
const money = (n) => "$" + Math.round(Number(n || 0)).toLocaleString("en-US");
function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const tz = () => state.acct?.timezone || "America/Chicago";
const fmtWhen = (iso, o = {}) => new Intl.DateTimeFormat("en-US", { timeZone: tz(), weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...o }).format(new Date(iso));
const fmtDay = (iso) => new Intl.DateTimeFormat("en-US", { timeZone: tz(), weekday: "long", month: "long", day: "numeric" }).format(new Date(iso));
const slugify = (s) => String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

async function api(op, body = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${FN}?fn=api`, { method: "POST", headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify({ op, ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }

const icons = {
  today: '<path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>',
  inbox: '<path d="M4 5h16v11a2 2 0 0 1-2 2h-4l-2 3-2-3H6a2 2 0 0 1-2-2z"/>',
  contacts: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  pipeline: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  automations: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  campaigns: '<path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M16 9a3 3 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const ic = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[k]}</svg>`;
const VIEWS = [["today", "Today"], ["inbox", "Inbox"], ["contacts", "Contacts"], ["pipeline", "Pipeline"], ["calendar", "Calendar"],
  ["automations", "Automations"], ["campaigns", "Campaigns"], ["reports", "Reports"], ["settings", "Settings"], ["more", "More"]];
const PHONE_TABS = new Set(["today", "inbox", "contacts", "pipeline", "calendar", "more"]);

// ---------- state ----------
const state = { user: null, accounts: [], acct: null, isAgency: false, unread: 0, inboxContact: null };

// ---------- sign in ----------
function authView(mode = "signin", email = "") {
  app.innerHTML = `<div class="auth"><form class="card" id="authf">
    <div class="brand"><img src="/assets/img/crest.svg" alt="" width="34" height="35">KWS Hub</div>
    <p class="lead">${mode === "signin" ? "Sign in to your leads, texts and bookings." : mode === "code" ? "We'll email you a 6-digit code." : "Enter the code and choose a password."}</p>
    <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="email" required value="${esc(email)}" ${mode === "set" ? "readonly" : ""}></div>
    ${mode === "signin" ? `<div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>` : ""}
    ${mode === "set" ? `<div class="field"><label for="cd">Code from the email</label><input id="cd" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>
      <div class="field"><label for="np">New password</label><input id="np" type="password" autocomplete="new-password" minlength="10" required><div class="hint">At least 10 characters.</div></div>` : ""}
    <button class="btn primary" style="width:100%">${mode === "signin" ? "Sign in" : mode === "code" ? "Email me a code" : "Save password and sign in"}</button>
    <p class="small muted" style="text-align:center;margin:16px 0 0">${mode === "signin"
      ? `<a href="#" id="toCode">First time, or forgot your password?</a>` : `<a href="#" id="toSignin">Back to sign in</a>`}</p>
  </form></div>`;
  $("#toCode")?.addEventListener("click", (e) => { e.preventDefault(); authView("code", $("#em").value); });
  $("#toSignin")?.addEventListener("click", (e) => { e.preventDefault(); authView("signin", $("#em").value); });
  $("#authf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#authf button"); btn.disabled = true;
    const em = $("#em").value.trim().toLowerCase();
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email: em, password: $("#pw").value });
        if (error) throw new Error("That email and password don't match.");
        return start();
      }
      if (mode === "code") { await api("request_code", { email: em }); toast("If that email has access, a code is on its way."); return authView("set", em); }
      await api("set_password", { email: em, code: $("#cd").value, password: $("#np").value });
      const { error } = await sb.auth.signInWithPassword({ email: em, password: $("#np").value });
      if (error) throw error;
      start();
    } catch (err) { fail(err); btn.disabled = false; }
  });
}

// ---------- shell ----------
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return authView();
  state.user = session.user;
  state.accounts = await q(sb.from("hub_accounts").select("*").order("kind").order("name"));
  if (!state.accounts.length) {
    app.innerHTML = `<div class="auth"><div class="card"><h2>No account yet</h2><p class="muted">You're signed in as ${esc(state.user.email)}, but no business has been shared with you. Ask KnightWebstudio to add you.</p><button class="btn" id="so">Sign out</button></div></div>`;
    $("#so").onclick = async () => { await sb.auth.signOut(); authView(); };
    return;
  }
  const mem = await q(sb.from("hub_members").select("role, account_id").eq("user_id", state.user.id));
  state.isAgency = mem.some((m) => ["owner", "admin"].includes(m.role) && state.accounts.find((a) => a.id === m.account_id)?.kind === "agency");
  const saved = localStorageGet("kws-hub-acct");
  state.acct = state.accounts.find((a) => a.id === saved) || state.accounts[0];
  window.addEventListener("hashchange", route);
  route();
  setInterval(refreshUnread, 30000);
}
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

function shell(view, inner) {
  const opts = state.accounts.map((a) => `<option value="${a.id}" ${a.id === state.acct.id ? "selected" : ""}>${esc(a.name)}${a.kind === "agency" ? " (studio)" : ""}</option>`).join("");
  const sel = state.accounts.length > 1 ? `<select aria-label="Business" class="acctsel">${opts}</select>` : `<div class="small muted" style="padding:0 6px">${esc(state.acct.name)}</div>`;
  app.innerHTML = `<div class="shell">
    <aside class="side">
      <div class="brand"><img src="/assets/img/crest.svg" alt="" width="30" height="31">KWS Hub</div>
      <div class="acct">${sel}</div>
      <nav class="nav" aria-label="Main">${VIEWS.map(([k, l]) => `<a href="#/${k}" class="${k === "more" ? "phone-only" : PHONE_TABS.has(k) ? "" : "desk-only"}" ${k === view || (k === "more" && !PHONE_TABS.has(view)) ? 'aria-current="page"' : ""}>${ic(k)}<span>${l}</span>${k === "inbox" && state.unread ? `<span class="count">${state.unread}</span>` : ""}</a>`).join("")}</nav>
      <div class="me">${esc(state.user.email)}<br><button class="btn small" id="signout">Sign out</button></div>
    </aside>
    <main id="main"><div class="mobile-acct">${sel}</div>${inner}</main></div>`;
  $$(".acctsel").forEach((s) => s.addEventListener("change", (e) => { state.acct = state.accounts.find((a) => a.id === e.target.value); localStorageSet("kws-hub-acct", state.acct.id); state.inboxContact = null; route(); }));
  $("#signout").onclick = async () => { await sb.auth.signOut(); location.hash = ""; authView(); };
}
async function refreshUnread() {
  if (!state.acct) return;
  const rows = await q(sb.from("hub_contacts").select("unread").eq("account_id", state.acct.id).gt("unread", 0)).catch(() => []);
  const n = rows.reduce((s, r) => s + r.unread, 0);
  if (n !== state.unread) { state.unread = n; const nav = $('.nav a[href="#/inbox"]'); if (nav) { nav.querySelector(".count")?.remove(); if (n) nav.insertAdjacentHTML("beforeend", `<span class="count">${n}</span>`); } }
}
async function route() {
  const [view, arg] = (location.hash.replace(/^#\//, "") || "today").split("/");
  const v = VIEWS.find(([k]) => k === view) ? view : "today";
  await refreshUnread();
  shell(v, `<div class="empty">Loading…</div>`);
  clearInterval(state.poll);
  try { await ({ today, inbox, contacts, pipeline, calendar, automations, campaigns, reports, settings, more }[v])(arg); } catch (e) { fail(e); }
}
const main = () => $("#main");
function setMain(html) { main().innerHTML = `<div class="mobile-acct">${$(".mobile-acct")?.innerHTML ?? ""}</div>` + html;
  $$(".mobile-acct .acctsel").forEach((s) => s.addEventListener("change", (e) => { state.acct = state.accounts.find((a) => a.id === e.target.value); localStorageSet("kws-hub-acct", state.acct.id); route(); })); }
const A = () => state.acct.id;

// ---------- modal ----------
function openModal(html, { wide = false } = {}) {
  modal.className = wide ? "wide" : ""; modal.innerHTML = `<div class="dlg">${html}</div>`;
  if (!modal.open) modal.showModal();
  $$("[data-close]", modal).forEach((b) => b.addEventListener("click", () => modal.close()));
}
modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

// ---------- Today ----------
async function today() {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [newC, opps, appts, recent, tasks, failed] = await Promise.all([
    q(sb.from("hub_contacts").select("id", { count: "exact", head: false }).eq("account_id", A()).gte("created_at", since)),
    q(sb.from("hub_opportunities").select("value,status,stage_id").eq("account_id", A()).eq("status", "open")),
    q(sb.from("hub_appointments").select("*, hub_contacts(first_name,last_name,phone)").eq("account_id", A()).eq("status", "booked").gte("end_at", new Date().toISOString()).order("start_at").limit(8)),
    q(sb.from("hub_messages").select("*, hub_contacts(id,first_name,last_name,phone,email)").eq("account_id", A()).neq("direction", "internal").order("created_at", { ascending: false }).limit(12)),
    q(sb.from("hub_tasks").select("*, hub_contacts(id,first_name,last_name,phone,email)").eq("account_id", A()).is("done_at", null).order("due_at", { ascending: true, nullsFirst: false }).limit(30)),
    q(sb.from("hub_outbox").select("id", { count: "exact" }).eq("account_id", A()).eq("status", "failed").gte("created_at", since)),
  ]);
  const missed = recent.filter((m) => m.kind === "missed_call").length;
  const value = opps.reduce((s, o) => s + Number(o.value || 0), 0);
  const a = state.acct;
  const setup = [];
  if (!a.sms_number) setup.push(`No texting number yet, so missed-call text-back and text reminders are off. <a href="#/settings">Set up texting</a>`);
  if (!a.review_link) setup.push(`Add your Google review link so review requests can go out. <a href="#/automations">Add it</a>`);
  if (!a.notify_email) setup.push(`Add an email for new-lead alerts. <a href="#/settings">Settings</a>`);
  setMain(`<div class="head"><div><h1>${esc(a.name)}</h1><p class="muted">${new Intl.DateTimeFormat("en-US", { timeZone: tz(), weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p></div>
      <div class="row"><button class="btn" id="addC">Add contact</button><a class="btn primary" href="#/inbox">Open inbox</a></div></div>
    ${setup.map((s) => `<div class="notice">${s}</div>`).join("")}
    ${failed.length ? `<div class="notice">${failed.length} message${failed.length > 1 ? "s" : ""} failed to send this week. Open the contact to see why.</div>` : ""}
    <div class="cards">
      <div class="card stat"><div class="n">${newC.length}</div><div class="l">New contacts, last 7 days</div></div>
      <div class="card stat"><div class="n">${state.unread}</div><div class="l">Unread messages</div></div>
      <div class="card stat"><div class="n">${opps.length}</div><div class="l">Open jobs · ${money(value)}</div></div>
      <div class="card stat"><div class="n">${appts.length}</div><div class="l">Upcoming appointments</div></div>
    </div>
    <div class="two">
      <section class="card"><h2>Latest activity</h2>${recent.length ? `<ul class="list">${recent.map((m) => `<li><a class="rowlink" href="#/inbox/${m.contact_id}">
        <span class="av">${esc(initials(m.hub_contacts))}</span><span class="grow"><span class="t">${esc(name(m.hub_contacts))}</span>
        <span class="s">${esc(label(m))}</span></span><span class="small muted">${ago(m.created_at)}</span></a></li>`).join("")}</ul>`
        : `<div class="empty"><b>Nothing yet</b>New leads, texts, calls and bookings show up here.</div>`}</section>
      <section class="card"><h2>Coming up</h2>${appts.length ? `<ul class="list">${appts.map((p) => `<li><span class="grow"><span class="t">${esc(name(p.hub_contacts))}</span><span class="s">${esc(fmtWhen(p.start_at))}</span></span>
        ${p.contact_id ? `<a class="btn small" href="#/inbox/${p.contact_id}">Message</a>` : ""}</li>`).join("")}</ul>`
        : `<div class="empty"><b>No appointments</b>Share your booking link from Calendar.</div>`}
        ${missed ? `<p class="small muted">${missed} missed call${missed > 1 ? "s" : ""} texted back recently.</p>` : ""}</section>
    </div>
    <section class="card"><div class="head" style="margin:0 0 6px"><h2 style="margin:0">To do</h2><button class="btn small" id="addT">Add task</button></div>${taskList(tasks)}</section>`);
  $("#addC").onclick = () => contactForm();
  $("#addT").onclick = () => taskForm(null, today);
  wireTasks(today);
}

// ---------- Tasks ----------
function taskList(tasks, showContact = true) {
  if (!tasks.length) return `<div class="empty" style="padding:18px 10px"><b>Nothing to do</b>Add a call-back or a reminder and it shows up here.</div>`;
  const now = Date.now();
  return `<ul class="list">${tasks.map((t) => { const due = t.due_at ? Date.parse(t.due_at) : null; const late = due && due < now;
    return `<li><label class="switch" style="padding:0;border:0;margin:0"><input type="checkbox" data-done="${t.id}" aria-label="Mark done"></label>
      <span class="grow"><span class="t">${esc(t.title)}</span><span class="s">${showContact && t.hub_contacts ? `<a href="#/inbox/${t.contact_id}">${esc(name(t.hub_contacts))}</a> · ` : ""}${due ? `<span class="${late ? "badge red" : ""}">${late ? "Overdue · " : ""}${esc(fmtWhen(t.due_at))}</span>` : "No due date"}</span></span>
      <button class="btn small ghost" data-deltask="${t.id}" aria-label="Delete task">Delete</button></li>`; }).join("")}</ul>`;
}
function wireTasks(after) {
  $$("[data-done]").forEach((b) => b.addEventListener("change", async () => { try { await q(sb.from("hub_tasks").update({ done_at: new Date().toISOString() }).eq("id", b.dataset.done)); toast("Done"); after(); } catch (e) { fail(e); } }));
  $$("[data-deltask]").forEach((b) => b.addEventListener("click", async () => { try { await q(sb.from("hub_tasks").delete().eq("id", b.dataset.deltask)); after(); } catch (e) { fail(e); } }));
}
async function taskForm(contactId, after) {
  const people = contactId ? [] : await q(sb.from("hub_contacts").select("id,first_name,last_name,phone,email").eq("account_id", A()).order("last_activity_at", { ascending: false }).limit(300));
  const tomorrow = new Date(Date.now() + 86400_000); tomorrow.setHours(9, 0, 0, 0);
  const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal(`<header><h2>Add task</h2><button class="btn small" data-close>Close</button></header><form id="tf">
    <div class="field"><label for="tt">What needs doing</label><input id="tt" required placeholder="Call back about the roof quote"></div>
    <div class="grid2"><div class="field"><label for="td">Due</label><input id="td" type="datetime-local" value="${local}"></div>
    ${contactId ? "" : `<div class="field"><label for="tc">Contact</label><select id="tc"><option value="">—</option>${people.map((c) => `<option value="${c.id}">${esc(name(c))}</option>`).join("")}</select></div>`}</div>
    <footer><button class="btn primary">Save</button></footer></form>`);
  $("#tf").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await q(sb.from("hub_tasks").insert({ account_id: A(), title: $("#tt").value.trim(), due_at: $("#td").value ? new Date($("#td").value).toISOString() : null, contact_id: contactId || $("#tc")?.value || null }));
      modal.close(); toast("Task added"); after(); } catch (err) { fail(err); }
  });
}

// ---------- More (phones) ----------
async function more() {
  setMain(`<div class="head"><h1>More</h1></div><section class="card"><ul class="list">${VIEWS.filter(([k]) => !PHONE_TABS.has(k)).map(([k, l]) =>
    `<li><a class="rowlink" href="#/${k}"><span class="av">${ic(k)}</span><span class="grow"><span class="t">${l}</span></span><span class="muted">›</span></a></li>`).join("")}</ul>
    <p class="small muted" style="margin-top:14px">${esc(state.user.email)}</p><button class="btn small" id="so2">Sign out</button></section>`);
  $("#so2").onclick = async () => { await sb.auth.signOut(); location.hash = ""; authView(); };
}
function label(m) {
  const k = { missed_call: "Missed call, texted back", form: "Filled in your form", booking: "Booking", review: "Review request sent", reminder: "Reminder sent", autoreply: "Instant reply sent", confirmation: "Booking confirmed", voicemail: "Left a voicemail" }[m.kind];
  const pre = m.direction === "in" ? "" : "You: ";
  return k ? `${k}${m.kind === "form" || m.kind === "booking" ? "" : ""}` : pre + String(m.body ?? "").replace(/\s+/g, " ").slice(0, 90);
}

// ---------- Inbox ----------
async function inbox(contactId) {
  const threads = await q(sb.from("hub_contacts").select("id,first_name,last_name,phone,email,unread,last_activity_at,dnd_sms")
    .eq("account_id", A()).order("last_activity_at", { ascending: false }).limit(150));
  const ids = threads.map((t) => t.id);
  const last = ids.length ? await q(sb.from("hub_messages").select("contact_id,body,kind,direction,created_at").in("contact_id", ids).neq("direction", "internal").order("created_at", { ascending: false }).limit(400)) : [];
  const lastBy = {}; for (const m of last) lastBy[m.contact_id] ??= m;
  const withMsgs = threads.filter((t) => lastBy[t.id]);
  const sel = contactId || state.inboxContact || null;
  setMain(`<div class="head"><h1>Inbox</h1><input class="search" type="search" placeholder="Search conversations" id="ifind" aria-label="Search conversations"></div>
    <div class="inbox ${contactId ? "open" : ""}"><div class="threads"><ul class="list" id="tlist">${withMsgs.map((t) => `<li data-id="${t.id}" ${t.id === sel ? 'aria-current="true"' : ""}>
      <span class="av">${esc(initials(t))}</span><span class="grow"><span class="t">${esc(name(t))}</span><span class="s">${esc(label(lastBy[t.id]))}</span></span>
      <span style="text-align:right"><span class="small muted">${ago(lastBy[t.id].created_at)}</span>${t.unread ? `<br><span class="dot" style="display:inline-block"></span>` : ""}</span></li>`).join("")
      || `<li><div class="empty" style="width:100%"><b>No conversations yet</b>Texts, form fills, calls and bookings land here.</div></li>`}</ul></div>
    <div class="thread" id="thread"><div class="empty" style="margin:auto"><b>Pick a conversation</b></div></div></div>`);
  $$("#tlist li[data-id]").forEach((li) => li.addEventListener("click", () => { location.hash = `#/inbox/${li.dataset.id}`; }));
  $("#ifind").addEventListener("input", (e) => { const v = e.target.value.toLowerCase(); $$("#tlist li[data-id]").forEach((li) => { li.hidden = !li.textContent.toLowerCase().includes(v); }); });
  if (sel) { state.inboxContact = sel; await openThread(sel); }
}
async function openThread(id) {
  const [c, msgs, seqs] = await Promise.all([
    q(sb.from("hub_contacts").select("*").eq("id", id).single()),
    q(sb.from("hub_messages").select("*").eq("contact_id", id).order("created_at").limit(500)),
    q(sb.from("hub_sequences").select("id,name").eq("account_id", A()).eq("active", true)),
  ]);
  if (c.unread) { await sb.from("hub_contacts").update({ unread: 0 }).eq("id", id); refreshUnread(); }
  const canSms = !!state.acct.sms_number && !!c.phone && !c.dnd_sms;
  const defCh = canSms ? "sms" : c.email ? "email" : "sms";
  $("#thread").innerHTML = `<div class="top"><button class="btn small ghost" id="back" aria-label="Back to conversations">‹</button>
      <span class="av">${esc(initials(c))}</span><span class="grow" style="flex:1;min-width:0"><b>${esc(name(c))}</b><br><span class="small muted">${esc(fmtPhone(c.phone))}${c.phone && c.email ? " · " : ""}${esc(c.email || "")}${c.dnd_sms ? ' · <span class="badge red">No texts</span>' : ""}</span></span>
      ${c.phone ? `<a class="btn small" href="tel:${esc(c.phone)}">Call</a>` : ""}<button class="btn small" id="openC">Details</button></div>
    <div class="msgs" id="msgs">${msgs.map(bubble).join("") || `<div class="empty">No messages yet.</div>`}</div>
    <form class="compose" id="cf">
      <div class="row"><select id="ch" aria-label="Send as" style="width:auto">${c.phone ? `<option value="sms" ${defCh === "sms" ? "selected" : ""}>Text</option>` : ""}${c.email ? `<option value="email" ${defCh === "email" ? "selected" : ""}>Email</option>` : ""}<option value="note">Private note</option></select>
        <input id="subj" placeholder="Subject" ${defCh === "email" ? "" : "hidden"} aria-label="Subject">
        ${seqs.length ? `<select id="enr" aria-label="Start a follow-up" style="width:auto;margin-left:auto"><option value="">Start follow-up…</option>${seqs.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select>` : ""}</div>
      <div class="row"><textarea id="body" placeholder="${state.acct.sms_number || defCh !== "sms" ? "Write a message" : "Texting isn't set up yet. Choose Email or a private note."}" aria-label="Message"></textarea><button class="btn primary">Send</button></div>
    </form>`;
  const box = $("#msgs"); box.scrollTop = box.scrollHeight;
  clearInterval(state.poll);
  state.poll = setInterval(async () => {
    if (!$("#msgs") || document.hidden) return;
    const { count } = await sb.from("hub_messages").select("id", { count: "exact", head: true }).eq("contact_id", id);
    if (count != null && count !== msgs.length && !$("#body")?.value) openThread(id);
  }, 12000);
  $("#back").onclick = () => { state.inboxContact = null; location.hash = "#/inbox"; };
  $("#openC").onclick = () => contactDrawer(id);
  $("#ch").onchange = (e) => { $("#subj").hidden = e.target.value !== "email"; };
  $("#body").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("#cf").requestSubmit(); });
  $("#enr")?.addEventListener("change", async (e) => { if (!e.target.value) return; try { await api("enroll", { account_id: A(), sequence_id: e.target.value, contact_id: id }); toast("Follow-up started"); } catch (err) { fail(err); } e.target.value = ""; });
  $("#cf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = $("#body").value.trim(); if (!body) return;
    const ch = $("#ch").value; const btn = $("#cf .btn.primary"); btn.disabled = true;
    try {
      if (ch === "note") await q(sb.from("hub_messages").insert({ account_id: A(), contact_id: id, channel: "note", direction: "internal", body }));
      else await api("send", { account_id: A(), contact_id: id, channel: ch, body, subject: $("#subj").value || state.acct.name });
      $("#body").value = ""; await openThread(id);
    } catch (err) { fail(err); btn.disabled = false; }
  });
}
function bubble(m) {
  const t = new Date(m.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const failed = String(m.status || "").startsWith("failed");
  const via = m.channel === "email" ? "Email" : m.channel === "sms" ? "Text" : m.channel === "call" ? "Call" : "";
  const kind = { missed_call: " · missed-call text", autoreply: " · instant reply", review: " · review request", reminder: " · reminder", confirmation: " · confirmation", sequence: " · follow-up", owner_relay: " · from your phone" }[m.kind] || "";
  if (m.channel === "note") return `<div class="msg note"><b>Note</b> ${esc(m.body)}<span class="meta">${t}</span></div>`;
  if (m.channel === "system" || m.channel === "call") {
    const body = m.kind === "voicemail" ? esc(m.body).replace(/(https:\/\/\S+\.mp3)/, '<a href="$1" target="_blank" rel="noopener">Play voicemail</a>') : esc(m.body);
    return `<div class="msg sys">${body}<span class="meta">${t}</span></div>`;
  }
  return `<div class="msg ${m.direction === "in" ? "in" : "out"} ${failed ? "failed" : ""}">${m.subject && m.channel === "email" ? `<b>${esc(m.subject)}</b>\n` : ""}${esc(m.body)}
    <span class="meta">${via}${kind} · ${t}${m.direction === "out" && m.status ? ` · ${esc(failed ? m.status : m.status)}` : ""}</span></div>`;
}

// ---------- Contacts ----------
async function contacts() {
  const rows = await q(sb.from("hub_contacts").select("*").eq("account_id", A()).order("created_at", { ascending: false }).limit(1000));
  setMain(`<div class="head"><div><h1>Contacts</h1><p class="muted">${rows.length} people</p></div>
      <div class="row"><input class="search" type="search" placeholder="Search name, phone, email, tag" id="cfind" aria-label="Search contacts">
      <button class="btn" id="imp">Import CSV</button><button class="btn primary" id="addC">Add contact</button></div></div>
    <section class="card"><ul class="list" id="clist">${rows.map((c) => `<li data-id="${c.id}" style="cursor:pointer"><span class="av">${esc(initials(c))}</span>
      <span class="grow"><span class="t">${esc(name(c))}${c.company ? ` <span class="muted">· ${esc(c.company)}</span>` : ""}</span><span class="s">${esc(fmtPhone(c.phone))} ${esc(c.email || "")}</span></span>
      <span class="small">${(c.tags || []).map((t) => `<span class="badge">${esc(t)}</span>`).join(" ")} ${c.source ? `<span class="badge blue">${esc(c.source.replace("form:", "form "))}</span>` : ""}</span>
      <span class="small muted" style="min-width:64px;text-align:right">${ago(c.created_at)}</span></li>`).join("")
      || `<li><div class="empty" style="width:100%"><b>No contacts yet</b>Add one, import a CSV, or put your form on your website.</div></li>`}</ul></section>`);
  $("#addC").onclick = () => contactForm();
  $("#imp").onclick = importCsv;
  $("#cfind").addEventListener("input", (e) => { const v = e.target.value.toLowerCase().replace(/[()\s-]/g, ""); $$("#clist li[data-id]").forEach((li) => { li.hidden = !li.textContent.toLowerCase().replace(/[()\s-]/g, "").includes(v); }); });
  $$("#clist li[data-id]").forEach((li) => li.addEventListener("click", () => contactDrawer(li.dataset.id)));
}
function contactForm(c = {}, after) {
  openModal(`<header><h2>${c.id ? "Edit contact" : "Add contact"}</h2><button class="btn small" data-close>Close</button></header>
    <form id="cform"><div class="grid2">
      <div class="field"><label for="fn">First name</label><input id="fn" value="${esc(c.first_name)}"></div>
      <div class="field"><label for="ln">Last name</label><input id="ln" value="${esc(c.last_name)}"></div>
      <div class="field"><label for="ph">Mobile phone</label><input id="ph" type="tel" value="${esc(fmtPhone(c.phone))}"></div>
      <div class="field"><label for="em2">Email</label><input id="em2" type="email" value="${esc(c.email)}"></div>
      <div class="field"><label for="co">Company</label><input id="co" value="${esc(c.company)}"></div>
      <div class="field"><label for="tg">Tags</label><input id="tg" value="${esc((c.tags || []).join(", "))}"><div class="hint">Separate with commas.</div></div></div>
      <div class="field"><label for="nt">Notes</label><textarea id="nt">${esc(c.notes)}</textarea></div>
      ${c.id ? `<div class="switch"><span>No texts (they opted out)</span><input type="checkbox" id="dnds" ${c.dnd_sms ? "checked" : ""}></div>
        <div class="switch"><span>No emails</span><input type="checkbox" id="dnde" ${c.dnd_email ? "checked" : ""}></div>` : ""}
      ${!c.id ? `<div class="switch"><span>Also add a card to the pipeline</span><input type="checkbox" id="mkopp" checked></div>` : ""}
      <footer>${c.id ? `<button type="button" class="btn danger" id="del">Delete</button>` : ""}<button class="btn primary">Save</button></footer></form>`);
  $("#del")?.addEventListener("click", async () => { if (!confirm(`Delete ${name(c)} and their whole conversation?`)) return; try { await q(sb.from("hub_contacts").delete().eq("id", c.id)); modal.close(); toast("Deleted"); route(); } catch (e) { fail(e); } });
  $("#cform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = { account_id: A(), first_name: $("#fn").value.trim() || null, last_name: $("#ln").value.trim() || null, phone: e164($("#ph").value),
      email: $("#em2").value.trim().toLowerCase() || null, company: $("#co").value.trim() || null, notes: $("#nt").value.trim() || null,
      tags: $("#tg").value.split(",").map((t) => t.trim()).filter(Boolean) };
    if ($("#ph").value.trim() && !row.phone) return toast("Check the phone number");
    if (c.id) { row.dnd_sms = $("#dnds").checked; row.dnd_email = $("#dnde").checked; }
    try {
      const saved = c.id ? await q(sb.from("hub_contacts").update(row).eq("id", c.id).select().single())
        : await q(sb.from("hub_contacts").insert({ ...row, source: "manual" }).select().single());
      if (!c.id && $("#mkopp").checked) {
        const st = await q(sb.from("hub_stages").select("id,pipeline_id").eq("account_id", A()).order("position").limit(1));
        if (st.length) await q(sb.from("hub_opportunities").insert({ account_id: A(), contact_id: saved.id, pipeline_id: st[0].pipeline_id, stage_id: st[0].id, title: name(saved) }));
      }
      modal.close(); toast("Saved"); after ? after(saved) : route();
    } catch (err) { fail(err); }
  });
}
async function contactDrawer(id) {
  const [c, msgs, opps, appts, stages] = await Promise.all([
    q(sb.from("hub_contacts").select("*").eq("id", id).single()),
    q(sb.from("hub_messages").select("*").eq("contact_id", id).order("created_at", { ascending: false }).limit(60)),
    q(sb.from("hub_opportunities").select("*").eq("contact_id", id)),
    q(sb.from("hub_appointments").select("*").eq("contact_id", id).order("start_at", { ascending: false })),
    q(sb.from("hub_stages").select("id,name").eq("account_id", A()).order("position")),
  ]);
  const tasks = await q(sb.from("hub_tasks").select("*").eq("contact_id", id).is("done_at", null).order("due_at"));
  const sname = (sid) => stages.find((s) => s.id === sid)?.name ?? "";
  openModal(`<header><div class="row"><span class="av">${esc(initials(c))}</span><div><h2>${esc(name(c))}</h2><span class="small muted">Added ${ago(c.created_at)}${c.source ? ` from ${esc(c.source)}` : ""}</span></div></div>
      <div class="row"><button class="btn small" id="edit">Edit</button><a class="btn small primary" href="#/inbox/${c.id}" id="msg">Message</a><button class="btn small" data-close>Close</button></div></header>
    <div class="contact-grid"><div class="stack">
      <dl class="kv"><dt>Phone</dt><dd>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(fmtPhone(c.phone))}</a>` : "—"}</dd><dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"}</dd>
        <dt>Company</dt><dd>${esc(c.company || "—")}</dd><dt>Tags</dt><dd>${(c.tags || []).map((t) => `<span class="badge">${esc(t)}</span>`).join(" ") || "—"}</dd>
        ${c.dnd_sms || c.dnd_email ? `<dt>Opted out</dt><dd>${[c.dnd_sms && "texts", c.dnd_email && "email"].filter(Boolean).join(", ")}</dd>` : ""}</dl>
      ${c.notes ? `<p class="small" style="white-space:pre-wrap">${esc(c.notes)}</p>` : ""}
      <h3>Jobs</h3>${opps.map((o) => `<div class="row small"><span class="badge ${o.status === "won" ? "green" : o.status === "lost" ? "red" : "blue"}">${esc(sname(o.stage_id))}</span> ${esc(o.title)} ${o.value ? `· ${money(o.value)}` : ""}</div>`).join("") || `<p class="small muted">None</p>`}
      <h3>Appointments</h3>${appts.map((p) => `<div class="small">${esc(fmtWhen(p.start_at))} <span class="badge ${p.status === "booked" ? "blue" : ""}">${p.status}</span></div>`).join("") || `<p class="small muted">None</p>`}
      <div class="row" style="justify-content:space-between"><h3>To do</h3><button class="btn small" id="ctask">Add task</button></div>${taskList(tasks, false)}
    </div><div><h3 style="margin-bottom:8px">History</h3><div class="timeline">${msgs.map(bubble).join("") || `<p class="muted small">Nothing yet.</p>`}</div></div></div>`, { wide: true });
  $("#edit").onclick = () => contactForm(c, () => contactDrawer(id));
  $("#ctask").onclick = () => taskForm(id, () => contactDrawer(id));
  wireTasks(() => contactDrawer(id));
  $("#msg").onclick = () => modal.close();
}
function importCsv() {
  openModal(`<header><h2>Import contacts</h2><button class="btn small" data-close>Close</button></header>
    <p class="small muted">A CSV with a header row. Columns we read: name (or first name and last name), phone, email, company, tags. Duplicates by phone or email are skipped.</p>
    <input type="file" id="csv" accept=".csv,text/csv"><footer><button class="btn primary" id="go" disabled>Import</button></footer>`);
  let rows = [];
  $("#csv").onchange = async (e) => { rows = parseCsv(await e.target.files[0].text()); $("#go").disabled = !rows.length; $("#go").textContent = `Import ${rows.length}`; };
  $("#go").onclick = async () => {
    const have = await q(sb.from("hub_contacts").select("phone,email").eq("account_id", A()));
    const seen = new Set(have.flatMap((h) => [h.phone, h.email?.toLowerCase()]).filter(Boolean));
    const out = [];
    for (const r of rows) {
      const g = (...ks) => { for (const k of ks) { const v = r[k]; if (v) return v.trim(); } return ""; };
      const full = g("name", "full name", "contact"); const parts = full.split(/\s+/);
      const row = { account_id: A(), first_name: g("first name", "first", "firstname") || parts[0] || null, last_name: g("last name", "last", "lastname") || parts.slice(1).join(" ") || null,
        phone: e164(g("phone", "mobile", "phone number", "cell")), email: g("email", "email address").toLowerCase() || null, company: g("company", "business", "business name") || null,
        tags: g("tags").split(/[;,]/).map((t) => t.trim()).filter(Boolean), source: "import" };
      if (!row.phone && !row.email) continue;
      if ((row.phone && seen.has(row.phone)) || (row.email && seen.has(row.email))) continue;
      seen.add(row.phone); seen.add(row.email); out.push(row);
    }
    try { for (let i = 0; i < out.length; i += 500) await q(sb.from("hub_contacts").insert(out.slice(i, i + 500))); modal.close(); toast(`Imported ${out.length}`); route(); } catch (err) { fail(err); }
  };
}
function parseCsv(text) {
  const lines = []; let cur = [""], inQ = false, row = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"' && text[i + 1] === '"') { cur[0] += '"'; i++; } else if (ch === '"') inQ = false; else cur[0] += ch; continue; }
    if (ch === '"') inQ = true; else if (ch === ",") { row.push(cur[0]); cur = [""]; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur[0]); lines.push(row); row = []; cur = [""]; } else cur[0] += ch;
  }
  if (cur[0] || row.length) { row.push(cur[0]); lines.push(row); }
  const head = (lines.shift() || []).map((h) => h.trim().toLowerCase());
  return lines.filter((l) => l.some((v) => v.trim())).map((l) => Object.fromEntries(head.map((h, i) => [h, l[i] ?? ""])));
}

// ---------- Pipeline ----------
async function pipeline() {
  const pipes = await q(sb.from("hub_pipelines").select("*").eq("account_id", A()).order("position"));
  const p = pipes[0]; if (!p) return setMain(`<div class="empty">No pipeline.</div>`);
  const [stages, opps] = await Promise.all([
    q(sb.from("hub_stages").select("*").eq("pipeline_id", p.id).order("position")),
    q(sb.from("hub_opportunities").select("*, hub_contacts(first_name,last_name,phone,email)").eq("pipeline_id", p.id).order("updated_at", { ascending: false })),
  ]);
  const seqByStage = Object.fromEntries((await q(sb.from("hub_sequences").select("name,trigger_stage_id").eq("account_id", A()).eq("trigger", "stage").eq("active", true))).map((s) => [s.trigger_stage_id, s.name]));
  setMain(`<div class="head"><div><h1>Pipeline</h1><p class="muted">Drag a card to move it. Moving to a stage with a follow-up starts it; moving to ${esc(stages.find((s) => s.kind === "won")?.name || "Won")} sends the review request.</p></div>
      <div class="row"><button class="btn" id="stagesBtn">Edit stages</button><button class="btn primary" id="addO">Add job</button></div></div>
    <div class="board">${stages.map((s) => {
      const list = opps.filter((o) => o.stage_id === s.id);
      return `<section class="col" data-stage="${s.id}"><header><span>${esc(s.name)} ${seqByStage[s.id] ? `<span class="badge blue" title="Starts: ${esc(seqByStage[s.id])}">auto</span>` : s.kind === "won" && state.acct.review_on ? `<span class="badge green" title="Sends the review request">review</span>` : ""}</span>
        <span class="muted">${list.length}${list.some((o) => o.value) ? ` · ${money(list.reduce((t, o) => t + Number(o.value || 0), 0))}` : ""}</span></header>
        ${list.map((o) => `<article class="opp" draggable="true" data-id="${o.id}" tabindex="0"><div class="t">${esc(o.title)}</div>
          <div class="s"><span>${esc(name(o.hub_contacts))}</span><span>${o.value ? money(o.value) : ""} ${ago(o.stage_changed_at)}</span></div>
          <select class="move" aria-label="Move to stage">${stages.map((x) => `<option value="${x.id}" ${x.id === s.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></article>`).join("")}</section>`;
    }).join("")}</div>`);
  const move = async (oid, sid) => { try { await q(sb.from("hub_opportunities").update({ stage_id: sid }).eq("id", oid)); toast(`Moved to ${stages.find((s) => s.id === sid).name}`); pipeline(); } catch (e) { fail(e); } };
  $$(".opp").forEach((el) => {
    el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", el.dataset.id));
    el.addEventListener("click", (e) => { if (e.target.tagName !== "SELECT" && e.target.tagName !== "OPTION") oppForm(opps.find((o) => o.id === el.dataset.id), stages, p); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") oppForm(opps.find((o) => o.id === el.dataset.id), stages, p); });
    el.querySelector(".move").addEventListener("change", (e) => move(el.dataset.id, e.target.value));
  });
  $$(".col").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop"); });
    col.addEventListener("dragleave", () => col.classList.remove("drop"));
    col.addEventListener("drop", (e) => { e.preventDefault(); col.classList.remove("drop"); const id = e.dataTransfer.getData("text/plain"); if (id) move(id, col.dataset.stage); });
  });
  $("#addO").onclick = () => oppForm(null, stages, p);
  $("#stagesBtn").onclick = () => stagesForm(stages, p);
}
async function oppForm(o, stages, p) {
  const contactsList = await q(sb.from("hub_contacts").select("id,first_name,last_name,phone,email").eq("account_id", A()).order("last_activity_at", { ascending: false }).limit(500));
  openModal(`<header><h2>${o ? "Job" : "Add job"}</h2><button class="btn small" data-close>Close</button></header><form id="of">
    <div class="field"><label for="ot">Title</label><input id="ot" required value="${esc(o?.title)}" placeholder="Roof repair – Smith"></div>
    <div class="grid2"><div class="field"><label for="oc">Contact</label><select id="oc"><option value="">—</option>${contactsList.map((c) => `<option value="${c.id}" ${o?.contact_id === c.id ? "selected" : ""}>${esc(name(c))}</option>`).join("")}</select></div>
    <div class="field"><label for="ov">Value ($)</label><input id="ov" inputmode="decimal" value="${o?.value ? esc(o.value) : ""}"></div>
    <div class="field"><label for="os">Stage</label><select id="os">${stages.map((s) => `<option value="${s.id}" ${(o?.stage_id ?? stages[0].id) === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div></div>
    <footer>${o ? `<button type="button" class="btn danger" id="odel">Delete</button>${o.contact_id ? `<a class="btn" href="#/inbox/${o.contact_id}" id="omsg">Message</a>` : ""}` : ""}<button class="btn primary">Save</button></footer></form>`);
  $("#omsg")?.addEventListener("click", () => modal.close());
  $("#odel")?.addEventListener("click", async () => { if (!confirm("Delete this job card?")) return; await q(sb.from("hub_opportunities").delete().eq("id", o.id)).catch(fail); modal.close(); pipeline(); });
  $("#of").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = { title: $("#ot").value.trim(), contact_id: $("#oc").value || null, value: Number($("#ov").value.replace(/[$,]/g, "")) || 0, stage_id: $("#os").value };
    try { o ? await q(sb.from("hub_opportunities").update(row).eq("id", o.id)) : await q(sb.from("hub_opportunities").insert({ ...row, account_id: A(), pipeline_id: p.id })); modal.close(); pipeline(); } catch (err) { fail(err); }
  });
}
function stagesForm(stages, p) {
  openModal(`<header><h2>Stages</h2><button class="btn small" data-close>Close</button></header>
    <p class="small muted">Rename, reorder (lowest number first) or add stages. "Won" stages send the review request; "Lost" stages close the job.</p>
    <div id="sl">${stages.map((s) => stageRow(s)).join("")}</div><button class="btn small" id="sadd">Add stage</button>
    <footer><button class="btn primary" id="ssave">Save</button></footer>`);
  $("#sadd").onclick = () => $("#sl").insertAdjacentHTML("beforeend", stageRow({ id: "", name: "", position: stages.length, kind: "open" }));
  $("#ssave").onclick = async () => {
    try {
      for (const r of $$("#sl .srow")) {
        const row = { name: $(".sn", r).value.trim(), position: Number($(".sp", r).value) || 0, kind: $(".sk", r).value };
        if (!row.name) continue;
        r.dataset.id ? await q(sb.from("hub_stages").update(row).eq("id", r.dataset.id)) : await q(sb.from("hub_stages").insert({ ...row, account_id: A(), pipeline_id: p.id }));
      }
      modal.close(); pipeline();
    } catch (e) { fail(e); }
  };
}
const stageRow = (s) => `<div class="srow row" data-id="${s.id}" style="margin-bottom:8px;flex-wrap:nowrap"><input class="sp" style="width:64px" type="number" value="${s.position}" aria-label="Order">
  <input class="sn" value="${esc(s.name)}" placeholder="Stage name" aria-label="Stage name"><select class="sk" style="width:110px" aria-label="Kind">${["open", "won", "lost"].map((k) => `<option ${s.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>`;

// ---------- Calendar ----------
async function calendar() {
  const [cals, appts] = await Promise.all([
    q(sb.from("hub_calendars").select("*").eq("account_id", A())),
    q(sb.from("hub_appointments").select("*, hub_contacts(first_name,last_name,phone,email)").eq("account_id", A()).gte("end_at", new Date(Date.now() - 3 * 86400_000).toISOString()).order("start_at").limit(200)),
  ]);
  const byDay = {}; for (const p of appts) (byDay[fmtDay(p.start_at)] ??= []).push(p);
  const cal = cals[0];
  const link = cal ? `${SITE}/book/?a=${state.acct.slug}&c=${cal.slug}` : "";
  setMain(`<div class="head"><div><h1>Calendar</h1><p class="muted">Bookings come in from your link, get a confirmation and reminders, and land in your pipeline.</p></div>
      <div class="row">${cal ? `<a class="btn" href="${link}" target="_blank" rel="noopener">Open booking page</a><button class="btn" id="copyL">Copy link</button><button class="btn primary" id="calS">Booking settings</button>` : ""}</div></div>
    <div class="two"><section class="card"><h2>Appointments</h2>${Object.keys(byDay).length ? Object.entries(byDay).map(([d, list]) => `<h3 style="margin:14px 0 4px">${esc(d)}</h3><ul class="list">${list.map((p) => `<li>
        <span style="min-width:74px;font-weight:650">${esc(new Intl.DateTimeFormat("en-US", { timeZone: tz(), hour: "numeric", minute: "2-digit" }).format(new Date(p.start_at)))}</span>
        <span class="grow"><span class="t">${esc(name(p.hub_contacts))}</span><span class="s">${esc(p.notes || cals.find((c) => c.id === p.calendar_id)?.name || "")}</span></span>
        <select data-appt="${p.id}" style="width:auto" aria-label="Status">${["booked", "completed", "no_show", "cancelled"].map((s) => `<option value="${s}" ${p.status === s ? "selected" : ""}>${s.replace("_", "-")}</option>`).join("")}</select></li>`).join("")}</ul>`).join("")
      : `<div class="empty"><b>No appointments yet</b>Share your booking link, or add it to your website and Google profile.</div>`}</section>
    <section class="card"><h2>Share it</h2>${cal ? `<p class="small muted">Booking link</p><span class="code">${esc(link)}</span>
      <p class="small muted" style="margin-top:14px">Button for a website</p><span class="code">${esc(`<a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:99px;background:${state.acct.brand_color || "#2C46C4"};color:#fff;font-weight:600;text-decoration:none">Book online</a>`)}</span>
      <p class="small muted" style="margin-top:14px">Put this link on your Google Business Profile as the booking link too.</p>` : ""}</section></div>`);
  $("#copyL")?.addEventListener("click", () => { navigator.clipboard?.writeText(link); toast("Link copied"); });
  $("#calS")?.addEventListener("click", () => calSettings(cal));
  $$("[data-appt]").forEach((s) => s.addEventListener("change", async (e) => {
    try { await q(sb.from("hub_appointments").update({ status: e.target.value }).eq("id", s.dataset.appt));
      if (e.target.value === "cancelled") await sb.from("hub_outbox").update({ status: "cancelled" }).eq("ref_id", s.dataset.appt).eq("status", "queued");
      toast("Updated"); } catch (err) { fail(err); }
  }));
}
function calSettings(cal) {
  const days = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
  openModal(`<header><h2>Booking settings</h2><button class="btn small" data-close>Close</button></header><form id="calf">
    <div class="grid2"><div class="field"><label for="cn">Name</label><input id="cn" value="${esc(cal.name)}"></div>
    <div class="field"><label for="cd2">Length (minutes)</label><input id="cd2" type="number" min="10" step="5" value="${cal.duration_min}"></div>
    <div class="field"><label for="cb">Gap between bookings (minutes)</label><input id="cb" type="number" min="0" step="5" value="${cal.buffer_min}"></div>
    <div class="field"><label for="cmn">Earliest booking (hours from now)</label><input id="cmn" type="number" min="0" value="${cal.min_notice_hours}"></div>
    <div class="field"><label for="cmx">How far ahead (days)</label><input id="cmx" type="number" min="1" value="${cal.max_days_ahead}"></div>
    <div class="field"><label for="crh">Reminders (hours before)</label><input id="crh" value="${esc((cal.reminder_hours || []).join(", "))}"></div></div>
    <div class="field"><label for="cdesc">Note on the booking page</label><input id="cdesc" value="${esc(cal.description)}"></div>
    <div class="field"><label for="cloc">Where</label><input id="cloc" value="${esc(cal.location)}" placeholder="At your home, or a phone call"></div>
    <label>Open hours</label><div class="avail">${days.map(([k, l]) => { const w = (cal.availability?.[k] ?? [])[0]; return `<div class="day"><span>${l}</span>
      <input type="time" data-d="${k}" data-e="0" value="${w?.[0] ?? "08:00"}" aria-label="${l} start"><input type="time" data-d="${k}" data-e="1" value="${w?.[1] ?? "17:00"}" aria-label="${l} end">
      <label class="switch" style="padding:0;border:0;margin:0"><input type="checkbox" data-on="${k}" ${w ? "checked" : ""} aria-label="Open on ${l}"></label></div>`; }).join("")}</div>
    <footer><button class="btn primary">Save</button></footer></form>`);
  $("#calf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const availability = {};
    for (const [k] of days) if ($(`[data-on="${k}"]`).checked) availability[k] = [[$(`[data-d="${k}"][data-e="0"]`).value, $(`[data-d="${k}"][data-e="1"]`).value]];
    const row = { name: $("#cn").value.trim() || cal.name, duration_min: Number($("#cd2").value) || 30, buffer_min: Number($("#cb").value) || 0,
      min_notice_hours: Number($("#cmn").value) || 0, max_days_ahead: Number($("#cmx").value) || 30, description: $("#cdesc").value.trim() || null,
      location: $("#cloc").value.trim() || null, availability, reminder_hours: $("#crh").value.split(",").map((x) => Number(x.trim())).filter((x) => x > 0) };
    try { await q(sb.from("hub_calendars").update(row).eq("id", cal.id)); modal.close(); toast("Saved"); calendar(); } catch (err) { fail(err); }
  });
}

// ---------- Automations ----------
async function automations(tab = "auto") {
  const a = state.acct;
  const [seqs, steps, stages, forms, counts] = await Promise.all([
    q(sb.from("hub_sequences").select("*").eq("account_id", A()).order("created_at")),
    q(sb.from("hub_sequence_steps").select("*").eq("account_id", A()).order("position")),
    q(sb.from("hub_stages").select("id,name").eq("account_id", A()).order("position")),
    q(sb.from("hub_forms").select("*").eq("account_id", A())),
    q(sb.from("hub_enrollments").select("sequence_id").eq("account_id", A()).eq("status", "active")),
  ]);
  const trig = (s) => s.trigger === "stage" ? `When a job moves to ${stages.find((x) => x.id === s.trigger_stage_id)?.name ?? "a stage"}` : s.trigger === "form" ? "When someone fills in your form" : s.trigger === "booking" ? "When someone books" : "Started by hand";
  setMain(`<div class="head"><div><h1>Automations</h1><p class="muted">What runs on its own for ${esc(a.name)}. Use {{first_name}}, {{business}}, {{review_link}} and {{booking_link}} in any message.</p></div></div>
    <div class="tabs" role="tablist">${[["auto", "Instant replies"], ["seq", "Follow-ups"], ["forms", "Website form"]].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}</div>
    <div id="tabbody"></div>`);
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => automations(b.dataset.tab)));
  const body = $("#tabbody");
  if (tab === "auto") {
    body.innerHTML = `<form id="af" class="stack">
      ${!a.sms_number ? `<div class="notice">Texting isn't set up for this business yet, so texts below wait until it is. Email replies and review requests by email still work. <a href="#/settings">Set up texting</a></div>` : ""}
      <section class="card"><div class="switch"><div><h2 style="margin:0">Missed-call text-back</h2><span class="small muted">Calls to your business number ring your cell first. Missed ones get this text right away.</span></div><input type="checkbox" id="mc_on" ${a.missed_call_on ? "checked" : ""}></div>
        <div class="field"><label for="mc_t">Text</label><textarea id="mc_t">${esc(a.missed_call_text)}</textarea></div>
        <div class="field" style="max-width:220px"><label for="mc_s">Ring your cell for (seconds)</label><input id="mc_s" type="number" min="10" max="60" value="${a.missed_call_ring_seconds}"></div></section>
      <section class="card"><div class="switch"><div><h2 style="margin:0">Instant reply to new inquiries</h2><span class="small muted">Sent the moment your website form comes in: a text if they gave a phone, otherwise an email.</span></div><input type="checkbox" id="fr_on" ${a.form_reply_on ? "checked" : ""}></div>
        <div class="field"><label for="fr_s">Text</label><textarea id="fr_s">${esc(a.form_reply_sms)}</textarea></div>
        <div class="field"><label for="fr_es">Email subject</label><input id="fr_es" value="${esc(a.form_reply_subject)}"></div>
        <div class="field"><label for="fr_e">Email</label><textarea id="fr_e">${esc(a.form_reply_email)}</textarea></div></section>
      <section class="card"><div class="switch"><div><h2 style="margin:0">Review requests</h2><span class="small muted">Sent when a job moves to a Won stage.</span></div><input type="checkbox" id="rv_on" ${a.review_on ? "checked" : ""}></div>
        <div class="grid2"><div class="field"><label for="rv_l">Google review link</label><input id="rv_l" type="url" value="${esc(a.review_link)}" placeholder="https://g.page/r/…/review"></div>
        <div class="field"><label for="rv_d">Wait after the job (hours)</label><input id="rv_d" type="number" min="0" value="${a.review_delay_hours}"></div></div>
        <div class="field"><label for="rv_t">Message</label><textarea id="rv_t">${esc(a.review_text)}</textarea></div></section>
      <section class="card"><h2>Booking messages</h2>
        <div class="field"><label for="bk_c">Confirmation</label><textarea id="bk_c">${esc(a.confirm_text)}</textarea><div class="hint">Also {{when}} and {{manage_link}}.</div></div>
        <div class="field"><label for="bk_r">Reminder</label><textarea id="bk_r">${esc(a.reminder_text)}</textarea></div></section>
      <section class="card"><div class="switch"><div><h2 style="margin:0">Forward texts to my cell</h2><span class="small muted">Customer texts are forwarded to the owner's cell. Reply to the forwarded text and it goes to the customer from the business number.</span></div><input type="checkbox" id="fw_on" ${a.forward_sms_to_owner ? "checked" : ""}></div></section>
      <div class="row" style="justify-content:flex-end"><button class="btn primary">Save</button></div></form>`;
    $("#af").addEventListener("submit", async (e) => {
      e.preventDefault();
      const row = { missed_call_on: $("#mc_on").checked, missed_call_text: $("#mc_t").value, missed_call_ring_seconds: Number($("#mc_s").value) || 20,
        form_reply_on: $("#fr_on").checked, form_reply_sms: $("#fr_s").value, form_reply_subject: $("#fr_es").value, form_reply_email: $("#fr_e").value,
        review_on: $("#rv_on").checked, review_link: $("#rv_l").value.trim() || null, review_delay_hours: Number($("#rv_d").value) || 0, review_text: $("#rv_t").value,
        confirm_text: $("#bk_c").value, reminder_text: $("#bk_r").value, forward_sms_to_owner: $("#fw_on").checked };
      try { const saved = await q(sb.from("hub_accounts").update(row).eq("id", A()).select().single()); Object.assign(state.acct, saved); toast("Saved"); } catch (err) { fail(err); }
    });
  }
  if (tab === "seq") {
    body.innerHTML = `<div class="row" style="justify-content:flex-end;margin-bottom:12px"><button class="btn primary" id="newSeq">New follow-up</button></div>
      ${seqs.map((s) => `<section class="card"><div class="head" style="margin:0 0 6px"><div><h2 style="margin:0">${esc(s.name)} ${s.active ? "" : '<span class="badge">off</span>'}</h2><span class="small muted">${esc(trig(s))} · ${((n) => `${n} message${n === 1 ? "" : "s"}`)(steps.filter((x) => x.sequence_id === s.id).length)}${s.stop_on_reply ? " · stops when they reply" : ""} · ${counts.filter((c) => c.sequence_id === s.id).length} in progress</span></div>
        <button class="btn small" data-seq="${s.id}">Edit</button></div>
        <ol class="small muted" style="margin:6px 0 0;padding-left:18px">${steps.filter((x) => x.sequence_id === s.id).map((x) => `<li>${delayText(x.delay_minutes)} later, ${x.channel === "sms" ? "text" : "email"}: “${esc(x.body.slice(0, 90))}${x.body.length > 90 ? "…" : ""}”</li>`).join("")}</ol></section>`).join("")
      || `<div class="empty"><b>No follow-ups yet</b></div>`}`;
    $("#newSeq").onclick = () => seqForm(null, [], stages);
    $$("[data-seq]").forEach((b) => b.addEventListener("click", () => seqForm(seqs.find((s) => s.id === b.dataset.seq), steps.filter((x) => x.sequence_id === b.dataset.seq), stages)));
  }
  if (tab === "forms") {
    const f = forms[0];
    const fields = ["name", "phone", "email", "company", "address", "service", "message"];
    const snippet = `<div data-kws-form="${a.slug}/${f?.slug ?? "contact"}"></div>\n<script src="${SITE}/hub/form.js?v=14" async></script>`;
    body.innerHTML = f ? `<div class="two"><form class="card" id="ff"><h2>Your website form</h2>
      <label>Fields</label><div class="row" style="margin-bottom:14px">${fields.map((k) => `<label class="badge" style="cursor:pointer;margin:0"><input type="checkbox" data-f="${k}" ${f.fields.includes(k) ? "checked" : ""} style="width:auto;min-height:0;margin-right:4px">${k}</label>`).join("")}</div>
      <div class="field"><label for="fb">Button text</label><input id="fb" value="${esc(f.button_text)}"></div>
      <div class="field"><label for="fty">Thank-you message</label><textarea id="fty">${esc(f.thank_you)}</textarea></div>
      <div class="field"><label for="fst">New leads go to</label><select id="fst">${stages.map((s) => `<option value="${s.id}" ${s.id === f.stage_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      <footer style="justify-content:flex-start;margin:0"><button class="btn primary">Save</button></footer></form>
      <section class="card"><h2>Put it on a website</h2><p class="small muted">Paste this where the form should appear. It matches the page's fonts and works on any site builder that allows custom HTML.</p><span class="code">${esc(snippet)}</span>
      <button class="btn small" id="copyS" style="margin-top:10px">Copy</button>
      <p class="small muted" style="margin-top:16px">Already have a form? Point it at this address (POST, field names name, phone, email, message):</p><span class="code">${esc(`${FN}?op=form&a=${a.slug}&f=${f.slug}`)}</span></section></div>` : `<div class="empty">No form.</div>`;
    $("#copyS")?.addEventListener("click", () => { navigator.clipboard?.writeText(snippet); toast("Copied"); });
    $("#ff")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const row = { fields: $$("[data-f]").filter((x) => x.checked).map((x) => x.dataset.f), button_text: $("#fb").value, thank_you: $("#fty").value, stage_id: $("#fst").value };
      if (!row.fields.includes("phone") && !row.fields.includes("email")) return toast("Keep phone or email so you can reach them");
      try { await q(sb.from("hub_forms").update(row).eq("id", f.id)); toast("Saved"); } catch (err) { fail(err); }
    });
  }
}
const delayText = (m) => m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} min`;
function seqForm(s, steps, stages) {
  const stepHtml = (x, i) => `<div class="step" data-id="${x.id ?? ""}"><div class="row" style="flex-wrap:nowrap"><b>${i + 1}.</b>
    <input class="sd" type="number" min="0" style="width:80px" value="${x.delay_minutes % 1440 === 0 ? x.delay_minutes / 1440 : Math.round(x.delay_minutes / 60)}" aria-label="Wait">
    <select class="su" style="width:auto" aria-label="Unit"><option value="1440" ${x.delay_minutes % 1440 === 0 ? "selected" : ""}>days later</option><option value="60" ${x.delay_minutes % 1440 !== 0 ? "selected" : ""}>hours later</option></select>
    <select class="sc" style="width:auto" aria-label="Channel"><option value="sms" ${x.channel === "sms" ? "selected" : ""}>Text</option><option value="email" ${x.channel === "email" ? "selected" : ""}>Email</option></select>
    <button type="button" class="btn small ghost sx" aria-label="Remove step">Remove</button></div>
    <input class="ss" placeholder="Email subject" value="${esc(x.subject)}" ${x.channel === "email" ? "" : "hidden"} style="margin-top:8px" aria-label="Subject">
    <textarea class="sb" style="margin-top:8px" aria-label="Message">${esc(x.body)}</textarea></div>`;
  openModal(`<header><h2>${s ? "Edit follow-up" : "New follow-up"}</h2><button class="btn small" data-close>Close</button></header><form id="sf">
    <div class="grid2"><div class="field"><label for="sn2">Name</label><input id="sn2" required value="${esc(s?.name)}" placeholder="Quote follow-up"></div>
    <div class="field"><label for="str">Starts</label><select id="str"><option value="manual">By hand from a conversation</option><option value="form">When someone fills in the form</option><option value="booking">When someone books</option>
      ${stages.map((x) => `<option value="stage:${x.id}" ${s?.trigger === "stage" && s.trigger_stage_id === x.id ? "selected" : ""}>When a job moves to ${esc(x.name)}</option>`).join("")}</select></div></div>
    <div class="switch"><span>Stop when they reply</span><input type="checkbox" id="sr" ${s?.stop_on_reply ?? true ? "checked" : ""}></div>
    <div class="switch"><span>On</span><input type="checkbox" id="sa" ${s?.active ?? true ? "checked" : ""}></div>
    <h3 style="margin:14px 0 8px">Messages</h3><div class="steps" id="steps">${(steps.length ? steps : [{ delay_minutes: 1440, channel: "sms", body: "" }]).map(stepHtml).join("")}</div>
    <button type="button" class="btn small" id="sadd2">Add message</button>
    <footer>${s ? `<button type="button" class="btn danger" id="sdel">Delete</button>` : ""}<button class="btn primary">Save</button></footer></form>`, { wide: true });
  if (s && s.trigger !== "stage") $("#str").value = s.trigger;
  const wire = () => $$("#steps .step").forEach((el) => {
    $(".sc", el).onchange = (e) => { $(".ss", el).hidden = e.target.value !== "email"; };
    $(".sx", el).onclick = () => { if ($$("#steps .step").length > 1) el.remove(); };
  });
  wire();
  $("#sadd2").onclick = () => { $("#steps").insertAdjacentHTML("beforeend", stepHtml({ delay_minutes: 1440, channel: "sms", body: "" }, $$("#steps .step").length)); wire(); };
  $("#sdel")?.addEventListener("click", async () => { if (!confirm("Delete this follow-up? Anyone in it stops getting messages.")) return; await q(sb.from("hub_sequences").delete().eq("id", s.id)).catch(fail); modal.close(); automations("seq"); });
  $("#sf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = $("#str").value;
    const row = { name: $("#sn2").value.trim(), trigger: t.startsWith("stage:") ? "stage" : t, trigger_stage_id: t.startsWith("stage:") ? t.slice(6) : null, stop_on_reply: $("#sr").checked, active: $("#sa").checked };
    const list = $$("#steps .step").map((el, i) => ({ position: i, delay_minutes: Number($(".sd", el).value || 0) * Number($(".su", el).value), channel: $(".sc", el).value, subject: $(".ss", el).value || null, body: $(".sb", el).value.trim() })).filter((x) => x.body);
    if (!list.length) return toast("Add at least one message");
    try {
      const saved = s ? await q(sb.from("hub_sequences").update(row).eq("id", s.id).select().single()) : await q(sb.from("hub_sequences").insert({ ...row, account_id: A() }).select().single());
      await q(sb.from("hub_sequence_steps").delete().eq("sequence_id", saved.id));
      await q(sb.from("hub_sequence_steps").insert(list.map((x) => ({ ...x, account_id: A(), sequence_id: saved.id }))));
      modal.close(); toast("Saved"); automations("seq");
    } catch (err) { fail(err); }
  });
}

// ---------- Campaigns ----------
async function campaigns() {
  const [list, stages, tagRows] = await Promise.all([
    q(sb.from("hub_campaigns").select("*").eq("account_id", A()).order("created_at", { ascending: false })),
    q(sb.from("hub_stages").select("id,name").eq("account_id", A()).order("position")),
    q(sb.from("hub_contacts").select("tags").eq("account_id", A()).not("tags", "eq", "{}").limit(2000)),
  ]);
  const tags = [...new Set(tagRows.flatMap((r) => r.tags))].sort();
  const sentIds = list.filter((k) => k.status === "sent").map((k) => k.id);
  const out = sentIds.length ? await q(sb.from("hub_outbox").select("ref_id,status").in("ref_id", sentIds)) : [];
  const tally = (id, st) => out.filter((o) => o.ref_id === id && (st ? o.status === st : true)).length;
  const aud = (k) => k.audience?.tags ? `Tagged ${k.audience.tags.join(", ")}` : k.audience?.stage_id ? `In ${stages.find((s) => s.id === k.audience.stage_id)?.name ?? "a stage"}` : "Everyone";
  setMain(`<div class="head"><div><h1>Campaigns</h1><p class="muted">One message to many customers: a seasonal reminder, an opening on the schedule, a thank-you.</p></div><button class="btn primary" id="newK">New campaign</button></div>
    <div class="notice">Only text people who gave you their number for your business. "Reply STOP to opt out" is added to every campaign text, and emails get an unsubscribe link and your mailing address.</div>
    <section class="card">${list.length ? `<ul class="list">${list.map((k) => `<li data-k="${k.id}" style="cursor:pointer"><span class="av">${ic("campaigns")}</span>
      <span class="grow"><span class="t">${esc(k.name)}</span><span class="s">${k.channel === "sms" ? "Text" : "Email"} · ${esc(aud(k))}${k.status === "scheduled" ? ` · goes out ${esc(fmtWhen(k.send_at))}` : ""}</span></span>
      <span class="small">${k.status === "sent" ? `<span class="badge green">sent ${tally(k.id, "sent")}/${k.recipients}</span>${tally(k.id, "failed") ? ` <span class="badge red">${tally(k.id, "failed")} failed</span>` : ""}${tally(k.id, "queued") + tally(k.id, "sending") ? ` <span class="badge blue">${tally(k.id, "queued") + tally(k.id, "sending")} going out</span>` : ""}`
        : `<span class="badge ${k.status === "scheduled" ? "blue" : ""}">${k.status}</span>`}</span></li>`).join("")}</ul>`
      : `<div class="empty"><b>No campaigns yet</b>Tag your customers (for example "past customer") and send them a seasonal check-in.</div>`}</section>`);
  $("#newK").onclick = () => campaignForm(null, stages, tags);
  $$("[data-k]").forEach((li) => li.addEventListener("click", () => { const k = list.find((x) => x.id === li.dataset.k); if (k.status === "draft" || k.status === "scheduled") campaignForm(k, stages, tags); else toast("This campaign has been sent"); }));
}
function campaignForm(k, stages, tags) {
  const au = k?.audience ?? { all: true };
  const mode = au.tags ? "tags" : au.stage_id ? "stage" : "all";
  openModal(`<header><h2>${k ? "Edit campaign" : "New campaign"}</h2><button class="btn small" data-close>Close</button></header><form id="kf">
    <div class="grid2"><div class="field"><label for="kn">Name (only you see this)</label><input id="kn" required value="${esc(k?.name)}" placeholder="Spring tune-up reminder"></div>
    <div class="field"><label for="kc">Send as</label><select id="kc"><option value="sms" ${k?.channel !== "email" ? "selected" : ""}>Text</option><option value="email" ${k?.channel === "email" ? "selected" : ""}>Email</option></select></div>
    <div class="field"><label for="ka">Who gets it</label><select id="ka"><option value="all" ${mode === "all" ? "selected" : ""}>Everyone who can receive it</option><option value="tags" ${mode === "tags" ? "selected" : ""}>Contacts with a tag</option><option value="stage" ${mode === "stage" ? "selected" : ""}>Jobs in a pipeline stage</option></select></div>
    <div class="field" id="kaw"></div></div>
    <div class="field" id="ksw" ${k?.channel === "email" ? "" : "hidden"}><label for="ks">Email subject</label><input id="ks" value="${esc(k?.subject)}"></div>
    <div class="field"><label for="kb">Message</label><textarea id="kb" required placeholder="Hi {{first_name}}, it's {{business}}. Spring is here: want us to look at your AC before the heat? Grab a time: {{booking_link}}">${esc(k?.body)}</textarea>
      <div class="hint" id="klen"></div></div>
    <div class="grid2"><div class="field"><label for="kw">When</label><select id="kw"><option value="now">Send now</option><option value="later" ${k?.status === "scheduled" ? "selected" : ""}>Schedule</option></select></div>
    <div class="field" id="ktw" ${k?.status === "scheduled" ? "" : "hidden"}><label for="kt">Date and time</label><input id="kt" type="datetime-local" value="${k?.send_at ? new Date(Date.parse(k.send_at) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}"></div></div>
    <p class="small" id="kcount"></p>
    <footer>${k ? `<button type="button" class="btn danger" id="kdel">Delete</button>` : ""}<button type="button" class="btn" id="kdraft">Save draft</button><button class="btn primary" id="kgo">Send</button></footer></form>`, { wide: true });
  const audWidget = () => {
    const m = $("#ka").value;
    $("#kaw").innerHTML = m === "tags" ? `<label for="kat">Tag</label>${tags.length ? `<select id="kat" multiple size="${Math.min(4, tags.length)}">${tags.map((t) => `<option ${au.tags?.includes(t) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>` : `<p class="small muted">No tags yet. Add tags on contacts first.</p>`}`
      : m === "stage" ? `<label for="kst">Stage</label><select id="kst">${stages.map((s) => `<option value="${s.id}" ${au.stage_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>` : "";
    $("#kat")?.addEventListener("change", preview); $("#kst")?.addEventListener("change", preview);
  };
  const audience = () => { const m = $("#ka").value; return m === "tags" ? { tags: $$("#kat option").filter((o) => o.selected).map((o) => o.value) } : m === "stage" ? { stage_id: $("#kst")?.value } : { all: true }; };
  const lenHint = () => { const n = $("#kb").value.length + ($("#kc").value === "sms" ? 24 : 0); $("#klen").textContent = $("#kc").value === "sms" ? `${n} characters with the opt-out line${n > 160 ? ` · sends as ${Math.ceil(n / 153)} texts each` : ""}. Use {{first_name}}, {{business}}, {{booking_link}}, {{review_link}}.` : "Use {{first_name}}, {{business}}, {{booking_link}}, {{review_link}}."; };
  let draftId = k?.id ?? null;
  async function save(status, sendAt) {
    const row = { account_id: A(), name: $("#kn").value.trim() || "Campaign", channel: $("#kc").value, subject: $("#ks").value || null, body: $("#kb").value.trim(), audience: audience(), status, send_at: sendAt ?? null };
    if (!row.body) throw new Error("Write the message first");
    const r = draftId ? await q(sb.from("hub_campaigns").update(row).eq("id", draftId).select().single()) : await q(sb.from("hub_campaigns").insert(row).select().single());
    draftId = r.id; return r;
  }
  let pt;
  async function preview() {
    clearTimeout(pt); pt = setTimeout(async () => {
      try { const r = await save(k?.status === "scheduled" ? "scheduled" : "draft", k?.status === "scheduled" ? k.send_at : null); const { data: n } = await sb.rpc("hub_campaign_count", { cid: r.id }); $("#kcount").innerHTML = `<b>${n ?? 0}</b> ${n === 1 ? "person" : "people"} will get this${$("#kc").value === "sms" && !state.acct.sms_number ? " (texting isn't set up yet, so it goes by email where possible)" : ""}.`; } catch { /* keep typing */ }
    }, 600);
  }
  audWidget(); lenHint();
  $("#ka").onchange = () => { audWidget(); preview(); };
  $("#kc").onchange = () => { $("#ksw").hidden = $("#kc").value !== "email"; lenHint(); preview(); };
  $("#kw").onchange = () => { $("#ktw").hidden = $("#kw").value !== "later"; $("#kgo").textContent = $("#kw").value === "later" ? "Schedule" : "Send"; };
  $("#kb").oninput = lenHint;
  if (k) preview();
  $("#kdel")?.addEventListener("click", async () => { if (!confirm("Delete this campaign?")) return; await q(sb.from("hub_campaigns").delete().eq("id", k.id)).catch(fail); modal.close(); campaigns(); });
  $("#kdraft").onclick = async () => { try { await save("draft"); modal.close(); toast("Draft saved"); campaigns(); } catch (e) { fail(e); } };
  $("#kf").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      if ($("#kw").value === "later") {
        if (!$("#kt").value) return toast("Pick a date and time");
        await save("scheduled", new Date($("#kt").value).toISOString()); modal.close(); toast("Scheduled"); return campaigns();
      }
      const r = await save("draft");
      const { data: n } = await sb.rpc("hub_campaign_count", { cid: r.id });
      if (!n) return toast("Nobody matches that audience yet");
      if (!confirm(`Send "${r.name}" to ${n} ${n === 1 ? "person" : "people"} now?`)) return;
      const { data: sent, error } = await sb.rpc("hub_launch_campaign", { cid: r.id });
      if (error) throw error;
      modal.close(); toast(`Sending to ${sent}`); campaigns();
    } catch (err) { fail(err); }
  });
}

// ---------- Reports ----------
async function reports(days = "30") {
  const d = Number(days) || 30;
  const since = new Date(Date.now() - d * 86400_000).toISOString();
  const [cs, msgs, won, appts] = await Promise.all([
    q(sb.from("hub_contacts").select("id,source,created_at").eq("account_id", A()).gte("created_at", since).limit(5000)),
    q(sb.from("hub_messages").select("contact_id,channel,direction,kind,status,created_at").eq("account_id", A()).gte("created_at", since).limit(10000)),
    q(sb.from("hub_opportunities").select("value,status,stage_changed_at").eq("account_id", A()).neq("status", "open").gte("stage_changed_at", since)),
    q(sb.from("hub_appointments").select("status,created_at").eq("account_id", A()).gte("created_at", since)),
  ]);
  const by = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const src = by(cs, (c) => (c.source || "manual").replace(/^form:.*/, "website form").replace("sms", "text").replace("call", "phone call"));
  const missed = msgs.filter((m) => m.kind === "missed_call");
  const missedIds = new Set(missed.map((m) => m.contact_id));
  const replied = new Set(msgs.filter((m) => m.direction === "in" && m.channel === "sms" && missedIds.has(m.contact_id)).map((m) => m.contact_id));
  const wonJobs = won.filter((o) => o.status === "won");
  const stat = (n, l) => `<div class="card stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const bars = (obj) => { const max = Math.max(1, ...Object.values(obj)); return Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div style="display:grid;grid-template-columns:120px 1fr 40px;gap:10px;align-items:center;margin:8px 0"><span class="small">${esc(k)}</span><span style="height:10px;border-radius:5px;background:var(--blue);width:${Math.max(4, (v / max) * 100)}%"></span><b class="small">${v}</b></div>`).join("") || `<p class="small muted">Nothing yet.</p>`; };
  const sentBy = by(msgs.filter((m) => m.direction === "out" && !String(m.status || "").startsWith("failed")), (m) => ({ missed_call: "Missed-call texts", autoreply: "Instant replies", confirmation: "Confirmations", reminder: "Reminders", review: "Review requests", sequence: "Follow-ups", campaign: "Campaigns", manual: "Your messages", owner_relay: "Your messages" }[m.kind] || "Other"));
  setMain(`<div class="head"><div><h1>Reports</h1><p class="muted">What the system did for ${esc(state.acct.name)}.</p></div>
    <select id="rd" style="width:auto" aria-label="Period">${[["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]].map(([v, l]) => `<option value="${v}" ${v === String(d) ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="cards">${stat(cs.length, "New contacts")}${stat(appts.filter((a) => a.status !== "cancelled").length, "Bookings")}${stat(`${replied.size}/${missedIds.size}`, "Missed callers who texted back")}${stat(`${wonJobs.length} · ${money(wonJobs.reduce((t, o) => t + Number(o.value || 0), 0))}`, "Jobs won")}</div>
    <div class="two"><section class="card"><h2>Where new contacts came from</h2>${bars(src)}</section>
    <section class="card"><h2>Messages sent for you</h2>${bars(sentBy)}<p class="small muted">${msgs.filter((m) => m.direction === "in").length} messages and calls came in.</p></section></div>`);
  $("#rd").onchange = (e) => reports(e.target.value);
}

// ---------- Settings ----------
async function settings() {
  const a = state.acct;
  const team = await q(sb.from("hub_members").select("user_id, role").eq("account_id", A()));
  setMain(`<div class="head"><div><h1>Settings</h1><p class="muted">${esc(a.name)}</p></div></div>
    <div class="two"><form class="card" id="bf"><h2>Business</h2>
      <div class="grid2"><div class="field"><label for="bn">Business name</label><input id="bn" value="${esc(a.name)}" required></div>
      <div class="field"><label for="bp">Business phone (shown to customers)</label><input id="bp" value="${esc(a.business_phone)}"></div>
      <div class="field"><label for="op">Owner's cell</label><input id="op" type="tel" value="${esc(fmtPhone(a.owner_phone))}"><div class="hint">Missed calls ring here first; lead alerts text here.</div></div>
      <div class="field"><label for="ne">Alerts email</label><input id="ne" type="email" value="${esc(a.notify_email)}"><div class="hint">New leads, bookings and voicemails.</div></div>
      <div class="field"><label for="ws">Website</label><input id="ws" type="url" value="${esc(a.website)}"></div>
      <div class="field"><label for="bu">Booking link override</label><input id="bu" type="url" value="${esc(a.booking_url)}"><div class="hint">Leave blank to use the KWS Hub booking page.</div></div>
      <div class="field"><label for="tzs">Time zone</label><select id="tzs">${["America/Chicago", "America/New_York", "America/Denver", "America/Phoenix", "America/Los_Angeles"].map((z) => `<option ${a.timezone === z ? "selected" : ""}>${z}</option>`).join("")}</select></div>
      <div class="field"><label for="ma">Mailing address</label><input id="ma" value="${esc(a.mailing_address)}"><div class="hint">Printed at the bottom of campaign emails, as US law asks.</div></div>
      <div class="field"><label for="bc">Brand color</label><input id="bc" type="color" value="${esc(a.brand_color || "#2C46C4")}" style="padding:4px;height:40px"></div></div>
      <button class="btn primary">Save</button></form>
    <section class="card" id="texting"><h2>Texting number</h2><div class="empty">Checking…</div></section></div>
    <section class="card"><h2>People with access</h2><p class="small muted">${team.length} ${team.length === 1 ? "person" : "people"} can sign in to ${esc(a.name)}${state.isAgency && a.kind === "client" ? ", plus you as the studio" : ""}.</p>
      ${state.isAgency ? `<form id="inv" class="row" style="margin-top:8px"><input id="ie" type="email" placeholder="owner@theirbusiness.com" style="max-width:320px" aria-label="Email to invite"><button class="btn">Give access</button></form>` : ""}</section>
    ${state.isAgency ? `<section class="card"><h2>Client accounts</h2><p class="small muted">Each client gets their own contacts, inbox, pipeline, booking page, form and automations, with no monthly software fee. Texting costs only what Twilio charges for their number and messages.</p>
      <ul class="list">${state.accounts.filter((x) => x.kind === "client").map((x) => `<li><span class="grow"><span class="t">${esc(x.name)}</span><span class="s">${esc(x.sms_number ? fmtPhone(x.sms_number) : "No texting number")} · ${esc(x.slug)}</span></span></li>`).join("") || "<li class='muted'>None yet</li>"}</ul>
      <form id="newA" class="row" style="margin-top:12px"><input id="na" placeholder="Client business name" style="max-width:320px" aria-label="Client business name"><button class="btn primary">Add client</button></form></section>` : ""}`);
  $("#bf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = { name: $("#bn").value.trim(), business_phone: $("#bp").value.trim() || null, owner_phone: e164($("#op").value), notify_email: $("#ne").value.trim() || null,
      website: $("#ws").value.trim() || null, mailing_address: $("#ma").value.trim() || null, booking_url: $("#bu").value.trim() || null, timezone: $("#tzs").value, brand_color: $("#bc").value };
    if ($("#op").value.trim() && !row.owner_phone) return toast("Check the cell number");
    try { const saved = await q(sb.from("hub_accounts").update(row).eq("id", A()).select().single()); Object.assign(state.acct, saved); toast("Saved"); } catch (err) { fail(err); }
  });
  $("#inv")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("invite", { account_id: A(), email: $("#ie").value }); toast("Access given. They'll get an email."); settings(); } catch (err) { fail(err); } });
  $("#newA")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = $("#na").value.trim(); if (!n) return;
    try {
      let slug = slugify(n); if (state.accounts.some((x) => x.slug === slug)) slug += "-" + Math.random().toString(36).slice(2, 5);
      const acct = await q(sb.from("hub_accounts").insert({ name: n, slug, kind: "client", business_phone: null }).select().single());
      state.accounts.push(acct); state.acct = acct; localStorageSet("kws-hub-acct", acct.id); toast(`${n} added`); location.hash = "#/settings"; route();
    } catch (err) { fail(err); }
  });
  texting();
}
async function texting() {
  const box = $("#texting"); const a = state.acct;
  let st = { connected: false };
  try { st = await api("twilio_status"); } catch { /* not allowed or not connected */ }
  const mine = a.sms_number;
  if (!st.connected) {
    box.innerHTML = `<h2>Texting number</h2>${mine ? `<p><b>${esc(fmtPhone(mine))}</b></p>` : ""}
      ${state.isAgency ? `<p class="small muted">Texting runs on Twilio, pay as you go: no monthly software fee, just about $1–2 a month per number and about a cent per text. Create a Twilio account, then paste the Account SID and Auth Token from the Twilio Console home page. They're stored on the server and never shown again.</p>
      <form id="tw"><div class="field"><label for="tsid">Account SID</label><input id="tsid" placeholder="AC…" autocomplete="off"></div>
      <div class="field"><label for="ttok">Auth Token</label><input id="ttok" type="password" autocomplete="off"></div><button class="btn primary">Connect Twilio</button></form>`
      : `<p class="small muted">Texting isn't set up yet. KnightWebstudio will connect a local number for you.</p>`}`;
    $("#tw")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("save_twilio", { sid: $("#tsid").value, token: $("#ttok").value }); toast("Twilio connected"); texting(); } catch (err) { fail(err); } });
    return;
  }
  const free = (st.numbers || []).filter((n) => !n.account || n.number === mine);
  box.innerHTML = `<h2>Texting number</h2><p class="small muted">Twilio: ${esc(st.name)} (${esc(st.status)}${st.type === "Trial" ? ", trial: can only text verified numbers" : ""})</p>
    ${mine ? `<div class="notice ok">This business texts and takes calls on <b>${esc(fmtPhone(mine))}</b>.${(st.numbers || []).find((n) => n.number === mine && !n.wired) ? " Its call and text settings need wiring: press Connect below." : ""}</div>` : `<div class="notice">No number yet for ${esc(a.name)}.</div>`}
    ${free.length ? `<div class="field"><label for="tn">Use a number already in Twilio</label><div class="row" style="flex-wrap:nowrap"><select id="tn">${free.map((n) => `<option value="${n.number}" ${n.number === mine ? "selected" : ""}>${esc(fmtPhone(n.number))}${n.account ? ` (${esc(n.account)})` : ""}</option>`).join("")}</select><button class="btn" id="tnc">Connect</button></div></div>` : ""}
    <div class="field"><label for="ac">Or get a new local number</label><div class="row" style="flex-wrap:nowrap"><input id="ac" inputmode="numeric" maxlength="3" placeholder="Area code, e.g. 225" style="max-width:200px"><button class="btn" id="srch">Search</button></div></div>
    <ul class="list" id="found"></ul>
    <p class="small muted">Before texting customers at scale, US carriers require a one-time business registration (A2P 10DLC) in the Twilio Console. Missed-call replies and replies to people who texted you first are the safest uses while it's pending.</p>`;
  $("#tnc")?.addEventListener("click", async () => { try { const r = await api("connect_number", { account_id: A(), number: $("#tn").value }); state.acct.sms_number = r.number; toast("Number connected"); texting(); } catch (err) { fail(err); } });
  $("#srch").onclick = async () => {
    try {
      const r = await api("search_numbers", { area_code: $("#ac").value });
      $("#found").innerHTML = r.numbers.map((n) => `<li><span class="grow"><span class="t">${esc(fmtPhone(n.number))}</span><span class="s">${esc(n.city || "")} ${esc(n.state || "")}</span></span><button class="btn small" data-buy="${n.number}">Buy for ${esc(a.name)}</button></li>`).join("") || "<li class='muted'>No numbers found. Try another area code.</li>";
      $$("[data-buy]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm(`Buy ${fmtPhone(b.dataset.buy)} on your Twilio account for ${a.name}? Twilio bills about $1.15 a month for it.`)) return;
        try { const r2 = await api("buy_number", { account_id: A(), number: b.dataset.buy }); state.acct.sms_number = r2.number; toast("Number bought and connected"); texting(); } catch (err) { fail(err); }
      }));
    } catch (err) { fail(err); }
  };
}

// ---------- go ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/hub/sw.js", { scope: "/hub/" }).catch(() => {});
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") authView(); });
start().catch(fail);
