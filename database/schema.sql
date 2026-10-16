create table if not exists public.user_material_records (
  user_id uuid primary key references auth.users (id) on delete cascade,
  records jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_material_records enable row level security;

revoke all on public.user_material_records from anon, authenticated;
grant select, insert, update, delete on public.user_material_records to service_role;
