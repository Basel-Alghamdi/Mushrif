-- Head chat with the agent, stored documents and first-sign-in accounts (PORT decisions 1, 2, 7, 8).
-- Writes still go through the Rasd API; RLS below only adds read access for signed-in users, like the core schema.

-- ───────────────────────── accounts ─────────────────────────
-- الصفة, and whether she has chosen her password yet (null = she picks it at her first sign-in).
-- activation_expires_at: the first-sign-in window (after it the head resets the account to open a new one).
-- sessions_valid_after: tokens issued before this moment are refused (set when the head resets a password).
alter table public.profiles
  add column title text not null default '',
  add column activated_at timestamptz,
  add column activation_expires_at timestamptz,
  add column sessions_valid_after timestamptz;
update public.profiles set activated_at = created_at;

-- ───────────────────────── no blocking formats (decision 1) ─────────────────────────
-- Numbers keep their ranges (percent 0–100, counts ≥ 0); free-text formats and short labels stop blocking saves.
alter table public.schools drop constraint schools_ministry_no_check;
-- Real 6-digit ministry numbers stay unique; free text (e.g. «لا يوجد») must never collide between members.
drop index public.schools_ministry_no_unique;
create unique index schools_ministry_no_unique on public.schools (ministry_no) where deleted_at is null and ministry_no ~ '^[0-9]{6}$';
alter table public.visit_reports drop constraint visit_reports_text_check;

do $$
declare item text[];
begin
  foreach item slice 1 in array array[
    array['profile_fields', 'profile_fields_label_check', 'label'],
    array['schools', 'schools_name_check', 'name'],
    array['school_custom_fields', 'school_custom_fields_label_check', 'label'],
    array['school_staff_tiles', 'school_staff_tiles_label_check', 'label'],
    array['leadership_roles', 'leadership_roles_role_check', 'role'],
    array['leadership_fields', 'leadership_fields_label_check', 'label'],
    array['visit_reports', 'visit_reports_type_check', 'type'],
    array['plans', 'plans_label_check', 'label'],
    array['pd_programs', 'pd_programs_label_check', 'label'],
    array['custom_sections', 'custom_sections_label_check', 'label'],
    array['custom_section_fields', 'custom_section_fields_label_check', 'label']
  ] loop
    execute format('alter table public.%I drop constraint %I', item[1], item[2]);
    execute format('alter table public.%I add constraint %I check (char_length(btrim(%I)) between 1 and 200)', item[1], item[2], item[3]);
  end loop;
end $$;

-- ───────────────────────── head chat ─────────────────────────
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'محادثة جديدة',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_idx on public.conversations (user_id, updated_at desc);

-- ai.ts keeps writing messages without a conversation; the head chat always sets one.
alter table public.chat_messages
  add column conversation_id uuid references public.conversations (id) on delete cascade,
  add column blocks jsonb not null default '[]',
  add column attachments jsonb not null default '[]';
create index chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at);

-- Chat proposals reuse agent_runs: proposed / executed / rejected = the contract's pending / applied / rejected.
alter table public.agent_runs drop constraint agent_runs_action_check;
alter table public.agent_runs add constraint agent_runs_action_check check (action in (
  'remind', 'report', 'gaps', 'profile_updates', 'new_members', 'school_updates', 'assign_documents', 'import', 'undo'
));
alter table public.agent_runs add column conversation_id uuid references public.conversations (id) on delete set null;
create index agent_runs_conversation_idx on public.agent_runs (conversation_id) where conversation_id is not null;

-- ───────────────────────── documents ─────────────────────────
-- A file the head attaches in the chat belongs to her district before it is filed into a member's cluster.
alter table public.attachments
  alter column cluster_id drop not null,
  add column district_id uuid references public.districts (id),
  add column conversation_id uuid references public.conversations (id) on delete set null;
update public.attachments a set district_id = c.district_id from public.clusters c where c.id = a.cluster_id;
alter table public.attachments alter column district_id set not null;
create index attachments_district_idx on public.attachments (district_id, uploaded_at desc) where deleted_at is null;
create index attachments_conversation_idx on public.attachments (conversation_id) where conversation_id is not null;

-- Text and tables read out of each file (spreadsheets, Word, PDF); images and audio are stored only.
create table public.attachment_contents (
  attachment_id uuid primary key references public.attachments (id) on delete cascade,
  text text not null default '',
  tables jsonb not null default '[]',
  pages integer check (pages >= 0),
  status text not null default 'ready' check (status in ('ready', 'failed')),
  error text,
  extracted_at timestamptz not null default now()
);

-- ───────────────────────── triggers & row-level security ─────────────────────────
create trigger touch_updated_at before update on public.conversations for each row execute function app.touch_updated_at();

do $$
declare t text;
begin
  foreach t in array array['conversations', 'attachment_contents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

create policy "read own conversations" on public.conversations for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read district attachments" on public.attachments for select to authenticated
  using ((select app.is_head()) and district_id = (select app.my_district_id()));
create policy "read readable attachment contents" on public.attachment_contents for select to authenticated
  using (exists (
    select 1 from public.attachments a where a.id = attachment_id
      and ((a.cluster_id is not null and app.can_read_cluster(a.cluster_id))
        or ((select app.is_head()) and a.district_id = (select app.my_district_id())))
  ));
