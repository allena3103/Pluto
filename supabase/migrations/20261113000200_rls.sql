-- Row-level security. Every policy is keyed on auth.uid() and applies to `authenticated` only.
-- anon gets no policies and no table privileges. Service role bypasses RLS (server-only routes).

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.grade_groups enable row level security;
alter table public.assignments enable row level security;
alter table public.files enable row level security;
alter table public.file_pages enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.magic_links enable row level security;
alter table public.alerts enable row level security;
alter table public.study_blocks enable row level security;
alter table public.sms_messages enable row level security;

-- ---------------------------------------------------------------- privileges (explicit, not default)
revoke all on table
  public.profiles, public.courses, public.grade_groups, public.assignments, public.files,
  public.file_pages, public.chat_sessions, public.chat_messages, public.magic_links,
  public.alerts, public.study_blocks, public.sms_messages
from public, anon, authenticated;

grant all on table
  public.profiles, public.courses, public.grade_groups, public.assignments, public.files,
  public.file_pages, public.chat_sessions, public.chat_messages, public.magic_links,
  public.alerts, public.study_blocks, public.sms_messages
to service_role;

grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table
  public.courses, public.grade_groups, public.assignments, public.files,
  public.chat_sessions, public.chat_messages
to authenticated;
-- Read-only for students; writes are service role.
grant select on table public.file_pages, public.alerts, public.study_blocks, public.sms_messages to authenticated;
-- magic_links: no grants and no policies. Service role only.

-- ---------------------------------------------------------------- profiles: select and update own row
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------- full CRUD on own rows
create policy courses_select_own on public.courses
  for select to authenticated using (student_id = (select auth.uid()));
create policy courses_insert_own on public.courses
  for insert to authenticated with check (student_id = (select auth.uid()));
create policy courses_update_own on public.courses
  for update to authenticated using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy courses_delete_own on public.courses
  for delete to authenticated using (student_id = (select auth.uid()));

create policy grade_groups_select_own on public.grade_groups
  for select to authenticated using (student_id = (select auth.uid()));
create policy grade_groups_insert_own on public.grade_groups
  for insert to authenticated with check (student_id = (select auth.uid()));
create policy grade_groups_update_own on public.grade_groups
  for update to authenticated using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy grade_groups_delete_own on public.grade_groups
  for delete to authenticated using (student_id = (select auth.uid()));

create policy assignments_select_own on public.assignments
  for select to authenticated using (student_id = (select auth.uid()));
create policy assignments_insert_own on public.assignments
  for insert to authenticated with check (student_id = (select auth.uid()));
create policy assignments_update_own on public.assignments
  for update to authenticated using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy assignments_delete_own on public.assignments
  for delete to authenticated using (student_id = (select auth.uid()));

create policy files_select_own on public.files
  for select to authenticated using (student_id = (select auth.uid()));
create policy files_insert_own on public.files
  for insert to authenticated with check (student_id = (select auth.uid()));
create policy files_update_own on public.files
  for update to authenticated using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy files_delete_own on public.files
  for delete to authenticated using (student_id = (select auth.uid()));

create policy chat_sessions_select_own on public.chat_sessions
  for select to authenticated using (student_id = (select auth.uid()));
create policy chat_sessions_insert_own on public.chat_sessions
  for insert to authenticated with check (student_id = (select auth.uid()));
create policy chat_sessions_update_own on public.chat_sessions
  for update to authenticated using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy chat_sessions_delete_own on public.chat_sessions
  for delete to authenticated using (student_id = (select auth.uid()));

create policy chat_messages_select_own on public.chat_messages
  for select to authenticated using (student_id = (select auth.uid()));
create policy chat_messages_insert_own on public.chat_messages
  for insert to authenticated with check (student_id = (select auth.uid()));
create policy chat_messages_update_own on public.chat_messages
  for update to authenticated using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy chat_messages_delete_own on public.chat_messages
  for delete to authenticated using (student_id = (select auth.uid()));

-- ---------------------------------------------------------------- select own only
create policy file_pages_select_own on public.file_pages
  for select to authenticated using (student_id = (select auth.uid()));
create policy alerts_select_own on public.alerts
  for select to authenticated using (student_id = (select auth.uid()));
create policy study_blocks_select_own on public.study_blocks
  for select to authenticated using (student_id = (select auth.uid()));
create policy sms_messages_select_own on public.sms_messages
  for select to authenticated using (student_id = (select auth.uid()));
