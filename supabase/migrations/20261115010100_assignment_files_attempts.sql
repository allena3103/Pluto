-- Failed attachment reads are retried at most twice per Canvas version of the file
-- (docs/plan.md decision log, 2026-11-15). Sync resets the count when Canvas reports a newer file.
alter table public.assignment_files
  add column ingest_attempts int not null default 0 check (ingest_attempts >= 0);

notify pgrst, 'reload schema';
