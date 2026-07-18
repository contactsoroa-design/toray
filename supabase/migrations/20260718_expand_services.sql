-- Allow subscription tools in billing_scans.service
alter table public.billing_scans
  drop constraint if exists billing_scans_service_check;

alter table public.billing_scans
  add constraint billing_scans_service_check
  check (
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
  );
