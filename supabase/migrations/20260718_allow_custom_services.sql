-- Allow any tool name (presets + user-defined custom tools)
alter table public.billing_scans
  drop constraint if exists billing_scans_service_check;

alter table public.billing_scans
  add constraint billing_scans_service_length_check
  check (char_length(service) >= 1 and char_length(service) <= 64);
