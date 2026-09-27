-- Conversa/mensagem não são configuração administrativa. Os campos privados
-- ficam nas bases; a projeção mantém o escopo de visibilidade e publica somente
-- o necessário ao atendente. Sinais separados preservam Realtime sem WAL privado.

create or replace function public.fn_managed_area_allowed(p_org uuid,p_area text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $fn$
declare v_areas jsonb; v_role text; v_class text;
begin
 if auth.uid() is not null and not public.fn_is_platform_admin() and not exists(
   select 1 from public.user_organizations where organization_id=p_org and user_id=auth.uid() and revoked_at is null
 ) then return false; end if;
 select areas into v_areas from public.managed_client_policies where organization_id=p_org;
 if not found then return true; end if;
 if auth.uid() is not null and not public.fn_is_platform_admin() and not exists(
   select 1 from public.user_organizations where organization_id=p_org and user_id=auth.uid()
     and revoked_at is null and accepted_at is not null
 ) then return false; end if;
 v_role:=public.fn_user_role_in_org(p_org);
 if v_role is null then return false; end if;
 v_class:=v_areas->>p_area;
 if v_class='agency' then return v_role='admin'; end if;
 return coalesce(v_class in ('client','shared'),false);
end $fn$;
revoke all on function public.fn_managed_area_allowed(uuid,text) from public,anon;
grant execute on function public.fn_managed_area_allowed(uuid,text) to authenticated,service_role;

-- Campo calculado: acrescentar coluna à view quebraria a reaplicação das
-- definições anteriores do baseline. Só devolve um enum; nunca o metadata.
create or replace function public.social_platform(p_channel public.operational_channel_sessions)
returns text language plpgsql stable security definer set search_path=public,pg_temp as $fn$
declare v_platform text;
begin
 if auth.uid() is not null and not public.fn_managed_area_allowed(p_channel.organization_id,'/app/inbox') then
   raise exception 'managed_area_denied' using errcode='42501';
 end if;
 select metadata->>'social_platform' into v_platform from public.channel_sessions
   where id=p_channel.id and organization_id=p_channel.organization_id;
 return case when v_platform in ('instagram','facebook','whatsapp') then v_platform end;
end $fn$;
revoke all on function public.social_platform(public.operational_channel_sessions) from public,anon;
grant execute on function public.social_platform(public.operational_channel_sessions) to authenticated,service_role;

create or replace function public.fn_operational_message_metadata(p_metadata jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $fn$
 select jsonb_strip_nulls(jsonb_build_object(
   'ai_generated', case when jsonb_typeof(p_metadata->'ai_generated')='boolean' then p_metadata->'ai_generated' end,
   'media_status', case when jsonb_typeof(p_metadata->'media_status')='string' then p_metadata->'media_status' end,
   'shared_contact', case when jsonb_typeof(p_metadata->'shared_contact')='object' then
     jsonb_strip_nulls(jsonb_build_object(
       'name', case when jsonb_typeof(p_metadata->'shared_contact'->'name')='string' then p_metadata->'shared_contact'->'name' end,
       'phone_number', case when jsonb_typeof(p_metadata->'shared_contact'->'phone_number')='string' then p_metadata->'shared_contact'->'phone_number' end
     )) end
 ));
$fn$;
revoke all on function public.fn_operational_message_metadata(jsonb) from public, anon;
grant execute on function public.fn_operational_message_metadata(jsonb) to authenticated, service_role;

create or replace view public.operational_conversations with (security_barrier=true) as
select c.id, c.organization_id, c.contact_id, c.channel_session_id, c.channel, c.status, c.status_changed_at, c.assigned_to_user_id, c.assigned_at, c.last_inbound_at, c.last_outbound_at, c.last_message_at, c.last_message_preview, c.unread_count_for_assignee, c.is_group, c.group_chat_id, c.created_at, c.updated_at, c.bot_silenced_until, c.last_handoff_at, c.last_handoff_reason, c.assignee_kind, c.tags, c.snooze_until, c.snoozed_by_user_id, c.snoozed_at, c.assigned_to_user_name, c.service_revision, c.service_closed_at, c.service_started_at, c.current_demanda_id, c.reply_context_revision, c.awaiting_since, public.comando_da_conversa(c) as comando_da_conversa, public.tags_do_contato(c) as tags_do_contato, case when public.fn_managed_area_allowed(c.organization_id, '/app/ai/knowledge/sources') then c.metadata else '{}'::jsonb end as metadata
from public.conversations c
where (public.fn_managed_area_allowed(c.organization_id, '/app/inbox') and public.fn_can_view_conversation(c.organization_id, c.assigned_to_user_id))
   or public.fn_is_platform_admin() or current_user in ('postgres','service_role');
alter view public.operational_conversations owner to postgres;
revoke all on public.operational_conversations from public, anon;
grant select, insert, update, delete on public.operational_conversations to authenticated, service_role;

drop policy if exists managed_conversations_base_select on public.conversations;
create policy managed_conversations_base_select on public.conversations
as restrictive for select to authenticated
using (public.fn_managed_area_allowed(organization_id, '/app/ai/knowledge/sources'));

create or replace view public.operational_messages with (security_barrier=true) as
select m.id, m.organization_id, m.conversation_id, m.channel_session_id, m.contact_id, m.external_id, m.type, m.direction, m.status, m.ack, m.error_code, m.error_message, m.body, m.media_url, m.media_mime, m.media_size_bytes, m.media_storage_path, m.sent_via, m.sent_by_user_id, m.sent_at, m.delivered_at, m.read_at, m.created_at, m.template_name, m.template_language, m.edited_at, m.revoked_at, m.reply_to_message_id, case when public.fn_managed_area_allowed(m.organization_id, '/app/ai/knowledge/sources') then m.metadata else public.fn_operational_message_metadata(m.metadata) end as metadata, m.service_revision
from public.messages m join public.conversations c on c.id=m.conversation_id and c.organization_id=m.organization_id
where (public.fn_managed_area_allowed(m.organization_id, '/app/inbox') and public.fn_can_view_conversation(c.organization_id, c.assigned_to_user_id))
   or public.fn_is_platform_admin() or current_user in ('postgres','service_role');
alter view public.operational_messages owner to postgres;
revoke all on public.operational_messages from public, anon;
grant select, insert, update, delete on public.operational_messages to authenticated, service_role;

drop policy if exists managed_messages_base_select on public.messages;
create policy managed_messages_base_select on public.messages
as restrictive for select to authenticated
using (public.fn_managed_area_allowed(organization_id, '/app/ai/knowledge/sources'));

-- UPDATE/INSERT passam por um guarda de ator/organização e pelo MESMO escopo
-- do SELECT. Um view com owner postgres não pode receber escrita automática.
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
drop trigger if exists trg_operational_inbox_write on public.operational_conversations;
create trigger trg_operational_inbox_write instead of insert or update or delete on public.operational_conversations
for each row execute function public.fn_write_operational_inbox('conversations');
drop trigger if exists trg_operational_inbox_write on public.operational_messages;
create trigger trg_operational_inbox_write instead of insert or update or delete on public.operational_messages
for each row execute function public.fn_write_operational_inbox('messages');

-- Uma linha por conversa: o sinal não acumula histórico sem limite.
create table if not exists public.operational_inbox_signals (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision bigint not null default 1,
  changed_at timestamptz not null default now(),
  message_id uuid,
  contact_id uuid,
  direction text,
  type text,
  body text
);
alter table public.operational_inbox_signals enable row level security;
revoke all on public.operational_inbox_signals from public,anon,authenticated;
grant select on public.operational_inbox_signals to authenticated;
grant all on public.operational_inbox_signals to service_role;
drop policy if exists operational_inbox_signals_select on public.operational_inbox_signals;
create policy operational_inbox_signals_select on public.operational_inbox_signals for select to authenticated
using (public.fn_managed_area_allowed(organization_id,'/app/inbox') and exists(
  select 1 from public.operational_conversations c where c.id=conversation_id and c.organization_id=operational_inbox_signals.organization_id
));
create or replace function public.fn_signal_operational_inbox()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $fn$
declare v_conv uuid; v_org uuid;
begin
  v_conv:=case when tg_table_name='conversations' then (to_jsonb(new)->>'id')::uuid else (to_jsonb(new)->>'conversation_id')::uuid end;
  v_org:=new.organization_id;
  insert into public.operational_inbox_signals(conversation_id,organization_id,message_id,contact_id,direction,type,body)
  values(v_conv,v_org,
    case when tg_table_name='messages' and tg_op='INSERT' then new.id end,
    new.contact_id,
    case when tg_table_name='messages' and tg_op='INSERT' then to_jsonb(new)->>'direction' end,
    case when tg_table_name='messages' and tg_op='INSERT' then to_jsonb(new)->>'type' end,
    case when tg_table_name='messages' and tg_op='INSERT' then left(to_jsonb(new)->>'body',160) end)
  on conflict(conversation_id) do update set revision=operational_inbox_signals.revision+1,
    changed_at=clock_timestamp(),message_id=excluded.message_id,contact_id=excluded.contact_id,
    direction=excluded.direction,type=excluded.type,body=excluded.body;
  return new;
end;
$fn$;
revoke all on function public.fn_signal_operational_inbox() from public,anon,authenticated;
grant execute on function public.fn_signal_operational_inbox() to service_role;
drop trigger if exists trg_zz_operational_inbox_signal on public.conversations;
create trigger trg_zz_operational_inbox_signal after insert or update on public.conversations
for each row execute function public.fn_signal_operational_inbox();
drop trigger if exists trg_zz_operational_inbox_signal on public.messages;
create trigger trg_zz_operational_inbox_signal after insert or update on public.messages
for each row execute function public.fn_signal_operational_inbox();
do $fn$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
   select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='operational_inbox_signals'
 ) then alter publication supabase_realtime add table public.operational_inbox_signals; end if;
end $fn$;

-- A RPC de atribuição preserva o escopo e retorna a mesma projeção para o cliente.
CREATE OR REPLACE FUNCTION public.fn_conversation_assign(p_organization_id uuid, p_conversation_id uuid, p_to_user_id uuid, p_reason text, p_expected_assignee uuid DEFAULT NULL::uuid, p_enforce_expected boolean DEFAULT false)
 RETURNS SETOF conversations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_from uuid;
  v_conv public.conversations%rowtype;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_organization_id, '/app/inbox') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

  if not public.fn_support_write_allowed(p_organization_id) then raise exception 'support_readonly' using errcode='42501'; end if;
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'caller must be an active agent+ member of the organization';
  end if;

  if p_to_user_id is not null then
    if coalesce(public.fn_member_role_in_org(p_to_user_id, p_organization_id), 'none')
         not in ('agent','manager','admin') then
      raise exception 'assignee_not_eligible_member'
        using hint = 'target must be an active agent+ member of the organization';
    end if;
  end if;

  select assigned_to_user_id into v_from
    from public.conversations
   where id = p_conversation_id
     and organization_id = p_organization_id
   for no key update;

  if not found then
    return;
  end if;

  if auth.uid() is not null and not public.fn_can_view_conversation(p_organization_id,v_from) then
    raise exception 'conversation_not_visible' using errcode='42501';
  end if;

  if p_enforce_expected and v_from is distinct from p_expected_assignee then
    return;
  end if;

  update public.conversations
     set assigned_to_user_id = p_to_user_id,
         -- Desnormalizado JUNTO com o dono, na mesma transação: nunca existe
         -- uma janela em que id e nome discordam. NULL junto com o id quando
         -- a atribuição é removida (release) — nunca sobra um nome órfão de
         -- dono nenhum. Lido de auth.users porque quem chama esta função
         -- (RPC) não necessariamente tem acesso ao Admin API — a definer
         -- resolve por dentro.
         assigned_to_user_name = case
           when p_to_user_id is null then null
           else (select raw_user_meta_data ->> 'full_name' from auth.users where id = p_to_user_id)
         end,
         assigned_at = case when p_to_user_id is null then null else now() end,
         assignee_kind = case when p_to_user_id is null then null else 'user' end,
         status = case when p_to_user_id is null then 'open' else 'claimed' end,
         status_changed_at = now(),
         unread_count_for_assignee = 0,
         bot_silenced_until = case
           when p_reason = 'routing'  then bot_silenced_until
           when p_to_user_id is null  then (case when last_handoff_at is null
                                                 then null
                                                 else bot_silenced_until end)
           else 'infinity'::timestamptz
         end,
         updated_at = now()
   where id = p_conversation_id
   returning * into v_conv;

  insert into public.conversation_assignment_events
    (organization_id, conversation_id, from_user_id, to_user_id, changed_by, reason)
  values
    (p_organization_id, p_conversation_id, v_from, p_to_user_id, auth.uid(), p_reason);

  if auth.uid() is not null and not public.fn_managed_area_allowed(p_organization_id,'/app/ai/knowledge/sources') then
    select (jsonb_populate_record(null::public.conversations,to_jsonb(c))).* into v_conv
      from public.operational_conversations c where c.id=p_conversation_id and c.organization_id=p_organization_id;
  end if;
  return next v_conv;
