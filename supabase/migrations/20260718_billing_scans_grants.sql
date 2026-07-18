-- Expose billing_scans to the Data API roles.
-- Needed because "Automatically expose new tables" is disabled.
-- Run in SQL Editor after creating the table.

grant select, insert, update, delete
  on public.billing_scans
  to authenticated;

grant select
  on public.billing_scans
  to anon;

-- Optional: allow sequence/uuid defaults for inserts via API clients
grant usage on schema public to anon, authenticated;
