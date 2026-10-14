-- The مشرفات' review of the member app (Oct 2026): رصد حضور ١٠٠٪ on اليوم, members fill مؤشرات التقويم المدرسي,
-- and sub-folders in ملف الإنجاز.

-- رصد حضور ١٠٠٪: per school per day, yes / no (null = not answered yet). Kept beside the absence confirmation.
alter table public.absence_confirmations add column full_attendance boolean;

-- مؤشرات التقويم المدرسي, now filled by the member (and still by the head):
-- domains: {"<DOMAIN key>": {"level": "تميز|تقدم|انطلاق|تهيئة|", "percent": 0–100 | null}} (keys in @rasd/schemas EVALUATION_DOMAINS);
-- نافس per grade (ثالث ابتدائي، سادس ابتدائي، ثالث متوسط); the self-evaluation report link beside the external one.
alter table public.evaluation_indicators
  add column domains jsonb not null default '{}'::jsonb check (jsonb_typeof(domains) = 'object'),
  add column nafes_grade3 integer check (nafes_grade3 between 0 and 100),
  add column nafes_grade6 integer check (nafes_grade6 between 0 and 100),
  add column nafes_grade9 integer check (nafes_grade9 between 0 and 100),
  add column self_report_url text not null default '';

-- Sub-folder keys (e.g. supervisory_execution_1) need digits.
alter table public.attachments drop constraint attachments_folder_check;
alter table public.attachments add constraint attachments_folder_check check (folder is null or folder ~ '^[a-z0-9_]{1,60}$');
