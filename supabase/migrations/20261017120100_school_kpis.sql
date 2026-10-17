-- مؤشرات الأداء (Oct 2026): رئيسة النطاق enters the school-evaluation indicators of every school in the district (her
-- Excel «مؤشرات التقويم المدرسي», imported or typed), and each member sees them for her schools. Levels
-- (تميز…تهيئة, دعم منخفض…دعم ومساندة شديدة) are derived from the scores in code (@rasd/schemas kpis.ts), never stored.

-- A ministry number as compared everywhere — the SQL twin of ministryKey() in @rasd/schemas (a test keeps them equal):
-- western digits, no spaces/commas/dashes/dots/bidi marks, upper-case, a spreadsheet's trailing ".0" dropped, and the
-- leading zeros of an all-digit number dropped. «096175», «96,175» and «96175» → '96175'; «m 399-5842» → 'M3995842'.
create function app.ministry_key(value text) returns text language sql immutable as $$
  with a(v) as (
    select upper(regexp_replace(regexp_replace(
      translate(coalesce(value, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
      '\.0+$', ''), '[[:space:],٬،._‎‏‪-‮⁦-⁩-]', '', 'g'))
  )
  select case when v ~ '^[0-9]+$' then regexp_replace(v, '^0+(?=[0-9])', '') else v end from a
$$;

create table public.school_kpis (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts (id),
  -- The evaluation year, e.g. '1447' ('' when the sheet did not say). One row per school and year.
  year text not null default '' check (year ~ '^[0-9]{0,4}$'),
  ministry_no text not null default '' check (char_length(ministry_no) <= 40),
  ministry_key text generated always as (app.ministry_key(ministry_no)) stored,
  school_name text not null check (char_length(btrim(school_name)) between 1 and 200),
  stage text not null default '' check (char_length(stage) <= 200),
  authority text not null default '' check (char_length(authority) <= 200),
  region text not null default '' check (char_length(region) <= 200),
  sector text not null default '' check (char_length(sector) <= 200),
  evaluation_type text not null default '' check (char_length(evaluation_type) <= 200),
  -- double precision (not numeric, which the driver returns as text); null = not available.
  overall_score double precision check (overall_score between 0 and 100),
  outcomes_score double precision check (outcomes_score between 0 and 100),
  follow_up_level text not null default '' check (char_length(follow_up_level) <= 200),
  -- {"planning": 84.75, "leadership": null, …}: the ten standards (KPI_STANDARDS keys), each 0–100 or null.
  standards jsonb not null default '{}'::jsonb check (jsonb_typeof(standards) = 'object'),
  -- [{"label": "…", "value": "…"}]: columns of her sheet the platform does not know, kept and shown as they are.
  extra jsonb not null default '[]'::jsonb check (jsonb_typeof(extra) = 'array'),
  note text not null default '' check (char_length(note) <= 2000),
  -- The member assigned to follow the school (from «اسم عضو الفريق التنفيذي المتابع», or chosen by the head). A member
  -- whose own school has this ministry number sees the row too. 'manual' assignments are never changed by an import.
  assigned_member_id uuid references public.profiles (id) on delete set null,
  assignment_source text not null default 'import' check (assignment_source in ('import', 'manual')),
  member_name text not null default '' check (char_length(member_name) <= 200),
  -- 'import': from a sheet (sheet = its name) · 'manual': typed by the head (a replace import never removes it).
  source text not null default 'manual' check (source in ('import', 'manual')),
  sheet text not null default '' check (char_length(sheet) <= 200),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz
);
create unique index school_kpis_school_year_unique on public.school_kpis (district_id, year, ministry_key) where deleted_at is null and ministry_key <> '';
create index school_kpis_district_idx on public.school_kpis (district_id, year, sort_order) where deleted_at is null;
create index school_kpis_assigned_idx on public.school_kpis (assigned_member_id) where deleted_at is null and assigned_member_id is not null;
create index school_kpis_key_idx on public.school_kpis (ministry_key) where deleted_at is null and ministry_key <> '';
create index schools_ministry_key_idx on public.schools (app.ministry_key(ministry_no)) where deleted_at is null and ministry_no <> '';
create trigger touch_updated_at before update on public.school_kpis for each row execute function app.touch_updated_at();

-- Names from «عضو الفريق التنفيذي المتابع» she mapped by hand ("فائزة سلامي" → her member), reused by later imports.
-- member_id null = «ليست من فريقي» (the name is known and left unassigned).
create table public.kpi_member_aliases (
  district_id uuid not null references public.districts (id),
  alias text not null check (char_length(alias) between 1 and 200),
  member_id uuid references public.profiles (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (district_id, alias)
);
create trigger touch_updated_at before update on public.kpi_member_aliases for each row execute function app.touch_updated_at();

-- Each applied import, with what it changed (rows before / added / removed) so it can be undone for a day.
create table public.kpi_imports (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts (id),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  file_name text not null default '',
  year text not null default '',
  mode text not null check (mode in ('merge', 'replace')),
  summary jsonb not null default '{}'::jsonb,
  -- {"added": [ids], "updated": [{"id", "before": {...}}], "removed": [ids]}
  changes jsonb not null default '{}'::jsonb,
  undone_at timestamptz
);
create index kpi_imports_district_idx on public.kpi_imports (district_id, created_at desc);

-- What a member sees: 'own' = her schools' rows · 'district' = every school in the district (the specialists, whose
-- folder «تحليل وتصنيف أداء المدارس وفق مؤشرات …» is about the district's schools). رئيسة النطاق changes it per member.
alter table public.clusters add column kpi_scope text not null default 'own' check (kpi_scope in ('own', 'district'));
update public.clusters c set kpi_scope = 'district'
  from public.profiles p where p.id = c.member_id and p.role = 'member' and p.deleted_at is null and app.member_specialty(p.title) is not null;

-- Row-level security (the API connects as the owner and enforces all of this itself).
do $$
declare t text;
begin
  foreach t in array array['school_kpis', 'kpi_member_aliases', 'kpi_imports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
create policy "read the district register" on public.school_kpis for select to authenticated using (
  deleted_at is null and district_id = (select app.my_district_id()) and (
    (select app.is_head())
    or assigned_member_id = (select auth.uid())
    or exists (select 1 from public.clusters c where c.member_id = (select auth.uid()) and c.kpi_scope = 'district')
    or (ministry_key <> '' and exists (
      select 1 from public.schools s join public.clusters c on c.id = s.cluster_id
      where c.member_id = (select auth.uid()) and s.deleted_at is null and app.ministry_key(s.ministry_no) = school_kpis.ministry_key
    ))
  )
);
create policy "head reads aliases" on public.kpi_member_aliases for select to authenticated
  using ((select app.is_head()) and district_id = (select app.my_district_id()));
create policy "head reads imports" on public.kpi_imports for select to authenticated
  using ((select app.is_head()) and district_id = (select app.my_district_id()));

-- The agent's new proposal kinds: head actions approved on a card, and a KPI sheet import.
alter table public.agent_runs drop constraint agent_runs_action_check;
alter table public.agent_runs add constraint agent_runs_action_check check (action in (
  'remind', 'report', 'gaps', 'profile_updates', 'new_members', 'school_updates', 'assign_documents', 'import', 'undo',
  'api_requests', 'kpi_import'
));
