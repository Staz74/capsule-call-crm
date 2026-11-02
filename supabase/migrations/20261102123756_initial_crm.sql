-- Capsule Call CRM: authenticated profiles and shared persisted application state.
create table public.crm_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null check (role in ('admin', 'rh', 'chef_plateau')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_profiles enable row level security;
grant select on public.crm_profiles to authenticated;
grant all on public.crm_profiles to service_role;
create policy "crm_profiles_read_self_or_admin" on public.crm_profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (
      (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      and exists (
        select 1 from public.crm_profiles self
        where self.id = (select auth.uid()) and self.is_active
      )
    )
  );

create table public.crm_state (
  state_key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.crm_state enable row level security;
grant select, insert, update, delete on public.crm_state to authenticated;
grant all on public.crm_state to service_role;
create policy "crm_state_active_users_read" on public.crm_state
  for select to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'rh', 'chef_plateau')
    and exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid()) and self.is_active
    )
  );
create policy "crm_state_active_users_insert" on public.crm_state
  for insert to authenticated
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'rh', 'chef_plateau')
    and exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid()) and self.is_active
    )
  );
create policy "crm_state_active_users_update" on public.crm_state
  for update to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'rh', 'chef_plateau')
    and exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid()) and self.is_active
    )
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'rh', 'chef_plateau')
    and exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid()) and self.is_active
    )
  );
create policy "crm_state_active_users_delete" on public.crm_state
  for delete to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'rh', 'chef_plateau')
    and exists (
      select 1 from public.crm_profiles self
      where self.id = (select auth.uid()) and self.is_active
    )
  );

create table public.crm_bootstrap (
  singleton boolean primary key default true check (singleton),
  token_hash text not null,
  claimed_by uuid,
  consumed_at timestamptz
);
alter table public.crm_bootstrap enable row level security;
revoke all on public.crm_bootstrap from anon, authenticated;
grant all on public.crm_bootstrap to service_role;
insert into public.crm_bootstrap(singleton, token_hash)
values (true, '9177b259575b46761c78a6b4c302376537034ec91bf475a2ed800b959d9e80cc');

create or replace function public.crm_claim_bootstrap(p_token_hash text, p_claim_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.crm_bootstrap
    set claimed_by = p_claim_id
    where singleton = true
      and token_hash = p_token_hash
      and consumed_at is null
      and (claimed_by is null or claimed_by = p_claim_id);
  return found;
end;
$$;
revoke all on function public.crm_claim_bootstrap(text, uuid) from public, anon, authenticated;
grant execute on function public.crm_claim_bootstrap(text, uuid) to service_role;

create or replace function public.crm_finish_bootstrap(p_claim_id uuid, p_success boolean)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_success then
    update public.crm_bootstrap set consumed_at = now(), token_hash = ''
      where singleton = true and claimed_by = p_claim_id and consumed_at is null;
  else
    update public.crm_bootstrap set claimed_by = null
      where singleton = true and claimed_by = p_claim_id and consumed_at is null;
  end if;
  return found;
end;
$$;
revoke all on function public.crm_finish_bootstrap(uuid, boolean) from public, anon, authenticated;
grant execute on function public.crm_finish_bootstrap(uuid, boolean) to service_role;

grant usage on schema public to authenticated, service_role;