end;
$function$;
revoke all on function public.fn_conversation_assign(uuid,uuid,uuid,text,uuid,boolean) from public,anon;
grant execute on function public.fn_conversation_assign(uuid,uuid,uuid,text,uuid,boolean) to authenticated,service_role;

-- O evento genérico não é uma entrada alternativa para workers administrativos.
CREATE OR REPLACE FUNCTION public.emit_event(p_event_type text, p_entity_kind text, p_entity_id uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_metadata jsonb DEFAULT '{}'::jsonb, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
  v_event_id uuid;
  v_contact uuid;
  v_origin jsonb;
begin
  -- message.received nasce somente do INSERT inbound interno. Um chamador
  -- público não pode reapresentar uma mensagem existente como evento novo.
  -- `ai.case_opened`/`ai.case_closed` entram pela mesma razão (0279): o caso é
  -- do motor, e um evento de caso forjado por login move o funil e acorda o
  -- agente em nome de uma decisão que ninguém tomou.
  if auth.uid() is not null and p_event_type in (
    'message.received','appointment.outcome_confirmed',
    'ai.case_opened','ai.case_closed'
  ) then
    raise exception 'reserved_message_received' using errcode='42501';
  end if;
  -- Estes campos autorizam efeitos operacionais; não são payload público.
  if auth.uid() is not null and (
    coalesce(p_payload,'{}'::jsonb) ?| array['service_origin','service_boundary']
    or coalesce(p_metadata,'{}'::jsonb) ?| array['service_origin','service_boundary']
  ) then raise exception 'reserved_service_origin' using errcode='42501'; end if;
  v_org_id := coalesce(p_organization_id, (public.fn_support_context()->>'organization_id')::uuid);
  if v_org_id is null then
    select organization_id into v_org_id
      from public.user_organizations
      where user_id = auth.uid() and revoked_at is null
      limit 1;
  end if;
  if v_org_id is null then
    raise exception 'emit_event: organization_id obrigatorio';
  end if;

  if auth.uid() is not null
     and not public.fn_role_at_least(v_org_id, 'viewer') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'emit_event: caller must be an active member of the organization';
  end if;

  if auth.uid() is not null and not public.fn_managed_area_allowed(v_org_id,'/app/ai/knowledge/sources') then
    if p_event_type not in (
      'contact.created','contact.updated','contact.deleted','contact.tag_added',
      'lead.created','lead.updated','lead.stage_changed','lead.tag_added','lead.won','lead.lost','lead.deleted','lead.reopened','lead.assigned',
      'conversation.claimed','conversation.transferred','conversation.released','message.sent','message.failed','message.sending','message.outbound',
      'user.mentioned','user.profile_updated','crm.activity_write_failed'
    ) then raise exception 'managed_event_denied' using errcode='42501'; end if;
    if not public.fn_managed_area_allowed(v_org_id,
      case split_part(p_event_type,'.',1)
        when 'lead' then '/app/kanban'
        when 'contact' then '/app/contacts'
        when 'message' then '/app/inbox'
        when 'conversation' then '/app/inbox'
        when 'crm' then '/app/activities'
        else '/app/settings/profile'
      end
    ) then raise exception 'managed_event_area_denied' using errcode='42501'; end if;
  end if;

  if not public.fn_support_write_allowed(v_org_id) then raise exception 'support_readonly' using errcode='42501'; end if;

  -- A ORIGEM E RESERVADA AO SERVIDOR — ENTAO O SERVIDOR TEM DE ESCREVE-LA.
  --
  -- O bloco acima recusa `service_origin` vindo de chamador autenticado (42501,
  -- e com razao: e o campo que AUTORIZA efeito operacional, nao payload
  -- publico). So que ninguem o escrevia no lugar dele. Efeito medido: quem move
  -- o negocio pela IA carimba a origem no servidor (`agent-stage-sync`,
  -- `appointment-stage-move`, `handoff-stage-move`) e o follow-up nasce; quem
  -- move PELO QUADRO — o operador, pela rota HTTP autenticada — emitia um
  -- evento SEM origem, `fn_service_event_origin` caia no `service_stale` final
  -- (40001), `serviceForEvent` engolia como `stale_origin` e o follow-up nunca
  -- nascia. Sem erro em lugar nenhum: o gatilho de etapa era inalcancavel pelo
  -- caminho que o produto oferece na tela.
  --
  -- O retrato e tirado AQUI, no instante da emissao, que e exatamente a
  -- semantica de procedencia que a 0223 quer: "quando este evento nasceu, o
  -- atendimento estava assim". A resolucao do contato repete a mesma regra de
  -- `fn_service_event_origin` — se ela nao souber resolver o tipo, nao ha o que
  -- carimbar e o evento segue sem origem, como antes.
  if not (coalesce(p_payload,'{}'::jsonb) ? 'service_origin')
     and not (coalesce(p_metadata,'{}'::jsonb) ? 'service_origin') then
    if p_event_type in ('lead.created','lead.stage_changed','lead.tag_added') and p_entity_kind='crm_lead' then
      select contact_id into v_contact from public.crm_leads where organization_id=v_org_id and id=p_entity_id;
    elsif p_event_type='contact.tag_added' and p_entity_kind='contact' then
      select id into v_contact from public.contacts where organization_id=v_org_id and id=p_entity_id;
    end if;
    if v_contact is not null
       and exists(select 1 from public.contacts
                   where organization_id=v_org_id and id=v_contact
                     and not is_anonymized and is_merged_into is null) then
      v_origin := jsonb_build_object('kind','command',
        'observed', public.fn_service_observe_command(v_org_id, v_contact));
    end if;
  end if;

  insert into public.event_log
    (organization_id, event_type, entity_kind, entity_id, payload, metadata)
  values
    (v_org_id, p_event_type, p_entity_kind, p_entity_id,
     coalesce(p_payload, '{}'::jsonb)
       || case when v_origin is null then '{}'::jsonb else jsonb_build_object('service_origin', v_origin) end,
     coalesce(p_metadata, '{}'::jsonb)
       || jsonb_build_object('emitted_at', extract(epoch from now())))
  returning id into v_event_id;

  return v_event_id;
end $function$;
revoke all on function public.emit_event(text,text,uuid,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.emit_event(text,text,uuid,jsonb,jsonb,uuid) to authenticated,service_role;

-- Agregação operacional permanece sob RLS/projeção, sem retornar configuração.
CREATE OR REPLACE FUNCTION public.fn_atrito_metrics(p_org uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_abandono_horas integer DEFAULT 72, p_repeticao_min double precision DEFAULT 0.7, p_espera_horas integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with
  -- DENOMINADOR DEFINITIVO: demandas encerradas na janela. Não mais os casos.
  demandas_j as (
    select d.id, d.agent_case_id, d.aberta_em, d.fechada_em, d.desfecho
      from public.demandas d
     where d.organization_id = p_org
       and d.fechada_em is not null
       and d.fechada_em >= p_from
       and d.fechada_em <  p_to
  ),
  -- Turnos: mensagens de TODAS as conversas da demanda (N:N), dentro da vida
  -- dela. Uma demanda que atravessou dois canais soma os dois.
  turnos as (
    select d.id,
           (select count(*)
              from public.demanda_conversas dc
              join public.operational_messages m
                on m.conversation_id = dc.conversation_id
               and m.organization_id = p_org
               and m.sent_at >= d.aberta_em
               and m.sent_at <  d.fechada_em
             where dc.demanda_id = d.id) as n
      from demandas_j d
  ),
  -- Insistência: só existe onde houve caso. O payload declara o denominador
  -- próprio (`demandas_com_caso`) para o número não ser lido como se fosse
  -- sobre o total.
  insistencia as (
    select avg(c.followup_attempts)::float8 as media,
           max(c.followup_attempts)         as maximo,
           count(*)                         as base
      from demandas_j d
      join public.agent_cases c on c.id = d.agent_case_id
  ),
  humano as (
    select e.case_id, count(*) as intervencoes, min(e.created_at) as primeiro_toque
      from public.agent_case_events e
      join demandas_j d on d.agent_case_id = e.case_id
     where e.organization_id = p_org and e.actor_kind = 'human'
     group by e.case_id
  ),
  espera_fila as (
    select extract(epoch from (h.primeiro_toque - d.aberta_em)) as segundos
      from demandas_j d join humano h on h.case_id = d.agent_case_id
     where h.primeiro_toque > d.aberta_em
  ),
  retrabalho as (
    select count(distinct e.case_id) as n
      from public.agent_case_events e
      join demandas_j d on d.agent_case_id = e.case_id
     where e.organization_id = p_org
       and (e.kind = 'escalated' or e.human_action = 'escalate')
  ),
  abandono as (
    select
      count(*) filter (
        where cv.last_outbound_at >= p_from and cv.last_outbound_at < p_to
          and (cv.last_inbound_at is null or cv.last_outbound_at > cv.last_inbound_at)
          and cv.last_outbound_at < now() - make_interval(hours => p_abandono_horas)
          and cv.status not in ('resolved', 'closed')
      ) as abandonadas,
      count(*) filter (
        where cv.last_outbound_at >= p_from and cv.last_outbound_at < p_to
      ) as com_fala_nossa
      from public.operational_conversations cv
     where cv.organization_id = p_org and cv.last_outbound_at is not null
  ),
  -- INVARIANTE 4, agora VERIFICÁVEL: demanda aberta sem próximo passo é o
  -- vazamento que a doutrina proíbe. Antes da 0119 isto não era enumerável.
  sem_proximo_passo as (
    select count(*) as n
      from public.demandas d
     where d.organization_id = p_org
       and d.fechada_em is null
       and d.proximo_passo is null
  ),
  demandas_abertas as (
    select count(*) as n from public.demandas d
     where d.organization_id = p_org and d.fechada_em is null
  ),
  inbounds as (
    select m.conversation_id, m.sent_at, m.body,
           lag(m.body)    over (partition by m.conversation_id order by m.sent_at) as body_anterior,
           lag(m.sent_at) over (partition by m.conversation_id order by m.sent_at) as sent_at_anterior
      from public.operational_messages m
     where m.organization_id = p_org and m.direction = 'inbound' and m.body is not null
       and m.sent_at >= p_from and m.sent_at < p_to
  ),
  repeticao as (
    select
      count(*) filter (
        where i.body_anterior is not null
          and exists (select 1 from public.operational_messages o
                       where o.organization_id = p_org and o.conversation_id = i.conversation_id
                         and o.direction = 'outbound'
                         and o.sent_at > i.sent_at_anterior and o.sent_at < i.sent_at)
          and public.fn_atrito_jaccard(i.body, i.body_anterior) >= p_repeticao_min
      ) as repetidas,
      count(*) filter (
        where i.body_anterior is not null
          and exists (select 1 from public.operational_messages o
                       where o.organization_id = p_org and o.conversation_id = i.conversation_id
                         and o.direction = 'outbound'
                         and o.sent_at > i.sent_at_anterior and o.sent_at < i.sent_at)
      ) as com_resposta_no_meio
      from inbounds i
  ),
  espera_calada as (
    select count(*) filter (where prox.espera_s > p_espera_horas * 3600) as caladas,
           count(*) as com_resposta,
           percentile_cont(0.9) within group (order by prox.espera_s) as p90_s
      from (
        select extract(epoch from (
                 (select min(o.sent_at) from public.operational_messages o
                   where o.organization_id = p_org and o.conversation_id = m.conversation_id
                     and o.direction = 'outbound' and o.sent_at > m.sent_at) - m.sent_at)) as espera_s
          from public.operational_messages m
         where m.organization_id = p_org and m.direction = 'inbound'
           and m.sent_at >= p_from and m.sent_at < p_to
      ) prox
     where prox.espera_s is not null
  ),
  envios as (
    select count(*) filter (where m.sent_via = 'ai')              as por_ia,
           count(*) filter (where m.sent_via = 'automation')      as por_automacao,
           count(*) filter (where m.sent_via = 'system')          as por_integracao,
           count(*) filter (where m.sent_via = 'user')            as por_humano_no_sistema,
           count(*) filter (where m.sent_via = 'external_device') as por_humano_fora
      from public.operational_messages m
     where m.organization_id = p_org and m.direction = 'outbound'
       and m.sent_at >= p_from and m.sent_at < p_to
  ),
  vetos as (
    select count(*) filter (where t.vetoed_gate is not null) as vetados,
           count(distinct t.job_id) as execucoes
      from public.before_send_traces t
     where t.organization_id = p_org and t.created_at >= p_from and t.created_at < p_to
  ),
  descadastros as (
    select count(*) as n from public.contacts c
     where c.organization_id = p_org and c.blocked_at is not null
       and c.blocked_at >= p_from and c.blocked_at < p_to
  ),
  pedidos_humano as (
    select count(*) as n from public.crm_lead_activities a
     where a.organization_id = p_org and a.type = 'handoff_triggered'
       and a.performed_at >= p_from and a.performed_at < p_to
  ),
  -- ─── O LAÇO DE RETORNO DA PASSAGEM (migration 0294) ──────────────────────
  -- A pergunta que mede se o briefing serviu para alguma coisa: DEPOIS de a IA
  -- passar a conversa, o cliente precisou repetir o que já tinha dito? Se o
  -- contexto chegou a quem assumiu, a repetição cai; se não chegou, ela não
  -- muda — e a feature é decoração.
  --
  -- A RÉGUA, escrita para o número não envelhecer:
  --   · limiar         = `p_repeticao_min` (0.7), o MESMO do índice de
  --                      repergunta — dois limiares para o mesmo fenômeno
  --                      fariam dois números incomparáveis na mesma tela;
  --   · janela         = 24 h depois da passagem. Mais que isso já é outra
  --                      conversa; menos deixaria de fora o atendente que
  --                      assumiu no dia seguinte;
  --   · denominador    = passagens em que o cliente VOLTOU A FALAR. Sem fala
  --                      nova não há repetição a medir, e contá-las como "não
  --                      repetiu" inflaria o número para o lado bonito. É a
  --                      mesma regra de `lib/metrics/atrito.ts`: ausência de
  --                      dado é `null`, nunca `0` — e é a razão de as DUAS
  --                      chaves saírem daqui (numerador e denominador), em vez
  --                      de uma razão já calculada.
  repeticao_pos_passagem as (
    select count(*) filter (where r.repetiu) as repetidas,
           count(*)                          as medidas
      from (
        select p.id,
               exists (
                 select 1
                   from public.operational_messages depois
                   join public.operational_messages antes
                     on antes.organization_id = depois.organization_id
                    and antes.conversation_id = depois.conversation_id
                    and antes.direction = 'inbound'
                    and antes.body is not null
                    and antes.sent_at < p.criado_em
                  where depois.organization_id = p.organization_id
                    and depois.conversation_id = p.conversation_id
                    and depois.direction = 'inbound'
                    and depois.body is not null
                    and depois.sent_at > p.criado_em
                    and depois.sent_at < p.criado_em + interval '24 hours'
                    and public.fn_atrito_jaccard(depois.body, antes.body) >= p_repeticao_min
               ) as repetiu
          from public.passagens_de_atendimento p
         where p.organization_id = p_org
           and p.criado_em >= p_from and p.criado_em < p_to
           and exists (
             select 1 from public.operational_messages m
              where m.organization_id = p.organization_id
                and m.conversation_id = p.conversation_id
                and m.direction = 'inbound'
                and m.body is not null
                and m.sent_at > p.criado_em
                and m.sent_at < p.criado_em + interval '24 hours'
           )
      ) r
  ),
  eficiencia as (
    select count(*) filter (where status = 'won')  as ganhos,
           count(*) filter (
             where status = 'lost'
               -- A transferência entre funis não é perda comercial (migration 0266).
               and coalesce(lost_reason, '') <> 'moved_to_another_pipeline'
           ) as perdidos
      from public.crm_leads
     where organization_id = p_org and status in ('won', 'lost')
       and closed_at >= p_from and closed_at < p_to
  )
  select jsonb_build_object(
    'escopo', jsonb_build_object(
      'demandas',            (select count(*) from demandas_j),
      'demandas_com_caso',   (select base from insistencia),
      'demandas_abertas',    (select n from demandas_abertas),
      'de', p_from, 'ate', p_to,
      'abandono_horas', p_abandono_horas,
      'repeticao_min',  p_repeticao_min,
      'espera_horas',   p_espera_horas,
      -- Marca a régua do denominador: quem comparar dois períodos precisa saber
      -- se foram medidos sobre casos ou sobre demandas.
      'denominador', 'demandas'
    ),
    'cliente', jsonb_build_object(
      'turnos_p50',        (select percentile_cont(0.5) within group (order by n) from turnos),
      'turnos_p90',        (select percentile_cont(0.9) within group (order by n) from turnos),
      'insistencia_media', (select media  from insistencia),
      'insistencia_max',   (select maximo from insistencia),
      'pedidos_de_humano', (select n from pedidos_humano),
      'descadastros',      (select n from descadastros),
      'abandonos',         (select abandonadas   from abandono),
      'conversas_com_fala_nossa', (select com_fala_nossa from abandono),
      'reperguntas',              (select repetidas            from repeticao),
      'perguntas_com_resposta',   (select com_resposta_no_meio from repeticao),
      'esperas_caladas',          (select caladas      from espera_calada),
      'esperas_medidas',          (select com_resposta from espera_calada),
      'espera_resposta_p90_s',    (select p90_s        from espera_calada),
      -- As duas chaves do laço da passagem (0294). Numerador e denominador
      -- SEPARADOS de propósito: a razão é calculada na borda, que é onde
      -- mora a regra de devolver `null` quando o denominador é zero.
      'repeticao_pos_passagem',   (select repetidas from repeticao_pos_passagem),
      'passagens_medidas',        (select medidas   from repeticao_pos_passagem)
    ),
    'empresa', jsonb_build_object(
      'intervencoes_por_demanda', (select avg(coalesce(h.intervencoes, 0))::float8
                                     from demandas_j d left join humano h on h.case_id = d.agent_case_id),
      'espera_humana_p50_s',      (select percentile_cont(0.5) within group (order by segundos) from espera_fila),
      'espera_humana_p90_s',      (select percentile_cont(0.9) within group (order by segundos) from espera_fila),
      'retrabalho',               (select n from retrabalho),
      'vetos',                    (select vetados  from vetos),
      'execucoes_medidas',        (select execucoes from vetos),
      'envios_por_ia',            (select por_ia                from envios),
      'envios_por_automacao',     (select por_automacao         from envios),
      'envios_por_integracao',    (select por_integracao        from envios),
      'envios_humano_no_sistema', (select por_humano_no_sistema from envios),
      'envios_humano_fora',       (select por_humano_fora       from envios),
      -- O invariante 4 vira NÚMERO na tela: demanda aberta sem próximo passo é
      -- vazamento, e vazamento invisível é o que a doutrina inteira combate.
      'demandas_sem_proximo_passo', (select n from sem_proximo_passo)
    ),
    'eficiencia', jsonb_build_object(
      'ganhos',   (select ganhos   from eficiencia),
      'perdidos', (select perdidos from eficiencia)
    )
  );
$function$;
revoke all on function public.fn_atrito_metrics(uuid,timestamp with time zone,timestamp with time zone,integer,double precision,integer) from public, anon;
grant execute on function public.fn_atrito_metrics(uuid,timestamp with time zone,timestamp with time zone,integer,double precision,integer) to authenticated, service_role;

-- Agregação operacional permanece sob RLS/projeção, sem retornar configuração.
CREATE OR REPLACE FUNCTION public.fn_attendant_metrics(p_org uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_owner uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with
  lead_agg as (
    select
      owner_user_id as user_id,
      count(*) filter (where status = 'won')  as won,
      count(*) filter (
        where status = 'lost'
          -- A transferência entre funis não é perda comercial (migration 0266).
          and coalesce(lost_reason, '') <> 'moved_to_another_pipeline'
      ) as lost
    from public.crm_leads
    where organization_id = p_org
      and status in ('won', 'lost')
      and closed_at >= p_from and closed_at < p_to
      and owner_user_id is not null
      and (p_owner is null or owner_user_id = p_owner)
    group by owner_user_id
  ),
  conv_agg as (
    select
      assigned_to_user_id as user_id,
      count(*) as conversations_handled
    from public.operational_conversations
    where organization_id = p_org
      and assigned_to_user_id is not null
      and assigned_at >= p_from and assigned_at < p_to
      and (p_owner is null or assigned_to_user_id = p_owner)
    group by assigned_to_user_id
  ),
  -- (0235) Chamada de voz ATENDIDA conta como trabalho.
  --
  -- Quem passa o dia ao telefone tinha produtividade zero nesta função: ela
  -- lia negócios fechados, conversas atribuídas e primeira resposta por
  -- MENSAGEM, e nenhuma das três enxerga uma ligação.
  --
  -- `owner_user_id` é quem esteve NA LINHA (a rota de atender grava; a ponte de
  -- eventos confirma pelo `owner` do upstream) — e não `created_by`, que só
  -- existe na chamada iniciada pelo CRM e diria zero para toda ligação
  -- recebida. `answered_at is not null` é o que separa trabalho de telefone
  -- tocando.
  voice_agg as (
    select
      owner_user_id as user_id,
      count(*) as calls_answered,
      coalesce(sum(duration_ms), 0)::bigint as call_ms
    from public.voice_calls
    where organization_id = p_org
      and owner_user_id is not null
      and answered_at is not null
      and answered_at >= p_from and answered_at < p_to
      and (p_owner is null or owner_user_id = p_owner)
    group by owner_user_id
  ),
  ttfr as (
    select
      c.assigned_to_user_id as user_id,
      avg(extract(epoch from (fr.first_human_out - fr.first_in))) as avg_first_response_seconds
    from public.operational_conversations c
    cross join lateral (
      select
        min(m.sent_at) filter (where m.direction = 'inbound') as first_in,
        min(m.sent_at) filter (
          where m.direction = 'outbound' and m.sent_by_user_id is not null
        ) as first_human_out
      from public.operational_messages m
      where m.conversation_id = c.id
    ) fr
    where c.organization_id = p_org
      and c.assigned_to_user_id is not null
      and (p_owner is null or c.assigned_to_user_id = p_owner)
      and fr.first_in is not null
      and fr.first_human_out is not null
      and fr.first_human_out > fr.first_in
      and fr.first_human_out >= p_from and fr.first_human_out < p_to
    group by c.assigned_to_user_id
  ),
  attendant_ids as (
    select user_id from lead_agg
    union select user_id from conv_agg
    union select user_id from ttfr
    union select user_id from voice_agg
  )
  select jsonb_build_object(
    'funnel', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'stage_id', s.id,
          'stage_name', s.name,
          'position', s.position,
          'count', coalesce(l.cnt, 0)
        ) order by s.position, s.name
      )
      from public.operational_crm_stages s
      left join (
        select stage_id, count(*) as cnt
        from public.crm_leads
        where organization_id = p_org
          and status = 'open'
          and (p_owner is null or owner_user_id = p_owner)
        group by stage_id
      ) l on l.stage_id = s.id
      where s.organization_id = p_org
        and s.is_archived = false
    ), '[]'::jsonb),
    'attendants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', a.user_id,
          'won', coalesce(la.won, 0),
          'lost', coalesce(la.lost, 0),
          'conversations_handled', coalesce(ca.conversations_handled, 0),
          'avg_first_response_seconds', tf.avg_first_response_seconds,
          'calls_answered', coalesce(va.calls_answered, 0),
          'call_seconds', (coalesce(va.call_ms, 0) / 1000)::bigint
        ) order by coalesce(la.won, 0) desc, a.user_id
      )
      from attendant_ids a
      left join lead_agg la on la.user_id = a.user_id
      left join conv_agg ca on ca.user_id = a.user_id
      left join ttfr tf on tf.user_id = a.user_id
      left join voice_agg va on va.user_id = a.user_id
    ), '[]'::jsonb)
  );
