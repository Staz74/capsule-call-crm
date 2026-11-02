create or replace function public.crm_role_has_module(p_role text, p_module text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  saved_permissions jsonb;
  configured_modules jsonb;
  defaults jsonb;
begin
  if p_role = 'admin' then return true; end if;
  if p_role not in ('rh','chef_plateau') then return false; end if;
  select payload into saved_permissions from public.crm_state where state_key = 'appPermissions';
  configured_modules := saved_permissions #> array['moduleAccess',p_role];
  if jsonb_typeof(configured_modules) = 'array' then return configured_modules @> jsonb_build_array(p_module); end if;
  if p_role = 'rh' then defaults := jsonb_build_array('dashboard','candidates','employees','employee-archive','profile','onboarding','quality','tasks','reports','documents');
  else defaults := jsonb_build_array('dashboard','employees','profile','onboarding','kpi','quality','tasks','reports'); end if;
  return defaults @> jsonb_build_array(p_module);
end;
$$;
create or replace function public.crm_role_can_write_state(p_role text, p_state_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare saved_permissions jsonb; label text;
begin
  if p_role='admin' then return true; end if;
  if p_role not in ('rh','chef_plateau') then return false; end if;
  case
    when p_state_key='employees' then return public.crm_role_has_module(p_role,'employees') or public.crm_role_has_module(p_role,'profile') or public.crm_role_has_module(p_role,'onboarding') or public.crm_role_has_module(p_role,'candidates');
    when p_state_key in ('candidates','archivedCandidates') then return public.crm_role_has_module(p_role,'candidates');
    when p_state_key='archivedEmployees' then
      label:=case when p_role='rh' then 'RH' else 'Chef de plateau' end;
      select payload into saved_permissions from public.crm_state where state_key='appPermissions';
      return (public.crm_role_has_module(p_role,'employees') or public.crm_role_has_module(p_role,'profile') or public.crm_role_has_module(p_role,'employee-archive')) and coalesce(saved_permissions->'deleteEmployeeRoles','["Administrateur"]'::jsonb) ? label;
    when p_state_key in ('tasks','taskHistory') then return public.crm_role_has_module(p_role,'tasks') or public.crm_role_has_module(p_role,'quality') or public.crm_role_has_module(p_role,'reports') or public.crm_role_has_module(p_role,'control') or public.crm_role_has_module(p_role,'employees') or public.crm_role_has_module(p_role,'onboarding');
    when p_state_key in ('qualityHistory','coachingHistory') then return public.crm_role_has_module(p_role,'quality');
    when p_state_key='onboardingHistory' then return public.crm_role_has_module(p_role,'onboarding');
    when p_state_key='attendanceHistory' then return public.crm_role_has_module(p_role,'employees') or public.crm_role_has_module(p_role,'profile');
    when p_state_key in ('reports','meetings') then return public.crm_role_has_module(p_role,'reports');
    when p_state_key='docs' then return public.crm_role_has_module(p_role,'documents');
    when p_state_key='kpiRows' then return public.crm_role_has_module(p_role,'kpi');
    when p_state_key='controlRules' then return public.crm_role_has_module(p_role,'control');
    when p_state_key like 'local:cc_onboarding_steps_%' then return public.crm_role_has_module(p_role,'onboarding');
    when p_state_key like 'local:cc_attendance_%' then return public.crm_role_has_module(p_role,'employees') or public.crm_role_has_module(p_role,'profile');
    else return false;
  end case;
end;
$$;
revoke all on function public.crm_role_has_module(text,text) from public, anon;
revoke all on function public.crm_role_can_write_state(text,text) from public, anon;
grant execute on function public.crm_role_has_module(text,text) to authenticated;
grant execute on function public.crm_role_can_write_state(text,text) to authenticated;
drop policy if exists "crm_state_role_insert" on public.crm_state;
create policy "crm_state_role_insert" on public.crm_state for insert to authenticated with check (
  exists (select 1 from public.crm_profiles s where s.id=(select auth.uid()) and s.is_active and s.role=((select auth.jwt())->'app_metadata'->>'role'))
  and public.crm_role_can_write_state(((select auth.jwt())->'app_metadata'->>'role'),state_key)
);
drop policy if exists "crm_state_role_update" on public.crm_state;
create policy "crm_state_role_update" on public.crm_state for update to authenticated using (
  exists (select 1 from public.crm_profiles s where s.id=(select auth.uid()) and s.is_active and s.role=((select auth.jwt())->'app_metadata'->>'role'))
  and public.crm_role_can_write_state(((select auth.jwt())->'app_metadata'->>'role'),state_key)
) with check (
  exists (select 1 from public.crm_profiles s where s.id=(select auth.uid()) and s.is_active and s.role=((select auth.jwt())->'app_metadata'->>'role'))
  and public.crm_role_can_write_state(((select auth.jwt())->'app_metadata'->>'role'),state_key)
);
drop policy if exists "crm_state_role_delete" on public.crm_state;
create policy "crm_state_role_delete" on public.crm_state for delete to authenticated using (
  exists (select 1 from public.crm_profiles s where s.id=(select auth.uid()) and s.is_active and s.role=((select auth.jwt())->'app_metadata'->>'role'))
  and public.crm_role_can_write_state(((select auth.jwt())->'app_metadata'->>'role'),state_key)
);