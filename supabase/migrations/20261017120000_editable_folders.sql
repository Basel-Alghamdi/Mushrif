-- ملف الإنجاز folders become data (Oct 2026): رئيسة النطاق renames, adds, removes and reorders the folders of each member
-- (one member or many at once) and the folders inside each of her schools. `key` is what attachments.folder stores:
-- the defaults keep today's keys, new folders get a key unique across the district (the same key in two members means
-- the same folder), and keys are never reused — a removed folder's files wait in «غير مصنّفة» until it is restored.
--   scope 'member': her own folders · scope 'school': the folders each of her schools opens
--   kind 'schools': «مدارس المشرفة», which holds no files and opens her schools (removed = her school folders are hidden)
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  scope text not null check (scope in ('member', 'school')),
  key text not null check (key ~ '^[a-z0-9_]{1,60}$' and key <> 'unsorted'),
  label text not null check (char_length(btrim(label)) between 1 and 200),
  parent_key text,
  kind text not null default 'files' check (kind in ('files', 'schools')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (cluster_id, scope, key),
  -- A sub-folder opens from a folder of the same member and scope (one level: enforced by the API).
  foreign key (cluster_id, scope, parent_key) references public.folders (cluster_id, scope, key) on delete cascade,
  check (parent_key is null or parent_key <> key),
  check (kind <> 'schools' or (scope = 'member' and key = 'schools' and parent_key is null))
);
create index folders_cluster_idx on public.folders (cluster_id, scope, sort_order) where deleted_at is null;
create trigger touch_updated_at before update on public.folders for each row execute function app.touch_updated_at();

alter table public.folders enable row level security;
revoke all on public.folders from anon;
revoke insert, update, delete, truncate on public.folders from authenticated;
create policy "read readable cluster rows" on public.folders for select to authenticated using (app.can_read_cluster(cluster_id));

-- The folders a member starts with: today's folders (DEFAULT_FOLDERS in @rasd/schemas — a test keeps the two equal).
-- Used here for every existing member and by the API for every new one. Safe to call again.
create function app.seed_default_folders(target uuid) returns void language sql as $$
  insert into public.folders (cluster_id, scope, key, label, parent_key, kind, sort_order)
  select target, d.scope, d.key, d.label, d.parent_key, d.kind, d.sort_order
  from (values
    ('member', 'professional_development', 'التطوير المهني', null, 'files', 0),
    ('member', 'pd_presenter', 'منفذ', 'professional_development', 'files', 1),
    ('member', 'pd_attendee', 'مستفيد', 'professional_development', 'files', 2),
    ('member', 'schools_analysis', 'تحليل وتصنيف مدارس المشرفة', null, 'files', 3),
    ('member', 'initiatives', 'مبادرات المشرفة', null, 'files', 4),
    ('member', 'schools', 'مدارس المشرفة', null, 'schools', 5),
    ('member', 'performance_charter', 'ميثاق الأداء الوظيفي', null, 'files', 6),
    ('member', 'visit_plan', 'خطة الزيارات', null, 'files', 7),
    ('school', 'discipline', 'الانضباط التعليمي', null, 'files', 0),
    ('school', 'discipline_accountability', 'المساءلة', 'discipline', 'files', 1),
    ('school', 'discipline_thanks', 'الشكر', 'discipline', 'files', 2),
    ('school', 'discipline_plan', 'خطة الانضباط', 'discipline', 'files', 3),
    ('school', 'discipline_reports', 'تقارير الانضباط', 'discipline', 'files', 4),
    ('school', 'supervisory_model', 'النموذج الإشرافي', null, 'files', 5),
    ('school', 'supervisory_reality_analysis', 'تقرير تحليل الواقع', 'supervisory_model', 'files', 6),
    ('school', 'supervisory_improvement_plan', 'خطة التحسين', 'supervisory_model', 'files', 7),
    ('school', 'supervisory_execution_1', 'استمارة تنفيذ الخطة ١', 'supervisory_model', 'files', 8),
    ('school', 'supervisory_execution_2', 'استمارة تنفيذ الخطة ٢', 'supervisory_model', 'files', 9),
    ('school', 'supervisory_execution_3', 'استمارة تنفيذ الخطة ٣', 'supervisory_model', 'files', 10),
    ('school', 'supervisory_nafes_card', 'استمارة بطاقة نافس', 'supervisory_model', 'files', 11),
    ('school', 'visit_reports', 'تقارير الزيارات', null, 'files', 12),
    ('school', 'support_plan', 'خطة دعم المدرسة', null, 'files', 13),
    ('school', 'database', 'قاعدة بيانات المدرسة', null, 'files', 14),
    ('school', 'initiatives', 'مبادرات المدرسة', null, 'files', 15),
    ('school', 'commitment_project', 'مشروع الالتزام التعليمي', null, 'files', 16),
    ('school', 'forms', 'الاستمارات', null, 'files', 17)
  ) as d(scope, key, label, parent_key, kind, sort_order)
  on conflict (cluster_id, scope, key) do nothing
