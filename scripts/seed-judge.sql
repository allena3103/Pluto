-- Judge demo account data, run by `npm run seed:judge` after it recreates the judge user
-- (the delete cascades every judge row, so this always starts from empty).
-- Same synthetic courses, grade groups and assignments as the demo student in supabase/seed.sql,
-- with judge ids: the last id group starts with 3. Never touches any other student.
-- Ids are mirrored in scripts/lib/seed-ids.ts (JUDGE_*).

update public.profiles set name = 'Judge Demo', phone = null
where id = '33333333-3333-4333-8333-333333333333';

-- ---------------------------------------------------------------- courses
insert into public.courses (id, student_id, name, term, canvas_course_id)
values
  ('c0000000-0000-4000-8000-300000000001', '33333333-3333-4333-8333-333333333333', 'History 105', 'Fall 2026', 'seed-hist-105'),
  ('c0000000-0000-4000-8000-300000000002', '33333333-3333-4333-8333-333333333333', 'Biology 151', 'Fall 2026', 'seed-bio-151'),
  ('c0000000-0000-4000-8000-300000000003', '33333333-3333-4333-8333-333333333333', 'Statistics 240', 'Fall 2026', 'seed-stat-240');

-- ---------------------------------------------------------------- grade groups (weights sum to 100 per course)
insert into public.grade_groups (id, student_id, course_id, name, weight_percent, canvas_group_id)
select
  ('60000000-0000-4000-8000-3000000000' || g.grp)::uuid,
  '33333333-3333-4333-8333-333333333333'::uuid,
  ('c0000000-0000-4000-8000-3000000000' || g.course)::uuid,
  g.name, g.weight, g.canvas_id
from (values
  ('11', '01', 'Reading Responses', 20, 'seed-hist-responses'),
  ('12', '01', 'Essays',            30, 'seed-hist-essays'),
  ('13', '01', 'Exams',             50, 'seed-hist-exams'),
  ('21', '02', 'Quizzes',           15, 'seed-bio-quizzes'),
  ('22', '02', 'Labs',              25, 'seed-bio-labs'),
  ('23', '02', 'Exams',             60, 'seed-bio-exams'),
  ('31', '03', 'Problem Sets',      30, 'seed-stat-psets'),
  ('32', '03', 'Project',           20, 'seed-stat-project'),
  ('33', '03', 'Exams',             50, 'seed-stat-exams')
) as g (grp, course, name, weight, canvas_id);

