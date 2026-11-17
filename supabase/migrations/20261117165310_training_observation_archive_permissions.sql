create or replace function public.crm_role_can_write_state(p_role text, p_state_key text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare saved_permissions jsonb; label text;
begin
  if p_role='admin' then return true; end if;
  if p_role not in ('rh','chef_plateau','directeur_operationnel','imperator') then return false; end if;
  case
    when p_state_key='synthesisActions' then return public.crm_role_has_module(p_role,'synthesis');
    when p_state_key='employees' then return public.crm_role_has_module(p_role,'employees') or public.crm_role_has_module(p_role,'profile') or public.crm_role_has_module(p_role,'onboarding') or public.crm_role_has_module(p_role,'candidates');
    when p_state_key in ('candidates','archivedCandidates') then return public.crm_role_has_module(p_role,'candidates');
    when p_state_key='archivedEmployees' then
      label:=case when p_role='rh' then 'RH' when p_role='directeur_operationnel' then 'Directeur opérationnel' when p_role='imperator' then 'Imperator' else 'Chef de plateau' end;
      select payload into saved_permissions from public.crm_state where state_key='appPermissions';
      return (public.crm_role_has_module(p_role,'employees') or public.crm_role_has_module(p_role,'profile') or public.crm_role_has_module(p_role,'employee-archive')) and coalesce(saved_permissions->'deleteEmployeeRoles','["Administrateur"]'::jsonb) ? label;
    when p_state_key in ('tasks','taskHistory') then return public.crm_role_has_module(p_role,'tasks') or public.crm_role_has_module(p_role,'quality') or public.crm_role_has_module(p_role,'reports') or public.crm_role_has_module(p_role,'control') or public.crm_role_has_module(p_role,'employees') or public.crm_role_has_module(p_role,'onboarding');
    when p_state_key in ('qualityHistory','coachingHistory') then return public.crm_role_has_module(p_role,'quality');
    when p_state_key='onboardingHistory' then return public.crm_role_has_module(p_role,'onboarding');
    when p_state_key='attendanceHistory' then return public.crm_role_has_module(p_role,'employees') or public.crm_role_has_module(p_role,'profile');
    when p_state_key='reports' then return public.crm_role_has_module(p_role,'reports');
    when p_state_key='meetings' then return public.crm_role_has_module(p_role,'reports') or public.crm_role_has_module(p_role,'synthesis');
    when p_state_key='docs' then return public.crm_role_has_module(p_role,'documents');
    when p_state_key='kpiRows' then return public.crm_role_has_module(p_role,'kpi');
    when p_state_key='controlRules' then return public.crm_role_has_module(p_role,'control');
    when p_state_key='trainingThemes' then return public.crm_role_has_module(p_role,'synthesis');
    when p_state_key='trainingAgenda' then
      return p_role in ('rh','chef_plateau') and
        (public.crm_role_has_module(p_role,'formationAgenda') or public.crm_role_has_module(p_role,'synthesis'));
    when p_state_key='trainingHistory' then
      return p_role='chef_plateau' and
        (public.crm_role_has_module(p_role,'formationAgenda') or public.crm_role_has_module(p_role,'synthesis'));
    when p_state_key in ('trainingObservationArchive','trainingObservationArchiveInitialized') then
      return p_role in ('rh','chef_plateau') and
        (public.crm_role_has_module(p_role,'formationAgenda') or public.crm_role_has_module(p_role,'synthesis'));
    when p_state_key like 'local:cc_onboarding_steps_%' then return public.crm_role_has_module(p_role,'onboarding');
    when p_state_key like 'local:cc_attendance_%' then return public.crm_role_has_module(p_role,'employees') or public.crm_role_has_module(p_role,'profile');
    else return false;
  end case;
end;
$function$;

DO $archive$
DECLARE v_archive jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_state
    WHERE state_key='trainingObservationArchiveInitialized'
  ) THEN
    WITH state_data AS (
      SELECT state_key, payload FROM public.crm_state
      WHERE state_key IN ('employees','qualityHistory','coachingHistory','reports','meetings')
    ),
    employee_candidates AS (
      SELECT
        e.value->>'id' AS employee_id,
        COALESCE(
          NULLIF(e.value->>'name',''),
          NULLIF(e.value->>'displayName',''),
          NULLIF(CONCAT_WS(' ', NULLIF(e.value->>'firstName',''), NULLIF(e.value->>'lastName','')),''),
          'Collaborateur'
        ) AS employee_name,
        e.ordinality AS position
      FROM state_data s
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN s.state_key='employees' AND jsonb_typeof(s.payload)='array' THEN s.payload ELSE '[]'::jsonb END)
        WITH ORDINALITY AS e(value, ordinality)
      WHERE s.state_key='employees'
        AND COALESCE(NULLIF(e.value->>'archivedAt',''),'')=''
    ),
    employees AS (
      SELECT employee_id, employee_name
      FROM (
        SELECT employee_id, employee_name,
          ROW_NUMBER() OVER (PARTITION BY employee_name ORDER BY position) AS name_rank
        FROM employee_candidates
      ) ranked
      WHERE name_rank=1
    ),
    observation_ids AS (
      SELECT 'Écoute qualité' AS source, 'quality:'||COALESCE(x.value->>'id',(x.ordinality-1)::text) AS observation_id
      FROM state_data s
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload)='array' THEN s.payload ELSE '[]'::jsonb END)
        WITH ORDINALITY AS x(value, ordinality)
      JOIN employees e ON e.employee_name=x.value->>'employee'
      WHERE s.state_key='qualityHistory'
        AND COALESCE(LOWER(TRIM(x.value->>'category')),'') <> 'pas besoin de formation'
      UNION ALL
      SELECT 'Coaching', 'coaching:'||COALESCE(x.value->>'id',(x.ordinality-1)::text)
      FROM state_data s
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload)='array' THEN s.payload ELSE '[]'::jsonb END)
        WITH ORDINALITY AS x(value, ordinality)
      JOIN employees e ON e.employee_name=x.value->>'employee'
      WHERE s.state_key='coachingHistory'
      UNION ALL
      SELECT CASE WHEN s.state_key='reports' THEN 'Rapport' ELSE 'Réunion' END,
        LOWER(CASE WHEN s.state_key='reports' THEN 'Rapport' ELSE 'Réunion' END)||':'||
        COALESCE(x.value->>'id',(x.ordinality-1)::text)||':'||e.employee_id
      FROM state_data s
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload)='array' THEN s.payload ELSE '[]'::jsonb END)
        WITH ORDINALITY AS x(value, ordinality)
      JOIN employees e ON POSITION(LOWER(e.employee_name) IN LOWER(x.value::text))>0
      WHERE s.state_key IN ('reports','meetings')
    )
    
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object('id', archived.observation_id, 'observationId', archived.observation_id, 'reason', 'baseline', 'archivedAt', now())
        ORDER BY archived.observation_id
      ),
      '[]'::jsonb
    )
    INTO v_archive
    FROM (SELECT DISTINCT observation_id FROM observation_ids) AS archived;

    INSERT INTO public.crm_state(state_key,payload,updated_by)
    VALUES ('trainingObservationArchive',v_archive,NULL)
    ON CONFLICT (state_key) DO NOTHING;

    INSERT INTO public.crm_state(state_key,payload,updated_by)
    VALUES ('trainingObservationArchiveInitialized','true'::jsonb,NULL)
    ON CONFLICT (state_key) DO NOTHING;
  END IF;
END
$archive$;
