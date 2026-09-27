-- 0473 — autoria operacional acrescentada pelo upstream 1.53.
-- A coluna é um UUID de autoria, sem token/configuração. Preserva filtros,
-- metadata higienizada, OID e trigger de escrita da projeção certificada.
create or replace view public.operational_messages with (security_barrier=true) as
select m.id, m.organization_id, m.conversation_id, m.channel_session_id, m.contact_id, m.external_id, m.type, m.direction, m.status, m.ack, m.error_code, m.error_message, m.body, m.media_url, m.media_mime, m.media_size_bytes, m.media_storage_path, m.sent_via, m.sent_by_user_id, m.sent_at, m.delivered_at, m.read_at, m.created_at, m.template_name, m.template_language, m.edited_at, m.revoked_at, m.reply_to_message_id, case when public.fn_managed_area_allowed(m.organization_id, '/app/ai/knowledge/sources') then m.metadata else public.fn_operational_message_metadata(m.metadata) end as metadata, m.service_revision, m.sent_on_behalf_of_user_id
from public.messages m join public.conversations c on c.id=m.conversation_id and c.organization_id=m.organization_id
where (public.fn_managed_area_allowed(m.organization_id, '/app/inbox') and public.fn_can_view_conversation(c.organization_id, c.assigned_to_user_id))
   or public.fn_is_platform_admin() or current_user in ('postgres','service_role');
alter view public.operational_messages owner to postgres;
revoke all on public.operational_messages from public, anon;
grant select, insert, update, delete on public.operational_messages to authenticated, service_role;
-- Autoria delegada vem do ingresso autenticado de serviço, nunca do PATCH do cliente.
create or replace function public.fn_write_operational_inbox()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
  v_row jsonb;
  v_org uuid;
  v_id uuid;
  v_conv uuid;
  v_owner uuid;
  v_table text := tg_argv[0];
  v_keys text[];
  v_set text;
  v_columns text;
  v_values text;
  v_private_metadata jsonb;
