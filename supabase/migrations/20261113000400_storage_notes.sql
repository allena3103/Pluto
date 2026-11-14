-- Private bucket for lecture PDFs. Object path: <student_id>/<file_id>.pdf
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notes', 'notes', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists notes_select_own on storage.objects;
drop policy if exists notes_insert_own on storage.objects;
drop policy if exists notes_update_own on storage.objects;
drop policy if exists notes_delete_own on storage.objects;

create policy notes_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'notes' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy notes_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'notes' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy notes_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'notes' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'notes' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy notes_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'notes' and (storage.foldername(name))[1] = (select auth.uid())::text);
