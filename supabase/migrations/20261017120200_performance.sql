-- Speed (Oct 2026). The tables are small; what costs is reading more than a page needs.

-- A member's last activity is one index probe (workspace.ts: latest audit row by her, per cluster) instead of
-- aggregating her whole history on every page load.
create index audit_log_activity_idx on public.audit_log (cluster_id, actor_id, at desc) include (action);

-- Removing a profile (undoing an account the agent created) sets audit_log.actor_id to null: find those rows by index.
create index audit_log_actor_idx on public.audit_log (actor_id) where actor_id is not null;

-- File listings show each spreadsheet's sheet names: keep them beside the extracted tables so a listing never has to
-- read and decompress every cell of every sheet.
alter table public.attachment_contents
  add column sheets jsonb generated always as (jsonb_path_query_array(tables, '$[*].sheet')) stored;
