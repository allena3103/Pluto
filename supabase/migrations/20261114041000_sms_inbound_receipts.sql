-- Inbound SMS dedupe receipts (service role only). /api/sms/inbound inserts the
-- key before doing anything else; a second delivery of the same message hits the
-- primary key and is acknowledged without replying again. dedupe_key is the
-- provider message id (Sendblue `message_handle`) when present, otherwise the
-- SHA-256 hex of from_number + "\n" + content. No student id, no message text.
-- Same posture as phone_link_codes: RLS on, no policies, no grants for students.

create table public.sms_inbound_receipts (
  dedupe_key text primary key check (char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now()
);

alter table public.sms_inbound_receipts enable row level security;

revoke all on table public.sms_inbound_receipts from public, anon, authenticated;
grant all on table public.sms_inbound_receipts to service_role;

notify pgrst, 'reload schema';
