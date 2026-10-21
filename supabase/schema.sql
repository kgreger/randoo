-- Initial schema. Auth itself is handled by Supabase (auth.users); everything
-- here just extends it for Randoo's own data.

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  gpx_path text not null, -- storage path, not the raw file
  distance_m numeric,
  created_at timestamptz not null default now()
);

create table if not exists category_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  category_ids text[] not null,
  radius_m integer not null default 500,
  created_at timestamptz not null default now()
);

create table if not exists export_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete set null,
  route_id uuid references routes (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table routes enable row level security;
alter table category_presets enable row level security;
alter table export_log enable row level security;

create policy "profiles: read own" on profiles for select using (auth.uid() = id);
create policy "profiles: update own" on profiles for update using (auth.uid() = id);

create policy "routes: owner full access" on routes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "category_presets: owner full access" on category_presets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "export_log: owner read" on export_log for select
  using (auth.uid() = user_id);

-- Idea portal (see ~/Code/idea-portal): submissions and upvotes tied to
-- this project's own accounts, no separate login of its own. email and
-- tier are already live on profiles but hadn't been added to this file
-- yet; tier also gates free/premium search in entitlements.py, 'admin'
-- is who this counts as a moderator.
alter table profiles add column if not exists email text;
alter table profiles add column if not exists tier text not null default 'free';

-- on_auth_user_created's function, live but - like the two columns above -
-- never committed here before. Only ever wrote display_name as a copy of
-- the email (there was no real name to use yet); extended to also
-- populate email once the admin view needed it (2026-09-24), and now to
-- use an actual chosen display name when the signup form collects one
-- (SignInDialog.tsx passes it as user metadata) - existing rows from
-- before either change need a one-time backfill, run separately, not
-- part of this file.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, tier, display_name, email)
  values (
    new.id,
    'free',
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), new.email),
    new.email
  );
  return new;
end;
$$;

-- handle_new_user above only runs on signup - without this, changing
-- email via Supabase's own email-change flow would leave profiles.email
-- stale while auth.users.email moves on.
create or replace function public.handle_user_email_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.handle_user_email_update();

-- Emails every admin once a new account's address is confirmed (immediately
-- on insert if the project doesn't require confirmation). Fires from
-- auth.users rather than profiles because profiles gets its row at signup,
-- before confirmation. pg_net queues the request and returns, so a failing
-- or slow mail function can't block the signup or confirmation itself.
-- Needs the shared secret in Vault once, and the same value as the
-- function's REGISTRATION_WEBHOOK_SECRET:
--   select vault.create_secret('<secret>', 'registration_webhook_secret');
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_user_registered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_secret text;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then
    return new;
  end if;

  select decrypted_secret into webhook_secret
    from vault.decrypted_secrets
    where name = 'registration_webhook_secret';
  if webhook_secret is null then
    raise warning 'notify_user_registered: registration_webhook_secret missing from vault';
    return new;
  end if;

  perform net.http_post(
    url := 'https://qdtlraxuewrpqzgtjety.supabase.co/functions/v1/notify-user-registered',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'email', new.email,
      'display_name', new.raw_user_meta_data->>'display_name'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_registered on auth.users;
create trigger on_auth_user_registered
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.notify_user_registered();

-- Last line of defence behind delete-account's own check: no path (that
-- function, the dashboard, the admin API) can delete an account whose
-- profile has the admin tier. Demote it first to remove it on purpose.
create or replace function public.prevent_admin_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles where id = old.id and tier = 'admin') then
    raise exception 'admin accounts cannot be deleted, change the tier first';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_admin_deletion on auth.users;
create trigger prevent_admin_deletion
  before delete on auth.users
  for each row execute function public.prevent_admin_deletion();

-- live tier already carries a check constraint limited to free/premium
-- (also not previously reflected here); widened for 'admin' (this file's
-- moderator check) and 'beta' (planned: same access as premium).
alter table profiles drop constraint if exists profiles_tier_check;
alter table profiles add constraint profiles_tier_check
  check (tier in ('free', 'premium', 'beta', 'admin'));

create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references profiles (id) on delete set null,
  title text not null,
  description text not null,
  attachment_path text, -- storage path, not the raw file
  kind text not null default 'idea',
  status text not null default 'open',
  github_issue_url text,
  upvote_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- table already existed live before "kind"/"status"/"github_issue_url" were added
alter table ideas add column if not exists kind text not null default 'idea';
alter table ideas drop constraint if exists ideas_kind_check;
alter table ideas add constraint ideas_kind_check check (kind in ('idea', 'bug'));

alter table ideas add column if not exists status text not null default 'open';
alter table ideas drop constraint if exists ideas_status_check;
alter table ideas add constraint ideas_status_check check (status in ('open', 'resolved'));

-- set by push-idea-to-github once an admin pushes this row there - null
-- until then. No new RLS needed: "ideas: admin update status" below
-- already permits any column an admin writes, the name is just a holdover
-- from when status was the only thing it covered.
alter table ideas add column if not exists github_issue_url text;