$$;

select app.seed_default_folders(id) from public.clusters;

-- The field a specialist's الصفة names (spelling-tolerant: أ/إ/ا, ة/ه, with or without «ال»), or null for everyone else
-- (e.g. «عضو فريق تنفيذي»). A title naming two fields counts as neither.
create function app.member_specialty(title text) returns text language sql immutable as $$
  with t(v) as (select translate(coalesce(title, ''), 'أإآةى', 'اااهي')),
  hits as (
    select field from t, (values
      ('نواتج', 'نواتج التعلم'),
      ('اداره (ال)?مدرسيه', 'الإدارة المدرسية'),
      ('توجيه (ال)?طلابي', 'التوجيه الطلابي'),
      ('نشاط (ال)?طلابي', 'النشاط الطلابي')
    ) as s(pattern, field) where t.v ~ s.pattern
  )
  select case when (select count(*) from hits) = 1 then (select field from hits) end
$$;

-- خلود's changes for the specialists (Oct 2026): each specialty analyses schools by its own indicators, has no
-- «مدارس المشرفة», and gets a support-plan folder for its field.
create temporary table specialist_folders on commit drop as
  select c.id as cluster_id, c.district_id, p.name, app.member_specialty(p.title) as field
  from public.clusters c join public.profiles p on p.id = c.member_id
  where p.role = 'member' and p.deleted_at is null and app.member_specialty(p.title) is not null;

update public.folders f set label = 'تحليل وتصنيف أداء المدارس وفق مؤشرات ' || t.field
  from specialist_folders t where f.cluster_id = t.cluster_id and f.scope = 'member' and f.key = 'schools_analysis';

-- Only where no file sits in one of her schools' folders (none does today): such files would otherwise leave her view.
update public.folders f set deleted_at = now()
  from specialist_folders t where f.cluster_id = t.cluster_id and f.scope = 'member' and f.key = 'schools'
    and not exists (select 1 from public.attachments a where a.cluster_id = t.cluster_id and a.school_id is not null and a.deleted_at is null);

insert into public.folders (cluster_id, scope, key, label, kind, sort_order)
  select t.cluster_id, 'member', 'schools_support_plan', 'خطة دعم المدارس في مجال ' || t.field, 'files', 8
  from specialist_folders t
  on conflict (cluster_id, scope, key) do nothing;

-- On each member's timeline, and one note to رئيسة النطاق naming who changed (so a missed title is noticed at once).
insert into public.audit_log (district_id, cluster_id, actor_id, action, entity, entity_id, after, source)
  select t.district_id, t.cluster_id, null, 'update', 'folders', t.cluster_id::text,
    jsonb_build_object('label', 'مجلدات ' || t.field), 'system'
  from specialist_folders t;

insert into public.notifications (user_id, kind, text, level)
  select h.id, 'folders',
    'عُدّلت مجلدات ملف الإنجاز للمتخصصات: ' || string_agg(t.name || ' (' || t.field || ')', '، ' order by t.field, t.name)
      || '. لتعديل أي مجلد أو تطبيقه على مشرفات أخريات: الفريق والأرقام ← مجلدات ملف الإنجاز.',
    'info'
  from specialist_folders t join public.profiles h on h.district_id = t.district_id and h.role = 'head' and h.deleted_at is null
  group by h.id;
