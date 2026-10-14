-- رئيسة النطاق removes a مشرفة: her account is soft-deleted. Her file (schools, visits, files, audit) stays in the database
-- for the platform owner only. She can no longer sign in or read anything, is never listed or reminded, and her login
-- email is freed (moved to deleted_email) so the same address can be added again later.
alter table public.profiles
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id) on delete set null,
  add column deleted_email extensions.citext;

-- Row-level security: a removed account reads nothing, and the head no longer reads a removed member's rows.
create or replace function app.is_head() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'head' and deleted_at is null)
$$;

create or replace function app.my_district_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select district_id from public.profiles where id = auth.uid() and deleted_at is null
$$;

create or replace function app.can_read_cluster(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clusters c
      join public.profiles member on member.id = c.member_id and member.deleted_at is null
      join public.profiles p on p.id = auth.uid() and p.deleted_at is null
    where c.id = target and (c.member_id = p.id or (p.role = 'head' and c.district_id = p.district_id))
  )
$$;

drop policy "read self or district" on public.profiles;
create policy "read self or district" on public.profiles for select to authenticated
  using (deleted_at is null and (id = (select auth.uid()) or ((select app.is_head()) and district_id = (select app.my_district_id()))));

drop policy "read district attachments" on public.attachments;
create policy "read district attachments" on public.attachments for select to authenticated
  using ((select app.is_head()) and district_id = (select app.my_district_id()) and (cluster_id is null or app.can_read_cluster(cluster_id)));

drop policy "read readable attachment contents" on public.attachment_contents;
create policy "read readable attachment contents" on public.attachment_contents for select to authenticated
  using (exists (
    select 1 from public.attachments a where a.id = attachment_id
      and (case when a.cluster_id is not null then app.can_read_cluster(a.cluster_id)
        else (select app.is_head()) and a.district_id = (select app.my_district_id()) end)
  ));
