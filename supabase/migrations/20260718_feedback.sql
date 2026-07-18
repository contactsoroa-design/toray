-- Product feedback for roadmap signals (ops read via Dashboard / service role)
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  message text not null
    check (char_length(trim(message)) between 1 and 2000),
  category text not null
    check (category in ('bug', 'idea', 'confusing', 'other')),
  context text not null
    check (context in (
      'header',
      'footer',
      'scan_error',
      'tool_limit',
      'founding_cta',
      'sign_in',
      'budget_cap',
      'outlook'
    )),
  is_signed_in boolean not null default false,
  email text,
  is_pro boolean not null default false,
  path text,
  user_agent text,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_at_idx
  on public.feedback (created_at desc);

create index if not exists feedback_context_idx
  on public.feedback (context, category);

alter table public.feedback enable row level security;

drop policy if exists "Anyone can submit feedback" on public.feedback;
create policy "Anyone can submit feedback"
  on public.feedback for insert
  to anon, authenticated
  with check (true);

-- No client select/update/delete — review in Supabase Table Editor (service role).
grant insert on public.feedback to anon, authenticated;
grant all on public.feedback to service_role;

-- Weekly rollup example (run in SQL editor when reviewing):
-- select context, category, count(*) as n
-- from public.feedback
-- where created_at > now() - interval '7 days'
-- group by 1, 2
-- order by n desc;
