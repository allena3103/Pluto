-- MCP save_study_guide (docs/plan.md, "MCP contract", "Write tool rules").
--
-- 1. saved_notes.source: where a saved note came from. 'chat' (web chat, the default
--    for every existing row) or 'mcp' (the save_study_guide tool). The tool counts its
--    own rows per student per hour to enforce the 10-saves rate limit.
-- 2. magic_links may target a saved note instead of a file page, so the text Pluto sends
--    after an MCP save opens /notes/saved/<id>. Exactly one target per link (check).
--    The composite foreign key (student_id, saved_note_id) -> saved_notes (student_id, id)
--    means a link can only point at a note owned by the same student it signs in, and
--    deleting the note deletes its links.
--
-- No new grants or policies: magic_links stays service-role only (no grants, no
-- policies for anon/authenticated), and the saved_notes policies are unchanged, so a
-- student can still only select, insert and delete their own rows. The insert policy
-- does not restrict `source`, which is fine: it is a label, not a permission.

alter table public.saved_notes
  add column source text not null default 'chat' check (source in ('chat', 'mcp'));

create index saved_notes_student_source_created_idx
  on public.saved_notes (student_id, source, created_at desc);

alter table public.magic_links
  alter column file_id drop not null,
  add column saved_note_id uuid,
  add constraint magic_links_student_id_saved_note_id_fkey
    foreign key (student_id, saved_note_id) references public.saved_notes (student_id, id)
    on delete cascade,
  add constraint magic_links_one_target check (num_nonnulls(file_id, saved_note_id) = 1);

create index magic_links_saved_note_id_idx on public.magic_links (saved_note_id);

notify pgrst, 'reload schema';
