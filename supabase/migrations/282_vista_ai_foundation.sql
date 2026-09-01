-- 282_vista_ai_foundation.sql
-- Vista AI — the tables the assistant needs and nothing more.
--
-- The assistant is a conversation layer over the ERP that already exists. It
-- owns no business logic and no business data: every figure it quotes comes
-- from the same RPCs the screens call, under the same session, through the
-- same permissions. So the only state that is genuinely new is the
-- conversation itself, the user's own assistant preferences, and — later —
-- the development tasks it hands to Claude Code.
--
-- What it deliberately does NOT create:
--   * no audit table. AI actions go into the existing audit_log with
--     entity = 'ai_action'; anything the AI causes to post also lands in
--     acct_audit by itself, because it posts through the ordinary routines.
--   * no customer, invoice, booking or message tables. Those exist.
--   * no permission table. Permissions live on profiles.permissions and are
--     read with staff_has_perm(), the same server mirror of staffCan() that
--     every other guarded RPC uses.
--
-- Three new permission keys are introduced in lib/staffPermissions.ts and
-- checked here and in the tool layer:
--   ai.use      — may talk to the assistant at all
--   ai.actions  — may let her run WRITE tools (each tool still checks its own
--                 module permission on top; this is an extra gate, not a
--                 replacement for one)
--   ai.dev      — may commission development tasks

-- ---------------------------------------------------------------------------
-- Conversations. One row per thread; messages hang off it.
-- ---------------------------------------------------------------------------
create table if not exists ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_ai_conv_user on ai_conversations(user_id, updated_at desc);

-- role: 'user' | 'assistant'. `blocks` keeps the full Anthropic content array
-- so a resumed thread replays exactly what the model saw — including the
-- tool_use / tool_result pairs, which is what makes "show me the biggest
-- three" still work after a page reload. `text` is the plain rendering for
-- the transcript, so the UI never has to understand block shapes.
create table if not exists ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  text            text,
  blocks          jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ai_msg_conv on ai_messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Per-user assistant preferences. Voice, language, avatar, confirmations.
-- One row per user; the app upserts it.
-- ---------------------------------------------------------------------------
create table if not exists ai_settings (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  voice_input   boolean not null default true,
  voice_output  boolean not null default false,
  hands_free    boolean not null default false,
  language      text    not null default 'en-US',
  avatar        text    not null default 'default',
  -- When false the assistant still asks before every write; this only allows
  -- a user to ask for MORE confirmation, never less.
  confirm_reads boolean not null default false,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Development tasks. Created in phase 8; the table is defined now so the
-- schema settles in one migration instead of two.
--
-- status walks: draft → approved → dispatched → working → preview → tested
--               → done, or → failed / cancelled at any point.
-- Nothing here can deploy anything. The GitHub columns are a record of what
-- happened on GitHub, written by the ERP after reading GitHub's own API.
-- ---------------------------------------------------------------------------
create table if not exists ai_dev_tasks (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete set null,
  title          text not null,
  spoken_request text,
  prompt         text,
  status         text not null default 'draft',
  issue_number   int,
  pr_number      int,
  branch         text,
  preview_url    text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_ai_dev_company on ai_dev_tasks(company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS. A conversation is private to the person who had it — an admin does not
-- read someone else's thread from the ERP, because a thread can quote any
-- figure that person was allowed to see. The audit trail, not the transcript,
-- is the management record; that is what audit_log is for and it is already
-- readable by staff.
-- ---------------------------------------------------------------------------
alter table ai_conversations enable row level security;
alter table ai_messages      enable row level security;
alter table ai_settings      enable row level security;
alter table ai_dev_tasks     enable row level security;

drop policy if exists ai_conv_own on ai_conversations;
create policy ai_conv_own on ai_conversations for all to authenticated
  using (user_id = auth.uid() and is_staff())
  with check (user_id = auth.uid() and is_staff() and company_id = auth_company_id());

drop policy if exists ai_msg_own on ai_messages;
create policy ai_msg_own on ai_messages for all to authenticated
  using (exists (select 1 from ai_conversations c
                 where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from ai_conversations c
                      where c.id = conversation_id and c.user_id = auth.uid()));

drop policy if exists ai_settings_own on ai_settings;
create policy ai_settings_own on ai_settings for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Development tasks are the team's, not one person's: anyone who may
-- commission development can see what has been commissioned. Writes still go
-- through the API, which re-checks the permission before it touches GitHub.
drop policy if exists ai_dev_staff on ai_dev_tasks;
create policy ai_dev_staff on ai_dev_tasks for all to authenticated
  using (company_id = auth_company_id() and staff_has_perm('ai.dev'))
  with check (company_id = auth_company_id() and staff_has_perm('ai.dev'));

-- ---------------------------------------------------------------------------
-- Audit. audit_log has a select policy but no insert policy — the app never
-- wrote to it directly. This is the AI's writer, and it is deliberately the
-- ONLY way the AI records itself: a definer function, so the row cannot be
-- forged or suppressed by the caller, and every field is filled from the
-- session rather than from anything the model said.
--
-- action is 'ai_read' or 'ai_write'; detail carries the tool, its arguments,
-- how many records came back, whether the user confirmed, and the error if
-- there was one.
-- ---------------------------------------------------------------------------
create or replace function ai_log_action(
  p_tool text, p_kind text, p_args jsonb, p_result jsonb
) returns void language sql security definer set search_path = public as $$
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (
    auth_company_id(), auth.uid(),
    case when p_kind = 'write' then 'ai_write' else 'ai_read' end,
    'ai_action', null,
    jsonb_build_object('tool', p_tool, 'args', coalesce(p_args, '{}'::jsonb))
      || coalesce(p_result, '{}'::jsonb)
  );
$$;

grant execute on function ai_log_action(text, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Touch updated_at so the conversation list sorts by last activity.
-- ---------------------------------------------------------------------------
create or replace function ai_touch_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update ai_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_ai_touch_conversation on ai_messages;
create trigger trg_ai_touch_conversation after insert on ai_messages
  for each row execute function ai_touch_conversation();
