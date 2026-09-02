-- 284_ai_pending_actions.sql
-- The confirmation gate.
--
-- The important design decision here is what Vista AI is NOT given: there is
-- no "send" tool, no "post" tool, no "cancel booking" tool. She cannot execute
-- anything, and no amount of persuasion in a conversation can change that,
-- because the capability does not exist on her side.
--
-- What she can do is PREPARE. A preparing tool works out exactly what would
-- happen, writes it here as a row, and returns a preview. Nothing has moved.
-- The user then sees the preview and presses Confirm, and it is that HTTP
-- request — from the browser, carrying the user's own session — that executes
-- the work. The model is not in the loop at the moment of execution.
--
-- So the sequence is: she proposes, the person disposes, the server acts.
--
-- `payload` is the whole prepared action: recipients, resolved phone numbers,
-- the exact message text. It is written once and never re-derived at execution
-- time, so what is confirmed is precisely what is carried out — a second
-- lookup could quietly send to a different list than the one that was shown.
--
-- `status` walks: pending → executed, or → cancelled / failed / expired.

create table if not exists ai_pending_actions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references ai_conversations(id) on delete set null,
  -- What kind of work this is. The server maps it to an executor; an unknown
  -- kind is refused rather than guessed at.
  kind            text not null,
  title           text not null,
  summary         text,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending'
                    check (status in ('pending','executed','cancelled','failed','expired')),
  result          jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  -- A prepared action goes stale: the balances behind it move. Confirming
  -- something worked out two days ago would send yesterday's truth.
  expires_at      timestamptz not null default now() + interval '1 hour',
  decided_at      timestamptz
);

create index if not exists idx_ai_pending_user on ai_pending_actions(user_id, created_at desc);

alter table ai_pending_actions enable row level security;

-- A prepared action belongs to the person who prepared it. Nobody confirms
-- somebody else's send.
drop policy if exists ai_pending_own on ai_pending_actions;
create policy ai_pending_own on ai_pending_actions for all to authenticated
  using (user_id = auth.uid() and is_staff())
  with check (user_id = auth.uid() and is_staff() and company_id = auth_company_id());
