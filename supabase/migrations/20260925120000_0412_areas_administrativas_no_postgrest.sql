-- Segunda passada de RLS por área: recursos administrativos com tabela própria.
-- Toda policy é RESTRICTIVE e compõe por AND com o isolamento já existente.
-- Não reclassifica recursos mistos (organizations, channel_sessions, crm_stages).
do $$
declare gate record;
begin
  for gate in select * from (values
    ('ai_faq_items', '/app/ai/knowledge/sources'),
    ('knowledge_searches', '/app/ai/knowledge/sources'),
    ('ai_invocations', '/app/ai/runs'),
    ('ai_purpose_bindings', '/app/ai/providers'),
    ('ai_routers', '/app/ai/routers'),
    ('ai_router_members', '/app/ai/routers'),
    ('ai_router_decisions', '/app/ai/routers'),
    ('org_memory_entries', '/app/ai/memory'),
    ('org_memory_pointers', '/app/ai/memory'),
    ('org_memory_versions', '/app/ai/memory'),
    ('skill_pointers', '/app/ai/skills'),
    ('skill_versions', '/app/ai/skills'),
    ('skill_activations', '/app/ai/skills'),
    ('followup_flow_pointers', '/app/ai/followups'),
    ('followup_flow_versions', '/app/ai/followups'),
    ('followup_enrollments', '/app/ai/followups'),
    ('followup_enrollment_events', '/app/ai/followups'),
    ('automation_rules', '/app/ai/followups'),
    ('automation_rule_runs', '/app/ai/followups'),
    ('config_aviso_de_caso', '/app/ai/cases/avisos'),
    ('flywheel_distiller_proposals', '/app/ai/proposals'),
    ('flywheel_judge_verdicts', '/app/ai/evolution'),
    ('org_guardrail_layers', '/app/ai/agents'),
    ('playbook_versions', '/app/ai/agents'),
    ('playbook_pointers', '/app/ai/agents'),
    ('disclosure_template_versions', '/app/ai/agents'),
    ('disclosure_template_pointers', '/app/ai/agents'),
    ('channel_knobs', '/app/connections'),
    ('reentry_template_versions', '/app/ai/followups'),
    ('reentry_template_pointers', '/app/ai/followups'),
    ('reentry_knob_versions', '/app/ai/followups'),
    ('reentry_knob_pointers', '/app/ai/followups'),
    ('promise_table_versions', '/app/ai/followups'),
    ('promise_table_pointers', '/app/ai/followups'),
    ('campaigns', '/app/campaigns'),
    ('campaign_recipients', '/app/campaigns'),
    ('campaign_channel_sessions', '/app/campaigns'),
    ('campaign_templates', '/app/campaigns'),
    ('campaign_suppressions', '/app/campaigns'),
    ('prospecting_settings', '/app/prospecting'),
    ('prospecting_campaigns', '/app/prospecting'),
    ('prospecting_candidates', '/app/prospecting'),
    ('tenant_integrations', '/app/integrations/nuvemshop'),
    ('orders', '/app/integrations/nuvemshop'),
    ('nuvemshop_products', '/app/integrations/nuvemshop'),
    ('webhook_sources', '/app/webhooks'),
    ('webhook_lead_captures', '/app/webhooks'),
    ('webhook_events_log', '/app/webhooks'),
    ('ad_insights_connections', '/app/ads/meta'),
    ('ad_hierarchy_cache', '/app/ads/meta'),
    ('ad_platform_connections', '/app/settings/meta-ads'),
    ('ad_conversion_dispatches', '/app/settings/conversoes'),
    ('channel_routing_policies', '/app/settings/atendimento'),
    ('channel_routing_responsibles', '/app/settings/atendimento'),
    ('external_db_connections', '/app/integracao-dados'),
    ('organization_extensions', '/app/extensions'),
    ('voip_trunk_settings', '/app/settings/voip-trunk'),
    ('api_audit_log', '/app/audit')
  ) as t(table_name, area_href) loop
    if to_regclass('public.' || gate.table_name) is null then
      raise exception 'managed_area_table_missing: %', gate.table_name;
    end if;
    if not exists (
      select 1 from pg_attribute
      where attrelid = to_regclass('public.' || gate.table_name)
        and attname = 'organization_id' and attnum > 0 and not attisdropped
    ) then
      raise exception 'managed_area_organization_id_missing: %', gate.table_name;
    end if;
    execute format('drop policy if exists managed_area_gate on public.%I', gate.table_name);
    execute format(
      'create policy managed_area_gate on public.%I as restrictive for all to authenticated using (public.fn_managed_area_allowed(organization_id, %L)) with check (public.fn_managed_area_allowed(organization_id, %L))',
      gate.table_name, gate.area_href, gate.area_href
    );
  end loop;
end $$;

-- llm_calls tem isolamento tenant da 0050, mas esse SELECT permissivo por
-- membership deixava o cliente ler Execuções. O gate deve ser RESTRICTIVE:
-- uma segunda policy permissiva seria combinada por OR e não fecharia o acesso.
-- O único escritor do produto usa service_role; a API de execuções usa SELECT.
alter table public.llm_calls enable row level security;
revoke all on public.llm_calls from anon, authenticated;
grant select on public.llm_calls to authenticated;
drop policy if exists managed_llm_calls_read on public.llm_calls;
create policy managed_llm_calls_read on public.llm_calls
  as restrictive for all to authenticated using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_managed_area_allowed(organization_id, '/app/ai/runs')
    and public.fn_managed_area_allowed(organization_id, '/app/ai/usage')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_managed_area_allowed(organization_id, '/app/ai/runs')
    and public.fn_managed_area_allowed(organization_id, '/app/ai/usage')
  );
