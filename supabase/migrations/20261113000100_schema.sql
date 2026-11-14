-- Pluto schema (build step 1). Every table except profiles carries student_id.
-- Child rows cannot point at another student's parent: parents expose unique (student_id, id)
-- and children reference it with a composite foreign key.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  phone text unique,
  canvas_token_encrypted text,
  canvas_base_url text,
  created_at timestamptz not null default now(),
  constraint profiles_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$')
);

-- New auth user -> profile row. Security definer because auth inserts run as the auth admin role.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, new.raw_user_meta_data ->> 'name')
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- courses
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  term text,
  canvas_course_id text,
  created_at timestamptz not null default now(),
  unique (student_id, id),
  unique (student_id, canvas_course_id)
);
create index courses_student_id_idx on public.courses (student_id);

-- ---------------------------------------------------------------- grade_groups
create table public.grade_groups (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null,
  name text not null,
  weight_percent numeric not null default 0 check (weight_percent >= 0 and weight_percent <= 100),
  canvas_group_id text,
  created_at timestamptz not null default now(),
  unique (student_id, id),
  foreign key (student_id, course_id) references public.courses (student_id, id) on delete cascade
);
create index grade_groups_student_id_idx on public.grade_groups (student_id);
create index grade_groups_course_id_idx on public.grade_groups (course_id);

-- ---------------------------------------------------------------- assignments
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null,
  title text not null,
  due_at timestamptz,
  previous_due_at timestamptz,
  due_changed_at timestamptz,
  points_possible numeric,
  grade_group_id uuid,
  score numeric,
  graded boolean not null default false,
  submitted boolean not null default false,
  canvas_assignment_id text,
  created_at timestamptz not null default now(),
  unique (student_id, id),
  unique (student_id, canvas_assignment_id),
  foreign key (student_id, course_id) references public.courses (student_id, id) on delete cascade,
  foreign key (student_id, grade_group_id) references public.grade_groups (student_id, id)
    on delete set null (grade_group_id)
);
create index assignments_student_id_idx on public.assignments (student_id);
create index assignments_course_id_idx on public.assignments (course_id);
create index assignments_student_due_idx on public.assignments (student_id, due_at);
create index assignments_grade_group_id_idx on public.assignments (grade_group_id);

-- ---------------------------------------------------------------- files
create table public.files (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null,
  title text not null,
  week_label text,
  added_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('canvas', 'manual')),
  storage_path text,
  ingest_status text not null default 'pending'
    check (ingest_status in ('pending', 'processing', 'ready', 'failed')),
  ingest_error text,
  page_count int check (page_count is null or page_count >= 0),
  canvas_file_id text,
  created_at timestamptz not null default now(),
  unique (student_id, id),
  unique (student_id, canvas_file_id),
  foreign key (student_id, course_id) references public.courses (student_id, id) on delete cascade
);
create index files_student_id_idx on public.files (student_id);
create index files_course_id_idx on public.files (course_id);
create index files_student_added_idx on public.files (student_id, added_at desc);

-- ---------------------------------------------------------------- file_pages (one row per PDF page, 1-based)
create table public.file_pages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  file_id uuid not null,
  page_number int not null check (page_number >= 1),
  text text,
  search tsvector generated always as (to_tsvector('english', coalesce(text, ''))) stored,
  created_at timestamptz not null default now(),
  unique (file_id, page_number),
  foreign key (student_id, file_id) references public.files (student_id, id) on delete cascade
);
create index file_pages_student_id_idx on public.file_pages (student_id);
create index file_pages_search_idx on public.file_pages using gin (search);

-- ---------------------------------------------------------------- chat
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('web', 'sms')),
  title text,
  created_at timestamptz not null default now(),
  unique (student_id, id)
);
create index chat_sessions_student_id_idx on public.chat_sessions (student_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  cited_file_id uuid,
  cited_page int check (cited_page is null or cited_page >= 1),
  channel text not null check (channel in ('web', 'sms')),
  created_at timestamptz not null default now(),
  foreign key (student_id, session_id) references public.chat_sessions (student_id, id) on delete cascade,
  foreign key (student_id, cited_file_id) references public.files (student_id, id)
    on delete set null (cited_file_id)
);
create index chat_messages_student_id_idx on public.chat_messages (student_id);
create index chat_messages_session_idx on public.chat_messages (session_id, created_at);
create index chat_messages_cited_file_id_idx on public.chat_messages (cited_file_id);

-- ---------------------------------------------------------------- magic_links (service role only)
create table public.magic_links (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique, -- SHA-256 hex of the token; the raw token is never stored
  file_id uuid not null,
  page int not null default 1 check (page >= 1),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (student_id, file_id) references public.files (student_id, id) on delete cascade
);
create index magic_links_student_id_idx on public.magic_links (student_id);
create index magic_links_file_id_idx on public.magic_links (file_id);

-- ---------------------------------------------------------------- alerts + study_blocks (ICS feed source)
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('crunch_week', 'date_change')),
  week_start date,
  assignment_id uuid,
  message text,
  sent_at timestamptz,
  calendar_feed_token text unique,
  created_at timestamptz not null default now(),
  unique (student_id, id),
  foreign key (student_id, assignment_id) references public.assignments (student_id, id)
    on delete set null (assignment_id)
);
create index alerts_student_id_idx on public.alerts (student_id);
create index alerts_assignment_id_idx on public.alerts (assignment_id);

create table public.study_blocks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  alert_id uuid not null,
  course_id uuid,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (student_id, alert_id) references public.alerts (student_id, id) on delete cascade,
  foreign key (student_id, course_id) references public.courses (student_id, id)
    on delete set null (course_id)
);
create index study_blocks_student_id_idx on public.study_blocks (student_id);
create index study_blocks_alert_id_idx on public.study_blocks (alert_id);
create index study_blocks_course_id_idx on public.study_blocks (course_id);

-- ---------------------------------------------------------------- sms_messages (simulator store and SMS log)
create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  phone text,
  provider text,
  created_at timestamptz not null default now()
);
create index sms_messages_student_id_idx on public.sms_messages (student_id, created_at);
