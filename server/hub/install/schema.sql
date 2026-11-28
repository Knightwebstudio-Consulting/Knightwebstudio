-- KWS Hub: complete database for a fresh Supabase project (one standalone install).
-- Run once by install.mjs. The studio's own project (kws-growth) was built from the same
-- definitions through migrations hub_core, hub_runner, hub_runner_claimed_at, hub_campaigns_tasks.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table public.hub_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  kind text not null default 'client' check (kind in ('agency','client')),
  timezone text not null default 'America/Chicago',
  business_phone text,
  owner_phone text,
  notify_email text,
  sms_number text unique,
  website text,
  review_link text,
  booking_url text,
  mailing_address text,
  brand_color text default '#2C46C4',
  missed_call_on boolean not null default true,
  missed_call_text text not null default 'Hi, this is {{business}}. Sorry we missed your call! We''re on a job right now. What can we help you with? Text back here and we''ll get right back to you.',
  missed_call_ring_seconds int not null default 20,
  review_on boolean not null default true,
  review_delay_hours int not null default 2,
  review_text text not null default 'Hi {{first_name}}, thanks for choosing {{business}}! If you were happy with the work, would you leave us a quick Google review? It really helps a small business: {{review_link}}',
  form_reply_on boolean not null default true,
  form_reply_sms text not null default 'Hi {{first_name}}, thanks for reaching out to {{business}}! We got your message and will get back to you shortly.',
  form_reply_subject text not null default 'Thanks for reaching out to {{business}}',
  form_reply_email text not null default E'Hi {{first_name}},\n\nThanks for reaching out to {{business}}. We got your message and will get back to you shortly.\n\n{{business}}',
  reminder_text text not null default 'Reminder: your appointment with {{business}} is {{when}}. Need a different time? {{manage_link}}',
  confirm_text text not null default 'You''re booked with {{business}} for {{when}}. Need to change it? {{manage_link}}',
  forward_sms_to_owner boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.hub_members (
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create table public.hub_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  first_name text, last_name text, company text,
  email text, phone text,
  source text, tags text[] not null default '{}',
  dnd_sms boolean not null default false, dnd_email boolean not null default false,
  notes text,
  last_activity_at timestamptz default now(),
  unread int not null default 0,
  unsub_token text not null default encode(extensions.gen_random_bytes(12), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.hub_contacts (account_id, phone);
create index on public.hub_contacts (account_id, lower(email));
create index on public.hub_contacts (account_id, last_activity_at desc);
create unique index hub_contacts_unsub on public.hub_contacts (unsub_token);

create table public.hub_pipelines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  name text not null, position int not null default 0
);
create table public.hub_stages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  pipeline_id uuid not null references public.hub_pipelines(id) on delete cascade,
  name text not null, position int not null default 0,
  kind text not null default 'open' check (kind in ('open','won','lost'))
);
create table public.hub_opportunities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  contact_id uuid references public.hub_contacts(id) on delete cascade,
  pipeline_id uuid not null references public.hub_pipelines(id) on delete cascade,
  stage_id uuid not null references public.hub_stages(id) on delete restrict,
  title text not null, value numeric(12,2) default 0,
  status text not null default 'open' check (status in ('open','won','lost')),
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.hub_opportunities (account_id, stage_id);

create table public.hub_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  contact_id uuid references public.hub_contacts(id) on delete cascade,
  channel text not null check (channel in ('sms','email','call','note','system')),
  direction text not null default 'out' check (direction in ('in','out','internal')),
  subject text, body text,
  status text, provider_id text, kind text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.hub_messages (account_id, contact_id, created_at);
create index on public.hub_messages (provider_id);

create table public.hub_tasks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  contact_id uuid references public.hub_contacts(id) on delete cascade,
  title text not null, due_at timestamptz, done_at timestamptz,
  created_at timestamptz not null default now()
);
create index hub_tasks_due on public.hub_tasks (account_id, done_at, due_at);

