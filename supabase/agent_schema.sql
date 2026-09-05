-- NOVA AI Coding Agent control plane
-- Run after schema.sql in Supabase SQL Editor.

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  provider text not null default 'google',
  model text not null default 'gemini-3.6-flash',
  workspace text,
  status text not null default 'idle' check (status in ('idle','running','offline','error')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  title text not null,
  prompt text not null,
  repo_owner text,
  repo_name text,
  repo_branch text default 'main',
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool','system')),
  content text,
  tool_name text,
  tool_call_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  result jsonb,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','blocked')),
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.executions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  command text not null,
  cwd text,
  exit_code integer,
  stdout text,
  stderr text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.test_results (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  command text not null,
  passed boolean,
  exit_code integer,
  output text,
  created_at timestamptz not null default now()
);

create table if not exists public.commits (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sha text,
  branch text,
  message text,
  url text,
  created_at timestamptz not null default now()
);

create index if not exists tasks_queue_idx on public.tasks(status, created_at);
create index if not exists messages_task_idx on public.messages(task_id, created_at);
create index if not exists tool_calls_task_idx on public.tool_calls(task_id, created_at);

alter table public.agents enable row level security;
alter table public.tasks enable row level security;
alter table public.messages enable row level security;
alter table public.tool_calls enable row level security;
alter table public.executions enable row level security;
alter table public.test_results enable row level security;
alter table public.commits enable row level security;

do $$
declare t text; begin
  foreach t in array array['agents','tasks','messages','tool_calls','executions','test_results','commits'] loop
    execute format('drop policy if exists "Users own %s" on public.%s', t, t);
    execute format('create policy "Users own %s" on public.%s for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t, t);
  end loop;
end $$;
