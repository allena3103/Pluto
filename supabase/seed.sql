-- Pluto seed. Idempotent: fixed UUIDs + upserts, safe to re-run (`npm run seed`) and runs on `db reset`.
-- Dates are relative to now(), so a re-run refreshes the seeded assignment dates instead of duplicating.
-- Local dev passwords only (same as the .env.example defaults); `npm run seed` re-sets them from env.
-- Ids are mirrored in scripts/lib/seed-ids.ts.

-- ---------------------------------------------------------------- auth users
-- If a seed email is held by a different user id (for example created by hand), remove it first.
delete from auth.users
where email in ('demo@pluto.test', 'other@pluto.test')
  and id not in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt(u.password, extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('name', u.name), now(), now(),
  '', '', '', ''
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'demo@pluto.test', 'pluto-demo-local-1', 'Demo Student'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'other@pluto.test', 'pluto-other-local-1', 'Other Student')
) as u (id, email, password, name)
on conflict (id) do update set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  banned_until = null,
  deleted_at = null,
  updated_at = now();

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  u.identity_id, u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  now(), now(), now()
from (values
  ('11111111-1111-4111-8111-1111111111aa'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'demo@pluto.test'),
  ('22222222-2222-4222-8222-2222222222aa'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'other@pluto.test')
) as u (identity_id, id, email)
on conflict (provider_id, provider) do update set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  updated_at = now();

-- ---------------------------------------------------------------- profiles (the auth trigger made the rows)
insert into public.profiles (id, name, phone)
values
  ('11111111-1111-4111-8111-111111111111', 'Demo Student', '+15555550100'),
  ('22222222-2222-4222-8222-222222222222', 'Other Student', '+15555550101')
on conflict (id) do update set name = excluded.name, phone = excluded.phone;

-- ---------------------------------------------------------------- courses
insert into public.courses (id, student_id, name, term, canvas_course_id)
values
  ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'History 105', 'Fall 2026', 'seed-hist-105'),
  ('c0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Biology 151', 'Fall 2026', 'seed-bio-151'),
  ('c0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Statistics 240', 'Fall 2026', 'seed-stat-240'),
  ('c0000000-0000-4000-8000-000000000009', '22222222-2222-4222-8222-222222222222', 'Chemistry 111', 'Fall 2026', 'seed-chem-111')
on conflict (id) do update set
  student_id = excluded.student_id, name = excluded.name, term = excluded.term,
  canvas_course_id = excluded.canvas_course_id;

