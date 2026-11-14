-- Stop two student writes that become cross-tenant bugs once the server trusts them:
--   * ingest (service role) downloads files.storage_path. A student must not be able to
--     aim their row at another student's object, or at any key other than their own
--     <student_id>/<file_id>.pdf.
--   * profiles.canvas_base_url is fetched by Canvas sync (SSRF), and profiles.phone is
--     how inbound SMS is mapped onto a student. Students may change only their name.
--
-- The check constraint binds every role, including service_role. Column grants are what
-- PostgREST enforces. The profile trigger still rejects a signed-in student if a later
-- migration grants table-level UPDATE again.

alter table public.files
  add constraint files_storage_path_canonical
  check (
    storage_path is null
    or storage_path = student_id::text || '/' || id::text || '.pdf'
  );

-- Table-level insert/update covers every column. Replace both with the columns a
-- student actually edits. storage_path and ingest bookkeeping stay server-owned
-- (defaults still fill ingest_status and the timestamps when the column is omitted).
revoke insert, update on table public.files from public, anon, authenticated;

grant insert (
  id,
  student_id,
  course_id,
  title,
  week_label,
  added_at,
  source,
  canvas_file_id
) on table public.files to authenticated;

grant update (
  course_id,
  title,
  week_label,
  added_at,
  source,
  canvas_file_id
) on table public.files to authenticated;

revoke update on table public.profiles from public, anon, authenticated;
grant update ("name") on table public.profiles to authenticated;

create function public.protect_profile_student_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Null when seed.sql runs as postgres. service_role is the server and the seed script.
  if auth.role() in ('authenticated', 'anon')
     and (
       new.id is distinct from old.id
       or new.phone is distinct from old.phone
       or new.canvas_token_encrypted is distinct from old.canvas_token_encrypted
       or new.canvas_base_url is distinct from old.canvas_base_url
       or new.created_at is distinct from old.created_at
     )
  then
    raise exception 'students may update only profiles.name'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_profile_student_columns() from public, anon, authenticated, service_role;

drop trigger if exists profiles_protect_student_columns on public.profiles;
create trigger profiles_protect_student_columns
  before update on public.profiles
  for each row execute function public.protect_profile_student_columns();

-- A running PostgREST keeps column privileges in its schema cache.
notify pgrst, 'reload schema';
