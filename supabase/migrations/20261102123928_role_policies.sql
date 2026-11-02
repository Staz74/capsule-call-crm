drop policy if exists "crm_profiles_read_self_or_admin" on public.crm_profiles;
create policy "crm_profiles_read_self" on public.crm_profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "crm_state_active_users_read" on public.crm_state;
drop policy if exists "crm_state_active_users_insert" on public.crm_state;
drop policy if exists "crm_state_active_users_update" on public.crm_state;
drop policy if exists "crm_state_active_users_delete" on public.crm_state;

create policy "crm_state_active_users_read" on public.crm_state
  for select to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'rh', 'chef_plateau')
    and exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid()) and self.is_active
        and self.role = (select auth.jwt() -> 'app_metadata' ->> 'role')
    )
  );
create policy "crm_state_role_insert" on public.crm_state
  for insert to authenticated
  with check (
    exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid()) and self.is_active
        and self.role = (select auth.jwt() -> 'app_metadata' ->> 'role')
    )
    and (
      (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      or (
        (select auth.jwt() -> 'app_metadata' ->> 'role') = 'rh'
        and state_key in ('employees','candidates','archivedEmployees','appPermissions','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','controlRules')
      )
      or (
        (select auth.jwt() -> 'app_metadata' ->> 'role') = 'chef_plateau'
        and state_key in ('employees','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','kpiRows')
      )
    )
  );
create policy "crm_state_role_update" on public.crm_state
  for update to authenticated
  using (
    exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid()) and self.is_active
        and self.role = (select auth.jwt() -> 'app_metadata' ->> 'role')
    )
    and (
      (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      or (
        (select auth.jwt() -> 'app_metadata' ->> 'role') = 'rh'
        and state_key in ('employees','candidates','archivedEmployees','appPermissions','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','controlRules')
      )
      or (
        (select auth.jwt() -> 'app_metadata' ->> 'role') = 'chef_plateau'
        and state_key in ('employees','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','kpiRows')
      )
    )
  )
  with check (
    exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid()) and self.is_active
        and self.role = (select auth.jwt() -> 'app_metadata' ->> 'role')
    )
    and (
      (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      or ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'rh' and state_key in ('employees','candidates','archivedEmployees','appPermissions','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','controlRules'))
      or ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'chef_plateau' and state_key in ('employees','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','kpiRows'))
    )
  );
create policy "crm_state_role_delete" on public.crm_state
  for delete to authenticated
  using (
    exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid()) and self.is_active
        and self.role = (select auth.jwt() -> 'app_metadata' ->> 'role')
    )
    and (
      (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      or ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'rh' and state_key in ('employees','candidates','archivedEmployees','appPermissions','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','controlRules'))
      or ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'chef_plateau' and state_key in ('employees','tasks','taskHistory','qualityHistory','coachingHistory','onboardingHistory','attendanceHistory','reports','meetings','docs','kpiRows'))
    )
  );


