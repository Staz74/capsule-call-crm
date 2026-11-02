create or replace function public.crm_merge_state(p_state_key text, p_base jsonb, p_next jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_payload jsonb;
  merged_payload jsonb;
  base_item jsonb;
  next_item jsonb;
  item_key text;
  item record;
  item_id text;
  exists_in_next boolean;
begin
  select payload into current_payload
    from public.crm_state
    where state_key = p_state_key
    for update;

  if not found then
    insert into public.crm_state(state_key, payload, updated_by)
      values (p_state_key, coalesce(p_next, 'null'::jsonb), (select auth.uid()))
      returning payload into merged_payload;
    return merged_payload;
  end if;

  merged_payload := current_payload;

  if jsonb_typeof(p_base) = 'array' and jsonb_typeof(p_next) = 'array' and p_state_key <> 'kpiRows' then
    for item in select value from jsonb_array_elements(p_base) loop
      base_item := item.value;
      item_id := coalesce(base_item ->> 'id', base_item ->> 'path', base_item::text);
      select exists (
        select 1 from jsonb_array_elements(p_next) n(value)
        where coalesce(n.value ->> 'id', n.value ->> 'path', n.value::text) = item_id
      ) into exists_in_next;
      if not exists_in_next then
        select coalesce(jsonb_agg(m.value order by m.ordinality), '[]'::jsonb)
          into merged_payload
          from jsonb_array_elements(merged_payload) with ordinality m(value, ordinality)
          where coalesce(m.value ->> 'id', m.value ->> 'path', m.value::text) <> item_id;
      end if;
    end loop;

    for item in select value from jsonb_array_elements(p_next) loop
      next_item := item.value;
      item_id := coalesce(next_item ->> 'id', next_item ->> 'path', next_item::text);
      select b.value into base_item
        from jsonb_array_elements(p_base) b(value)
        where coalesce(b.value ->> 'id', b.value ->> 'path', b.value::text) = item_id
        limit 1;
      if not found or base_item is distinct from next_item then
        if exists (
          select 1 from jsonb_array_elements(merged_payload) m(value)
          where coalesce(m.value ->> 'id', m.value ->> 'path', m.value::text) = item_id
        ) then
          select coalesce(jsonb_agg(case
            when coalesce(m.value ->> 'id', m.value ->> 'path', m.value::text) = item_id then next_item
            else m.value end order by m.ordinality), '[]'::jsonb)
            into merged_payload
            from jsonb_array_elements(merged_payload) with ordinality m(value, ordinality);
        else
          merged_payload := merged_payload || jsonb_build_array(next_item);
        end if;
      end if;
    end loop;
  elsif jsonb_typeof(p_base) = 'object' and jsonb_typeof(p_next) = 'object' then
    for item_key in select key from jsonb_object_keys(p_base) as keys(key) loop
      if not (p_next ? item_key)
        and (merged_payload ? item_key)
        and merged_payload -> item_key = p_base -> item_key then
        merged_payload := merged_payload - item_key;
      end if;
    end loop;
    for item in select key, value from jsonb_each(p_next) loop
      item_key := item.key;
      if not (p_base ? item_key) or p_base -> item_key is distinct from item.value then
        merged_payload := jsonb_set(merged_payload, array[item_key], item.value, true);
      end if;
    end loop;
  else
    merged_payload := p_next;
  end if;

  update public.crm_state
    set payload = merged_payload, updated_by = (select auth.uid()), updated_at = now()
    where state_key = p_state_key;
  return merged_payload;
end;
$$;
revoke all on function public.crm_merge_state(text, jsonb, jsonb) from public, anon;
grant execute on function public.crm_merge_state(text, jsonb, jsonb) to authenticated;


