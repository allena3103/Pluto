-- Upsert target for Canvas grade groups. Null canvas_group_id stays allowed:
-- Postgres unique treats nulls as distinct, so rows with no Canvas id are unchanged.

alter table public.grade_groups
  add constraint grade_groups_student_canvas_group_key unique (student_id, canvas_group_id);
