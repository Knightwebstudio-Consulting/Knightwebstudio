# KWS Hub

The studio's own CRM: contacts, a two-way inbox (texts, email, calls, form fills, bookings),
a drag-and-drop pipeline, a booking calendar, a website form, follow-up sequences, review
requests, missed-call text-back, campaigns (text or email broadcasts), tasks and reports.
It installs to a phone's home screen (`/hub/manifest.webmanifest`, `/hub/sw.js`). One login sees the studio and every client account; each
client can be given their own login that sees only their business.

No monthly software: the app is static files on GitHub Pages, the back end is the existing
Supabase project **kws-growth** (free tier), email goes through the Resend key already in
`settings`, and texting/calls run on Twilio pay-as-you-go (about $1–2 a month per number and
about a cent per text).

## Where things live

| Piece | Where |
| --- | --- |
| App | `/hub/` (`index.html`, `hub.css`, `hub.js`), noindex |
| Public booking page | `/book/?a=<account>&c=<calendar>`, manage link `/book/?m=<token>`, noindex |
| Website form widget | `/hub/form.js` (paste `<div data-kws-form="<account>/contact"></div>` + the script) |
| Server function | Supabase Edge Function `hub` (source in `server/hub/functions/`) |
| Data | `public.hub_*` tables in kws-growth, row-level security on every table |
| Scheduler | pg_cron job `hub-runner`, every minute, calls `hub?fn=runner` only when something is due |

The `hub` function has four entry points: `?fn=public` (booking and forms, no login),
`?fn=twilio` (Twilio webhooks, signature checked), `?fn=api` (the app, session checked) and
`?fn=runner` (pg_cron, shared secret in `hub_secrets.cron_secret`).

## Deploying the function

The Supabase deploy takes the files as `hub/index.ts`, `hub/public.ts`, `hub/twilio.ts`,
`hub/api.ts`, `hub/runner.ts` and `_shared/hub.ts` with the entrypoint `hub/index.ts` and
JWT verification **off** (the function checks the session, the Twilio signature or the cron
secret itself). With the Supabase CLI: copy `server/hub/functions/*` into
`supabase/functions/` and run `supabase functions deploy hub --no-verify-jwt`.
The old standalone `hub-runner` function is a retired stub and can be deleted.

## Database

Applied as migrations `hub_core`, `hub_runner`, `hub_runner_claimed_at` and `hub_campaigns_tasks` (Supabase dashboard
→ Database → Migrations). New accounts are seeded by a trigger with a "Jobs" pipeline
(New lead → Contacted → Appointment set → Quote sent → Won / job done → Lost), a "Free estimate"
calendar, a contact form, a "Quote follow-up" sequence (starts when a job moves to Quote sent)
and a "New lead nurture" sequence (starts on a form fill, stops when they book or reply).
Moving a job to a Won stage queues the review request.

## Campaigns

A campaign goes to everyone, a tag, or the contacts in a pipeline stage, skipping anyone opted out.
"Send now" calls `hub_launch_campaign`; scheduled ones start from the every-minute job. Recipients
are queued a little apart (texts 2 seconds, emails half a second). Every campaign text ends with
"Reply STOP to opt out." Campaign, follow-up and review emails end with the business's mailing
address and an unsubscribe link (`hub?op=unsub&t=<token>`).

## Secrets

Nothing secret is in this repository. Twilio's Account SID and Auth Token are pasted into
Settings → Texting number by the studio owner and stored in `public.hub_secrets`, which has RLS
on and no policies, so only the service role can read it.

## Sign-in

`/hub/` → "First time, or forgot your password?" → a 6-digit code is emailed (only to the
studio admin in `admin_users` or someone already given access) → choose a password.
Settings → People with access gives a client owner their own login.

## Texting rules

US carriers require a one-time A2P 10DLC registration in the Twilio Console before business
texting at volume. Every texting number replies STOP/START automatically; STOP marks the contact
"No texts" and cancels anything queued.
