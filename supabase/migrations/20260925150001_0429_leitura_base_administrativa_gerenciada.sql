-- Uma linha de cada tabela base contém configuração além do mínimo de
-- operação. A policy RESTRICTIVE conserva as regras históricas de tenant e
-- exige a área administrativa do snapshot persistido para ler a linha inteira.
-- Tenants sem managed_client_policies mantêm o comportamento anterior.
drop policy if exists managed_organizations_base_select on public.organizations;
create policy managed_organizations_base_select on public.organizations
  as restrictive for select to authenticated
  using (public.fn_is_platform_admin()
         or public.fn_managed_area_allowed(id, '/app/settings/tenant'));

drop policy if exists managed_channel_sessions_base_select on public.channel_sessions;
create policy managed_channel_sessions_base_select on public.channel_sessions
  as restrictive for select to authenticated
  using (public.fn_is_platform_admin()
         or public.fn_managed_area_allowed(organization_id, '/app/connections'));

drop policy if exists managed_crm_stages_base_select on public.crm_stages;
create policy managed_crm_stages_base_select on public.crm_stages
  as restrictive for select to authenticated
  using (public.fn_is_platform_admin()
         or public.fn_managed_area_allowed(organization_id, '/app/settings/tenant/pipelines'));

-- O snapshot também contém a classificação e os overrides administrativos.
-- A UI e o MCP o resolvem no servidor após membership; PostgREST direto não
-- precisa publicá-lo ao atendente.
drop policy if exists managed_client_policies_admin_read on public.managed_client_policies;
create policy managed_client_policies_admin_read on public.managed_client_policies
  as restrictive for select to authenticated
  using (public.fn_is_platform_admin()
         or public.fn_managed_area_allowed(organization_id, '/app/settings/tenant'));
