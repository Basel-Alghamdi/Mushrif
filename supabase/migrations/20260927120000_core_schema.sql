-- Rasd core schema (SPEC §5, EDITABILITY §1).
-- Writes go through the Rasd API, which connects as the table owner and enforces permissions itself.
-- RLS below only grants SELECT to signed-in users (for Realtime and defence in depth); anon gets nothing.

create extension if not exists citext with schema extensions;

create schema if not exists app;

-- ───────────────────────── enums ─────────────────────────
create type public.user_role as enum ('head', 'member');
create type public.school_tier as enum ('تميز', 'تقدم', 'انطلاق', 'تهيئة');
create type public.ingest_status as enum ('queued', 'processing', 'done', 'review', 'failed');
create type public.confidence as enum ('high', 'medium', 'low');
create type public.change_source as enum ('web', 'mobile', 'ingest', 'agent', 'system');

create function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────────────────── people & tenancy ─────────────────────────
create table public.districts (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  -- Local (Asia/Riyadh) time after which a daily submission counts as late. Null = no late status.
  submission_deadline time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  district_id uuid not null references public.districts (id),
  role public.user_role not null,
  name text not null,
  email extensions.citext not null unique,
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_district_idx on public.profiles (district_id, role);

create table public.clusters (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts (id),
  member_id uuid not null unique references public.profiles (id) on delete cascade,
  label text not null default '',
  nafes_card_folder_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clusters_district_idx on public.clusters (district_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts (id),
  invited_by uuid not null references public.profiles (id),
  name text not null,
  email extensions.citext not null,
  cluster_label text not null default '',
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  delivery_status text not null default 'sending' check (delivery_status in ('sending', 'sent', 'link_ready', 'failed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_user_id uuid references public.profiles (id)
);
create unique index invitations_one_pending_per_email on public.invitations (district_id, email) where status = 'pending';

-- ───────────────────────── cluster file ─────────────────────────
create table public.profile_fields (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  field_key text, -- built-in key (nationalId, phone, hireDate…) drives validation; null for member-added fields
  label text not null check (char_length(btrim(label)) between 1 and 60),
  value text not null default '',
  span smallint not null default 1 check (span in (1, 2)),
  field_type text not null default 'text' check (field_type in ('text', 'select', 'derived', 'hijri_date')),
  options text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index profile_fields_cluster_idx on public.profile_fields (cluster_id, sort_order) where deleted_at is null;

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  stage text not null default '',
  area text not null default '',
  ministry_no text not null default '' check (ministry_no = '' or ministry_no ~ '^[0-9]{6}$'),
  ministry_email extensions.citext not null default '',
  education_type text not null default 'حضوري',
  special_ed_program text not null default 'لا يوجد',
  has_guard boolean not null default false,
  classes integer not null default 0 check (classes >= 0),
  students integer not null default 0 check (students >= 0),
  gifted_classes integer not null default 0 check (gifted_classes >= 0),
  gifted_students integer not null default 0 check (gifted_students >= 0),
  teaches_chinese boolean not null default false,
  tier public.school_tier,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index schools_cluster_idx on public.schools (cluster_id, sort_order) where deleted_at is null;
create unique index schools_ministry_no_unique on public.schools (ministry_no) where deleted_at is null and ministry_no <> '';

-- Hides a base school field for every school in the cluster (EDITABILITY S-6).
create table public.school_field_overrides (
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  field_key text not null,
  hidden boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (cluster_id, field_key)
);

create table public.school_custom_fields (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  value text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index school_custom_fields_school_idx on public.school_custom_fields (school_id, sort_order) where deleted_at is null;

create table public.school_staff_tiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  value integer not null default 0 check (value >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index school_staff_tiles_school_idx on public.school_staff_tiles (school_id, sort_order) where deleted_at is null;

create table public.leadership_roles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  role text not null check (char_length(btrim(role)) between 1 and 60),
  state text not null default 'مكلفة',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index leadership_roles_school_idx on public.leadership_roles (school_id, sort_order) where deleted_at is null;

create table public.leadership_fields (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.leadership_roles (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  value text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index leadership_fields_role_idx on public.leadership_fields (role_id, sort_order) where deleted_at is null;

-- ───────────────────────── indicators ─────────────────────────
-- Imported by the head (read-only for members) except the external-report link/status.
create table public.evaluation_indicators (
  school_id uuid primary key references public.schools (id) on delete cascade,
  support_type text not null default '',
  nafes_value integer check (nafes_value between 0 and 100),
  nafes_direction text not null default '' check (nafes_direction in ('', 'up', 'down')),
  nafes_delta text not null default '',
  qudrat integer check (qudrat between 0 and 100),
  tahsili integer check (tahsili between 0 and 100),
  external_report_url text not null default '',
  external_report_status text not null default 'missing' check (external_report_status in ('uploaded', 'missing')),
  imported_at timestamptz,
  imported_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table public.madrasati_indicators (
  school_id uuid primary key references public.schools (id) on delete cascade,
  schedule_assignment integer not null default 0 check (schedule_assignment between 0 and 100),
  course_assignment integer not null default 0 check (course_assignment between 0 and 100),
  student_assignment integer not null default 0 check (student_assignment between 0 and 100),
  teacher_login integer not null default 0 check (teacher_login between 0 and 100),
  student_login integer not null default 0 check (student_login between 0 and 100),
  completion integer not null default 0 check (completion between 0 and 100),
  source text not null default 'manual' check (source in ('manual', 'sync', 'upload')),
  synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.discipline_indicators (
  school_id uuid primary key references public.schools (id) on delete cascade,
  daily integer not null default 0 check (daily between 0 and 100),
  weekly integer not null default 0 check (weekly between 0 and 100),
  monthly integer not null default 0 check (monthly between 0 and 100),
  plan_status text not null default 'missing' check (plan_status in ('approved', 'missing')),
  plan_url text not null default '',
  imported_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ───────────────────────── files ─────────────────────────
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  owner_type text not null, -- visit_report | discipline_support_plan | ingest_job | …
  owner_id uuid,
  name text not null,
  kind text not null default 'ملف',
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  storage_path text not null unique,
  uploaded_by uuid references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index attachments_owner_idx on public.attachments (owner_type, owner_id) where deleted_at is null;
create index attachments_cluster_idx on public.attachments (cluster_id, uploaded_at desc) where deleted_at is null;

create table public.discipline_support_plans (
  cluster_id uuid primary key references public.clusters (id) on delete cascade,
  text text not null default '' check (char_length(text) <= 1000),
  attachment_id uuid references public.attachments (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ───────────────────────── daily work ─────────────────────────
create table public.absence_confirmations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  date date not null,
  done boolean not null default false,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  unique (school_id, date)
);
create index absence_confirmations_date_idx on public.absence_confirmations (date);

create table public.visit_reports (
  id uuid primary key default gen_random_uuid(), -- client may supply it so offline replays stay idempotent
  school_id uuid not null references public.schools (id) on delete cascade,
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  member_id uuid not null references public.profiles (id),
  type text not null check (char_length(btrim(type)) between 1 and 60),
  text text not null check (char_length(btrim(text)) >= 10),
  beneficiaries integer check (beneficiaries >= 0),
  sessions integer check (sessions >= 0),
  blockers text not null default '',
  source public.change_source not null default 'web',
  flagged boolean not null default false,
  flag_reason text,
  created_at timestamptz not null default now()
);
create index visit_reports_cluster_idx on public.visit_reports (cluster_id, created_at desc);
create index visit_reports_school_idx on public.visit_reports (school_id);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  kind text not null, -- realityAnalysis | improvement | execution1..3 | custom
  label text not null check (char_length(btrim(label)) between 1 and 60),
  hint text not null default '',
  url text not null default '',
  status text not null default 'missing' check (status in ('uploaded', 'missing')),
  sort_order integer not null default 0,
  uploaded_at timestamptz,
  updated_at timestamptz not null default now()
);
create index plans_cluster_idx on public.plans (cluster_id, sort_order);

create table public.pd_programs (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  kind text not null check (kind in ('plc', 'workshop', 'appliedLesson', 'other')),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  count integer not null default 0 check (count >= 0),
  reports_url text not null default '',
  status text not null default 'missing' check (status in ('uploaded', 'missing')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index pd_programs_cluster_idx on public.pd_programs (cluster_id, sort_order) where deleted_at is null;

create table public.custom_sections (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index custom_sections_cluster_idx on public.custom_sections (cluster_id, sort_order) where deleted_at is null;

create table public.custom_section_fields (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.custom_sections (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  value text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index custom_section_fields_section_idx on public.custom_section_fields (section_id, sort_order) where deleted_at is null;

create table public.daily_submissions (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  submitted_at timestamptz not null default now(),
  unique (member_id, date)
);
create index daily_submissions_date_idx on public.daily_submissions (date);

-- ───────────────────────── ingest ─────────────────────────
create table public.ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  member_id uuid not null references public.profiles (id),
  attachment_id uuid references public.attachments (id) on delete set null,
  status public.ingest_status not null default 'queued',
  progress_pct integer not null default 0 check (progress_pct between 0 and 100),
  transcript text,
  tables_json jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  deleted_at timestamptz
);
create index ingest_jobs_cluster_idx on public.ingest_jobs (cluster_id, created_at desc) where deleted_at is null;

create table public.extracted_fields (
  id uuid primary key default gen_random_uuid(),
  ingest_job_id uuid not null references public.ingest_jobs (id) on delete cascade,
  target_entity text,
  target_id uuid,
  target_field_key text,
  label text not null,
  value text not null default '',
  confidence public.confidence not null,
  source_ref text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'edited', 'rejected', 'applied')),
  applied_at timestamptz,
  applied_by uuid references public.profiles (id)
);
create index extracted_fields_job_idx on public.extracted_fields (ingest_job_id);

-- ───────────────────────── head, messaging, AI ─────────────────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  text text not null,
  level text not null default 'info' check (level in ('info', 'attention')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts (id),
  user_id uuid not null references public.profiles (id),
  action text not null check (action in ('remind', 'report', 'gaps')),
  plan jsonb not null default '[]',
  payload jsonb not null default '{}',
  status text not null default 'proposed' check (status in ('proposed', 'executed', 'rejected')),
  result_summary text,
  proposed_at timestamptz not null default now(),
  decided_at timestamptz
);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts (id),
  from_user_id uuid not null references public.profiles (id),
  to_user_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null default 'app' check (channel in ('app', 'sms', 'email')),
  body text not null,
  agent_run_id uuid references public.agent_runs (id),
  sent_at timestamptz not null default now()
);
create index reminders_to_idx on public.reminders (to_user_id, sent_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  citations jsonb not null default '[]',
  result_table jsonb,
  created_at timestamptz not null default now()
);
create index chat_messages_user_idx on public.chat_messages (user_id, created_at);

create table public.consolidated_reports (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts (id),
  date date not null,
  summary_text text not null,
  stats jsonb not null default '[]',
  attachment_refs text[] not null default '{}',
  member_count integer not null default 0,
  school_count integer not null default 0,
  format text not null default 'text' check (format in ('text', 'pdf', 'excel')),
  generated_by uuid references public.profiles (id),
  generated_at timestamptz not null default now()
);

-- Append-only. The head's member timeline is rendered from this table (EDITABILITY §1.7).
create table public.audit_log (
  id bigint generated always as identity primary key,
  district_id uuid references public.districts (id),
  cluster_id uuid references public.clusters (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  field text,
  before jsonb,
  after jsonb,
  source public.change_source not null default 'web',
  ip inet,
  at timestamptz not null default now()
);
create index audit_log_cluster_idx on public.audit_log (cluster_id, at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);

-- ───────────────────────── updated_at triggers ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'districts', 'profiles', 'clusters', 'profile_fields', 'schools', 'school_field_overrides',
    'school_custom_fields', 'school_staff_tiles', 'leadership_roles', 'leadership_fields',
    'evaluation_indicators', 'madrasati_indicators', 'discipline_indicators', 'discipline_support_plans',
    'plans', 'pd_programs', 'custom_sections', 'custom_section_fields'
  ] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

-- ───────────────────────── row-level security ─────────────────────────
create function app.is_head() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'head')
$$;

create function app.my_district_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select district_id from public.profiles where id = auth.uid()
$$;

create function app.can_read_cluster(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clusters c join public.profiles p on p.id = auth.uid()
    where c.id = target and (c.member_id = p.id or (p.role = 'head' and c.district_id = p.district_id))
  )
$$;

create function app.can_read_school(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.schools s where s.id = target and app.can_read_cluster(s.cluster_id))
$$;

grant usage on schema app to authenticated;
grant execute on function app.is_head(), app.my_district_id(), app.can_read_cluster(uuid), app.can_read_school(uuid) to authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

create policy "read self or district" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or ((select app.is_head()) and district_id = (select app.my_district_id())));
create policy "read own district" on public.districts for select to authenticated
  using (id = (select app.my_district_id()));
create policy "read readable clusters" on public.clusters for select to authenticated
  using (app.can_read_cluster(id));

do $$
declare t text;
begin
  foreach t in array array[
    'profile_fields', 'schools', 'school_field_overrides', 'discipline_support_plans', 'visit_reports',
    'plans', 'pd_programs', 'custom_sections', 'daily_submissions', 'attachments', 'ingest_jobs'
  ] loop
    execute format('create policy "read readable cluster rows" on public.%I for select to authenticated using (app.can_read_cluster(cluster_id))', t);
  end loop;
  foreach t in array array[
    'school_custom_fields', 'school_staff_tiles', 'leadership_roles', 'evaluation_indicators',
    'madrasati_indicators', 'discipline_indicators', 'absence_confirmations'
  ] loop
    execute format('create policy "read readable school rows" on public.%I for select to authenticated using (app.can_read_school(school_id))', t);
  end loop;
end $$;

create policy "read readable role fields" on public.leadership_fields for select to authenticated
  using (exists (select 1 from public.leadership_roles r where r.id = role_id and app.can_read_school(r.school_id)));
create policy "read readable section fields" on public.custom_section_fields for select to authenticated
  using (exists (select 1 from public.custom_sections s where s.id = section_id and app.can_read_cluster(s.cluster_id)));
create policy "read own notifications" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own chat" on public.chat_messages for select to authenticated
  using (user_id = (select auth.uid()));
-- invitations, extracted_fields, agent_runs, reminders, consolidated_reports, audit_log: API only (no policy = no client access).
