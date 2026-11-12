create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.brokerlink_kpi_archive (
  row_key text primary key,
  brokerlink_email text,
  stat_date date,
  payload jsonb not null,
  archived_at timestamptz not null default now()
);
alter table private.brokerlink_kpi_archive enable row level security;
revoke all on table private.brokerlink_kpi_archive from public, anon, authenticated, service_role;

create or replace function public.crm_sync_brokerlink_rows(p_next jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
set statement_timeout = '60s'
as $function$
declare
  v_current jsonb := '[]'::jsonb;
  v_linked_emails text[] := array[]::text[];
  v_manual jsonb := '[]'::jsonb;
  v_api jsonb := '[]'::jsonb;
  v_cutoff date := date '2026-09-01';
begin
  select payload into v_current from public.crm_state where state_key = 'kpiRows' for update;
  if jsonb_typeof(v_current) <> 'array' then v_current := '[]'::jsonb; end if;

  select coalesce(array_agg(distinct lower(trim(coalesce(e.value->>'brokerlinkEmail', e.value->>'brokerlink_email')))), array[]::text[])
  into v_linked_emails
  from public.crm_state s
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s.payload) = 'array' then s.payload else '[]'::jsonb end) e(value)
  where s.state_key in ('employees', 'archivedEmployees')
    and nullif(trim(coalesce(e.value->>'brokerlinkEmail', e.value->>'brokerlink_email')), '') is not null;

  insert into private.brokerlink_kpi_archive(row_key, brokerlink_email, stat_date, payload, archived_at)
  select coalesce(nullif(lower(trim(coalesce(e.value->>'email', e.value->>'brokerlink_email))), '') || ':' || nullif(trim(e.value->>'date'), ''), md5(e.value::text)),
         nullif(lower(trim(coalesce(e.value->>'email', e.value->>'brokerlink_email'))), ''),
         case when (e.value->>'date') ~ '^\d{4}-\d{2}-\d{2}$' then (e.value->>'date')::date else null end,
         e.value, now()
  from jsonb_array_elements(v_current) e(value)
  where e.value->>'source' = 'brokerlink-api'
    and not (nullif(lower(trim(coalesce(e.value->>'email', e.value->>'brokerlink_email'))), '') = any(v_linked_emails)
      and (e.value->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
      and (e.value->>'date')::date >= v_cutoff)
  on conflict (row_key) do update set brokerlink_email=excluded.brokerlink_email, stat_date=excluded.stat_date,
    payload=excluded.payload, archived_at=now();

  select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb) into v_manual
  from jsonb_array_elements(v_current) with ordinality e(value, ordinality)
  where e.value->>'source' is distinct from 'brokerlink-api';

  with candidates as (
    select e.value, e.ordinality, 0 as priority from jsonb_array_elements(v_current) with ordinality e(value, ordinality)
    where e.value->>'source'='brokerlink-api'
      and nullif(lower(trim(coalesce(e.value->>'email',e.value->>'brokerlink_email'))),'')=any(v_linked_emails)
      and (e.value->>'date') ~ '^\d{4}-\d{2}-\d{2}$' and (e.value->>'date')::date>=v_cutoff
    union all
    select a.payload, 0, 1 from private.brokerlink_kpi_archive a
    where a.brokerlink_email=any(v_linked_emails) and a.stat_date>=v_cutoff
    union all
    select n.value,n.ordinality,2 from jsonb_array_elements(case when jsonb_typeof(p_next)='array' then p_next else '[]'::jsonb end) with ordinality n(value,ordinality)
    where n.value->>'source'='brokerlink-api'
      and nullif(lower(trim(coalesce(n.value->>'email',n.value->>'brokerlink_email'))),'')=any(v_linked_emails)
      and (n.value->>'date') ~ '^\d{4}-\d{2}-\d{2}$' and (n.value->>'date')::date>=v_cutoff
  ), keyed as (
    select value,priority,ordinality,
      coalesce(nullif(lower(trim(coalesce(value->>'email',value->>'brokerlink_email'))),'')||':'||nullif(trim(value->>'date'),''),
      md5(value::text)) as row_key from candidates
  ), ranked as (
    select value,row_key,row_number() over(partition by row_key order by priority desc,ordinality desc) as rn from keyed
  )
  select coalesce(jsonb_agg(value order by row_key),'[]'::jsonb) into v_api from ranked where rn=1;

  v_api := v_api || v_manual;
  update public.crm_state set payload=v_api,updated_at=now() where state_key='kpiRows';
  if not found then insert into public.crm_state(state_key,payload,updated_by) values('kpiRows',v_api,null); end if;

  return jsonb_build_object('linked_emails',cardinality(v_linked_emails),'rows_kept',jsonb_array_length(v_api),'cutoff',v_cutoff);
end;
$function$;

revoke all on function public.crm_sync_brokerlink_rows(jsonb) from public, anon, authenticated;
grant execute on function public.crm_sync_brokerlink_rows(jsonb) to service_role;