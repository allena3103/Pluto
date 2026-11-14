-- Phone link codes (service role only). The raw code is never stored; code_hash is
-- the SHA-256 hex of the trimmed, uppercased code. Same posture as magic_links:
-- RLS on, no policies, no grants for signed-in students. The service role bypasses RLS.

create table public.phone_link_codes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index phone_link_codes_student_id_idx on public.phone_link_codes (student_id);

alter table public.phone_link_codes enable row level security;

revoke all on table public.phone_link_codes from public, anon, authenticated;
grant all on table public.phone_link_codes to service_role;

notify pgrst, 'reload schema';
