-- A view tem dono postgres e, portanto, não depende da RLS da tabela base.
-- Cada linha é filtrada explicitamente pelo membership atual e pela mesma
-- classificação persistida que protege UI, MCP e as demais tabelas.
create or replace view public.operational_organizations
with (security_barrier = true) as
select id, slug, display_name, timezone, locale, currency, country, status,
       jsonb_build_object(
         'canonical_conversation_tags', settings->'canonical_conversation_tags',
         'tags', settings->'tags',
         'agenda', settings->'agenda',
         'crm', jsonb_build_object('cliente_pela_agenda', settings #> '{crm,cliente_pela_agenda}'),
         'colegas_podem_mexer_na_agenda', settings->'colegas_podem_mexer_na_agenda'
       ) as settings
from public.organizations
where id in (select public.fn_user_org_ids())
   or public.fn_is_platform_admin()
   or current_user = 'service_role';
revoke all on public.operational_organizations from public, anon, authenticated, service_role;
grant select on public.operational_organizations to authenticated, service_role;

create or replace view public.operational_channel_sessions
with (security_barrier = true) as
select id, organization_id, display_name, phone_number, status,
       provider, archived_at, created_at
from public.channel_sessions
where (organization_id in (select public.fn_user_org_ids())
       and public.fn_managed_area_allowed(organization_id, '/app/inbox'))
   or public.fn_is_platform_admin()
   or current_user = 'service_role';
revoke all on public.operational_channel_sessions from public, anon, authenticated, service_role;
grant select on public.operational_channel_sessions to authenticated, service_role;

create or replace view public.operational_crm_stages
with (security_barrier = true) as
select id, organization_id, pipeline_id, name, slug, description, position,
       color, is_won, is_lost, is_archived, requires_human,
       expected_duration_hours
from public.crm_stages
where (organization_id in (select public.fn_user_org_ids())
       and public.fn_managed_area_allowed(organization_id, '/app/kanban'))
   or public.fn_is_platform_admin()
   or current_user = 'service_role';
revoke all on public.operational_crm_stages from public, anon, authenticated, service_role;
grant select on public.operational_crm_stages to authenticated, service_role;