create table public.hub_calendars (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  name text not null, slug text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  description text, location text,
  duration_min int not null default 30, buffer_min int not null default 15,
  min_notice_hours int not null default 4, max_days_ahead int not null default 30,
  availability jsonb not null default '{"mon":[["08:00","17:00"]],"tue":[["08:00","17:00"]],"wed":[["08:00","17:00"]],"thu":[["08:00","17:00"]],"fri":[["08:00","17:00"]]}',
  reminder_hours int[] not null default '{24,2}',
  pipeline_stage_id uuid references public.hub_stages(id) on delete set null,
  active boolean not null default true,
  unique (account_id, slug)
);
create table public.hub_appointments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  calendar_id uuid not null references public.hub_calendars(id) on delete cascade,
  contact_id uuid references public.hub_contacts(id) on delete set null,
  start_at timestamptz not null, end_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked','cancelled','completed','no_show')),
  notes text,
  manage_token text not null default encode(extensions.gen_random_bytes(18),'hex'),
  created_at timestamptz not null default now()
);
create index on public.hub_appointments (calendar_id, start_at);

create table public.hub_forms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  name text not null, slug text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  fields jsonb not null default '["name","phone","email","message"]',
  button_text text not null default 'Send',
  thank_you text not null default 'Thanks! We got your message and will be in touch shortly.',
  stage_id uuid references public.hub_stages(id) on delete set null,
  active boolean not null default true,
  unique (account_id, slug)
);

create table public.hub_sequences (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  name text not null,
  trigger text not null default 'manual' check (trigger in ('manual','form','stage','booking')),
  trigger_stage_id uuid references public.hub_stages(id) on delete set null,
  stop_on_reply boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.hub_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  sequence_id uuid not null references public.hub_sequences(id) on delete cascade,
  position int not null default 0,
  delay_minutes int not null default 1440,
  channel text not null default 'sms' check (channel in ('sms','email')),
  subject text, body text not null
);
create table public.hub_enrollments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  sequence_id uuid not null references public.hub_sequences(id) on delete cascade,
  contact_id uuid not null references public.hub_contacts(id) on delete cascade,
  opportunity_id uuid references public.hub_opportunities(id) on delete set null,
  next_step int not null default 0,
  next_run_at timestamptz,
  status text not null default 'active' check (status in ('active','done','stopped')),
  stopped_reason text,
  created_at timestamptz not null default now()
);
create unique index hub_enroll_once on public.hub_enrollments (sequence_id, contact_id) where status = 'active';
create index on public.hub_enrollments (status, next_run_at);

create table public.hub_outbox (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  contact_id uuid references public.hub_contacts(id) on delete cascade,
  channel text not null check (channel in ('sms','email')),
  to_addr text, subject text, body text not null,
  send_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled','skipped')),
  kind text, ref_id uuid, error text,
  created_at timestamptz not null default now(), sent_at timestamptz, claimed_at timestamptz
);
create index on public.hub_outbox (status, send_at);

create table public.hub_campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.hub_accounts(id) on delete cascade,
  name text not null,
  channel text not null default 'sms' check (channel in ('sms','email')),
  subject text, body text not null,
  audience jsonb not null default '{"all": true}',
  status text not null default 'draft' check (status in ('draft','scheduled','sending','sent','cancelled')),
  send_at timestamptz,
  recipients int not null default 0,
  created_at timestamptz not null default now(),
  launched_at timestamptz
);

-- settings and keys for this install, readable only by the service role (no policies)
create table public.hub_secrets (key text primary key, value text not null, updated_at timestamptz not null default now());
create table public.hub_login_codes (email text primary key, code_hash text not null, expires_at timestamptz not null, tries int not null default 0);

-- ---------- access ----------
create or replace function public.hub_can(acct uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from hub_members m where m.user_id = auth.uid() and m.account_id = acct)
      or exists (select 1 from hub_members m join hub_accounts a on a.id = m.account_id
                 where m.user_id = auth.uid() and a.kind = 'agency' and m.role in ('owner','admin'));
$$;
create or replace function public.hub_is_agency_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from hub_members m join hub_accounts a on a.id = m.account_id
                 where m.user_id = auth.uid() and a.kind = 'agency' and m.role in ('owner','admin'));
$$;
revoke all on function public.hub_can(uuid) from public, anon;
revoke all on function public.hub_is_agency_admin() from public, anon;
grant execute on function public.hub_can(uuid) to authenticated;
grant execute on function public.hub_is_agency_admin() to authenticated;

