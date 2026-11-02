drop policy if exists "crm_state_role_insert" on public.crm_state;
create policy "crm_state_role_insert" on public.crm_state
  for insert to authenticated
  with check (
    exists (select 1 from public.crm_profiles self where self.id=(select auth.uid()) and self.is_active and self.role=(select auth.jwt()->'app_metadata'->>'role'))
    and (
      (select auth.jwt()->'app_metadata'->>'role')='admin'
      or ((select auth.jwt()->'app_metadata'->>'role')='rh' and (
        state_key in ('employees','candidates','archivedEmployees','appPermissions','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','controlRules')
        or state_key like 'local:cc_onboarding_steps_%' or state_key like 'local:cc_attendance_%'))
      or ((select auth.jwt()->'app_metadata'->>'role')='chef_plateau' and (
        state_key in ('employees','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','kpiRows')
        or state_key like 'local:cc_onboarding_steps_%' or state_key like 'local:cc_attendance_%'))
    )
  );
drop policy if exists "crm_state_role_update" on public.crm_state;
create policy "crm_state_role_update" on public.crm_state
  for update to authenticated
  using (
    exists (select 1 from public.crm_profiles self where self.id=(select auth.uid()) and self.is_active and self.role=(select auth.jwt()->'app_metadata'->>'role'))
    and (
      (select auth.jwt()->'app_metadata'->>'role')='admin'
      or ((select auth.jwt()->'app_metadata'->>'role')='rh' and (
        state_key in ('employees','candidates','archivedEmployees','appPermissions','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','controlRules')
        or state_key like 'local:cc_onboarding_steps_%' or state_key like 'local:cc_attendance_%'))
      or ((select auth.jwt()->'app_metadata'->>'role')='chef_plateau' and (
        state_key in ('employees','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','kpiRows')
        or state_key like 'local:cc_onboarding_steps_%' or state_key like 'local:cc_attendance_%'))
    )
  )
  with check (
    exists (select 1 from public.crm_profiles self where self.id=(select auth.uid()) and self.is_active and self.role=(select auth.jwt()->'app_metadata'->>'role'))
    and (
      (select auth.jwt()->'app_metadata'->>'role')='admin'
      or ((select auth.jwt()->'app_metadata'->>'role')='rh' and (
        state_key in ('employees','candidates','archivedEmployees','appPermissions','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','controlRules')
        or state_key like 'local:cc_onboarding_steps_%' or state_key like 'local:cc_attendance_%'))
      or ((select auth.jwt()->'app_metadata'->>'role')='chef_plateau' and (
        state_key in ('employees','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','kpiRows')
        or state_key like 'local:cc_onboarding_steps_%' or state_key like 'local:cc_attendance_%'))
    )
  );
drop policy if exists "crm_state_role_delete" on public.crm_state;
create policy "crm_state_role_delete" on public.crm_state
  for delete to authenticated
  using (
    exists (select 1 from public.crm_profiles self where self.id=(select auth.uid()) and self.is_active and self.role=(select auth.jwt()->'app_metadata'->>'role'))
    and (
      (select auth.jwt()->'app_metadata'->>'role')='admin'
      or ((select auth.jwt()->'app_metadata'->>'role')='rh' and (
        state_key in ('employees','candidates','archivedEmployees','appPermissions','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','controlRules')
        or state_key like 'local:cc_onboarding_steps_%' or state_key like 'local:cc_attendance_%'))
      or ((select auth.jwt()->'app_metadata'->>'role')='chef_plateau' and (
        state_key in ('employees','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','kpiRows')
        or state_key like 'local:cc_onboarding_steps_%' or state_key like 'local:cc_attendance_%'))
    )
  );


