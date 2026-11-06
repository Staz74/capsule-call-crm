-- Preserve and merge Brokerlink KPI history by collaborator email and day.
CREATE OR REPLACE FUNCTION public.crm_merge_state(p_state_key text, p_base jsonb, p_next jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  current_payload jsonb;
  merged_payload jsonb;
  api_payload jsonb;
  manual_base jsonb;
  manual_next jsonb;
  manual_merged jsonb;
  base_item jsonb;
  next_item jsonb;
  item record;
  item_key text;
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

  if p_state_key = 'kpiRows' and jsonb_typeof(p_next) = 'array' then
    select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
      into manual_base
      from jsonb_array_elements(case when jsonb_typeof(p_base) = 'array' then p_base else '[]'::jsonb end)
        with ordinality as b(value, ordinality)
      where coalesce(value ->> 'source', '') <> 'brokerlink-api';

    select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
      into manual_next
      from jsonb_array_elements(p_next) with ordinality as n(value, ordinality)
      where coalesce(value ->> 'source', '') <> 'brokerlink-api';

    select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
      into manual_merged
      from jsonb_array_elements(case when jsonb_typeof(current_payload) = 'array' then current_payload else '[]'::jsonb end)
        with ordinality as c(value, ordinality)
      where coalesce(value ->> 'source', '') <> 'brokerlink-api';

    if jsonb_array_length(manual_next) > 0 or jsonb_array_length(manual_base) = 0 then
      for item in select value from jsonb_array_elements(manual_base) loop
        base_item := item.value;
        item_id := coalesce(base_item ->> 'id', base_item ->> 'path', base_item::text);
        select exists (
          select 1 from jsonb_array_elements(manual_next) n(value)
          where coalesce(n.value ->> 'id', n.value ->> 'path', n.value::text) = item_id
        ) into exists_in_next;
        if not exists_in_next then
          select coalesce(jsonb_agg(m.value order by m.ordinality), '[]'::jsonb)
            into manual_merged
            from jsonb_array_elements(manual_merged) with ordinality m(value, ordinality)
            where coalesce(m.value ->> 'id', m.value ->> 'path', m.value::text) <> item_id;
        end if;
      end loop;

      for item in select value from jsonb_array_elements(manual_next) loop
        next_item := item.value;
        item_id := coalesce(next_item ->> 'id', next_item ->> 'path', next_item::text);
        select b.value into base_item
          from jsonb_array_elements(manual_base) b(value)
          where coalesce(b.value ->> 'id', b.value ->> 'path', b.value::text) = item_id
          limit 1;
        if not found or base_item is distinct from next_item then
          if exists (
            select 1 from jsonb_array_elements(manual_merged) m(value)
            where coalesce(m.value ->> 'id', m.value ->> 'path', m.value::text) = item_id
          ) then
            select coalesce(jsonb_agg(case
              when coalesce(m.value ->> 'id', m.value ->> 'path', m.value::text) = item_id then next_item
              else m.value end order by m.ordinality), '[]'::jsonb)
              into manual_merged
              from jsonb_array_elements(manual_merged) with ordinality m(value, ordinality);
          else
            manual_merged := manual_merged || jsonb_build_array(next_item);
          end if;
        end if;
      end loop;
    end if;

    with api_union as (
      select value, ordinality, 0 as source_priority
        from jsonb_array_elements(case when jsonb_typeof(current_payload) = 'array' then current_payload else '[]'::jsonb end)
          with ordinality as c(value, ordinality)
        where value ->> 'source' = 'brokerlink-api'
      union all
      select value, ordinality, 1 as source_priority
        from jsonb_array_elements(p_next) with ordinality as n(value, ordinality)
        where value ->> 'source' = 'brokerlink-api'
    ), keyed as (
      select value, ordinality, source_priority,
        case
          when coalesce(nullif(lower(trim(value ->> 'email')), ''), nullif(lower(trim(value ->> 'brokerlink_email')), '')) is not null
            and nullif(trim(value ->> 'date'), '') is not null
          then 'api:' || coalesce(nullif(lower(trim(value ->> 'email')), ''), lower(trim(value ->> 'brokerlink_email'))) || ':' || trim(value ->> 'date')
          else 'api:row:' || value::text
        end as row_key
      from api_union
    ), ranked as (
      select value, row_key,
        row_number() over (partition by row_key order by source_priority desc, ordinality desc) as rn
      from keyed
    )
    select coalesce(jsonb_agg(value order by row_key), '[]'::jsonb)
      into api_payload
      from ranked
      where rn = 1;

    merged_payload := api_payload || manual_merged;
  elsif jsonb_typeof(p_base) = 'array' and jsonb_typeof(p_next) = 'array' then
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
$function$


revoke all on function public.crm_merge_state(text, jsonb, jsonb) from public, anon;
grant execute on function public.crm_merge_state(text, jsonb, jsonb) to authenticated;