begin
  if v_table not in ('conversations','messages') then raise exception 'invalid_surface' using errcode='42501'; end if;
  v_row := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_org := (v_row->>'organization_id')::uuid;
  v_id := coalesce((v_row->>'id')::uuid,gen_random_uuid());
  if auth.uid() is not null then
    if not public.fn_role_at_least(v_org,'agent') or not public.fn_managed_area_allowed(v_org,'/app/inbox')
       or not public.fn_support_write_allowed(v_org) then
      raise exception 'managed_operational_write_denied' using errcode='42501';
    end if;
  elsif current_setting('role',true) not in ('service_role','none') then
    raise exception 'actor_required' using errcode='42501';
  end if;
  if auth.uid() is not null and v_table='messages' then
    if (tg_op='INSERT' and v_row->>'service_revision' is not null)
       or (tg_op='UPDATE' and (to_jsonb(old)->>'service_revision') is distinct from (v_row->>'service_revision')) then
      raise exception 'immutable_service_revision' using errcode='42501';
    end if;
    if (tg_op='INSERT' and v_row->>'sent_on_behalf_of_user_id' is not null)
       or (tg_op='UPDATE' and (to_jsonb(old)->>'sent_on_behalf_of_user_id') is distinct from (v_row->>'sent_on_behalf_of_user_id')) then
      raise exception 'immutable_message_authorship' using errcode='42501';
    end if;
  end if;
  if tg_op<>'INSERT' and ((to_jsonb(old)->>'id')::uuid is distinct from v_id
      or (to_jsonb(old)->>'organization_id')::uuid is distinct from v_org) then
    raise exception 'immutable_tenant' using errcode='42501';
  end if;
  v_conv := case when v_table='conversations' then v_id else (v_row->>'conversation_id')::uuid end;
  if v_table='messages' or tg_op<>'INSERT' then
    select assigned_to_user_id into v_owner from public.conversations where id=v_conv and organization_id=v_org for no key update;
    if not found or (auth.uid() is not null and not public.fn_can_view_conversation(v_org,v_owner)) then
      raise exception 'conversation_not_visible' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then
    execute format('delete from public.%I where id=$1 and organization_id=$2',v_table) using v_id,v_org;
  else
    if not exists(select 1 from public.contacts where id=(v_row->>'contact_id')::uuid and organization_id=v_org)
       or not exists(select 1 from public.channel_sessions where id=(v_row->>'channel_session_id')::uuid and organization_id=v_org) then
      raise exception 'foreign_operational_reference' using errcode='42501';
    end if;
    if v_table='conversations' and v_row->>'assigned_to_user_id' is not null and
       coalesce(public.fn_member_role_in_org((v_row->>'assigned_to_user_id')::uuid,v_org),'none') not in ('agent','manager','admin') then
      raise exception 'assignee_not_eligible_member' using errcode='42501';
    end if;
    if tg_op='UPDATE' and v_table='messages' and
       (v_row->>'conversation_id') is distinct from (to_jsonb(old)->>'conversation_id') then
      raise exception 'immutable_conversation' using errcode='42501';
    end if;
    v_row := v_row - 'comando_da_conversa' - 'tags_do_contato';
    if tg_op='UPDATE' and v_row->'metadata' is not distinct from to_jsonb(old)->'metadata' then
      -- A projeção sanitizada nunca substitui o metadata privado num PATCH.
      v_row := v_row - 'metadata';
    end if;
    if auth.uid() is not null and not public.fn_managed_area_allowed(v_org,'/app/ai/knowledge/sources') and v_row ? 'metadata' then
      if v_table='messages' then
        v_row := jsonb_set(v_row,'{metadata}',public.fn_operational_message_metadata(v_row->'metadata'));
      elsif v_row->'metadata' is distinct from '{}'::jsonb then
        raise exception 'private_metadata_write_denied' using errcode='42501';
      end if;
    end if;
    if tg_op='UPDATE' then
      select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_row from jsonb_each(v_row)
        where value is distinct from to_jsonb(old)->key;
      if v_row='{}'::jsonb then return old; end if;
    end if;
    if tg_op='UPDATE' and v_row ? 'metadata' then
      execute format('select metadata from public.%I where id=$1 and organization_id=$2',v_table)
        into v_private_metadata using v_id,v_org;
      v_row:=jsonb_set(v_row,'{metadata}',coalesce(v_private_metadata,'{}'::jsonb)||coalesce(v_row->'metadata','{}'::jsonb));
    end if;
    if tg_op='INSERT' then
      v_row := jsonb_strip_nulls(v_row) || jsonb_build_object('id',v_id);
      select array_agg(key order by key) into v_keys from jsonb_object_keys(v_row) key;
      select string_agg(format('%I',key),','), string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',v_table,key),',')
        into v_columns,v_values from unnest(v_keys) key;
      execute format('insert into public.%I (%s) select %s',v_table,v_columns,v_values) using v_row;
    else
      select string_agg(format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',key,v_table,key),',')
        into v_set from jsonb_object_keys(v_row) key where key not in ('id','organization_id');
      execute format('update public.%I set %s where id=$2 and organization_id=$3',v_table,v_set) using v_row,v_id,v_org;
    end if;
  end if;
  if auth.uid() is not null then
    insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,resource_id,metadata)
      values(v_org,auth.uid(),'operational_inbox.'||lower(tg_op),v_table,v_id,'{}'::jsonb);
  end if;
  if tg_op='DELETE' then return old; end if;
  execute format('select * from public.%I where id=$1 and organization_id=$2',tg_table_name) into new using v_id,v_org;
  return new;
end;
$fn$;
revoke all on function public.fn_write_operational_inbox() from public,anon,authenticated;
grant execute on function public.fn_write_operational_inbox() to service_role;
notify pgrst, 'reload schema';
