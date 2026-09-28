-- Presets oficiais do onboarding gerenciado. Gerado por:
-- pnpm exec tsx scripts/gerar-managed-onboarding-rpc.ts
-- Sem backfill: políticas já persistidas permanecem intactas.
create or replace function public.fn_begin_managed_client_onboarding(
  p_actor uuid, p_key uuid, p_request jsonb, p_hash text,
  p_client_email text, p_policy jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prior public.managed_client_onboardings%rowtype;
  created_org jsonb;
  actor_email text;
  invite_uuid uuid;
  org_uuid uuid;
begin
  if not exists (select 1 from public.platform_admins
                 where user_id = p_actor and revoked_at is null and scope = 'full') then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  select lower(email) into actor_email from auth.users where id = p_actor;
  if actor_email is null or actor_email is distinct from lower(p_request->>'owner_email')
     or not exists (
       -- Snapshot gerado de MANAGED_CLIENT_PRESETS; não manter lista SQL à mão.
       select 1 from jsonb_to_recordset('[{"id":"managed/aesthetic-clinic","business_type":"aesthetic_clinic","management_mode":"managed"},{"id":"managed/internet-provider","business_type":"internet_provider","management_mode":"managed"}]'::jsonb)
         as registered(id text, business_type text, management_mode text)
       where registered.id = p_policy->>'preset_id'
         and registered.business_type = p_policy->>'business_type'
         and registered.management_mode = p_policy->>'management_mode'
     )
     or jsonb_typeof(p_policy->'areas') is distinct from 'object'
     or lower(p_client_email) = actor_email then
    raise exception 'invalid_managed_onboarding' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':managed:' || p_key::text, 0));
  select * into prior from public.managed_client_onboardings
   where actor_user_id = p_actor and idempotency_key = p_key for update;
  if found then
    if prior.request_hash <> p_hash then
      raise exception 'idempotency_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('organization_id', prior.organization_id,
      'invite_id', prior.invite_id, 'state', prior.state, 'created', false);
  end if;

  -- Esta RPC cria organização + vínculo admin permanente do próprio criador.
  -- O owner_email é o do ator, então provisional_until_handover é false.
  created_org := public.fn_create_tenant_with_owner(p_actor, p_key, p_request, p_hash);
  if created_org->>'created' is distinct from 'true' then
    raise exception 'tenant_receipt_already_used' using errcode = '22023';
  end if;
  org_uuid := (created_org->>'id')::uuid;
  invite_uuid := (created_org->>'invite_id')::uuid;
  insert into public.managed_client_policies
    (organization_id, business_type, management_mode, preset_id, preset_version,
     areas, overrides, applied_by)
  values (org_uuid, p_policy->>'business_type', p_policy->>'management_mode',
          p_policy->>'preset_id', p_policy->>'preset_version', p_policy->'areas',
          coalesce(p_policy->'overrides', '{}'::jsonb), p_actor);
  insert into public.team_invites
    (id, organization_id, email, role, interface_settings, invited_by,
     inviter_name, email_dispatched, expires_at)
  values (invite_uuid, org_uuid, lower(p_client_email), 'agent',
          '{"preset":"completa"}'::jsonb, p_actor,
          coalesce(nullif(p_request->>'display_name', ''), 'Gestor'), false,
          now() + interval '24 hours');
  insert into public.managed_client_onboardings
    (organization_id, actor_user_id, idempotency_key, request_hash,
     client_email, invite_id)
  values (org_uuid, p_actor, p_key, p_hash, lower(p_client_email), invite_uuid);
  return jsonb_build_object('organization_id', org_uuid, 'invite_id', invite_uuid,
    'state', 'organization_created', 'created', true);
end $$;

revoke all on function public.fn_begin_managed_client_onboarding(uuid,uuid,jsonb,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_begin_managed_client_onboarding(uuid,uuid,jsonb,text,text,jsonb)
  to service_role;

notify pgrst, 'reload schema';
