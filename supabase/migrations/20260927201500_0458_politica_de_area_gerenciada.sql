-- A política de um cliente gerenciado pertence ao tenant, não à interface de um membro.
-- Sem linha, a autorização histórica da organização continua vigente.
create table if not exists public.managed_client_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  business_type text not null,
  management_mode text not null check (management_mode = 'managed'),
  preset_id text not null,
  preset_version text not null,
  areas jsonb not null check (jsonb_typeof(areas) = 'object'),
  overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides) = 'object'),
  applied_by uuid not null references auth.users(id),
  applied_at timestamptz not null default now()
);

alter table public.managed_client_policies enable row level security;
drop policy if exists managed_client_policies_member_read on public.managed_client_policies;
create policy managed_client_policies_member_read on public.managed_client_policies
  for select to authenticated using (organization_id in (select public.fn_user_org_ids()));
revoke all on public.managed_client_policies from public, anon, authenticated;
grant select on public.managed_client_policies to authenticated;
grant all on public.managed_client_policies to service_role;

-- O SECURITY DEFINER só consulta a classificação persistida; nunca aceita
-- uma área enviada pelo cliente como prova de membership ou papel.
create or replace function public.fn_managed_area_allowed(p_org uuid, p_area text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_areas jsonb;
  v_role text;
  v_class text;
begin
  select areas into v_areas from public.managed_client_policies where organization_id = p_org;
  if not found then return true; end if;
  v_role := public.fn_user_role_in_org(p_org);
  if v_role is null then return false; end if;
  v_class := v_areas->>p_area;
  if v_class = 'agency' then return v_role = 'admin'; end if;
  if v_class in ('client', 'shared') then return true; end if;
  return false;
end $$;
revoke all on function public.fn_managed_area_allowed(uuid, text) from public, anon;
grant execute on function public.fn_managed_area_allowed(uuid, text) to authenticated, service_role;

-- Restrictive policies compose with every historical permissive policy. This
-- avoids a FOR ALL or new permissive policy reopening SELECT via OR.
do $$
declare
  gate record;
begin
  for gate in select * from (values
    ('ai_agents', '/app/ai/agents'),
    ('ai_agent_versions', '/app/ai/agents'),
    ('ai_provider_credentials', '/app/ai/credentials'),
    ('ai_knowledge_sources', '/app/ai/knowledge/sources'),
    ('ai_knowledge_versions', '/app/ai/knowledge/sources'),
    ('ai_chunks', '/app/ai/knowledge/sources'),
    ('ai_budgets', '/app/ai/usage'),
    ('ai_agent_runs', '/app/ai/runs'),
    ('api_tokens', '/app/settings/api-tokens')
  ) as t(table_name, area_href) loop
    if to_regclass('public.' || gate.table_name) is not null then
      execute format('drop policy if exists managed_area_gate on public.%I', gate.table_name);
      execute format(
        'create policy managed_area_gate on public.%I as restrictive for all to authenticated using (public.fn_managed_area_allowed(organization_id, %L)) with check (public.fn_managed_area_allowed(organization_id, %L))',
        gate.table_name, gate.area_href, gate.area_href
      );
    end if;
  end loop;
end $$;
