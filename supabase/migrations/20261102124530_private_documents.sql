insert into storage.buckets (id, name, public)
values ('crm-documents', 'crm-documents', false)
on conflict (id) do update set public = false;

create policy "crm_documents_read_active_users" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'crm-documents'
    and exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid())
        and self.is_active
        and self.role = (select auth.jwt() -> 'app_metadata' ->> 'role')
    )
  );
create policy "crm_documents_upload_admin_rh" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'crm-documents'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','rh')
    and exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid())
        and self.is_active
        and self.role = (select auth.jwt() -> 'app_metadata' ->> 'role')
    )
  );
create policy "crm_documents_update_admin_rh" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'crm-documents'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','rh')
    and exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid())
        and self.is_active
        and self.role = (select auth.jwt() -> 'app_metadata' ->> 'role')
    )
  )
  with check (
    bucket_id = 'crm-documents'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','rh')
    and exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid())
        and self.is_active
        and self.role = (select auth.jwt() -> 'app_metadata' ->> 'role')
    )
  );
create policy "crm_documents_delete_admin_rh" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'crm-documents'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','rh')
    and exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid())
        and self.is_active
        and self.role = (select auth.jwt() -> 'app_metadata' ->> 'role')
    )
  );


