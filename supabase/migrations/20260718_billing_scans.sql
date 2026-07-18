-- ToRay v1: per-user billing scan history
-- Run in Supabase Dashboard → SQL Editor → New query → Run

create table if not exists public.billing_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  service text not null check (
    service in (
      'OpenAI API',
      'Anthropic API',
      'ChatGPT Plus',
      'Claude Pro',
      'Cursor Pro',
      'Midjourney',
      'GitHub Copilot',
      'Perplexity Pro'
    )
  ),
  amount_usd numeric(12, 2) not null check (amount_usd >= 0),
  billing_period text,
  scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists billing_scans_user_scanned_at_idx
  on public.billing_scans (user_id, scanned_at desc);

alter table public.billing_scans enable row level security;

drop policy if exists "Users read own scans" on public.billing_scans;
create policy "Users read own scans"
  on public.billing_scans for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own scans" on public.billing_scans;
create policy "Users insert own scans"
  on public.billing_scans for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own scans" on public.billing_scans;
create policy "Users update own scans"
  on public.billing_scans for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own scans" on public.billing_scans;
create policy "Users delete own scans"
  on public.billing_scans for delete
  using (auth.uid() = user_id);

-- Required when "Automatically expose new tables" is off
grant usage on schema public to anon, authenticated;
grant select on public.billing_scans to anon;
grant select, insert, update, delete on public.billing_scans to authenticated;
