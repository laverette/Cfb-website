-- Prop Lab public share snapshots: content hash for dedupe + notes.
-- Access is via Netlify prop-eval (service role). RLS stays enabled with no
-- anon policies so private browser clients cannot enumerate shares.

alter table public.prop_lab_shares
  add column if not exists content_hash text;

alter table public.prop_lab_shares
  add column if not exists model_version text;

create index if not exists idx_prop_lab_shares_content_hash
  on public.prop_lab_shares (content_hash)
  where content_hash is not null;

comment on table public.prop_lab_shares is
  'Public immutable Prop Lab card snapshots. Readable by share id via server API only.';
