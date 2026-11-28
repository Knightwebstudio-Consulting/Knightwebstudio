---
name: kws-hub-install
description: "Set up a standalone copy of KWS Hub (the CRM: inbox, pipeline, booking, forms, follow-ups, campaigns) for one client business on the client's own Supabase, Resend and Twilio accounts, sold as a one-time setup with no monthly fee to the studio. Use when Christian says set up a Hub for X, install the CRM for a client, one-time setup, standalone Hub, client wants the software without a subscription, or asks to update a client's Hub to the latest version."
---

# kws-hub-install

The runbook is `server/hub/install/README.md`; read it first and follow it. The tool is
`server/hub/install/install.mjs`; its header lists every flag.

## What to get from Christian before running anything

- Business name, slug, owner email (their login), owner cell, business phone, website, mailing
  address, time zone.
- The client's Supabase project ref (preferred: the client creates it and invites Christian to
  their organization) or their organization slug.
- The client's Resend API key and a from-address on their verified domain. Without it the owner
  can't get a sign-in code; don't install without it.
- Where the app lives: `knightwebstudio.com/c/<slug>/` (the default; the business name becomes
  public in this repository, so confirm the client is fine with that) or `--app-url` on the
  client's own site.

Ask for anything missing in one message. Never put a client's keys in the repository, a commit,
a pull request or chat output; they go in environment variables or straight into the client's
`hub_secrets`.

## Running it

- With a shell and `SUPABASE_ACCESS_TOKEN`: run `install.mjs` with `--dry-run` first, then for
  real. It needs outbound access to api.supabase.com.
- Without a token but with the Supabase connector, and Christian is a member of the client's
  organization: do the same steps by hand on the client's project ref, in this order:
  `execute_sql` with `schema.sql` (skip if `to_regclass('public.hub_accounts')` is not null);
  upsert `hub_secrets` (`fn_url` = `https://<ref>.supabase.co/functions/v1/hub`, `app_url`,
  `book_url`, `owner_email`, `from_email`, `resend_key`, `app_name`); insert the `agency` account
  as `install.mjs` does; `deploy_edge_function` named `hub`, entrypoint `hub/index.ts`,
  `verify_jwt` false, the six files from `server/hub/functions/`; `get_publishable_keys` for the
  anon key. Then build the folder with
  `node server/hub/install/install.mjs ... --project <ref>` only if a token is available;
  otherwise copy the files and make the same text replacements as `buildFolder()` in
  `install.mjs`.
- Check `?op=calendar&a=<slug>` on the new function returns the business before publishing.

## Publishing and handover

- Default address: commit `c/<slug>/` on the working branch, run `python3 tools/check_rules.py`
  (kws-site-rules), open a draft pull request. Never touch the studio's own `/hub/` or `/book/`
  for a client.
- Give Christian the app link, booking link, form snippet and the handover steps from the
  runbook (owner sign-in, Twilio connected by the owner inside the app, A2P registration, test
  form, booking and call).
- Never deploy client code to the studio project `uhmyfoibrwdkdhrnnaah` (kws-growth) and never
  put a client's data there; each client's copy runs only on its own project.
