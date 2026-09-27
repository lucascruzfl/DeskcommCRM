-- A leitura operacional do funil e do canal continua disponível ao atendimento.
-- A escrita da configuração é uma área da agência, mesmo quando o membro tem
-- rank manager por outro motivo. Policies RESTRICTIVE compõem com o RBAC atual.
drop policy if exists managed_crm_stages_insert on public.crm_stages;
create policy managed_crm_stages_insert on public.crm_stages
  as restrictive for insert to authenticated
  with check (public.fn_managed_area_allowed(organization_id, '/app/settings/tenant/pipelines'));
drop policy if exists managed_crm_stages_update on public.crm_stages;
create policy managed_crm_stages_update on public.crm_stages
  as restrictive for update to authenticated
  using (public.fn_managed_area_allowed(organization_id, '/app/settings/tenant/pipelines'))
  with check (public.fn_managed_area_allowed(organization_id, '/app/settings/tenant/pipelines'));
drop policy if exists managed_crm_stages_delete on public.crm_stages;
create policy managed_crm_stages_delete on public.crm_stages
  as restrictive for delete to authenticated
  using (public.fn_managed_area_allowed(organization_id, '/app/settings/tenant/pipelines'));

drop policy if exists managed_crm_pipelines_insert on public.crm_pipelines;
create policy managed_crm_pipelines_insert on public.crm_pipelines
  as restrictive for insert to authenticated
  with check (public.fn_managed_area_allowed(organization_id, '/app/settings/tenant/pipelines'));
drop policy if exists managed_crm_pipelines_update on public.crm_pipelines;
create policy managed_crm_pipelines_update on public.crm_pipelines
  as restrictive for update to authenticated
  using (public.fn_managed_area_allowed(organization_id, '/app/settings/tenant/pipelines'))
  with check (public.fn_managed_area_allowed(organization_id, '/app/settings/tenant/pipelines'));
drop policy if exists managed_crm_pipelines_delete on public.crm_pipelines;
create policy managed_crm_pipelines_delete on public.crm_pipelines
  as restrictive for delete to authenticated
  using (public.fn_managed_area_allowed(organization_id, '/app/settings/tenant/pipelines'));

drop policy if exists managed_channel_sessions_insert on public.channel_sessions;
create policy managed_channel_sessions_insert on public.channel_sessions
  as restrictive for insert to authenticated
  with check (public.fn_managed_area_allowed(organization_id, '/app/connections'));
drop policy if exists managed_channel_sessions_update on public.channel_sessions;
create policy managed_channel_sessions_update on public.channel_sessions
  as restrictive for update to authenticated
  using (public.fn_managed_area_allowed(organization_id, '/app/connections'))
  with check (public.fn_managed_area_allowed(organization_id, '/app/connections'));
drop policy if exists managed_channel_sessions_delete on public.channel_sessions;
create policy managed_channel_sessions_delete on public.channel_sessions
  as restrictive for delete to authenticated
  using (public.fn_managed_area_allowed(organization_id, '/app/connections'));

-- Estas quatro tabelas de anúncios são server-only: authenticated/anon não
-- recebem nenhum grant e a RLS não tem policy. A 0426 lhes acrescentou um
-- gate redundante, quebrando o contrato deny-all verificado pelos invariantes.
drop policy if exists managed_area_gate on public.ad_platform_connections;
drop policy if exists managed_area_gate on public.ad_conversion_dispatches;
drop policy if exists managed_area_gate on public.ad_insights_connections;
drop policy if exists managed_area_gate on public.ad_hierarchy_cache;

-- 0426 revoga a escrita de llm_calls depois da varredura do baseline anterior.
-- Recalcular aqui remove as travas de suporte obsoletas dessa tabela server-only
-- tanto no upgrade 0425→0427 quanto na primeira instalação.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;
