-- Verified Founding Members from Stripe Checkout
create table if not exists public.founding_members (
  email text primary key,
  stripe_customer_id text,
  stripe_session_id text unique,
  status text not null default 'active'
    check (status in ('active', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists founding_members_status_idx
  on public.founding_members (status);

alter table public.founding_members enable row level security;

drop policy if exists "Users read own founding row" on public.founding_members;
create policy "Users read own founding row"
  on public.founding_members for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Writes go through the service role (webhook / confirm API). No insert/update for anon/authenticated.
grant select on public.founding_members to authenticated;
grant all on public.founding_members to service_role;
