-- ملف الإنجاز: every file sits in a fixed folder (MEMBER_FOLDERS / SCHOOL_FOLDERS in @rasd/schemas).
-- folder = the folder key; school_id set = a folder inside one of her schools. Both null = not in a folder yet
-- (files uploaded before folders existed, and the head's chat uploads filed into a member's cluster).
alter table public.attachments
  add column folder text check (folder is null or folder ~ '^[a-z_]{1,40}$'),
  add column school_id uuid references public.schools (id) on delete set null,
  add constraint attachments_school_needs_folder check (school_id is null or folder is not null);
create index attachments_school_idx on public.attachments (school_id) where deleted_at is null and school_id is not null;