do $$ declare t text; begin
  foreach t in array array['hub_contacts','hub_pipelines','hub_stages','hub_opportunities','hub_messages','hub_tasks',
    'hub_calendars','hub_appointments','hub_forms','hub_sequences','hub_sequence_steps','hub_enrollments','hub_outbox','hub_campaigns'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy hub_rw on public.%I for all to authenticated using (public.hub_can(account_id)) with check (public.hub_can(account_id))', t);
  end loop;
end $$;
alter table public.hub_accounts enable row level security;
create policy hub_acct_read on public.hub_accounts for select to authenticated using (public.hub_can(id));
create policy hub_acct_update on public.hub_accounts for update to authenticated using (public.hub_can(id)) with check (public.hub_can(id));
create policy hub_acct_insert on public.hub_accounts for insert to authenticated with check (public.hub_is_agency_admin() and kind = 'client');
create policy hub_acct_delete on public.hub_accounts for delete to authenticated using (public.hub_is_agency_admin() and kind = 'client');
alter table public.hub_members enable row level security;
create policy hub_mem_read on public.hub_members for select to authenticated using (user_id = auth.uid() or public.hub_can(account_id));
create policy hub_mem_write on public.hub_members for all to authenticated using (public.hub_is_agency_admin()) with check (public.hub_is_agency_admin());
alter table public.hub_secrets enable row level security;
alter table public.hub_login_codes enable row level security;

-- ---------- triggers ----------
create or replace function public.hub_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
create trigger hub_contacts_touch before update on public.hub_contacts for each row execute function public.hub_touch();
create trigger hub_opps_touch before update on public.hub_opportunities for each row execute function public.hub_touch();

create or replace function public.hub_on_stage() returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then return new; end if;
  select kind into k from hub_stages where id = new.stage_id;
  new.status := coalesce(k, 'open');
  new.stage_changed_at := now();
  return new;
end $$;
create trigger hub_opps_stage before insert or update of stage_id on public.hub_opportunities for each row execute function public.hub_on_stage();

create or replace function public.hub_after_stage() returns trigger language plpgsql security definer set search_path = public as $$
declare s record; a record; c record;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then return null; end if;
  if new.contact_id is null then return null; end if;
  if tg_op = 'UPDATE' then
    update hub_enrollments e set status = 'stopped', stopped_reason = 'moved stage'
     from hub_sequences q where e.sequence_id = q.id and e.status = 'active' and e.contact_id = new.contact_id
       and q.trigger = 'stage' and q.trigger_stage_id = old.stage_id;
  end if;
  for s in select q.id, (select min(delay_minutes) from hub_sequence_steps st where st.sequence_id = q.id and st.position = 0) d
           from hub_sequences q where q.account_id = new.account_id and q.active and q.trigger = 'stage' and q.trigger_stage_id = new.stage_id loop
    insert into hub_enrollments (account_id, sequence_id, contact_id, opportunity_id, next_step, next_run_at)
    values (new.account_id, s.id, new.contact_id, new.id, 0, now() + make_interval(mins => coalesce(s.d, 0)))
    on conflict do nothing;
  end loop;
  if new.status = 'won' then
    select * into a from hub_accounts where id = new.account_id;
    select * into c from hub_contacts where id = new.contact_id;
    if a.review_on and coalesce(a.review_link,'') <> '' and not exists (
        select 1 from hub_outbox where contact_id = c.id and kind = 'review' and status in ('queued','sent')) then
      if c.phone is not null and not c.dnd_sms then
        insert into hub_outbox (account_id, contact_id, channel, to_addr, body, send_at, kind, ref_id)
        values (a.id, c.id, 'sms', c.phone, a.review_text, now() + make_interval(hours => a.review_delay_hours), 'review', new.id);
      elsif c.email is not null and not c.dnd_email then
        insert into hub_outbox (account_id, contact_id, channel, to_addr, subject, body, send_at, kind, ref_id)
        values (a.id, c.id, 'email', c.email, 'Thanks from {{business}}', a.review_text, now() + make_interval(hours => a.review_delay_hours), 'review', new.id);
      end if;
    end if;
  end if;
  insert into hub_messages (account_id, contact_id, channel, direction, body, kind)
  select new.account_id, new.contact_id, 'system', 'internal', 'Moved to ' || st.name || ': ' || new.title, 'stage' from hub_stages st where st.id = new.stage_id;
  return null;
end $$;
create trigger hub_opps_after_stage after insert or update of stage_id on public.hub_opportunities for each row execute function public.hub_after_stage();

-- every new account starts with a pipeline, a booking calendar, a contact form and two follow-ups
create or replace function public.hub_seed_account(acct uuid) returns void language plpgsql security definer set search_path = public as $$
declare p uuid; s_new uuid; s_quote uuid; q uuid;
begin
  if exists (select 1 from hub_pipelines where account_id = acct) then return; end if;
  insert into hub_pipelines (account_id, name) values (acct, 'Jobs') returning id into p;
  insert into hub_stages (account_id, pipeline_id, name, position) values (acct, p, 'New lead', 0) returning id into s_new;
  insert into hub_stages (account_id, pipeline_id, name, position) values (acct, p, 'Contacted', 1);
  insert into hub_stages (account_id, pipeline_id, name, position) values (acct, p, 'Appointment set', 2);
  insert into hub_stages (account_id, pipeline_id, name, position) values (acct, p, 'Quote sent', 3) returning id into s_quote;
  insert into hub_stages (account_id, pipeline_id, name, position, kind) values (acct, p, 'Won / job done', 4, 'won');
  insert into hub_stages (account_id, pipeline_id, name, position, kind) values (acct, p, 'Lost', 5, 'lost');
  insert into hub_calendars (account_id, name, slug, description, pipeline_stage_id)
  values (acct, 'Free estimate', 'estimate', 'Pick a time that works for you.', (select id from hub_stages where pipeline_id = p and position = 2));
  insert into hub_forms (account_id, name, slug, stage_id) values (acct, 'Contact form', 'contact', s_new);
  insert into hub_sequences (account_id, name, trigger, trigger_stage_id) values (acct, 'Quote follow-up', 'stage', s_quote) returning id into q;
  insert into hub_sequence_steps (account_id, sequence_id, position, delay_minutes, channel, body) values
    (acct, q, 0, 3*1440, 'sms', 'Hi {{first_name}}, just checking in on the quote from {{business}}. Any questions I can answer?'),
    (acct, q, 1, 4*1440, 'sms', 'Hi {{first_name}}, {{business}} here again. Want to get on the schedule? Just reply here and we''ll set a time.');
  insert into hub_sequences (account_id, name, trigger) values (acct, 'New lead nurture', 'form') returning id into q;
  insert into hub_sequence_steps (account_id, sequence_id, position, delay_minutes, channel, body) values
    (acct, q, 0, 1440, 'sms', 'Hi {{first_name}}, {{business}} here. Did you still need help? You can grab a time here: {{booking_link}}');
end $$;

create or replace function public.hub_after_account() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform hub_seed_account(new.id);
  if auth.uid() is not null and not exists (select 1 from hub_members where account_id = new.id and user_id = auth.uid()) then
    insert into hub_members (account_id, user_id, role) values (new.id, auth.uid(), 'owner');
  end if;
  return null;
end $$;
create trigger hub_accounts_seed after insert on public.hub_accounts for each row execute function public.hub_after_account();

revoke all on function public.hub_seed_account(uuid) from public, anon, authenticated;
revoke all on function public.hub_after_account() from public, anon, authenticated;
revoke all on function public.hub_after_stage() from public, anon, authenticated;
revoke all on function public.hub_on_stage() from public, anon, authenticated;
revoke all on function public.hub_touch() from public, anon, authenticated;

-- ---------- scheduler ----------
create or replace function public.hub_claim_outbox(n int) returns setof public.hub_outbox
language sql security definer set search_path = public as $$
  update hub_outbox set status = 'sending', claimed_at = now() where id in (
    select id from hub_outbox where status = 'queued' and send_at <= now() order by send_at limit n for update skip locked)
  returning *;
$$;
create or replace function public.hub_claim_enrollments(n int) returns setof public.hub_enrollments
language sql security definer set search_path = public as $$
  update hub_enrollments set next_run_at = now() + interval '10 minutes' where id in (
    select id from hub_enrollments where status = 'active' and next_run_at <= now() order by next_run_at limit n for update skip locked)
  returning *;
$$;
revoke all on function public.hub_claim_outbox(int) from public, anon, authenticated;
revoke all on function public.hub_claim_enrollments(int) from public, anon, authenticated;
grant execute on function public.hub_claim_outbox(int) to service_role;
grant execute on function public.hub_claim_enrollments(int) to service_role;

-- ---------- campaigns ----------
create or replace function public.hub_campaign_audience(cid uuid) returns setof public.hub_contacts
language sql stable security definer set search_path = public as $$
  select c.* from hub_contacts c join hub_campaigns k on k.account_id = c.account_id
  where k.id = cid
    and (case when k.channel = 'sms' then c.phone is not null and not c.dnd_sms else c.email is not null and not c.dnd_email end)
    and (coalesce((k.audience->>'all')::boolean, false)
      or (k.audience ? 'tags' and c.tags && array(select jsonb_array_elements_text(k.audience->'tags')))
      or (k.audience ? 'stage_id' and exists (select 1 from hub_opportunities o where o.contact_id = c.id and o.stage_id::text = k.audience->>'stage_id')));
$$;
create or replace function public.hub_campaign_count(cid uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when public.hub_can((select account_id from hub_campaigns where id = cid)) or auth.role() = 'service_role'
    then (select count(*)::int from public.hub_campaign_audience(cid)) else 0 end;
$$;
create or replace function public.hub_launch_campaign(cid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare k record; n int := 0; step interval;
begin
  select * into k from hub_campaigns where id = cid for update;
  if k is null or k.status not in ('draft','scheduled') then return 0; end if;
  if auth.role() <> 'service_role' and not hub_can(k.account_id) then raise exception 'no access'; end if;
  if k.status = 'scheduled' and k.send_at > now() and auth.role() <> 'service_role' then return 0; end if;
  step := case when k.channel = 'sms' then interval '2 seconds' else interval '500 milliseconds' end;
  insert into hub_outbox (account_id, contact_id, channel, to_addr, subject, body, send_at, kind, ref_id)
  select k.account_id, c.id, k.channel, case when k.channel = 'sms' then c.phone else c.email end, k.subject, k.body,
         now() + step * (row_number() over (order by c.created_at) - 1), 'campaign', k.id
  from hub_campaign_audience(cid) c;
  get diagnostics n = row_count;
  update hub_campaigns set status = 'sent', recipients = n, launched_at = now() where id = cid;
  return n;
end $$;
create or replace function public.hub_launch_due_campaigns() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from hub_campaigns where status = 'scheduled' and send_at <= now() loop
    n := n + hub_launch_campaign(r.id);
  end loop;
  return n;
end $$;
revoke all on function public.hub_campaign_audience(uuid) from public, anon, authenticated;
revoke all on function public.hub_campaign_count(uuid) from public, anon;
revoke all on function public.hub_launch_campaign(uuid) from public, anon;
revoke all on function public.hub_launch_due_campaigns() from public, anon, authenticated;
grant execute on function public.hub_campaign_count(uuid) to authenticated, service_role;
grant execute on function public.hub_launch_campaign(uuid) to authenticated, service_role;
grant execute on function public.hub_campaign_audience(uuid) to service_role;

-- the every-minute job: start due campaigns, recover stuck sends, call the function only when work is due
insert into public.hub_secrets (key, value) values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'));
select cron.schedule('hub-runner', '* * * * *', $cron$
  select public.hub_launch_due_campaigns();
  update public.hub_outbox set status = 'queued' where status = 'sending' and claimed_at < now() - interval '15 minutes';
  select net.http_post(
    url := (select value from public.hub_secrets where key = 'fn_url') || '?fn=runner',
    headers := jsonb_build_object('content-type', 'application/json', 'x-hub-cron', (select value from public.hub_secrets where key = 'cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from public.hub_secrets where key = 'fn_url')
    and (exists (select 1 from public.hub_outbox where status = 'queued' and send_at <= now())
      or exists (select 1 from public.hub_enrollments where status = 'active' and next_run_at <= now()));
$cron$);
