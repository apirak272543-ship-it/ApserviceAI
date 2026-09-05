-- NOVA skills library. Run after schema.sql and agent_schema.sql.

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null,
  instructions text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.skills enable row level security;
drop policy if exists "Users own skills" on public.skills;
create policy "Users own skills" on public.skills
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists skills_user_enabled_idx on public.skills(user_id, enabled);
