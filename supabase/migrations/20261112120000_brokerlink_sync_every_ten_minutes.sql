create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'capsule_brokerlink_cron_token') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'capsule_brokerlink_cron_token', 'Private token for the scheduled Brokerlink sync');
  end if;
  if not exists (select 1 from vault.secrets where name = 'capsule_brokerlink_project_url') then
    perform vault.create_secret('https://sfetljjrbwlxigcneiib.supabase.co', 'capsule_brokerlink_project_url');
  end if;
  if not exists (select 1 from vault.secrets where name = 'capsule_brokerlink_publishable_key') then
    perform vault.create_secret('sb_publishable_NLhHkVIMoNY1HGgY5h0aZg_yB-HHIAe', 'capsule_brokerlink_publishable_key');
  end if;
end
$$;

create or replace function public.validate_brokerlink_sync_cron_secret(p_candidate text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select coalesce(
    p_candidate is not null
    and octet_length(p_candidate) >= 64
    and exists (
      select 1
      from vault.decrypted_secrets
      where name = 'capsule_brokerlink_cron_token'
        and decrypted_secret = p_candidate
    ),
    false
  );
$function$;

revoke all on function public.validate_brokerlink_sync_cron_secret(text) from public;
grant execute on function public.validate_brokerlink_sync_cron_secret(text) to anon, authenticated;

do $outer$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'capsule-brokerlink-daily-sync'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'capsule-brokerlink-daily-sync',
    '*/10 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'capsule_brokerlink_project_url') || '/functions/v1/brokerlink-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'capsule_brokerlink_publishable_key'),
          'x-brokerlink-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'capsule_brokerlink_cron_token')
        ),
        body := jsonb_build_object(
          'from', to_char((now() at time zone 'Europe/Zurich')::date - 8, 'YYYY-MM-DD'),
          'to', to_char((now() at time zone 'Europe/Zurich')::date, 'YYYY-MM-DD')
        )
      );
    $job$
  );
end
$outer$;
