-- Assignment instructions and attachments (docs/plan.md decision log, 2026-11-15).
--
-- Canvas keeps assignment attachments only as file links inside the assignment description.
-- Canvas sync stores the description as plain text and each linked file as an
-- `assignment_files` row; PDFs and Word files are downloaded into the private
-- `assignment-files` bucket and their text goes into `assignment_file_pages`.
--
-- These are kept apart from `files` / `file_pages` on purpose: attachments never show on the
-- Notes page and never match search_notes or get_recent_notes.
--
-- Students only read their own rows. Every write is server-side (service role during sync),
-- so there are no student insert/update/delete grants and no storage write policies.

alter table public.assignments
  add column description text check (description is null or char_length(description) <= 20000),
  add column canvas_url text check (canvas_url is null or canvas_url ~ '^https://');

create table public.assignment_files (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  assignment_id uuid not null,
  canvas_file_id text not null,
  title text not null check (char_length(title) between 1 and 300),
  -- 'pdf' and 'docx' are downloaded and read; 'other' (xlsx, accdb, ...) is listed by name only.
  file_type text not null check (file_type in ('pdf', 'docx', 'other')),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  canvas_updated_at timestamptz,
  storage_path text,
  ingest_status text not null default 'pending'
    check (ingest_status in ('pending', 'ready', 'failed', 'skipped')),
  ingest_error text,
  page_count int check (page_count is null or page_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, id),
  unique (student_id, assignment_id, canvas_file_id),
  foreign key (student_id, assignment_id) references public.assignments (student_id, id) on delete cascade,
  -- Same rule as files.storage_path: the server only ever reads the student's own canonical key.
  constraint assignment_files_storage_path_canonical check (
    storage_path is null
    or storage_path = student_id::text || '/' || id::text || '.' || file_type
  ),
  constraint assignment_files_stored_types check (storage_path is null or file_type in ('pdf', 'docx'))
);
create index assignment_files_assignment_id_idx on public.assignment_files (assignment_id);

create table public.assignment_file_pages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  assignment_file_id uuid not null,
  page_number int not null check (page_number >= 1),
  text text,
  unique (assignment_file_id, page_number),
  foreign key (student_id, assignment_file_id) references public.assignment_files (student_id, id)
    on delete cascade
);
create index assignment_file_pages_student_id_idx on public.assignment_file_pages (student_id);

alter table public.assignment_files enable row level security;
alter table public.assignment_file_pages enable row level security;

revoke all on table public.assignment_files, public.assignment_file_pages from public, anon, authenticated;
grant all on table public.assignment_files, public.assignment_file_pages to service_role;
grant select on table public.assignment_files, public.assignment_file_pages to authenticated;

create policy assignment_files_select_own on public.assignment_files
  for select to authenticated using (student_id = (select auth.uid()));
create policy assignment_file_pages_select_own on public.assignment_file_pages
  for select to authenticated using (student_id = (select auth.uid()));

-- Private bucket. Object path: <student_id>/<assignment_file_id>.<pdf|docx>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assignment-files',
  'assignment-files',
  false,
  52428800,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists assignment_files_objects_select_own on storage.objects;
create policy assignment_files_objects_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'assignment-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

notify pgrst, 'reload schema';
