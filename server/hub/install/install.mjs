#!/usr/bin/env node
// KWS Hub installer: builds one business its own standalone copy of KWS Hub.
//
// The client owns everything it runs on (no monthly fee to the studio):
//   - their own Supabase project (free plan is fine to start)  -> database, server function, scheduler
//   - their own Twilio account (pay as you go)                 -> connected later inside the app
//   - their own Resend account and sending domain (free plan)  -> email
// The app files (a static folder) can live on knightwebstudio.com/c/<slug>/ or any static host.
//
// Usage (Node 18+, no packages needed):
//   SUPABASE_ACCESS_TOKEN=sbp_... RESEND_KEY=re_... node install.mjs \
//     --org <organization id or slug> | --project <existing project ref> \
//     --name "Acme Plumbing" --slug acme --owner-email owner@acmeplumbing.com \
//     --owner-cell "(225) 555-0100" --business-phone "(225) 555-0100" \
//     --from-email "Acme Plumbing <hello@acmeplumbing.com>" \
//     [--website https://acmeplumbing.com] [--mailing-address "123 Main St, Baton Rouge, LA 70801"] \
//     [--timezone America/Chicago] [--region us-east-1] [--host https://knightwebstudio.com/c/ | --app-url https://their-site.com/hub/]
//     [--out <folder>] [--dry-run] [--no-check]
//
// Safe to run again on the same project: it skips the database build if it's already there,
// updates the settings, redeploys the function and regenerates the app folder.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const FUNCS = resolve(HERE, "../functions");
const STUDIO_FN = "https://uhmyfoibrwdkdhrnnaah.supabase.co/functions/v1/hub";
const STUDIO_URL = "https://uhmyfoibrwdkdhrnnaah.supabase.co";

