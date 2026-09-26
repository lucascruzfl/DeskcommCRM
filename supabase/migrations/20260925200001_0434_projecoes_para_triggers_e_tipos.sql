-- O papel postgres usado por triggers e manutenção pode ler as views;
-- authenticated continua condicionado a membership e à área do preset.

create or replace view public.operational_organizations
with (security_barrier = true) as
select id, slug, display_name, timezone, locale, currency, country, status,
       jsonb_build_object(
         'canonical_conversation_tags', (
           select coalesce(jsonb_agg(tag.value order by tag.ordinality), '[]'::jsonb)
           from jsonb_array_elements(case when jsonb_typeof(settings->'canonical_conversation_tags') = 'array'
             then settings->'canonical_conversation_tags' else '[]'::jsonb end)
             with ordinality as tag(value, ordinality)
           where jsonb_typeof(tag.value) = 'string'
         ),
         'tags', (
           select coalesce(jsonb_agg(case when jsonb_typeof(tag.value) = 'string' then tag.value
             else jsonb_strip_nulls(jsonb_build_object(
               'tag', case when jsonb_typeof(tag.value->'tag') = 'string' then tag.value->'tag' end,
               'cor', case when jsonb_typeof(tag.value->'cor') = 'string' then tag.value->'cor' end,
               'descricao', case when jsonb_typeof(tag.value->'descricao') = 'string' then tag.value->'descricao' end
             )) end order by tag.ordinality), '[]'::jsonb)
           from jsonb_array_elements(case when jsonb_typeof(settings->'tags') = 'array'
             then settings->'tags' else '[]'::jsonb end)
             with ordinality as tag(value, ordinality)
           where jsonb_typeof(tag.value) in ('string', 'object')
         ),
         'agenda', jsonb_strip_nulls(jsonb_build_object(
           'confirmation_delay_minutes', case when jsonb_typeof(settings #> '{agenda,confirmation_delay_minutes}') = 'number'
             then settings #> '{agenda,confirmation_delay_minutes}' end,
           'unknown_protection_minutes', case when jsonb_typeof(settings #> '{agenda,unknown_protection_minutes}') = 'number'
             then settings #> '{agenda,unknown_protection_minutes}' end,
           'pending_expires_after_minutes', case when jsonb_typeof(settings #> '{agenda,pending_expires_after_minutes}') = 'number'
             then settings #> '{agenda,pending_expires_after_minutes}' end
         )),
         'crm', jsonb_strip_nulls(jsonb_build_object('cliente_pela_agenda',
           case when jsonb_typeof(settings #> '{crm,cliente_pela_agenda}') = 'boolean'
             then settings #> '{crm,cliente_pela_agenda}' end)),
         'colegas_podem_mexer_na_agenda', case when jsonb_typeof(settings->'colegas_podem_mexer_na_agenda') = 'boolean'
           then settings->'colegas_podem_mexer_na_agenda' end
       ) as settings
from public.organizations
where id in (select public.fn_user_org_ids())
   or public.fn_is_platform_admin()
   or current_user in ('service_role', 'postgres');

-- A função é usada apenas pelo worker de voz com service_role. A concessão
-- antiga a authenticated sobrevivia ao REVOKE de PUBLIC por default ACL.
alter function public.fn_resolve_inbound_number(text) set search_path = public, pg_temp;
revoke all on function public.fn_resolve_inbound_number(text) from public, anon, authenticated;
grant execute on function public.fn_resolve_inbound_number(text) to service_role;

-- DID e endpoint de tronco são configuração da agência. O worker usa
-- service_role; nenhuma tela operacional do atendente lê esta tabela.
drop policy if exists managed_phone_numbers_gate on public.phone_numbers;
create policy managed_phone_numbers_gate on public.phone_numbers
  as restrictive for all to authenticated
  using (public.fn_managed_area_allowed(organization_id, '/app/connections'))
  with check (public.fn_managed_area_allowed(organization_id, '/app/connections'));

create or replace view public.operational_channel_sessions
with (security_barrier = true) as
select id, organization_id, display_name, phone_number, status,
       provider, archived_at, created_at
from public.channel_sessions
where (organization_id in (select public.fn_user_org_ids())
       and public.fn_managed_area_allowed(organization_id, '/app/inbox'))
   or public.fn_is_platform_admin()
   or current_user in ('service_role', 'postgres');

create or replace view public.operational_crm_stages
with (security_barrier = true) as
select id, organization_id, pipeline_id, name, slug, description, position,
       color, is_won, is_lost, is_archived, requires_human,
       expected_duration_hours
from public.crm_stages
where (organization_id in (select public.fn_user_org_ids())
       and public.fn_managed_area_allowed(organization_id, '/app/kanban'))
   or public.fn_is_platform_admin()
   or current_user in ('service_role', 'postgres');

create or replace view public.operational_crm_pipelines
with (security_barrier = true) as
select id, organization_id, name, slug, description, position,
       is_default, is_client_pipeline, is_archived,
       jsonb_strip_nulls(jsonb_build_object(
         'lead', case when jsonb_typeof(vocabulary->'lead') = 'string' then vocabulary->'lead' end,
         'deal', case when jsonb_typeof(vocabulary->'deal') = 'string' then vocabulary->'deal' end,
         'won', case when jsonb_typeof(vocabulary->'won') = 'string' then vocabulary->'won' end,
         'lost', case when jsonb_typeof(vocabulary->'lost') = 'string' then vocabulary->'lost' end
       )) as vocabulary,
       jsonb_build_object(
         'fields', (
           select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'key', case when jsonb_typeof(field.value->'key') = 'string' then field.value->'key' end,
             'label', case when jsonb_typeof(field.value->'label') = 'string' then field.value->'label' end,
             'type', case when jsonb_typeof(field.value->'type') = 'string' then field.value->'type' end,
             'required', case when jsonb_typeof(field.value->'required') = 'boolean' then field.value->'required' end,
             'options', (
               select coalesce(jsonb_agg(jsonb_build_object(
                 'value', case when jsonb_typeof(option.value->'value') = 'string' then option.value->'value' end,
                 'label', case when jsonb_typeof(option.value->'label') = 'string' then option.value->'label' end
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
   or current_user in ('service_role', 'postgres');
