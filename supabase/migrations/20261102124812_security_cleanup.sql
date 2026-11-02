create index if not exists crm_state_updated_by_idx on public.crm_state(updated_by);
create policy "crm_bootstrap_deny_client_access" on public.crm_bootstrap
  for all to anon, authenticated
  using (false)
  with check (false);


