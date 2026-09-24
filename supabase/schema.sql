-- Initial schema. Auth itself is handled by Supabase (auth.users); everything
-- here just extends it for Randoo's own data. Not wired into the backend yet —
-- accounts and saved routes are a post-MVP feature.

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
-- never committed here before. Only ever wrote display_name; extended to
-- also populate email once the admin view needed it (2026-09-24) - existing
-- rows from before this change need a one-time backfill, run separately,
-- not part of this file.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, tier, display_name, email)
  values (new.id, 'free', new.email, new.email);
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
  upvote_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- table already existed live before "kind"/"status" were added
alter table ideas add column if not exists kind text not null default 'idea';
alter table ideas drop constraint if exists ideas_kind_check;
alter table ideas add constraint ideas_kind_check check (kind in ('idea', 'bug'));

alter table ideas add column if not exists status text not null default 'open';
alter table ideas drop constraint if exists ideas_status_check;
alter table ideas add constraint ideas_status_check check (status in ('open', 'resolved'));

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
