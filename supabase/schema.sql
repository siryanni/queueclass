-- QueueClass database schema
-- Run this file in Supabase SQL Editor before deploying the Edge Functions.

create extension if not exists pgcrypto;

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Unterricht',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 hours'),
  active boolean not null default true
);

create unique index if not exists one_active_lesson
  on public.lessons ((active))
  where active = true;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  question varchar(200) not null check (char_length(trim(question)) between 1 and 200),
  initials varchar(4) not null check (initials ~ '^[A-ZÄÖÜ]{1,4}$'),
  created_at timestamptz not null default now()
);

create index if not exists messages_lesson_created_idx
  on public.messages (lesson_id, created_at, id);

-- Owner credentials are intentionally stored in a separate, non-public table.
create table if not exists public.message_owners (
  message_id uuid primary key references public.messages(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.lessons enable row level security;
alter table public.messages enable row level security;
alter table public.message_owners enable row level security;

-- Clients may read active sessions only.
drop policy if exists "Anyone can read active lessons" on public.lessons;
create policy "Anyone can read active lessons"
  on public.lessons for select
  to anon, authenticated
  using (active = true and expires_at > now());

-- Clients may read messages belonging to an active, unexpired session.
drop policy if exists "Anyone can read active session messages" on public.messages;
create policy "Anyone can read active session messages"
  on public.messages for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.lessons l
      where l.id = messages.lesson_id
        and l.active = true
        and l.expires_at > now()
    )
  );

-- No direct client writes. All writes go through Edge Functions using service role.
revoke insert, update, delete on public.lessons from anon, authenticated;
revoke insert, update, delete on public.messages from anon, authenticated;
revoke all on public.message_owners from anon, authenticated;
grant select on public.lessons to anon, authenticated;
grant select on public.messages to anon, authenticated;

-- Enable Postgres Changes for the two public read tables.
alter publication supabase_realtime add table public.lessons;
alter publication supabase_realtime add table public.messages;

-- Expired sessions are hidden by RLS immediately. This function performs physical cleanup.
create or replace function public.cleanup_expired_queueclass_sessions()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.lessons
  where expires_at <= now() or (active = false and created_at < now() - interval '1 day');
$$;

-- Note: schedule this function with Supabase Cron if available on your plan,
-- or rely on the Edge Function session cleanup when a new session starts.
