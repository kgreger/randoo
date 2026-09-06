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