-- ---------------------------------------------------------------- grade groups (weights sum to 100 per course)
insert into public.grade_groups (id, student_id, course_id, name, weight_percent, canvas_group_id)
values
  ('60000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001', 'Reading Responses', 20, 'seed-hist-responses'),
  ('60000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001', 'Essays', 30, 'seed-hist-essays'),
  ('60000000-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001', 'Exams', 50, 'seed-hist-exams'),
  ('60000000-0000-4000-8000-000000000021', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000002', 'Quizzes', 15, 'seed-bio-quizzes'),
  ('60000000-0000-4000-8000-000000000022', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000002', 'Labs', 25, 'seed-bio-labs'),
  ('60000000-0000-4000-8000-000000000023', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000002', 'Exams', 60, 'seed-bio-exams'),
  ('60000000-0000-4000-8000-000000000031', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000003', 'Problem Sets', 30, 'seed-stat-psets'),
  ('60000000-0000-4000-8000-000000000032', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000003', 'Project', 20, 'seed-stat-project'),
  ('60000000-0000-4000-8000-000000000033', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000003', 'Exams', 50, 'seed-stat-exams'),
  ('60000000-0000-4000-8000-000000000091', '22222222-2222-4222-8222-222222222222', 'c0000000-0000-4000-8000-000000000009', 'Everything', 100, 'seed-chem-all')
on conflict (id) do update set
  student_id = excluded.student_id, course_id = excluded.course_id, name = excluded.name,
  weight_percent = excluded.weight_percent, canvas_group_id = excluded.canvas_group_id;

-- ---------------------------------------------------------------- assignments
-- Due dates: Monday of the current week (America/New_York) + wk weeks + dow days, at 23:59 Eastern.
-- dow: 1 = Tue, 2 = Wed, 3 = Thu, 4 = Fri (Mon/Sun avoided so week grouping is unambiguous).
-- Week +3 is the crunch week: five items including the 200-point History midterm.
-- Columns: id suffix, student (d/o), course, group, title, wk, dow, points, score, graded, submitted, prev_wk, prev_dow
with base as (
  select date_trunc('week', now() at time zone 'America/New_York') as monday
),
rows (n, who, course, grp, title, wk, dow, points, score, graded, submitted, prev_wk, prev_dow) as (
  values
  -- History 105: past
  ('001', 'd', '01', '11', 'Reading Response 1',              -6, 4,  20::numeric,  18::numeric, true,  true,  null::int, null::int),
  ('002', 'd', '01', '11', 'Reading Response 2',              -5, 4,  20,  17,   true,  true,  null, null),
  ('003', 'd', '01', '12', 'Essay 1: Causes of World War I',  -4, 3,  100, 88,   true,  true,  null, null),
  ('004', 'd', '01', '11', 'Reading Response 3',              -3, 4,  20,  20,   true,  true,  null, null),
  ('005', 'd', '01', '13', 'Quiz: Interwar Europe',           -2, 2,  50,  41,   true,  true,  null, null),
  ('006', 'd', '01', '11', 'Reading Response 4',              -1, 4,  20,  null, false, true,  null, null),
  -- History 105: upcoming ('101' is the date-change demo: moved up from Tue of week +2 to Thu of week +1)
  ('101', 'd', '01', '12', 'Primary Source Essay',             1, 3,  100, null, false, false, 2,    1),
  ('102', 'd', '01', '11', 'Reading Response 5',               2, 2,  20,  null, false, false, null, null),
  ('103', 'd', '01', '13', 'Midterm Exam',                     3, 3,  200, null, false, false, null, null),
  ('104', 'd', '01', '11', 'Reading Response 6',               3, 4,  20,  null, false, false, null, null),
  ('105', 'd', '01', '12', 'Research Paper Outline',           5, 2,  50,  null, false, false, null, null),
  ('106', 'd', '01', '12', 'Final Research Paper',             7, 3,  150, null, false, false, null, null),
  -- Biology 151: past
  ('011', 'd', '02', '21', 'Quiz 1: Cell Structure',          -6, 1,  25,  22,   true,  true,  null, null),
  ('012', 'd', '02', '22', 'Lab Report 1: Microscopy',        -5, 2,  60,  55,   true,  true,  null, null),
  ('013', 'd', '02', '21', 'Quiz 2: Membranes',               -4, 1,  25,  19,   true,  true,  null, null),
  ('014', 'd', '02', '23', 'Exam 1',                          -3, 2,  150, 126,  true,  true,  null, null),
  ('015', 'd', '02', '22', 'Lab Report 2: Enzymes',           -2, 3,  60,  51,   true,  true,  null, null),
  ('016', 'd', '02', '21', 'Quiz 3: Respiration',             -1, 1,  25,  24,   true,  true,  null, null),
  -- Biology 151: upcoming
  ('111', 'd', '02', '21', 'Quiz 4: Photosynthesis',           1, 1,  25,  null, false, false, null, null),
  ('112', 'd', '02', '22', 'Lab Report 3: Mitosis',            3, 1,  60,  null, false, false, null, null),
  ('113', 'd', '02', '21', 'Quiz 5: Genetics',                 3, 4,  25,  null, false, false, null, null),
  ('114', 'd', '02', '22', 'Lab Report 4: DNA Extraction',     5, 4,  60,  null, false, false, null, null),
  ('115', 'd', '02', '23', 'Exam 2',                           6, 2,  150, null, false, false, null, null),
  -- Statistics 240: past
  ('021', 'd', '03', '31', 'Problem Set 1',                   -6, 3,  40,  36,   true,  true,  null, null),
  ('022', 'd', '03', '31', 'Problem Set 2',                   -5, 3,  40,  38,   true,  true,  null, null),
  ('023', 'd', '03', '31', 'Problem Set 3',                   -4, 4,  40,  31,   true,  true,  null, null),
  ('024', 'd', '03', '33', 'Midterm Exam',                    -2, 1,  100, 84,   true,  true,  null, null),
  ('025', 'd', '03', '31', 'Problem Set 4',                   -1, 3,  40,  null, false, true,  null, null),
  -- Statistics 240: upcoming
  ('121', 'd', '03', '31', 'Problem Set 5',                    2, 4,  40,  null, false, false, null, null),
  ('122', 'd', '03', '31', 'Problem Set 6',                    3, 2,  40,  null, false, false, null, null),
  ('123', 'd', '03', '32', 'Project Proposal',                 4, 3,  50,  null, false, false, null, null),
  ('124', 'd', '03', '31', 'Problem Set 7',                    6, 4,  40,  null, false, false, null, null),
  ('125', 'd', '03', '32', 'Final Project Report',             7, 1,  100, null, false, false, null, null),
  -- Other student (isolation tests need something to hide)
  ('901', 'o', '09', '91', 'Chem Lab 1 (other student)',      -1, 2,  30,  27,   true,  true,  null, null),
  ('902', 'o', '09', '91', 'Chem Problem Set 2 (other student)', 2, 3, 30, null, false, false, null, null)
)
insert into public.assignments (
  id, student_id, course_id, grade_group_id, title, due_at, previous_due_at, due_changed_at,
  points_possible, score, graded, submitted, canvas_assignment_id
)
select
  ('a0000000-0000-4000-8000-000000000' || r.n)::uuid,
  case r.who when 'd' then '11111111-1111-4111-8111-111111111111'::uuid
             else '22222222-2222-4222-8222-222222222222'::uuid end,
  ('c0000000-0000-4000-8000-0000000000' || r.course)::uuid,
  ('60000000-0000-4000-8000-0000000000' || r.grp)::uuid,
  r.title,
  (b.monday + make_interval(weeks => r.wk, days => r.dow, hours => 23, mins => 59)) at time zone 'America/New_York',
  case when r.prev_wk is not null then
    (b.monday + make_interval(weeks => r.prev_wk, days => r.prev_dow, hours => 23, mins => 59)) at time zone 'America/New_York'
  end,
  case when r.prev_wk is not null then now() - interval '3 hours' end,
  r.points, r.score, r.graded, r.submitted,
  'seed-' || r.n
from rows r cross join base b
on conflict (id) do update set
  student_id = excluded.student_id,
  course_id = excluded.course_id,
  grade_group_id = excluded.grade_group_id,
  title = excluded.title,
  due_at = excluded.due_at,
  previous_due_at = excluded.previous_due_at,
  due_changed_at = excluded.due_changed_at,
  points_possible = excluded.points_possible,
  score = excluded.score,
  graded = excluded.graded,
  submitted = excluded.submitted,
  canvas_assignment_id = excluded.canvas_assignment_id;

-- No `files` rows here: the ingest task uploads and ingests the synthetic PDFs (scripts/seed.ts seedFiles()).

-- ---------------------------------------------------------------- assignment instructions and attachments
-- Lab Report 3 (Biology 151, due in week +3) carries Canvas instructions and two linked files:
-- a Word handout whose text is already read (no storage object: the web shows docx as text),
-- and a spreadsheet that is listed by name only.
-- Same data as the Canvas fixtures (packages/canvas/fixtures/courses/seed-bio-151: seed-112's
-- description links files 25001 and 25002), so a fixtures-mode sync keeps these rows as they are.
update public.assignments
set canvas_url = 'https://canvas.example.edu/courses/151/assignments/112',
    description = 'Write a lab report on the onion root tip mitosis lab. Include an introduction, methods, results with your cell counts for each phase, and a discussion of what the mitotic index tells you. Follow the section list in the handout and record your counts in the data template. Submit one PDF.'
where id = 'a0000000-0000-4000-8000-000000000112'
  and student_id = '11111111-1111-4111-8111-111111111111';

-- A sync may have stored the same Canvas files under other ids; the seeded ids win.
delete from public.assignment_files
where student_id = '11111111-1111-4111-8111-111111111111'
  and assignment_id = 'a0000000-0000-4000-8000-000000000112'
  and canvas_file_id in ('25001', '25002')
  and id not in ('af000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000002');

insert into public.assignment_files (
  id, student_id, assignment_id, canvas_file_id, title, file_type, size_bytes, canvas_updated_at, ingest_status, page_count
)
values
  ('af000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000112',
   '25001', 'Lab_3_Mitosis_Handout.docx', 'docx', 20172, '2026-11-03T14:00:00Z', 'ready', 1),
  ('af000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000112',
   '25002', 'Mitosis_Data_Template.xlsx', 'other', 9830, '2026-11-03T14:05:00Z', 'skipped', null)
on conflict (id) do update set
  student_id = excluded.student_id,
  assignment_id = excluded.assignment_id,
  canvas_file_id = excluded.canvas_file_id,
  title = excluded.title,
  file_type = excluded.file_type,
  size_bytes = excluded.size_bytes,
  canvas_updated_at = excluded.canvas_updated_at,
  storage_path = null,
  ingest_status = excluded.ingest_status,
  ingest_error = null,
  page_count = excluded.page_count,
  updated_at = now();

insert into public.assignment_file_pages (student_id, assignment_file_id, page_number, text)
values (
  '11111111-1111-4111-8111-111111111111', 'af000000-0000-4000-8000-000000000001', 1,
  'Lab 3 Handout: Mitosis in Onion Root Tips. Count 200 cells under the microscope and record how many are in interphase, prophase, metaphase, anaphase and telophase. Your report must include a mitotic index table, a labeled drawing of each phase, and a discussion of why the root tip has so many dividing cells. Length: 4 to 6 pages, double spaced. Due at 11:59 PM; late reports lose 10 percent per day.'
)
on conflict (assignment_file_id, page_number) do update set
  student_id = excluded.student_id,
  text = excluded.text;