$function$;
revoke all on function public.fn_attendant_metrics(uuid,timestamp with time zone,timestamp with time zone,uuid) from public, anon;
grant execute on function public.fn_attendant_metrics(uuid,timestamp with time zone,timestamp with time zone,uuid) to authenticated, service_role;

-- Agregação operacional permanece sob RLS/projeção, sem retornar configuração.
CREATE OR REPLACE FUNCTION public.fn_tags_de_conversa_em_uso(p_org uuid)
 RETURNS TABLE(tag text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select distinct t
  from public.operational_conversations c, unnest(c.tags) as t
  where c.organization_id = p_org
    and c.tags is not null
  order by t
  limit 200;
$function$;
revoke all on function public.fn_tags_de_conversa_em_uso(uuid) from public, anon;
grant execute on function public.fn_tags_de_conversa_em_uso(uuid) to authenticated, service_role;

-- Agregação operacional permanece sob RLS/projeção, sem retornar configuração.
CREATE OR REPLACE FUNCTION public.fn_vocabulario_de_tags(p_org uuid)
 RETURNS TABLE(tag text, uso_em_contatos bigint, uso_em_leads bigint, uso_em_conversas bigint, em_regras bigint, cor text, descricao text, no_vocabulario boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with vocabulario as (
    -- A organização pode guardar o vocabulário de dois jeitos, e os dois contam:
    -- `tags` (a lista com cor e descrição, vinda da tela) e
    -- `canonical_conversation_tags` (as sementes, que a 0244 já usava).
    select
      nullif(btrim(coalesce(entrada.valor ->> 'tag', entrada.valor #>> '{}')), '') as tag,
      nullif(btrim(coalesce(entrada.valor ->> 'cor', '')), '') as cor,
      nullif(btrim(coalesce(entrada.valor ->> 'descricao', '')), '') as descricao
    from public.operational_organizations o
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.settings -> 'tags') = 'array'
           then o.settings -> 'tags' else '[]'::jsonb end
    ) as entrada(valor)
    where o.id = p_org
    union all
    select nullif(btrim(coalesce(semente #>> '{}', '')), ''), null, null
    from public.operational_organizations o
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.settings -> 'canonical_conversation_tags') = 'array'
           then o.settings -> 'canonical_conversation_tags' else '[]'::jsonb end
    ) as semente(valor)
    where o.id = p_org
  ),
  vocabulario_limpo as (
    -- Uma linha por nome canônico. Se a lista curada tem cor/descrição, ela vence
    -- a semente crua.
    select distinct on (lower(v.tag))
           v.tag, v.cor, v.descricao
    from vocabulario v
    where v.tag is not null
    order by lower(v.tag), (v.cor is not null or v.descricao is not null) desc
  ),
  uso as (
    select nullif(btrim(t.valor), '') as tag, 'contatos' as origem
    from public.contacts c, unnest(coalesce(c.tags, '{}'::text[])) as t(valor)
    where c.organization_id = p_org
    union all
    select nullif(btrim(t.valor), ''), 'leads'
    from public.crm_leads l, unnest(coalesce(l.tags, '{}'::text[])) as t(valor)
    where l.organization_id = p_org
    union all
    select nullif(btrim(t.valor), ''), 'conversas'
    from public.operational_conversations v, unnest(coalesce(v.tags, '{}'::text[])) as t(valor)
    where v.organization_id = p_org
  ),
  uso_limpo as (
    select u.tag, u.origem from uso u where u.tag is not null and u.tag <> ''
  ),
  regras as (
    -- As ações `add_tag` dos agentes. É o que o operador NÃO via: a etiqueta
    -- podia ter zero conversas e ainda estar sendo escrita amanhã pela regra.
    -- `r.id` junto: a coluna "Regras de agente" da tela conta REGRAS, e a
    -- exclusão (mais abaixo) conta `distinct r.id`. Sem o id aqui, uma regra com
    -- duas ações `add_tag` da mesma etiqueta aparecia como "2" na lista e como
    -- "1" no resultado da operação — o mesmo rótulo contando coisas diferentes.
    select r.id as regra_id, nullif(btrim(etiqueta.valor #>> '{}'), '') as tag
    from public.automation_rules r
    cross join lateral jsonb_array_elements(coalesce(r.actions, '[]'::jsonb)) as acao(valor)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(acao.valor -> 'config' -> 'tags') = 'array'
           then acao.valor -> 'config' -> 'tags' else '[]'::jsonb end
    ) as etiqueta(valor)
    where r.organization_id = p_org
      and acao.valor ->> 'type' = 'add_tag'
  ),
  regras_limpo as (
    select r.regra_id, r.tag from regras r where r.tag is not null and r.tag <> ''
  ),
  bruto as (
    select tag from vocabulario_limpo
    union all select tag from uso_limpo
    union all select tag from regras_limpo
  ),
  todas as (
    select min(b.tag) as tag, lower(b.tag) as chave
    from bruto b
    where b.tag is not null
    group by lower(b.tag)
  )
  select
    coalesce(v.tag, t.tag) as tag,
    (select count(*) from uso_limpo u
      where lower(u.tag) = t.chave and u.origem = 'contatos') as uso_em_contatos,
    (select count(*) from uso_limpo u
      where lower(u.tag) = t.chave and u.origem = 'leads')    as uso_em_leads,
    (select count(*) from uso_limpo u
      where lower(u.tag) = t.chave and u.origem = 'conversas') as uso_em_conversas,
    (select count(distinct r.regra_id) from regras_limpo r
      where lower(r.tag) = t.chave)                           as em_regras,
    v.cor,
    v.descricao,
    (v.tag is not null)                                       as no_vocabulario
  from todas t
  left join vocabulario_limpo v on lower(v.tag) = t.chave
  order by t.chave
  -- Teto, como na 0244: numa organização bagunçada a união cresce sem limite e
  -- isto vai para uma tela.
  limit 500;
$function$;
revoke all on function public.fn_vocabulario_de_tags(uuid) from public, anon;
grant execute on function public.fn_vocabulario_de_tags(uuid) to authenticated, service_role;
