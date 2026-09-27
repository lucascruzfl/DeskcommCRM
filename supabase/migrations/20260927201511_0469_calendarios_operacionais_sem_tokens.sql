-- Conectar a própria agenda é operação do cliente, mas as tabelas completas
-- guardam OAuth/sync tokens e controle de lease. A leitura da sessão usa
-- projeções com colunas explícitas; workers continuam com service_role.
create or replace view public.operational_calendar_connections
with (security_barrier = true) as
select id, organization_id, user_id, provider, account_email, status,
       last_sync_at, last_sync_error, calendar_selection_revision, created_at
from public.calendar_connections
where ((organization_id in (select public.fn_user_org_ids()))
       and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager'))
       and public.fn_managed_area_allowed(organization_id, '/app/agenda'))
   or public.fn_is_platform_admin()
   or current_user in ('service_role', 'postgres');
revoke all on public.operational_calendar_connections from public, anon, authenticated, service_role;
grant select on public.operational_calendar_connections to authenticated, service_role;

create or replace view public.operational_calendar_connection_calendars
with (security_barrier = true) as
select cc.id, cc.organization_id, cc.connection_id, cc.name, cc.time_zone,
       cc.is_primary, cc.counts_for_conflicts, cc.is_destination, cc.access_role,
       cc.allowed_conference_types, cc.available, cc.last_sync_at, cc.sync_error,
       cc.catalog_checked_at, (cc.sync_cursor is not null) as reading,
       jsonb_strip_nulls(jsonb_build_object(
         'generation', case when jsonb_typeof(cc.sync_coverage->'generation') = 'string' then cc.sync_coverage->'generation' end,
         'window_start', case when jsonb_typeof(cc.sync_coverage->'window_start') = 'string' then cc.sync_coverage->'window_start' end,
         'window_end', case when jsonb_typeof(cc.sync_coverage->'window_end') = 'string' then cc.sync_coverage->'window_end' end,
         'completed_at', case when jsonb_typeof(cc.sync_coverage->'completed_at') = 'string' then cc.sync_coverage->'completed_at' end
       )) as sync_coverage
from public.calendar_connection_calendars cc
where ((cc.organization_id in (select public.fn_user_org_ids()))
       and public.fn_managed_area_allowed(cc.organization_id, '/app/agenda')
       and exists (select 1 from public.calendar_connections c
                   where c.id = cc.connection_id and c.organization_id = cc.organization_id
                     and (c.user_id = auth.uid()
                          or public.fn_role_at_least(cc.organization_id, 'manager'))))
   or public.fn_is_platform_admin()
   or current_user in ('service_role', 'postgres');
revoke all on public.operational_calendar_connection_calendars from public, anon, authenticated, service_role;
grant select on public.operational_calendar_connection_calendars to authenticated, service_role;

drop policy if exists managed_calendar_connections_base_select on public.calendar_connections;
create policy managed_calendar_connections_base_select on public.calendar_connections
  as restrictive for select to authenticated
  using (public.fn_is_platform_admin()
         or public.fn_managed_area_allowed(organization_id, '/app/connections'));

drop policy if exists managed_calendar_connection_calendars_base_select on public.calendar_connection_calendars;
create policy managed_calendar_connection_calendars_base_select on public.calendar_connection_calendars
  as restrictive for select to authenticated
  using (public.fn_is_platform_admin()
         or public.fn_managed_area_allowed(organization_id, '/app/connections'));
