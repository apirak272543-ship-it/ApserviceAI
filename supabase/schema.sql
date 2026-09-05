-- NOVA Chat: Supabase schema for per-user chat history
-- Run this in Supabase Dashboard > SQL Editor.

create table if not exists public.chat_histories (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'แชตใหม่',
  chat jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.chat_histories enable row level security;

drop policy if exists "Users can read their own chat history" on public.chat_histories;
create policy "Users can read their own chat history"
  on public.chat_histories for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own chat history" on public.chat_histories;
create policy "Users can insert their own chat history"
  on public.chat_histories for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own chat history" on public.chat_histories;
create policy "Users can update their own chat history"
  on public.chat_histories for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own chat history" on public.chat_histories;
create policy "Users can delete their own chat history"
  on public.chat_histories for delete to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists chat_histories_user_updated_idx
  on public.chat_histories (user_id, updated_at desc);
