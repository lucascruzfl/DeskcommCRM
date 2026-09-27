-- Projeção operacional mínima para o Funil. O cliente gerenciado não lê
-- ai_agents nem ai_agent_versions, que contêm prompt/configuração da agência.
create table if not exists public.ai_agent_assignable_directory (
  agent_id uuid primary key references public.ai_agents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  channel text not null,
  published_version_id uuid,
  version_number integer,
  paused_at timestamptz,
  archived_at timestamptz,
  priority integer not null,
  created_at timestamptz not null
);
create index if not exists idx_ai_agent_assignable_directory_org
  on public.ai_agent_assignable_directory(organization_id, priority desc, created_at);
alter table public.ai_agent_assignable_directory enable row level security;
drop policy if exists ai_agent_assignable_directory_read on public.ai_agent_assignable_directory;
create policy ai_agent_assignable_directory_read on public.ai_agent_assignable_directory
  for select to authenticated using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_managed_area_allowed(organization_id, '/app/kanban')
  );
revoke all on public.ai_agent_assignable_directory from public, anon, authenticated;
grant select on public.ai_agent_assignable_directory to authenticated;
grant all on public.ai_agent_assignable_directory to service_role;

create or replace function public.fn_sync_ai_agent_assignable_directory()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.ai_agent_assignable_directory(
    agent_id, organization_id, name, channel, published_version_id,
    version_number, paused_at, archived_at, priority, created_at
  ) values (
    new.id, new.organization_id, new.name, new.channel, new.published_version_id,
    (select version_number from public.ai_agent_versions
      where id = new.published_version_id and organization_id = new.organization_id),
    new.paused_at, new.archived_at, new.priority, new.created_at
  ) on conflict (agent_id) do update set
    organization_id = excluded.organization_id,
    name = excluded.name,
    channel = excluded.channel,
    published_version_id = excluded.published_version_id,
    version_number = excluded.version_number,
    paused_at = excluded.paused_at,
    archived_at = excluded.archived_at,
    priority = excluded.priority,
    created_at = excluded.created_at;
  return new;
end $$;
revoke all on function public.fn_sync_ai_agent_assignable_directory() from public, anon, authenticated;
drop trigger if exists trg_sync_ai_agent_assignable_directory on public.ai_agents;
create trigger trg_sync_ai_agent_assignable_directory
  after insert or update of name, channel, published_version_id, paused_at, archived_at, priority
  on public.ai_agents for each row execute function public.fn_sync_ai_agent_assignable_directory();

insert into public.ai_agent_assignable_directory(
  agent_id, organization_id, name, channel, published_version_id,
  version_number, paused_at, archived_at, priority, created_at
)
select a.id, a.organization_id, a.name, a.channel, a.published_version_id,
  v.version_number, a.paused_at, a.archived_at, a.priority, a.created_at
from public.ai_agents a
left join public.ai_agent_versions v on v.id = a.published_version_id and v.organization_id = a.organization_id
on conflict (agent_id) do update set
  organization_id = excluded.organization_id,
  name = excluded.name,
  channel = excluded.channel,
  published_version_id = excluded.published_version_id,
  version_number = excluded.version_number,
  paused_at = excluded.paused_at,
  archived_at = excluded.archived_at,
  priority = excluded.priority,
  created_at = excluded.created_at;
