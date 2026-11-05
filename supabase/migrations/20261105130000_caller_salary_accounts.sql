alter table public.crm_profiles add column if not exists employee_id bigint;
alter table public.crm_profiles drop constraint if exists crm_profiles_role_check;
alter table public.crm_profiles add constraint crm_profiles_role_check
  check (role = any (array['admin','rh','chef_plateau','directeur_operationnel','imperator','caller']));
alter table public.crm_profiles drop constraint if exists crm_profiles_caller_employee_check;
alter table public.crm_profiles add constraint crm_profiles_caller_employee_check
  check ((role = 'caller' and employee_id is not null and employee_id > 0) or (role <> 'caller' and employee_id is null));
create unique index if not exists crm_profiles_one_caller_per_employee
  on public.crm_profiles (employee_id) where role = 'caller';
