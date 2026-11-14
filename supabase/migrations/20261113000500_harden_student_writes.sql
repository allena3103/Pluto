-- Harden student-writable surfaces found in milestone security review.
-- 1) files.storage_path must always be <student_id>/<file_id>.pdf
-- 2) students cannot directly write files rows
-- 3) students may update only profiles.name

alter table public.files
  drop constraint if exists files_storage_path_matches_owner;

alter table public.files
  add constraint files_storage_path_matches_owner
  check (
    storage_path is null
    or storage_path = (student_id::text || '/' || id::text || '.pdf')
  ) not valid;

revoke insert, update, delete on table public.files from authenticated;

drop policy if exists files_insert_own on public.files;
drop policy if exists files_update_own on public.files;
drop policy if exists files_delete_own on public.files;

revoke update on table public.profiles from authenticated;
grant update (name) on table public.profiles to authenticated;
