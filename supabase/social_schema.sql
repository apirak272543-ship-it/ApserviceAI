-- Social Connections + Content Preview schema for NOVA Chat
-- Run in Supabase SQL Editor after schema.sql and agent_schema.sql.
-- OAuth access/refresh tokens are encrypted by the social-oauth Edge Function.

create extension if not exists pgcrypto;

create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('facebook','tiktok')),
  provider_account_id text not null,
  display_name text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, provider_account_id)
);

create table if not exists public.social_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('facebook','tiktok')),
  state_hash text not null unique,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  media_urls text[] not null default '{}',
  target_platforms text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','approved','published','archived')),
  ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_connections_user_idx on public.social_connections(user_id, provider);
create index if not exists oauth_states_expiry_idx on public.social_oauth_states(expires_at);
create index if not exists content_drafts_user_updated_idx on public.content_drafts(user_id, updated_at desc);

alter table public.social_connections enable row level security;
alter table public.social_oauth_states enable row level security;
alter table public.content_drafts enable row level security;

drop policy if exists "Users own social connections" on public.social_connections;
create policy "Users own social connections" on public.social_connections
  for select to authenticated using ((select auth.uid()) = user_id);

-- Do not grant the browser access to the base table because it contains ciphertext.
-- The Edge Function uses the service role and returns only this safe projection.
revoke all on table public.social_connections from anon, authenticated;
create or replace view public.social_connections_public as
  select id, user_id, provider, provider_account_id, display_name,
         token_expires_at, scopes, metadata, created_at, updated_at
  from public.social_connections
  where user_id = (select auth.uid());
grant select on public.social_connections_public to authenticated;

drop policy if exists "Users manage own drafts" on public.content_drafts;
create policy "Users manage own drafts" on public.content_drafts
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- OAuth states and encrypted token columns are never exposed to the browser via RLS.
drop policy if exists "No client access to oauth states" on public.social_oauth_states;
create policy "No client access to oauth states" on public.social_oauth_states
  for all to authenticated using (false) with check (false);

create or replace function public.touch_social_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists social_connections_touch_updated_at on public.social_connections;
create trigger social_connections_touch_updated_at before update on public.social_connections
for each row execute function public.touch_social_updated_at();

drop trigger if exists content_drafts_touch_updated_at on public.content_drafts;
create trigger content_drafts_touch_updated_at before update on public.content_drafts
for each row execute function public.touch_social_updated_at();