-- ---------------------------------------------------------------- assignments
-- Due dates: Monday of the current week (America/New_York) + wk weeks + dow days, at 23:59 Eastern,
-- so a re-run refreshes them. Week +3 is the crunch week. '101' is the moved-due-date example.
-- Columns: id suffix, course, group, title, wk, dow, points, score, graded, submitted, prev_wk, prev_dow
with base as (
  select date_trunc('week', now() at time zone 'America/New_York') as monday
),
rows (n, course, grp, title, wk, dow, points, score, graded, submitted, prev_wk, prev_dow) as (
  values
  ('001', '01', '11', 'Reading Response 1',              -6, 4,  20::numeric,  18::numeric, true,  true,  null::int, null::int),
  ('002', '01', '11', 'Reading Response 2',              -5, 4,  20,  17,   true,  true,  null, null),
  ('003', '01', '12', 'Essay 1: Causes of World War I',  -4, 3,  100, 88,   true,  true,  null, null),
  ('004', '01', '11', 'Reading Response 3',              -3, 4,  20,  20,   true,  true,  null, null),
  ('005', '01', '13', 'Quiz: Interwar Europe',           -2, 2,  50,  41,   true,  true,  null, null),
  ('006', '01', '11', 'Reading Response 4',              -1, 4,  20,  null, false, true,  null, null),
  ('101', '01', '12', 'Primary Source Essay',             1, 3,  100, null, false, false, 2,    1),
  ('102', '01', '11', 'Reading Response 5',               2, 2,  20,  null, false, false, null, null),
  ('103', '01', '13', 'Midterm Exam',                     3, 3,  200, null, false, false, null, null),
  ('104', '01', '11', 'Reading Response 6',               3, 4,  20,  null, false, false, null, null),
  ('105', '01', '12', 'Research Paper Outline',           5, 2,  50,  null, false, false, null, null),
  ('106', '01', '12', 'Final Research Paper',             7, 3,  150, null, false, false, null, null),
  ('011', '02', '21', 'Quiz 1: Cell Structure',          -6, 1,  25,  22,   true,  true,  null, null),
  ('012', '02', '22', 'Lab Report 1: Microscopy',        -5, 2,  60,  55,   true,  true,  null, null),
  ('013', '02', '21', 'Quiz 2: Membranes',               -4, 1,  25,  19,   true,  true,  null, null),
  ('014', '02', '23', 'Exam 1',                          -3, 2,  150, 126,  true,  true,  null, null),
  ('015', '02', '22', 'Lab Report 2: Enzymes',           -2, 3,  60,  51,   true,  true,  null, null),
  ('016', '02', '21', 'Quiz 3: Respiration',             -1, 1,  25,  24,   true,  true,  null, null),
  ('111', '02', '21', 'Quiz 4: Photosynthesis',           1, 1,  25,  null, false, false, null, null),
  ('112', '02', '22', 'Lab Report 3: Mitosis',            3, 1,  60,  null, false, false, null, null),
  ('113', '02', '21', 'Quiz 5: Genetics',                 3, 4,  25,  null, false, false, null, null),
  ('114', '02', '22', 'Lab Report 4: DNA Extraction',     5, 4,  60,  null, false, false, null, null),
  ('115', '02', '23', 'Exam 2',                           6, 2,  150, null, false, false, null, null),
  ('021', '03', '31', 'Problem Set 1',                   -6, 3,  40,  36,   true,  true,  null, null),
  ('022', '03', '31', 'Problem Set 2',                   -5, 3,  40,  38,   true,  true,  null, null),
  ('023', '03', '31', 'Problem Set 3',                   -4, 4,  40,  31,   true,  true,  null, null),
  ('024', '03', '33', 'Midterm Exam',                    -2, 1,  100, 84,   true,  true,  null, null),
  ('025', '03', '31', 'Problem Set 4',                   -1, 3,  40,  null, false, true,  null, null),
  ('121', '03', '31', 'Problem Set 5',                    2, 4,  40,  null, false, false, null, null),
  ('122', '03', '31', 'Problem Set 6',                    3, 2,  40,  null, false, false, null, null),
  ('123', '03', '32', 'Project Proposal',                 4, 3,  50,  null, false, false, null, null),
  ('124', '03', '31', 'Problem Set 7',                    6, 4,  40,  null, false, false, null, null),
  ('125', '03', '32', 'Final Project Report',             7, 1,  100, null, false, false, null, null)
)
insert into public.assignments (
  id, student_id, course_id, grade_group_id, title, due_at, previous_due_at, due_changed_at,
  points_possible, score, graded, submitted, canvas_assignment_id
)
select
  ('a0000000-0000-4000-8000-300000000' || r.n)::uuid,
  '33333333-3333-4333-8333-333333333333'::uuid,
  ('c0000000-0000-4000-8000-3000000000' || r.course)::uuid,
  ('60000000-0000-4000-8000-3000000000' || r.grp)::uuid,
  r.title,
  (b.monday + make_interval(weeks => r.wk, days => r.dow, hours => 23, mins => 59)) at time zone 'America/New_York',
  case when r.prev_wk is not null then
    (b.monday + make_interval(weeks => r.prev_wk, days => r.prev_dow, hours => 23, mins => 59)) at time zone 'America/New_York'
  end,
  case when r.prev_wk is not null then now() - interval '3 hours' end,
  r.points, r.score, r.graded, r.submitted,
  'seed-' || r.n
from rows r cross join base b;

-- ---------------------------------------------------------------- assignment instructions and attachments
-- Same as supabase/seed.sql: Lab Report 3 has Canvas instructions, a Word handout (text already read,
-- no storage object) and a spreadsheet listed by name only.
update public.assignments
set canvas_url = 'https://canvas.example.edu/courses/151/assignments/112',
    description = 'Write a lab report on the onion root tip mitosis lab. Include an introduction, methods, results with your cell counts for each phase, and a discussion of what the mitotic index tells you. Follow the section list in the handout and record your counts in the data template. Submit one PDF.'
where id = 'a0000000-0000-4000-8000-300000000112'
  and student_id = '33333333-3333-4333-8333-333333333333';

insert into public.assignment_files (
  id, student_id, assignment_id, canvas_file_id, title, file_type, size_bytes, canvas_updated_at, ingest_status, page_count
)
values
  ('af000000-0000-4000-8000-300000000001', '33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-300000000112',
   '25001', 'Lab_3_Mitosis_Handout.docx', 'docx', 20172, '2026-11-03T14:00:00Z', 'ready', 1),
  ('af000000-0000-4000-8000-300000000002', '33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-300000000112',
   '25002', 'Mitosis_Data_Template.xlsx', 'other', 9830, '2026-11-03T14:05:00Z', 'skipped', null);

insert into public.assignment_file_pages (student_id, assignment_file_id, page_number, text)
values (
  '33333333-3333-4333-8333-333333333333', 'af000000-0000-4000-8000-300000000001', 1,
  'Lab 3 Handout: Mitosis in Onion Root Tips. Count 200 cells under the microscope and record how many are in interphase, prophase, metaphase, anaphase and telophase. Your report must include a mitotic index table, a labeled drawing of each phase, and a discussion of why the root tip has so many dividing cells. Length: 4 to 6 pages, double spaced. Due at 11:59 PM; late reports lose 10 percent per day.'
);
