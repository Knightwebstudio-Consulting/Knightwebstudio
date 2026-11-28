# KWS Hub client install (one-time setup, no monthly fee to the studio)

This kit gives one business its own copy of KWS Hub: contacts, two-way inbox, pipeline,
booking page, website form, follow-ups, review requests, missed-call text-back, campaigns,
tasks and reports. The studio is paid once for the setup. Everything the copy runs on is in the
client's own name, so nothing bills through KnightWebstudio:

| What | Whose account | Client's running cost |
| --- | --- | --- |
| Database, server function, scheduler | Client's **Supabase** project | Free plan to start; Pro (about $25/mo) once they rely on it, because free projects pause after a week with no activity |
| Email (alerts, sign-in codes, follow-ups) | Client's **Resend** account and domain | Free plan covers small businesses (check Resend's current limits) |
| Texts and calls | Client's **Twilio** account | Pay as you go: about $1–2/mo per number, about a cent per text, plus the carrier registration (below) |
| The app files | knightwebstudio.com/c/&lt;slug&gt;/ or the client's own site | Free |

The installer is `install.mjs` (Node 18 or newer, no packages). It creates or uses the
Supabase project, builds the database from `schema.sql`, saves the settings, deploys the
`hub` function from `server/hub/functions/`, and writes a ready-to-publish app folder.

## 1. Collect from the client (15 minutes on a call)

1. **Supabase.** The client signs up at supabase.com (free), creates an organization in their
   business name, and invites you to it (Organization settings → Team → Invite, role
   *Administrator*). Simplest is that they also create the project (name it after the business,
   pick the region closest to them, save the database password in their password manager), so the
   project is theirs from the first minute; then you need its *project ref* (the 20 letters in
   its dashboard address). If they'd rather you create it, you only need the organization slug.
2. **Resend.** The client signs up at resend.com, adds their domain (Resend shows the DNS records;
   add them where their domain is managed), and creates an API key with *Sending access*. You
   need that key and the address to send from, e.g. `Acme Plumbing <hello@acmeplumbing.com>`.
   Without email the owner can't get their sign-in code, so don't skip this.
3. **Details:** business name, the owner's email (their login) and cell (missed calls ring it),
   the business phone, website, mailing address (required at the bottom of marketing emails) and
   time zone.
4. **Twilio** comes later, inside the app (step 4), so their keys never pass through you.

## 2. Run the installer

On your computer, in this repository, with a Supabase access token from **your** account
(supabase.com → Account → Access Tokens; it works on every organization you've been invited to):

```sh
export SUPABASE_ACCESS_TOKEN=sbp_...      # yours
export RESEND_KEY=re_...                  # the client's
node server/hub/install/install.mjs \
  --project abcdefghijklmnopqrst \
  --name "Acme Plumbing" --slug acme \
  --owner-email owner@acmeplumbing.com --owner-cell "(225) 555-0100" \
  --business-phone "(225) 555-0100" --website https://acmeplumbing.com \
  --from-email "Acme Plumbing <hello@acmeplumbing.com>" \
  --mailing-address "123 Main St, Baton Rouge, LA 70801" --timezone America/Chicago
```

Use `--org their-org-slug` instead of `--project` to have the installer create the project. Add `--dry-run` first to see what it will do without changing anything. If you let it create the
project (`--org`), it saves the database password to `server/hub/install/.<slug>-db-password.txt`
(never committed): give it to the client and delete the file.

Where the app lives:

- Default: `https://knightwebstudio.com/c/<slug>/` (the folder is written to `c/<slug>/` in this
  repository). The business name becomes public in this repository, so ask the client first.
- On the client's own site: add `--app-url https://acmeplumbing.com/hub/ --out ../acme-hub` and
  copy that folder into their site as `/hub/`.

The installer is safe to run again on the same project: it skips the database build if it's
already there, updates the settings, redeploys the function and regenerates the folder. That is
also how you ship them a newer version of the app later.

## 3. Publish the folder

For the default address: commit `c/<slug>/` on a branch, run `python3 tools/check_rules.py`,
open a pull request and merge it. GitHub Pages serves it a minute later. The folder holds only
public values (the project address and its public key); every page in it is noindex.

## 4. Hand it over (on a call with the owner)

1. The owner opens the app, chooses **First time, or forgot your password?**, enters their email,
   types the 6-digit code they're emailed and picks a password. On a phone they can add it to the
   home screen (Share → Add to Home Screen).
2. **Texting:** the owner creates a Twilio account (twilio.com), adds a payment method, and in
   the app opens **Settings → Texting number**, pastes the Account SID and Auth Token from the
   Twilio Console home page and buys a local number. The app points the number's calls and texts at
   their Hub automatically.
3. **Carrier registration:** US carriers require a one-time A2P 10DLC registration (Twilio Console
   → Messaging → Regulatory compliance) before business texting works reliably. Twilio charges a
   small one-time fee and a few dollars a month for it; check the current amount in the Console.
   Until it's approved, texts to customers may be blocked; owner alerts still go by email.
4. Paste the website form on their site (the snippet the installer printed), put the booking link
   on their Google Business Profile and website, and set their review link in **Settings**.
5. Send a test: submit the form, book a time, call the number and let it ring out.

## 5. After the handover

- Once it's working, the client can remove you from their Supabase organization (or keep you on
  if they buy a care plan). The copy keeps running without the studio.
- Suggest Supabase Pro when the business depends on it: free projects pause after about a week
  with no activity, which would stop reminders and follow-ups.
- Updates: pull this repository and re-run the same command with `--project <ref>`.
  `schema.sql` is the full database for new installs; if a later change needs a database upgrade,
  it will come with its own upgrade file to run first.

## Troubleshooting

| What you see | Fix |
| --- | --- |
| `Set SUPABASE_ACCESS_TOKEN` | Create a token in your Supabase account and `export` it |
| `GET /v1/organizations -> 401` | The token is wrong or expired |
| Organization not found | Use the slug from the client's organization settings address, and check the invite was accepted |
| Supabase refuses to create a free project | Free projects are limited per account; have the client create the project and use `--project` |
| No sign-in code arrives | Check the Resend domain shows *Verified* and the `--from-email` address is on that domain; re-run with the right values |
| The owner gets no code at all | Only the `--owner-email` address can make the first login (codes go only to known people); re-run with the right address |
| Calls or texts do nothing | In the app, Settings → Texting number should show the number as connected; reconnect it there |