// ---------- arguments ----------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const k = a.slice(2), v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) args[k] = true; else { args[k] = v; i++; }
}
const need = (k) => { if (!args[k]) { console.error(`Missing --${k}`); process.exit(2); } return String(args[k]); };
const API = String(args["api-base"] ?? "https://api.supabase.com");
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? args.token;
const DRY = !!args["dry-run"];
const name = need("name");
const slug = String(args.slug ?? name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).slice(0, 50);
if (!/^[a-z0-9-]{2,60}$/.test(slug)) { console.error("--slug must be lowercase letters, numbers and hyphens"); process.exit(2); }
const ownerEmail = need("owner-email").toLowerCase();
const fromEmail = String(args["from-email"] ?? "");
const resendKey = process.env.RESEND_KEY ?? args["resend-key"] ?? "";
const host = String(args.host ?? "https://knightwebstudio.com/c/").replace(/\/?$/, "/");
// --app-url puts the app on the client's own site instead (e.g. https://acmeplumbing.com/hub/)
const appUrl = args["app-url"] ? String(args["app-url"]).replace(/\/?$/, "/") : `${host}${slug}/`;
const bookUrl = `${appUrl}book/`;
const out = resolve(String(args.out ?? join(REPO, "c", slug)));
const e164 = (p) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length === 10 ? "+1" + d : d.length === 11 && d[0] === "1" ? "+" + d : null; };
const sql = (v) => (v === null || v === undefined || v === "" ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const step = (m) => console.log(`\n▸ ${m}`);

if (!TOKEN && !DRY) { console.error("Set SUPABASE_ACCESS_TOKEN (Supabase dashboard > Account > Access Tokens)."); process.exit(2); }
if (!args.project && !args.org && !DRY) { console.error("Give --org (to create a project) or --project (to use one)."); process.exit(2); }

async function api(method, path, body, raw = false) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 400)}`);
  return raw ? text : (text ? JSON.parse(text) : null);
}
const query = (ref, q) => api("POST", `/v1/projects/${ref}/database/query`, { query: q });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`KWS Hub installer: ${name} (${slug})${DRY ? "  [dry run: nothing is changed]" : ""}`);
  let ref = args.project ? String(args.project) : null;

  // 1. project
  if (!ref && !DRY) {
    step("Creating the Supabase project");
    const orgs = await api("GET", "/v1/organizations");
    const org = orgs.find((o) => o.id === args.org || o.slug === args.org || o.name === args.org);
    if (!org) throw new Error(`No organization "${args.org}". This token can see: ${orgs.map((o) => o.slug || o.id).join(", ")}`);
    const dbPass = randomBytes(18).toString("base64url");
    const p = await api("POST", "/v1/projects", { name: `${name} Hub`.slice(0, 60), organization_id: org.id, db_pass: dbPass, region: String(args.region ?? "us-east-1") });
    ref = p.id ?? p.ref;
    mkdirSync(out, { recursive: true });
    writeFileSync(join(HERE, `.${slug}-db-password.txt`), `${ref}\n${dbPass}\n`, { mode: 0o600 });
    console.log(`  Project ${ref} created. Database password saved to server/hub/install/.${slug}-db-password.txt (git-ignored); store it in your password manager.`);
    for (let i = 0; i < 90; i++) {
      const s = await api("GET", `/v1/projects/${ref}`);
      if (s.status === "ACTIVE_HEALTHY") break;
      if (i === 89) throw new Error(`Project still ${s.status} after 15 minutes; run again with --project ${ref}`);
      process.stdout.write("."); await sleep(10_000);
    }
  }
  ref ??= "PROJECTREF";
  const projectUrl = `https://${ref}.supabase.co`;
  const fnUrl = `${projectUrl}/functions/v1/hub`;

  // 2. database
  step("Building the database");
  if (DRY) console.log("  would run schema.sql");
  else {
    const [{ t }] = await query(ref, "select to_regclass('public.hub_accounts') is not null as t");
    if (t) console.log("  already built, skipping");
    else { await query(ref, readFileSync(join(HERE, "schema.sql"), "utf8")); console.log("  done"); }
  }

  // 3. settings and the business
  step("Saving settings and the business");
  const settings = { fn_url: fnUrl, app_url: appUrl, book_url: bookUrl, owner_email: ownerEmail, from_email: fromEmail, resend_key: resendKey, app_name: `${name} Hub` };
  const setSql = Object.entries(settings).filter(([, v]) => v)
    .map(([k, v]) => `insert into public.hub_secrets (key, value) values (${sql(k)}, ${sql(v)}) on conflict (key) do update set value = excluded.value, updated_at = now();`).join("\n");
  const acctSql = `insert into public.hub_accounts (name, slug, kind, timezone, business_phone, owner_phone, notify_email, website, mailing_address)
select ${sql(name)}, ${sql(slug)}, 'agency', ${sql(args.timezone ?? "America/Chicago")}, ${sql(args["business-phone"])}, ${sql(e164(args["owner-cell"]))}, ${sql(ownerEmail)}, ${sql(args.website)}, ${sql(args["mailing-address"])}
where not exists (select 1 from public.hub_accounts where kind = 'agency');`;
  if (DRY) console.log(`  would save: ${Object.keys(settings).filter((k) => settings[k]).join(", ")}`);
  else { await query(ref, `${setSql}\n${acctSql}`); console.log("  done"); }
  if (!resendKey || !fromEmail) console.log("  ! No --from-email/RESEND_KEY yet: emails (alerts, sign-in codes) won't send until you add them. Re-run with both.");

  // 4. server function
  step("Deploying the server function");
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : f.endsWith(".ts") && files.push(p); } };
  walk(FUNCS);
  if (DRY) console.log(`  would upload ${files.map((f) => relative(FUNCS, f)).join(", ")}`);
  else {
    const form = new FormData();
    form.append("metadata", JSON.stringify({ name: "hub", entrypoint_path: "hub/index.ts", verify_jwt: false }));
    for (const f of files) form.append("file", new Blob([readFileSync(f)], { type: "application/typescript" }), relative(FUNCS, f));
    await api("POST", `/v1/projects/${ref}/functions/deploy?slug=hub`, form);
    console.log("  done");
  }

  // 5. app folder
  step("Building the app folder");
  let anon = "ANON_KEY";
  if (!DRY) {
    const keys = await api("GET", `/v1/projects/${ref}/api-keys`);
    anon = (keys.find((k) => k.name === "anon") ?? keys.find((k) => k.type === "publishable"))?.api_key;
    if (!anon) throw new Error("Couldn't read the project's public API key");
  }
  buildFolder({ projectUrl, fnUrl, anon });
  console.log(`  ${relative(process.cwd(), out) || out}`);

  // 6. check
  if (!DRY && !args["no-check"]) {
    step("Checking the live booking page data");
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${fnUrl}?op=calendar&a=${slug}`).then((x) => x.json()).catch(() => ({}));
      if (r.business) { console.log(`  OK: ${r.business}, "${r.calendar.name}" is bookable`); break; }
      if (i === 5) console.log("  ! The function didn't answer yet. Give it a minute and open the booking link.");
      await sleep(5000);
    }
  }

  console.log(`
Done. ${name} Hub is set up.
  App:          ${appUrl}
  Booking page: ${bookUrl}
  Website form: <div data-kws-form="${slug}/contact"></div><script src="${appUrl}form.js?v=14" async></script>

Next:
  1. Publish the app folder (commit c/${slug}/ to the knightwebstudio.com repo, or upload the folder to the client's own host).
  2. The owner opens the app, chooses "First time, or forgot your password?" and signs in with ${ownerEmail}.
  3. In Settings > Texting number, paste the client's Twilio Account SID and Auth Token and buy a local number.
  4. Paste the website form on their site and add the booking link to their Google Business Profile.
  5. Recommend Supabase Pro (about $25 a month, billed to them) once they rely on it: free projects can pause when idle.`);
}

function buildFolder({ projectUrl, fnUrl, anon }) {
  mkdirSync(join(out, "book"), { recursive: true });
  const copy = (from, to, edits = []) => {
    let s = readFileSync(join(REPO, from), "utf8");
    for (const [a, b] of edits) { if (!s.includes(a)) throw new Error(`${from}: expected text not found: ${a.slice(0, 60)}`); s = s.split(a).join(b); }
    writeFileSync(join(out, to), s);
  };
  const appName = `${name} Hub`;
  copy("hub/hub.js", "hub.js", [
    [`const SUPABASE_URL = "${STUDIO_URL}";`, `const SUPABASE_URL = "${projectUrl}";`],
    [/const ANON = "[^"]+";/.exec(readFileSync(join(REPO, "hub/hub.js"), "utf8"))[0], `const ANON = "${anon}";`],
    [`const APP_URL = "https://knightwebstudio.com/hub/";`, `const APP_URL = "${appUrl}";`],
    [`const BOOK_URL = "https://knightwebstudio.com/book/";`, `const BOOK_URL = "${bookUrl}";`],
    [`const STUDIO = true;`, `const STUDIO = false;`],
    [`const APP_NAME = "KWS Hub";`, `const APP_NAME = ${JSON.stringify(appName)};`],
    [`storageKey: "kws-hub"`, `storageKey: "hub-${slug}"`],
  ]);
  copy("hub/index.html", "index.html", [["<title>KWS Hub</title>", `<title>${esc(appName)}</title>`],
    ['content="KWS Hub"', `content="${esc(appName)}"`], ["<h1>KWS Hub</h1>", `<h1>${esc(appName)}</h1>`]]);
  copy("hub/hub.css", "hub.css");
  copy("hub/sw.js", "sw.js", [[`const CACHE = "kws-hub-14";`, `const CACHE = "hub-${slug}-14";`]]);
  copy("hub/form.js", "form.js", [[STUDIO_FN, fnUrl]]);
  copy("hub/manifest.webmanifest", "manifest.webmanifest", [['"name": "KWS Hub"', `"name": ${JSON.stringify(appName)}`], ['"short_name": "KWS Hub"', `"short_name": ${JSON.stringify(name.slice(0, 12))}`]]);
  copy("book/index.html", "book/index.html", [[STUDIO_FN, fnUrl], [`var DEFAULT_ACCOUNT = "";`, `var DEFAULT_ACCOUNT = "${slug}";`]]);
  for (const f of ["crest.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) copyFileSync(join(REPO, "hub", f), join(out, f));
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
