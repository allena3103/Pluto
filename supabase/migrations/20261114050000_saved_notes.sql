-- saved_notes: answers the web chat built from a student's notes (study guides, summaries),
-- kept on the Notes page under their class. Written by /api/chat with the student's own
-- session client, so row-level security applies to every read and write.
--
-- course_id is null when the cited pages span more than one class. The composite foreign
-- keys stop a row from pointing at another student's course or chat session.

create table public.saved_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid,
  session_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 60000),
  -- [{ "fileId": uuid, "page": int >= 1 }], the notes pages the answer cites.
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  created_at timestamptz not null default now(),
  unique (student_id, id),
  foreign key (student_id, course_id) references public.courses (student_id, id)
    on delete set null (course_id),
  foreign key (student_id, session_id) references public.chat_sessions (student_id, id)
    on delete set null (session_id)
);
create index saved_notes_student_created_idx on public.saved_notes (student_id, created_at desc);
create index saved_notes_course_id_idx on public.saved_notes (course_id);
create index saved_notes_session_id_idx on public.saved_notes (session_id);

alter table public.saved_notes enable row level security;

revoke all on table public.saved_notes from public, anon, authenticated;
grant all on table public.saved_notes to service_role;
-- Students read, save and delete their own notes. No update: a saved answer is a snapshot.
grant select, insert, delete on table public.saved_notes to authenticated;

create policy saved_notes_select_own on public.saved_notes
  for select to authenticated using (student_id = (select auth.uid()));
create policy saved_notes_insert_own on public.saved_notes
  for insert to authenticated with check (student_id = (select auth.uid()));
create policy saved_notes_delete_own on public.saved_notes
  for delete to authenticated using (student_id = (select auth.uid()));

notify pgrst, 'reload schema';
