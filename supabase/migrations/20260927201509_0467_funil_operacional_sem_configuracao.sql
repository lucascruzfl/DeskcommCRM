-- A linha base contém settings arbitrário. O quadro precisa somente do
-- vocabulário exibido e das definições usadas para validar valores/motivos.
-- As chaves são enumeradas: novas configurações não se tornam públicas por
-- acidente. A view, de dono postgres, aplica membership e área explicitamente.
create or replace view public.operational_crm_pipelines
with (security_barrier = true) as
select id, organization_id, name, slug, description, position,
       is_default, is_client_pipeline, is_archived,
       jsonb_strip_nulls(jsonb_build_object(
         'lead', vocabulary->'lead', 'deal', vocabulary->'deal',
         'won', vocabulary->'won', 'lost', vocabulary->'lost'
       )) as vocabulary,
       jsonb_build_object(
         'fields', (
           select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'key', field.value->'key', 'label', field.value->'label',
             'type', field.value->'type', 'required', field.value->'required',
             'options', (
               select coalesce(jsonb_agg(jsonb_build_object(
                 'value', option.value->'value', 'label', option.value->'label'
               ) order by option.ordinality), '[]'::jsonb)
               from jsonb_array_elements(case when jsonb_typeof(field.value->'options') = 'array'
                 then field.value->'options' else '[]'::jsonb end)
                 with ordinality as option(value, ordinality)
             )
           )) order by field.ordinality), '[]'::jsonb)
           from jsonb_array_elements(case when jsonb_typeof(settings->'fields') = 'array'
             then settings->'fields' else '[]'::jsonb end)
             with ordinality as field(value, ordinality)
           where jsonb_typeof(field.value) = 'object'
         ),
         'lost_reasons', (
           select coalesce(jsonb_agg(reason.value order by reason.ordinality), '[]'::jsonb)
           from jsonb_array_elements(case when jsonb_typeof(settings->'lost_reasons') = 'array'
             then settings->'lost_reasons' else '[]'::jsonb end)
             with ordinality as reason(value, ordinality)
           where jsonb_typeof(reason.value) = 'string'
         ),
         'canonical_tags', (
           select coalesce(jsonb_agg(tag.value order by tag.ordinality), '[]'::jsonb)
           from jsonb_array_elements(case when jsonb_typeof(settings->'canonical_tags') = 'array'
             then settings->'canonical_tags' else '[]'::jsonb end)
             with ordinality as tag(value, ordinality)
           where jsonb_typeof(tag.value) = 'string'
         )
       ) as settings
from public.crm_pipelines
where (organization_id in (select public.fn_user_org_ids())
       and public.fn_managed_area_allowed(organization_id, '/app/kanban'))
   or public.fn_is_platform_admin()
   or current_user = 'service_role';
revoke all on public.operational_crm_pipelines from public, anon, authenticated, service_role;
grant select on public.operational_crm_pipelines to authenticated, service_role;

drop policy if exists managed_crm_pipelines_base_select on public.crm_pipelines;
create policy managed_crm_pipelines_base_select on public.crm_pipelines
  as restrictive for select to authenticated
  using (public.fn_is_platform_admin()
         or public.fn_managed_area_allowed(organization_id, '/app/settings/tenant/pipelines'));