create table if not exists idea_votes (
  idea_id uuid not null references ideas (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);

alter table ideas enable row level security;
alter table idea_votes enable row level security;

-- RLS alone isn't enough - the same gotcha already hit once on profiles
-- (see PROJECT_STATUS.md): without a table-level GRANT, a role is blocked
-- before RLS policies are even considered.
grant select on ideas to anon, authenticated;
grant insert, update, delete on ideas to authenticated;
grant select, insert, delete on idea_votes to authenticated;

-- Same gotcha again, this time for service_role: it always bypasses RLS,
-- but that's a separate layer from the table-level GRANT below it, which
-- service_role still needs explicitly - notify-idea-status's admin client
-- was hitting "permission denied for table ideas" without this, even
-- though RLS itself would never have blocked it.
grant select on ideas, idea_votes, profiles to service_role;
-- push-idea-to-github's admin client writes github_issue_url (the atomic
-- claim, the real URL on success, resetting to null on failure) - the
-- select grant above doesn't cover that, hit the exact same "permission
-- denied for table ideas" error again until this was added.
grant update on ideas to service_role;

-- security definer so policies can check admin-ness without recursing into
-- profiles' own RLS (a plain `using` clause referencing profiles would).
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and tier = 'admin');
$$;

create policy "profiles: admin read all" on profiles for select
  using (is_admin());

create policy "ideas: read all" on ideas for select using (true);

create policy "ideas: insert own" on ideas for insert
  with check (auth.uid() = author_id);

create policy "ideas: admin delete" on ideas for delete
  using (is_admin());

create policy "ideas: admin update status" on ideas for update
  using (is_admin()) with check (is_admin());

create policy "idea_votes: owner full access" on idea_votes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- keeps upvote_count in sync so listing ideas never needs a count() join.
-- security definer because there's no UPDATE policy on ideas - a voter
-- other than the idea's own author would otherwise get blocked by RLS
-- when this trigger tries to bump the counter on their vote.
create or replace function sync_idea_upvote_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    update ideas set upvote_count = upvote_count + 1 where id = new.idea_id;
    return new;
  elsif TG_OP = 'DELETE' then
    update ideas set upvote_count = upvote_count - 1 where id = old.idea_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger idea_votes_sync_count
  after insert or delete on idea_votes
  for each row execute function sync_idea_upvote_count();

insert into storage.buckets (id, name, public)
values ('idea-attachments', 'idea-attachments', true)
on conflict (id) do nothing;

create policy "idea-attachments: public read" on storage.objects for select
  using (bucket_id = 'idea-attachments');

create policy "idea-attachments: authenticated upload own" on storage.objects for insert
  with check (
    bucket_id = 'idea-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Saved plans: a route (the uploaded GPX) can carry several plans, each one
-- a search result with its categories, radius and the rider's point
-- selection. Saving is limited to premium, beta and admin accounts; the
-- check lives in the policies so it holds for any client. The GPX is kept
-- as text on the route row, so deleting the account removes it through the
-- foreign keys without any file clean-up.
alter table routes drop column if exists gpx_path;
alter table routes add column if not exists gpx text;
alter table routes drop constraint if exists routes_gpx_size;
alter table routes add constraint routes_gpx_size check (gpx is not null and length(gpx) <= 5000000);

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  route_id uuid not null references routes (id) on delete cascade,
  name text not null,
  category_ids text[] not null,
  radius_m integer not null,
  pois jsonb not null,
  poi_count integer not null,
  excluded_poi_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plans_user_idx on plans (user_id, updated_at desc);
create index if not exists plans_route_idx on plans (route_id);

create or replace function public.can_save_plans()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and tier in ('premium', 'beta', 'admin')
  );
$$;

-- At most 50 saved routes and 50 plans per account.
create or replace function public.limit_saved_plans()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'routes' and (select count(*) from routes where user_id = new.user_id) >= 50 then
    raise exception 'saved route limit reached';
  elsif tg_table_name = 'plans' and (select count(*) from plans where user_id = new.user_id) >= 50 then
    raise exception 'saved plan limit reached';
  end if;
  return new;
end;
$$;

drop trigger if exists routes_limit on routes;
create trigger routes_limit before insert on routes
  for each row execute function public.limit_saved_plans();

drop trigger if exists plans_limit on plans;
create trigger plans_limit before insert on plans
  for each row execute function public.limit_saved_plans();

alter table plans enable row level security;

drop policy if exists "routes: owner full access" on routes;
create policy "routes: owner read" on routes for select
  using (auth.uid() = user_id);
create policy "routes: owner insert" on routes for insert
  with check (auth.uid() = user_id and public.can_save_plans());
create policy "routes: owner update" on routes for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id and public.can_save_plans());
create policy "routes: owner delete" on routes for delete
  using (auth.uid() = user_id);

create policy "plans: owner read" on plans for select
  using (auth.uid() = user_id);
create policy "plans: owner insert" on plans for insert
  with check (
    auth.uid() = user_id
    and public.can_save_plans()
    and exists (select 1 from routes where routes.id = route_id and routes.user_id = auth.uid())
  );
create policy "plans: owner update" on plans for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id and public.can_save_plans());
create policy "plans: owner delete" on plans for delete
  using (auth.uid() = user_id);

-- Table-level grants for saved plans, same reason as for ideas above:
-- row level security only narrows what a role may already touch.
grant select, insert, update, delete on routes, plans to authenticated;
