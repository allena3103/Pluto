-- Full-text search over note pages. Security invoker: RLS applies for user sessions,
-- and the explicit student filter applies for every caller (including service role).
create or replace function public.search_notes(
  p_student_id uuid,
  p_query text,
  p_course_id uuid default null,
  p_limit int default 10
)
returns table (
  file_id uuid,
  file_title text,
  course_id uuid,
  course_name text,
  week_label text,
  page_number int,
  snippet text,
  rank real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select pg_catalog.websearch_to_tsquery('english'::regconfig, coalesce(p_query, '')) as tsq
  ),
  hits as (
    select
      f.id as file_id,
      f.title as file_title,
      c.id as course_id,
      c.name as course_name,
      f.week_label,
      fp.page_number,
      fp.text as page_text,
      pg_catalog.ts_rank(fp.search, q.tsq) as rank,
      q.tsq
    from public.file_pages fp
    join public.files f on f.id = fp.file_id and f.student_id = fp.student_id
    join public.courses c on c.id = f.course_id and c.student_id = f.student_id
    cross join q
    where fp.student_id = p_student_id
      and f.student_id = p_student_id
      and c.student_id = p_student_id
      and (p_course_id is null or f.course_id = p_course_id)
      and fp.search @@ q.tsq
    order by rank desc, f.added_at desc, f.id, fp.page_number
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  select
    h.file_id,
    h.file_title,
    h.course_id,
    h.course_name,
    h.week_label,
    h.page_number,
    pg_catalog.ts_headline(
      'english'::regconfig,
      coalesce(h.page_text, ''),
      h.tsq,
      'MaxWords=30, MinWords=10, MaxFragments=1, StartSel=**, StopSel=**'
    ) as snippet,
    h.rank
  from hits h
  order by h.rank desc, h.file_id, h.page_number;
$$;

revoke all on function public.search_notes(uuid, text, uuid, int) from public, anon;
grant execute on function public.search_notes(uuid, text, uuid, int) to authenticated, service_role;
