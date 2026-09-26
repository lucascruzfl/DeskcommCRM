-- Auditoria do catálogo efetivo: estas RPCs conferiam papel/membership,
-- mas SECURITY DEFINER ignorava a classificação persistida da área.
-- A leitura RAG podia revelar a base privada apesar da RLS de ai_chunks.
-- Workers com service_role conservam a operação; uma sessão com ator
-- autenticado soma o gate de área aos guardas históricos.

CREATE OR REPLACE FUNCTION public.retrieve_top_k_chunks(p_organization_id uuid, p_kb_version_id uuid, p_embedding vector, p_k integer DEFAULT 5, p_threshold real DEFAULT 0.40)
 RETURNS TABLE(chunk_id uuid, knowledge_source_id uuid, content text, similarity real, metadata jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_organization_id, '/app/ai/knowledge/sources') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'viewer') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'retrieve_top_k_chunks: caller must be an active member of the organization';
  end if;

  return query
  select
    c.id as chunk_id,
    c.knowledge_source_id,
    c.content,
    (1 - (c.embedding <=> p_embedding))::real as similarity,
    c.metadata
  from public.ai_chunks c
  where c.organization_id = p_organization_id
    and c.kb_version_id   = p_kb_version_id
    and (1 - (c.embedding <=> p_embedding)) >= p_threshold
  order by c.embedding <=> p_embedding asc
  limit greatest(p_k, 0);
end $function$;

revoke all on function public.retrieve_top_k_chunks(uuid,uuid,vector,integer,real) from public, anon;

grant execute on function public.retrieve_top_k_chunks(uuid,uuid,vector,integer,real) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_buscar_trechos_das_fontes(p_organization_id uuid, p_source_ids uuid[], p_embedding vector, p_k integer DEFAULT 5, p_threshold real DEFAULT 0.40, p_embedding_model text DEFAULT NULL::text)
 RETURNS TABLE(chunk_id uuid, knowledge_source_id uuid, source_name text, content text, similarity real, metadata jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_organization_id, '/app/ai/knowledge/sources') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'viewer') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'fn_buscar_trechos_das_fontes: caller must be an active member of the organization';
  end if;

  return query
  select
    c.id as chunk_id,
    c.knowledge_source_id,
    s.name as source_name,
    c.content,
    (1 - (c.embedding <=> p_embedding))::real as similarity,
    c.metadata
  from public.ai_chunks c
  join public.ai_knowledge_sources s
    on s.id = c.knowledge_source_id
   and s.organization_id = c.organization_id
  join public.ai_knowledge_versions v
    on v.id = c.kb_version_id
  where c.organization_id = p_organization_id
    and s.id = any(p_source_ids)
    and s.is_active
    and s.status = 'ready'
    and c.kb_version_id = s.active_kb_version_id
    and (
      p_embedding_model is null
      or v.embedding_model is null
      or v.embedding_model = p_embedding_model
    )
    and (1 - (c.embedding <=> p_embedding)) >= p_threshold
  order by c.embedding <=> p_embedding asc
  limit greatest(p_k, 0);
end $function$;

revoke all on function public.fn_buscar_trechos_das_fontes(uuid,uuid[],vector,integer,real,text) from public, anon;

grant execute on function public.fn_buscar_trechos_das_fontes(uuid,uuid[],vector,integer,real,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_finalizar_comanda(p_org uuid, p_sale uuid, p_payment_method uuid, p_loyalty_points integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale       public.sales%rowtype;
  v_conta      uuid;
  v_plano      uuid;
  v_total      bigint;
  v_item       record;
  v_entry      uuid;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/comandas') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

  if auth.uid() is null or not public.fn_role_at_least(p_org, 'agent') then
    raise exception 'comanda_forbidden' using errcode = '42501';
  end if;

  -- FOR UPDATE: duas finalizações simultâneas da mesma comanda geravam
  -- lançamento em dobro. O lock é o que torna esta função idempotente de fato,
  -- e não só na intenção.
  select * into v_sale from public.sales
   where id = p_sale and organization_id = p_org
   for update;

  if not found then
    raise exception 'comanda_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_sale.status = 'finalized' then
    -- Não é erro: quem chamou duas vezes recebe o mesmo desfecho.
    return jsonb_build_object('sale_id', v_sale.id, 'ja_finalizada', true);
  end if;
  if v_sale.status = 'cancelled' then
    raise exception 'comanda_cancelada' using errcode = '22023';
  end if;

  select account_id into v_conta from public.payment_methods
   where id = p_payment_method and organization_id = p_org and is_active;
  if not found then
    raise exception 'forma_de_pagamento_invalida' using errcode = '22023';
  end if;
  if v_conta is null then
    -- A forma existe e não diz para onde o dinheiro vai. Recusar aqui é melhor
    -- que escolher uma conta por conta própria.
    raise exception 'forma_sem_conta'
      using errcode = '22023',
            hint = 'Esta forma de pagamento ainda não tem conta de destino. Defina em Configurações → Financeiro.';
  end if;

  select coalesce(sum(total_cents), 0) into v_total
    from public.sale_items where sale_id = p_sale;
  v_total := greatest(v_total - coalesce(v_sale.discount_cents, 0), 0);

  -- (1) a venda
  update public.sales
     set status = 'finalized',
         finalized_at = now(),
         payment_method_id = p_payment_method,
         total_cents = v_total
   where id = p_sale;

  -- (2) a comissão por item, com o percentual CONGELADO na inclusão
  for v_item in
    select * from public.sale_items where sale_id = p_sale and attendant_user_id is not null
  loop
    insert into public.commissions
      (organization_id, sale_item_id, attendant_user_id, percent, amount_cents)
    values (
      p_org, v_item.id, v_item.attendant_user_id, v_item.commission_percent,
      -- Sobre o item, NUNCA sobre o desconto da comanda: um desconto de caixa
      -- não pode reduzir o que quem atendeu combinou.
      floor(v_item.total_cents * v_item.commission_percent / 100.0)
    )
    on conflict (sale_item_id) do nothing;
  end loop;

  -- (3) a entrada na conta que a FORMA DE PAGAMENTO determina
  select id into v_plano from public.account_plans
   where organization_id = p_org and direction = 'in' and is_active
   order by created_at limit 1;

  insert into public.financial_entries
    (organization_id, account_id, account_plan_id, sale_id, direction, amount_cents,
     currency, description, status, paid_at, origin, created_by_user_id)
  values (
    p_org, v_conta, v_plano, p_sale, 'in', greatest(v_total, 1),
    v_sale.currency, format('Comanda #%s', v_sale.number), 'paid', now(), 'sale', auth.uid()
  )
  returning id into v_entry;

  -- (4) o ponto de fidelidade, idempotente pela chave da comanda
  if p_loyalty_points > 0 and v_sale.contact_id is not null then
    insert into public.loyalty_ledger
      (organization_id, contact_id, points, reason, sale_id, idempotency_key, created_by_user_id)
    values (
      p_org, v_sale.contact_id, p_loyalty_points, 'Comanda finalizada', p_sale,
      format('sale:%s', p_sale), auth.uid()
    )
    on conflict do nothing;
  end if;

  -- (5) o agendamento conclui — e SÓ se ainda estiver de pé.
  if v_sale.appointment_id is not null then
    update public.calendar_appointments
       set status = 'completed', outcome_recorded_at = now()
     where id = v_sale.appointment_id
       and organization_id = p_org
       -- A guarda que o sistema de origem não tinha em todos os caminhos:
       -- cancelado e faltou são desfechos DECIDIDOS, e faturar não os desfaz.
       and status not in ('cancelled', 'no_show');
  end if;

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'number', v_sale.number,
    'total_cents', v_total,
    'entry_id', v_entry
  );
end $function$;

revoke all on function public.fn_finalizar_comanda(uuid,uuid,uuid,integer) from public, anon;

grant execute on function public.fn_finalizar_comanda(uuid,uuid,uuid,integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_estornar_comanda(p_org uuid, p_sale uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale   public.sales%rowtype;
  v_orig   public.financial_entries%rowtype;
  v_novo   uuid;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/comandas') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

  if auth.uid() is null or not public.fn_role_at_least(p_org, 'manager') then
    raise exception 'estorno_forbidden' using errcode = '42501';
  end if;

  select * into v_sale from public.sales
   where id = p_sale and organization_id = p_org for update;
  if not found then raise exception 'comanda_nao_encontrada' using errcode = 'P0002'; end if;
  if v_sale.status <> 'finalized' then
    raise exception 'comanda_nao_finalizada' using errcode = '22023';
  end if;
  if v_sale.reversed_at is not null then
    return jsonb_build_object('sale_id', v_sale.id, 'ja_estornada', true);
  end if;

  update public.sales set reversed_at = now(), reverse_reason = p_motivo where id = p_sale;

  -- O contra-lançamento de cada entrada da comanda. A original NÃO é tocada:
  -- ela está paga e é imutável (o trigger acima recusaria).
  for v_orig in
    select * from public.financial_entries
     where sale_id = p_sale and organization_id = p_org and origin = 'sale'
  loop
    insert into public.financial_entries
      (organization_id, account_id, account_plan_id, sale_id, direction, amount_cents,
       currency, description, status, paid_at, origin, reverses_entry_id, created_by_user_id)
    values (
      p_org, v_orig.account_id, v_orig.account_plan_id, p_sale,
      case when v_orig.direction = 'in' then 'out' else 'in' end,
      v_orig.amount_cents, v_orig.currency,
      format('Estorno da comanda #%s', v_sale.number), 'paid', now(), 'reversal',
      v_orig.id, auth.uid()
    )
    returning id into v_novo;
  end loop;

  -- A comissão vira 'reversed' — não some, porque ela existiu e alguém pode já
  -- ter sido pago por ela.
  update public.commissions c
     set status = 'reversed', reversed_at = now()
    from public.sale_items i
   where c.sale_item_id = i.id and i.sale_id = p_sale and c.status <> 'reversed';

  -- E o ponto de fidelidade volta como movimento NEGATIVO, nunca apagando o
  -- ganho: o livro-razão conta as duas coisas.
  insert into public.loyalty_ledger
    (organization_id, contact_id, points, reason, sale_id, idempotency_key, created_by_user_id)
  select p_org, v_sale.contact_id, -l.points, 'Estorno da comanda', p_sale,
         format('reversal:%s', p_sale), auth.uid()
    from public.loyalty_ledger l
   where l.sale_id = p_sale and l.organization_id = p_org and l.points > 0
     and v_sale.contact_id is not null
  on conflict do nothing;

  return jsonb_build_object('sale_id', v_sale.id, 'estornada', true);
end $function$;

revoke all on function public.fn_estornar_comanda(uuid,uuid,text) from public, anon;

grant execute on function public.fn_estornar_comanda(uuid,uuid,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_mesclar_contatos(p_organization_id uuid, p_contato_principal uuid, p_contatos_secundarios uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_principal public.contacts%rowtype;
  v_esperado integer;
  v_achado integer;
  v_alvo record;
  v_linha record;
  v_movidas integer;
  v_pulados integer;
  v_repontado jsonb := '{}'::jsonb;
  v_nao_repontado jsonb := '{}'::jsonb;
  v_nome text;
  v_apelido text;
  v_nascimento date;
  v_email text;
  v_telefone text;
  v_lid text;
  v_tags text[];
  v_leads integer := 0;
  v_service_contact uuid;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_organization_id, '/app/contacts') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

  if not public.fn_support_write_allowed(p_organization_id) then raise exception 'support_readonly' using errcode='42501'; end if;
  -- 1 · Autorização. Fundir é destrutivo na prática: `manager`, o mesmo piso das
  --     policies de `merge_queue`. Sessão de service role (auth.uid() nulo) não
  --     passa por aqui — quem resolve a org nesse caminho é a rota, de fonte
  --     confiável, nunca do body.
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;

  if p_contato_principal is null
     or p_contatos_secundarios is null
     or cardinality(p_contatos_secundarios) = 0
     or p_contato_principal = any(p_contatos_secundarios) then
    raise exception using errcode = '22023', message = 'selecao_de_mesclagem_invalida';
  end if;

  select count(distinct id)::integer into v_esperado
    from unnest(p_contatos_secundarios) as ids(id);
  if v_esperado <> cardinality(p_contatos_secundarios) then
    raise exception using errcode = '22023', message = 'secundario_repetido';
  end if;

  -- A TRAVA DA REGRA "CLIENTES PELA AGENDA" (migration 0262), ANTES DE TODA
  -- OUTRA. O passo 5 reponta `calendar_appointments.contact_id`, e o trigger
  -- desse repontamento pede `pg_advisory_xact_lock_shared(org, 262)` — só que
  -- a esta altura a fusão já segura os contatos (passos 2 e 3).
  -- `fn_definir_cliente_pela_agenda` pega a mesma trava EXCLUSIVA e depois
  -- trava contato por contato. Medido com duas sessões, sem esta linha: a fusão
  -- morria em `deadlock detected` e a rota devolvia 500. Aqui a ordem fica a
  -- mesma das duas funções — a organização primeiro, os contatos depois. Duas
  -- fusões, ou uma fusão e uma marcação, pegam a versão compartilhada e não se
  -- esperam.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(p_organization_id::text, 262));

  -- Mesmo mutex dos atendimentos, ANTES de qualquer row lock.
  for v_service_contact in select distinct id from unnest(array[p_contato_principal]||p_contatos_secundarios) ids(id) order by id loop
    perform public.fn_service_lock(p_organization_id,v_service_contact);
  end loop;
  perform 1 from public.conversations where organization_id=p_organization_id
    and contact_id=any(array[p_contato_principal]||p_contatos_secundarios) order by id for no key update;

  -- Conversa colidente NÃO aborta a fusão. Duas conversas no mesmo
  -- `channel_session_id` é exatamente COMO a duplicata de WhatsApp nasce (dois
  -- cadastros, dois números, o mesmo número de atendimento), então recusar aqui
  -- fecharia o caminho dominante do recurso — medido: o caso ordinário do
  -- `tests/e2e/juntar-contatos-duplicados.spec.ts` virava 409.
  -- Quem trata a colisão é o passo 5: `uniq_conversations_1to1_per_contact_session`
  -- levanta unique_violation, o repontamento cai para linha a linha, a conversa
  -- que não coube FICA na lápide e sai contada em `nao_repontado` — que a rota
  -- devolve e a tela anuncia ("N registro(s) continuaram no cadastro antigo").
  -- Mensagem não se perde: `messages.contact_id` não tem índice único por
  -- contato e passa inteira para o vencedor.

  -- 2 · O principal existe, é desta org, está vivo — e trava até o fim.
  select * into v_principal from public.contacts
   where id = p_contato_principal
     and organization_id = p_organization_id
     and is_merged_into is null
     and is_anonymized = false
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'contato_principal_indisponivel';
  end if;

  -- 3 · Os secundários também. `is_anonymized = false` não é zelo: L-04 é
  --     irreversível, e reencaixar a linha anonimizada num contato ativo a
  --     traria de volta ao atendimento pela porta dos fundos.
  perform 1 from public.contacts
   where id = any(p_contatos_secundarios)
     and organization_id = p_organization_id
     and is_merged_into is null
     and is_anonymized = false
   for update;
  get diagnostics v_achado = row_count;
  if v_achado <> v_esperado then
    raise exception using errcode = 'P0002', message = 'contato_secundario_indisponivel';
  end if;

  -- 4 · A LÁPIDE VEM ANTES de tudo. É ela que solta telefone/e-mail/CPF dos
  --     índices únicos parciais para o vencedor poder herdá-los no passo 6.
  update public.contacts
     set is_merged_into = p_contato_principal,
         merged_at = now(),
         updated_at = now()
   where organization_id = p_organization_id
     and id = any(p_contatos_secundarios);

  -- Cadeia: quem já tinha sido mesclado NUM dos secundários passa a apontar para
  -- o vencedor. Sem isto, `is_merged_into` vira uma corrente que a leitura teria
  -- de percorrer, e ninguém percorre.
  update public.contacts
     set is_merged_into = p_contato_principal
   where organization_id = p_organization_id
     and is_merged_into = any(p_contatos_secundarios);

  -- 5 · Reponta TODO ponteiro para os perdedores. A lista sai do catálogo; o
  --     polimórfico entra à mão porque catálogo nenhum o conhece.
  for v_alvo in
    select n.nspname as esquema, c.relname as tabela, a.attname as coluna, ''::text as filtro
      from pg_catalog.pg_constraint co
      join pg_catalog.pg_class c on c.oid = co.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
     where co.contype = 'f'
       and co.confrelid = 'public.contacts'::regclass
       and co.conrelid <> 'public.contacts'::regclass
       and array_length(co.conkey, 1) = 1
       and c.relkind = 'r'
       and n.nspname = 'public'
    union all
    select 'public', 'crm_lead_links', 'target_id', ' and target_kind = ''contact'''
     where to_regclass('public.crm_lead_links') is not null
    order by 2, 3
  loop
    v_pulados := 0;
    begin
      execute format(
        'update %I.%I set %I = $1 where %I = any($2)%s',
        v_alvo.esquema, v_alvo.tabela, v_alvo.coluna, v_alvo.coluna, v_alvo.filtro
      ) using p_contato_principal, p_contatos_secundarios;
      get diagnostics v_movidas = row_count;
    exception when unique_violation or exclusion_violation then
      -- Colisão REAL e esperada: `uniq_job_queue_one_running_per_contact` deixa
      -- um job 'running' por contato, e os dois lados podem ter um. Em vez de
      -- abortar a fusão inteira por causa de estado efêmero de runtime, reponta
      -- linha a linha e conta quem ficou. Quem fica NÃO vira FK órfã — continua
      -- apontando para a lápide, que existe.
      v_movidas := 0;
      for v_linha in execute format(
        'select ctid as tid from %I.%I where %I = any($1)%s',
        v_alvo.esquema, v_alvo.tabela, v_alvo.coluna, v_alvo.filtro
      ) using p_contatos_secundarios
      loop
        begin
          execute format(
            'update %I.%I set %I = $1 where ctid = $2',
            v_alvo.esquema, v_alvo.tabela, v_alvo.coluna
          ) using p_contato_principal, v_linha.tid;
          v_movidas := v_movidas + 1;
        exception when unique_violation or exclusion_violation then
          v_pulados := v_pulados + 1;
        end;
      end loop;
    end;

    if v_movidas > 0 then
      v_repontado := v_repontado
        || jsonb_build_object(v_alvo.tabela || '.' || v_alvo.coluna, v_movidas);
    end if;
    if v_pulados > 0 then
      v_nao_repontado := v_nao_repontado
        || jsonb_build_object(v_alvo.tabela || '.' || v_alvo.coluna, v_pulados);
    end if;
  end loop;

  -- 6 · O principal MANDA; o que ele não tem, vem dos perdedores. Nunca o
  --     contrário: sobrescrever o que o atendente digitou seria fusão com
  --     surpresa, e fusão não tem desfazer.
  select c.name into v_nome from public.contacts c
   where c.id = any(p_contatos_secundarios) and c.name is not null
   order by c.created_at, c.id limit 1;
  select c.display_name into v_apelido from public.contacts c
   where c.id = any(p_contatos_secundarios) and c.display_name is not null
   order by c.created_at, c.id limit 1;
  select c.birthdate into v_nascimento from public.contacts c
   where c.id = any(p_contatos_secundarios) and c.birthdate is not null
   order by c.created_at, c.id limit 1;
  select c.email into v_email from public.contacts c
   where c.id = any(p_contatos_secundarios) and c.email is not null
   order by c.created_at, c.id limit 1;
  select c.phone_number into v_telefone from public.contacts c
   where c.id = any(p_contatos_secundarios) and c.phone_number is not null
   order by c.created_at, c.id limit 1;
  -- `wa_identity`/`wa_lid` são GERADAS: o que se herda é a origem delas. Sem
  -- isto o WhatsApp do perdedor fica órfão — `fn_upsert_wa_contact` filtra
  -- `is_merged_into is null`, não acharia mais ninguém e criaria um contato
  -- novo na mensagem seguinte, refazendo a duplicata que acabou de ser desfeita.
  select c.source_metadata->>'waha_lid' into v_lid from public.contacts c
   where c.id = any(p_contatos_secundarios)
     and c.source_metadata->>'waha_lid' is not null
   order by c.created_at, c.id limit 1;

  -- Guardas de unicidade. A lápide já tirou os perdedores dos índices parciais,
  -- então o que sobrar aqui é conflito com um TERCEIRO contato vivo — e nesse
  -- caso o vencedor simplesmente não herda o campo. Falhar a fusão inteira por
  -- causa de um e-mail seria perder o repontamento que já valeu a pena.
  if v_email is not null and exists (
    select 1 from public.contacts o
     where o.organization_id = p_organization_id and o.is_merged_into is null
       and o.id <> p_contato_principal and o.email_normalized = lower(btrim(v_email))
  ) then v_email := null; end if;
  if v_telefone is not null and exists (
    select 1 from public.contacts o
     where o.organization_id = p_organization_id and o.is_merged_into is null
       and o.id <> p_contato_principal and o.phone_number = v_telefone
  ) then v_telefone := null; end if;
  if v_lid is not null and exists (
    select 1 from public.contacts o
     where o.organization_id = p_organization_id and o.is_merged_into is null
       and o.id <> p_contato_principal and o.wa_lid = v_lid
  ) then v_lid := null; end if;

  select coalesce(array_agg(distinct t), '{}'::text[]) into v_tags
    from (
      select unnest(c.tags) as t from public.contacts c
       where c.organization_id = p_organization_id
         and (c.id = p_contato_principal or c.id = any(p_contatos_secundarios))
    ) as todas;

  -- CPF e `consent` NÃO são herdados, de propósito. CPF é um PAR
  -- (`cpf_encrypted` + `cpf_hash`) preso por check constraint e criptografado
  -- com a chave da instalação — mover metade quebra a linha. `consent` é
  -- registro legal do que AQUELA pessoa autorizou; herdar um "granted_at" de
  -- outro cadastro fabricaria consentimento. Falha fechada nos dois.
  update public.contacts set
    name = coalesce(name, v_nome),
    display_name = coalesce(display_name, v_apelido),
    birthdate = coalesce(birthdate, v_nascimento),
    email = coalesce(email, v_email),
    phone_number = coalesce(phone_number, v_telefone),
    tags = v_tags,
    last_activity_at = greatest(
      last_activity_at,
      (select max(c.last_activity_at) from public.contacts c
        where c.id = any(p_contatos_secundarios))
    ),
    source_metadata = (
      case when source_metadata->>'waha_lid' is null and v_lid is not null
        then source_metadata || jsonb_build_object('waha_lid', v_lid)
        else source_metadata end
    )
      - case when coalesce(phone_number, v_telefone) is not null
             then 'telefone_em_conflito' else '' end
      || jsonb_build_object(
           'mesclado_de',
           coalesce(source_metadata->'mesclado_de', '[]'::jsonb)
             || to_jsonb(p_contatos_secundarios),
           'mesclado_em', to_jsonb(now())
         ),
    updated_at = now()
  where id = p_contato_principal and organization_id = p_organization_id;

  -- 7 · A fusão aparece na timeline de cada negócio que o vencedor passou a ter.
  --     `crm_lead_activities.lead_id` é NOT NULL — contato sem negócio nenhum
  --     não tem onde escrever, e para esse caso quem guarda o rastro é o
  --     `api_audit_log` que a rota emite, sempre.
  insert into public.crm_lead_activities
    (organization_id, lead_id, contact_id, source_module, source_id, type,
     payload, metadata, performed_at, performed_by_user_id)
  select p_organization_id, l.id, p_contato_principal, 'crm', p_contato_principal,
         'contacts_merged',
         jsonb_build_object(
           'contatos_mesclados', to_jsonb(p_contatos_secundarios),
           'repontado', v_repontado,
           'nao_repontado', v_nao_repontado
         ),
         '{}'::jsonb, now(), auth.uid()
    from public.crm_leads l
   where l.organization_id = p_organization_id
     and l.contact_id = p_contato_principal;
  get diagnostics v_leads = row_count;

  return jsonb_build_object(
    'contato_id', p_contato_principal,
    'contatos_mesclados', to_jsonb(p_contatos_secundarios),
    'repontado', v_repontado,
    'nao_repontado', v_nao_repontado,
    'atividades_emitidas', v_leads
  );
end;
$function$;

revoke all on function public.fn_mesclar_contatos(uuid,uuid,uuid[]) from public, anon;

grant execute on function public.fn_mesclar_contatos(uuid,uuid,uuid[]) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_definir_cliente_pela_agenda(p_org uuid, p_ligado boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings jsonb;
  v_antes boolean;
  v_contato uuid;
  v_r text;
  v_ganharam integer := 0;
  v_perderam integer := 0;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/contacts') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

  if auth.uid() is null
     or p_org is null
     or p_ligado is null
     or not public.fn_role_at_least(p_org, 'admin')
     or not public.fn_support_write_allowed(p_org) then
    raise exception 'cliente_pela_agenda_forbidden' using errcode = '42501';
  end if;
  if not public.fn_session_mfa_proven() then
    raise exception 'cliente_pela_agenda_mfa_required' using errcode = '42501';
  end if;

  -- EXCLUSIVA, ANTES de ler qualquer coisa: espera todo INSERT/UPDATE de
  -- agendamento desta organização que já passou pelo trigger (e segura a
  -- compartilhada até commitar), e faz os seguintes esperarem esta transação.
  -- Os comandos abaixo tiram snapshot novo e enxergam o que já commitou.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 262));

  -- Sem `for update` na linha da organização: a exclusiva acima já serializa
  -- esta função consigo mesma e com o trigger, e a trava de linha barraria todo
  -- insert com FK para a organização durante o laço. O UPDATE abaixo toma só a
  -- trava que não conflita com essas FKs.
  select o.settings into v_settings
    from public.organizations o
   where o.id = p_org;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  v_antes := (v_settings -> 'crm' -> 'cliente_pela_agenda') = 'true'::jsonb;

  -- Mescla dentro de `crm`: o que mais morar ali (hoje nada) não é apagado, e
  -- um `crm` que não seja objeto é substituído em vez de abortar.
  update public.organizations
     set settings = jsonb_set(
           coalesce(settings, '{}'::jsonb),
           '{crm}',
           (case when jsonb_typeof(settings -> 'crm') = 'object' then settings -> 'crm' else '{}'::jsonb end)
             || jsonb_build_object('cliente_pela_agenda', p_ligado),
           true)
   where id = p_org;

  -- O histórico, SÓ na virada desligado → ligado, SÓ desta organização.
  if p_ligado and v_antes is not true then
    for v_contato in
      select c.id
        from public.contacts c
       where c.organization_id = p_org
         and c.is_anonymized = false
         and c.is_merged_into is null
         and (c.first_service_at is not null
              or exists (select 1 from public.calendar_appointments a
                          where a.organization_id = p_org and a.contact_id = c.id))
       order by c.id
    loop
      v_r := public.fn_recalcular_cliente_do_contato(p_org, v_contato, false);
      if v_r = 'etiquetado' then
        v_ganharam := v_ganharam + 1;
      elsif v_r = 'desetiquetado' then
        v_perderam := v_perderam + 1;
      end if;
    end loop;
  end if;

  -- O QUARTO NÚMERO EXISTE PARA A TELA NÃO MENTIR. Medido: numa organização
  -- cujo único contato TEM horário marcado, todos cancelados, o corpo era
  -- `{ganharam: 0, perderam: 0, clientes: 0}` — e a última frase de
  -- `components/agenda/ClientePelaAgenda.tsx` dizia "Nenhum contato tinha
  -- horário marcado ainda". Numa clínica com cancelamentos, que é o nicho que
  -- esta migration cita, essa é a primeira frase depois de ligar. Zero
  -- etiquetas novas tem QUATRO causas, e esta é a única que os outros três
  -- números não distinguem.
  return jsonb_build_object(
    'ligado', p_ligado,
    'mudou', coalesce(v_antes, false) <> p_ligado,
    'ganharam_etiqueta', v_ganharam,
    'perderam_etiqueta', v_perderam,
    'clientes', (select count(*) from public.contacts
                  where organization_id = p_org and first_service_at is not null
                    and is_anonymized = false and is_merged_into is null),
    'com_agendamento_que_nao_conta', (
      select count(*) from public.contacts c
       where c.organization_id = p_org
         and c.first_service_at is null
         and c.is_anonymized = false and c.is_merged_into is null
         and exists (select 1 from public.calendar_appointments a
                      where a.organization_id = p_org and a.contact_id = c.id))
  );
end $function$;

revoke all on function public.fn_definir_cliente_pela_agenda(uuid,boolean) from public, anon;

grant execute on function public.fn_definir_cliente_pela_agenda(uuid,boolean) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_passagem_devolvida(p_organization_id uuid, p_conversation_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_fechadas integer;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_organization_id, '/app/inbox') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

  -- Mesmo padrão de `fn_conversation_assign`: quando há sessão, ela precisa ser
  -- de um membro `agent`+ da organização. Sem sessão (worker com service key) a
  -- checagem não se aplica — quem tem a chave já tem tudo.
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'caller must be an active agent+ member of the organization';
  end if;

  if auth.uid() is not null and not exists (
    select 1 from public.conversations c
      where c.organization_id = p_organization_id and c.id = p_conversation_id
        and public.fn_can_view_conversation(c.organization_id, c.assigned_to_user_id)
  ) then raise exception 'conversation_not_available' using errcode='42501'; end if;

  update public.passagens_de_atendimento
     set reconhecido_em = now()
   where organization_id = p_organization_id
     and conversation_id = p_conversation_id
     and reconhecido_em is null;
  get diagnostics v_fechadas = row_count;

  update public.agent_inbox_items
     set status = 'resolved',
         resolved_at = now()
   where organization_id = p_organization_id
     and kind = 'handoff'
     and ref_kind = 'conversation'
     and ref_id = p_conversation_id
     and status = 'open';

  return v_fechadas;
end;
$function$;

revoke all on function public.fn_passagem_devolvida(uuid,uuid) from public, anon;

grant execute on function public.fn_passagem_devolvida(uuid,uuid) to authenticated, service_role;

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

  return next v_conv;
end;
$function$;

revoke all on function public.fn_conversation_assign(uuid,uuid,uuid,text,uuid,boolean) from public, anon;

grant execute on function public.fn_conversation_assign(uuid,uuid,uuid,text,uuid,boolean) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_google_selection(p_org uuid, p_revisions jsonb, p_sources uuid[], p_destination uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=auth.uid(); expected jsonb; actual jsonb;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/agenda') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

 if actor is null or not public.fn_role_at_least(p_org,'agent') or not public.fn_support_write_allowed(p_org) then raise exception 'google_selection_forbidden' using errcode='42501';end if;
 if not public.fn_session_mfa_proven() then raise exception 'google_mfa_required' using errcode='42501';end if;
 perform 1 from public.user_organizations where organization_id=p_org and user_id=actor and revoked_at is null for update;
 if not found then raise exception 'google_owner_unavailable' using errcode='42501';end if;
 select jsonb_agg(value order by value->>'connection_id') into expected from jsonb_array_elements(p_revisions);
 select jsonb_agg(jsonb_build_object('connection_id',id,'revision',calendar_selection_revision::text) order by id::text) into actual from public.calendar_connections where organization_id=p_org and user_id=actor and provider='google_calendar';
 if actual is distinct from expected then raise exception 'google_selection_stale' using errcode='40001';end if;
 if not exists(select 1 from public.calendar_connection_calendars k join public.calendar_connections c on c.id=k.connection_id and c.organization_id=k.organization_id
  where k.organization_id=p_org and k.id=p_destination and c.user_id=actor and c.status='healthy' and k.available and k.access_role in ('owner','writer')) then raise exception 'google_destination_unavailable' using errcode='42501';end if;
 if exists(select 1 from unnest(p_sources) selected(id) where not exists(select 1 from public.calendar_connection_calendars k join public.calendar_connections c on c.id=k.connection_id and c.organization_id=k.organization_id
  where k.organization_id=p_org and k.id=selected.id and c.user_id=actor and c.status='healthy' and k.available and k.access_role in ('owner','writer','reader','writerWithoutPrivateAccess'))) then raise exception 'google_source_unavailable' using errcode='42501';end if;
 update public.calendar_connection_calendars k set is_destination=false from public.calendar_connections c where k.organization_id=p_org and c.organization_id=p_org and k.connection_id=c.id and c.user_id=actor;
 update public.calendar_connection_calendars k set is_destination=k.id=p_destination,counts_for_conflicts=k.id=any(p_sources),sync_next_attempt_at=now() from public.calendar_connections c where k.organization_id=p_org and c.organization_id=p_org and k.connection_id=c.id and c.user_id=actor;
 update public.calendar_connections set calendar_selection_revision=calendar_selection_revision+1 where organization_id=p_org and user_id=actor and provider='google_calendar';
end;$function$;

revoke all on function public.fn_google_selection(uuid,jsonb,uuid[],uuid) from public, anon;

grant execute on function public.fn_google_selection(uuid,jsonb,uuid[],uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_google_resolve(p_org uuid, p_id uuid, p_revision text, p_local_revision text, p_etag text, p_choice text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.calendar_appointments; contact uuid;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/agenda') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

 if auth.uid() is null or not public.fn_role_at_least(p_org,'agent') or not public.fn_support_write_allowed(p_org) then raise exception 'google_resolution_forbidden' using errcode='42501';end if;
 if not public.fn_session_mfa_proven() then raise exception 'google_mfa_required' using errcode='42501';end if;
 select contact_id into contact from public.calendar_appointments where organization_id=p_org and id=p_id;
 if contact is not null then perform public.fn_service_lock(p_org,contact);end if;
 select * into a from public.calendar_appointments where organization_id=p_org and id=p_id for update;
 if not found or a.owner_user_id is distinct from auth.uid() then raise exception 'google_resolution_forbidden' using errcode='42501';end if;
 if a.revision::text is distinct from p_revision or a.google_local_revision::text is distinct from p_local_revision
  or a.google_etag is distinct from p_etag then raise exception 'google_stale' using errcode='40001';end if;
 if p_choice='retry' then
  if a.google_conflict is not null then raise exception 'google_conflict_requires_choice' using errcode='40001';end if;
  update public.calendar_appointments set google_next_attempt_at=now() where organization_id=p_org and id=p_id;
 else
  if p_choice not in ('google','local','preserve_remote') or a.google_conflict is null then raise exception 'google_choice_invalid' using errcode='22023';end if;
  -- O trigger reconhece somente esta forma autenticada: o corpo da comparação
  -- e as revisões não mudam, actor_id é auth.uid(), não input do browser.
  update public.calendar_appointments set google_conflict=google_conflict||jsonb_build_object('resolution',jsonb_build_object('choice',p_choice,'actor_id',auth.uid())),google_next_attempt_at=now()
   where organization_id=p_org and id=p_id;
 end if;
end;$function$;

revoke all on function public.fn_google_resolve(uuid,uuid,text,text,text,text) from public, anon;

grant execute on function public.fn_google_resolve(uuid,uuid,text,text,text,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_meet_action(p_org uuid, p_id uuid, p_revision text, p_request uuid, p_action text, p_conversation uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.calendar_appointments; contact uuid; b jsonb; destination_channel uuid;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/agenda') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

 if auth.uid() is null or not public.fn_role_at_least(p_org,'agent') or not public.fn_support_write_allowed(p_org) then raise exception 'meet_forbidden' using errcode='42501';end if;
 if not public.fn_session_mfa_proven() then raise exception 'meet_mfa_required' using errcode='42501';end if;
 select contact_id into contact from public.calendar_appointments where organization_id=p_org and id=p_id;
 if contact is not null then perform public.fn_service_lock(p_org,contact);end if;
 select * into a from public.calendar_appointments where organization_id=p_org and id=p_id for update;
 if not found or a.owner_user_id is distinct from auth.uid() or not exists(select 1 from public.user_organizations where organization_id=p_org and user_id=auth.uid() and revoked_at is null) then raise exception 'meet_forbidden' using errcode='42501';end if;
 if a.revision::text is distinct from p_revision or a.meeting_request_id is distinct from p_request or a.status='cancelled'
  or exists(select 1 from public.contacts where id=a.contact_id and organization_id=p_org and is_anonymized) then raise exception 'meet_stale' using errcode='PT409';end if;
 if p_action='retry' then
  if a.google_conflict is not null then raise exception 'google_conflict_requires_choice' using errcode='PT409';end if;
  if a.meeting_state='ready' then return false;end if;
  if a.meeting_state<>'failed' then
   update public.calendar_appointments set meeting_next_attempt_at=now(),google_next_attempt_at=now() where organization_id=p_org and id=p_id;return true;
  end if;
  -- Tempo/timeout não provam rejeição. Somente failure recebido gira solicitação.
  update public.calendar_appointments set meeting_request_id=case when meeting_last_error='google_failure' and meeting_received_at is not null then gen_random_uuid() else meeting_request_id end,
   meeting_requested_at=case when meeting_last_error='google_failure' and meeting_received_at is not null then null else meeting_requested_at end,
   meeting_received_at=case when meeting_last_error='google_failure' then null else meeting_received_at end,
   meeting_state='pending',meeting_attempts=0,meeting_last_error=null,meeting_next_attempt_at=now(),google_next_attempt_at=now() where organization_id=p_org and id=p_id;
 elsif p_action in ('deliver','resend') then
  if a.contact_id is null then raise exception 'meet_conversation_unavailable' using errcode='42501';end if;
  select channel_session_id into destination_channel from public.conversations where organization_id=p_org and id=p_conversation and contact_id=a.contact_id and not is_group and public.fn_can_view_conversation(organization_id,assigned_to_user_id) for update;
  if not found then raise exception 'meet_conversation_unavailable' using errcode='42501';end if;
  b:=public.fn_service_boundary(p_org,p_conversation)-'status'-'demanda_fechada_em'-'service_started_at';
  if not public.fn_meet_boundary_current(b) then raise exception 'meet_conversation_stale' using errcode='PT409';end if;
  if a.meeting_delivery->'service_boundary'=b and a.meeting_delivery->>'channel_session_id'=destination_channel::text then
   -- ⛔ ESTE `return false` É A PROTEÇÃO CONTRA CLIQUE DUPLO, e é por isso que o
   -- reenvio é uma AÇÃO NOVA em vez de um ramo reescrito. Ele impede a mesma
   -- mensagem de sair duas vezes por um clique nervoso; se o botão "Enviar de
   -- novo" apenas reescrevesse este ramo, ganharíamos o reenvio e perderíamos a
   -- proteção — e envio em dobro para cliente é pior que não-envio.
   -- `deliver` continua exatamente como era; `resend` passa reto, e quem o
   -- dispara já confirmou na tela.
   if p_action='deliver' and a.meeting_delivery->>'state' in ('waiting_for_link','sent') then return false;end if;
   if a.meeting_delivery->>'state'='queued' and a.meeting_delivery_job_id is not null then
    -- Recuperação humana de job morto conserva ledger/identidade. Não duplicar
    -- uma mensagem aceita antes do crash nem reconstruir fronteira antiga.
    update public.job_queue set status='pending',locked_by=null,locked_at=null,attempts=0,run_after=now(),last_error=null
     where organization_id=p_org and id=a.meeting_delivery_job_id and kind='transactional_delivery' and status in ('dead','failed','done');
    return found;
   end if;
  end if;
  update public.job_queue set status='failed',locked_by=null,locked_at=null,last_error='meet_delivery_superseded' where organization_id=p_org and id=a.meeting_delivery_job_id and kind='transactional_delivery' and status in ('pending','running');
  update public.calendar_appointments set meeting_delivery=jsonb_build_object('state','waiting_for_link','generation',gen_random_uuid(),'service_boundary',b,'authorized_by',jsonb_build_object('kind','user','id',auth.uid()),'source_operation_id',gen_random_uuid()),meeting_delivery_job_id=null where organization_id=p_org and id=p_id;
 else raise exception 'meet_action_invalid' using errcode='22023';end if;
 return true;
end;$function$;

revoke all on function public.fn_meet_action(uuid,uuid,text,uuid,text,uuid) from public, anon;

grant execute on function public.fn_meet_action(uuid,uuid,text,uuid,text,uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_reply_action(p_org uuid, p_id uuid, p_revision text, p_action text, p_body text DEFAULT NULL::text, p_feedback text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.ai_reply_drafts;contact uuid;jid uuid;a uuid;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/inbox') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

 if auth.uid() is null or not public.fn_role_at_least(p_org,'agent') or not public.fn_support_write_allowed(p_org) or not public.fn_session_mfa_proven() then raise exception 'reply_forbidden' using errcode='42501';end if;
 select contact_id,agent_id into contact,a from public.ai_reply_drafts where organization_id=p_org and id=p_id;
 if contact is null then raise exception 'reply_forbidden' using errcode='42501';end if;
 perform public.fn_service_lock(p_org,contact);
 perform 1 from public.ai_agents where organization_id=p_org and id=a for share;
 perform 1 from public.conversations c join public.ai_reply_drafts r on r.organization_id=c.organization_id and r.conversation_id=c.id where r.organization_id=p_org and r.id=p_id and public.fn_can_view_conversation(c.organization_id,c.assigned_to_user_id) for share of c;
 if not found then raise exception 'reply_forbidden' using errcode='42501';end if;
 select * into d from public.ai_reply_drafts where organization_id=p_org and id=p_id for update;
 if d.status in('approved','sending','sent') and p_action='approve' and d.approved_by=auth.uid() and d.approved_body=p_body then return d.send_job_id;end if;
 if d.revision::text is distinct from p_revision or d.status<>'pending' or not public.fn_reply_context_current(p_org,p_id) then raise exception 'reply_stale' using errcode='40001';end if;
 if p_action='reject' then
 update public.ai_reply_drafts set status='dismissed',feedback=jsonb_build_object('decision','rejected','reason',left(p_feedback,1000)),revision=revision+1,updated_at=now() where id=p_id and organization_id=p_org;return null;
 elsif p_action='approve' then
 if p_body is null or length(trim(p_body))=0 or length(p_body)>12000 then raise exception 'reply_body_invalid' using errcode='22023';end if;
 jid:=gen_random_uuid();
 insert into public.job_queue(id,organization_id,contact_id,kind,payload,run_after) values(jid,p_org,contact,'approved_reply',jsonb_build_object('draft_id',d.id,'service_boundary',d.service_boundary),now());
 update public.ai_reply_drafts set status='approved',edited_body=p_body,approved_body=p_body,approved_by=auth.uid(),approved_at=now(),approved_support_session_id=case when public.fn_support_context()->>'organization_id'=p_org::text then (public.fn_support_context()->>'id')::uuid else null end,send_job_id=jid,
 feedback=jsonb_build_object('decision',case when p_body is distinct from original_body then 'edited' else 'approved' end,'reason',left(p_feedback,1000),'correction',case when p_body is distinct from original_body then p_body else null end),revision=revision+1,updated_at=now()
 where id=p_id and organization_id=p_org;return jid;
 end if;
 raise exception 'reply_action_invalid' using errcode='22023';
end;$function$;

revoke all on function public.fn_reply_action(uuid,uuid,text,text,text,text) from public, anon;

grant execute on function public.fn_reply_action(uuid,uuid,text,text,text,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_agenda_settings(p_org uuid, p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/settings/tenant/agenda') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

  if auth.uid() is null
     or not public.fn_role_at_least(p_org, 'manager')
     or not public.fn_support_write_allowed(p_org) then
    raise exception 'agenda_settings_forbidden' using errcode = '42501';
  end if;

  -- Portão de MFA (migration 0229). Prazos de agenda são configuração que muda
  -- o comportamento do produto para a organização inteira.
  if not public.fn_session_mfa_proven() then
    raise exception 'agenda_mfa_required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_config->'confirmation_delay_minutes') is distinct from 'number'
     or jsonb_typeof(p_config->'unknown_protection_minutes') is distinct from 'number'
     or (p_config - 'confirmation_delay_minutes'
                  - 'unknown_protection_minutes'
                  - 'pending_expires_after_minutes') <> '{}'::jsonb
     or (p_config->>'confirmation_delay_minutes' ~ '^[0-9]{1,5}$') is not true
     or (p_config->>'unknown_protection_minutes' ~ '^[0-9]{1,5}$') is not true
     or (p_config->>'confirmation_delay_minutes')::int not between 1 and 10080
     or (p_config->>'unknown_protection_minutes')::int not between 1 and 10080
     or (p_config->>'unknown_protection_minutes')::int
        < (p_config->>'confirmation_delay_minutes')::int
  then
    raise exception 'agenda_settings_invalid' using errcode = '22023';
  end if;

  if p_config ? 'pending_expires_after_minutes' then
    if jsonb_typeof(p_config->'pending_expires_after_minutes') is distinct from 'number'
       or (p_config->>'pending_expires_after_minutes' ~ '^[0-9]{1,5}$') is not true
       or (p_config->>'pending_expires_after_minutes')::int not between 15 and 10080
    then
      raise exception 'agenda_settings_invalid' using errcode = '22023';
    end if;
  end if;

  update public.organizations
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{agenda}', p_config, true)
   where id = p_org;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  return p_config;
end; $function$;

revoke all on function public.fn_agenda_settings(uuid,jsonb) from public, anon;

grant execute on function public.fn_agenda_settings(uuid,jsonb) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_lgpd_anonymize_contact(p_organization_id uuid, p_contact_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.contacts; support jsonb;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_organization_id, '/app/lgpd/requests') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

 support:=public.fn_support_context();
 if auth.uid() is null or not public.fn_support_write_allowed(p_organization_id)
  or not (public.fn_role_at_least(p_organization_id,'admin') or (public.fn_is_platform_admin() and support is null)) then
  raise exception 'contact_anonymize_forbidden' using errcode='42501';
 end if;
 if not public.fn_session_mfa_proven() then raise exception 'contact_anonymize_mfa_required' using errcode='42501';end if;
 perform public.fn_service_lock(p_organization_id,p_contact_id);
 select * into c from public.contacts where organization_id=p_organization_id and id=p_contact_id for update;
 if not found then raise exception 'contact_not_found' using errcode='P0002';end if;
 if c.is_anonymized then return jsonb_build_object('already_anonymized',true,'anonymized_at',c.anonymized_at);end if;
 update public.contacts set name=null,display_name='Contato Anonimizado #'||substring(p_contact_id::text from 1 for 8),
  email=null,phone_number=null,cpf_encrypted=null,cpf_hash=null,birthdate=null,
  is_anonymized=true,anonymized_at=now(),updated_at=now()
  where organization_id=p_organization_id and id=p_contact_id returning * into c;
 return jsonb_build_object('already_anonymized',false,'anonymized_at',c.anonymized_at);
end;$function$;

revoke all on function public.fn_lgpd_anonymize_contact(uuid,uuid) from public, anon;

grant execute on function public.fn_lgpd_anonymize_contact(uuid,uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_vocabulario_de_tags_operar(p_org uuid, p_acao text, p_tag text, p_destino text, p_cor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tag     text := btrim(coalesce(p_tag, ''));
  v_destino text := btrim(coalesce(p_destino, ''));
  -- A cor entra normalizada (minúscula, sem espaço). A rota valida com Zod antes;
  -- esta linha defende o caminho que NÃO passa por ela — RPC direta, psql, um
  -- cliente futuro. Sem isso, `#FFF` gravaria e a comparação por igualdade da
  -- tela (que compara o que o servidor devolveu) passaria a mentir.
  v_cor     text := lower(btrim(coalesce(p_cor, '')));
  v_remover boolean;
  v_so_cor  boolean;
  v_contatos integer := 0;
  v_leads integer := 0;
  v_conversas integer := 0;
  v_regras integer := 0;
  v_id uuid;
  v_ids uuid[];
  v_settings jsonb;
  v_antes jsonb;
  v_depois jsonb;
  v_definido boolean := false;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/settings/tags') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;
  -- Renomear/unir/excluir também reescreve automation_rules: não é só atendimento.
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/ai/followups') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

  -- Portão de papel ANTES de qualquer escrita. Definer com p_org vindo da rota:
  -- é esta linha que separa o tenant de quem chama.
  if p_org is null or not public.fn_role_at_least(p_org, 'manager') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;

  if p_acao is null or p_acao not in ('renomear', 'juntar', 'excluir', 'definir_cor') then
    raise exception using errcode = '22023', message = 'acao_invalida';
  end if;
  if v_tag = '' then
    raise exception using errcode = '22023', message = 'tag_obrigatoria';
  end if;
  v_remover := (p_acao = 'excluir');
  v_so_cor  := (p_acao = 'definir_cor');
  if not v_remover and not v_so_cor and v_destino = '' then
    raise exception using errcode = '22023', message = 'destino_obrigatorio';
  end if;
  -- `v_cor` vazio é pedido legítimo ("sem cor"): limpa. O que não passa é cor
  -- malformada — gravar `#12` e devolver `#12` para a tela pintar deixaria o
  -- chip sem cor sem ninguém saber por quê.
  if v_so_cor and v_cor <> '' and v_cor !~ '^#[0-9a-f]{6}$' then
    raise exception using errcode = '22023', message = 'cor_invalida';
  end if;

  -- ── POR QUE NÃO SAI EVENTO DAQUI ──────────────────────────────────────────
  --
  -- Os laços abaixo CONTAM as linhas alteradas e não emitem nada em `event_log`.
  -- A primeira versão emitia `contact.tags_changed` / `lead.tags_changed` /
  -- `conversation.tags_changed` POR LINHA, e nenhum desses tipos tem consumidor:
  -- `lib/event-log/register-handlers.ts` registra 13 handlers e nenhum os
  -- declara; o motor de automação ouve `lead.tag_added`/`contact.tag_added`, que
  -- é outro tipo (e disparar automação num renomear em lote seria pior que não
  -- disparar). Evento sem consumidor é o anti-pattern 3 do CLAUDE.md, e aqui
  -- custava milhares de linhas dentro de UMA transação, num log que nada drena e
  -- nada expurga.
  --
  -- Quem registra a operação é o AUDIT LOG, na borda: `tag_vocabulary.changed`
  -- em `app/api/v1/tags/vocabulario/route.ts`, com os contadores que este corpo
  -- devolve. E a tela aberta se atualiza pelo Realtime das próprias tabelas.

  -- ── (z) A COR SAI ANTES DOS LAÇOS, E NÃO É OTIMIZAÇÃO ─────────────────────
  --
  -- Cor é atributo do VOCABULÁRIO, não das linhas: `contacts.tags`,
  -- `crm_leads.tags` e `conversations.tags` continuam `text[]` de nomes, porque
  -- automação, webhook (`lead.tag_added`) e MCP (`*.tags_changed`) falam em
  -- string há versões (contrato da fatia S4). Então a ação `definir_cor` não tem
  -- o que reescrever em contatos, leads nem conversas — e os laços abaixo, se
  -- rodassem, custariam uma varredura das três tabelas para devolver zero.
  --
  -- O bloco de `canonical_conversation_tags` (mais abaixo) é pior que inútil
  -- aqui: ele troca o nome da semente por `v_destino` e descarta o que sobra
  -- vazio — com `destino` nulo nesta ação, a semente seria APAGADA. Daí o
  -- `return` cedo: nesta ação, só o vocabulário curado muda.
  if v_so_cor then
    select coalesce(o.settings, '{}'::jsonb) into v_settings
    from public.organizations o where o.id = p_org;
    if v_settings is null then
      v_settings := '{}'::jsonb;
    end if;

    -- (a) tolera `settings.tags` torto (escalar/objeto): a leitura já tolera com
    -- `jsonb_typeof`, e sem esta guarda o `jsonb_array_elements` levantava
    -- `cannot extract elements from a scalar` e derrubava a tela inteira numa
    -- organização com o dado malformado. Lista que não é lista é lista vazia.
    v_antes := case
      when jsonb_typeof(v_settings -> 'tags') = 'array' then v_settings -> 'tags'
      else '[]'::jsonb
    end;
    v_depois := coalesce(
      (
        select jsonb_agg(entrada.valor order by entrada.ord)
        from (
          -- Uma entrada por chave canônica, agora acrescentando a cor na que
          -- casar. A entrada que era string vira objeto — a mesma forma que o
          -- rename já grava (mais abaixo, `jsonb_build_object('tag', …)`) — e
          -- `descricao` que já existia é PRESERVADA: esta ação fala de cor.
          --
          -- ⚠️ O desempate é o MESMO da função de leitura
          -- (`fn_vocabulario_de_tags`, `order by … (cor is not null or descricao
          -- is not null) desc`), e de propósito: onde a lista curada já tiver a
          -- mesma etiqueta duas vezes (uma como string, outra como objeto com
          -- cor), quem sobrevive é a entrada que carrega o metadado. Ordenar só
          -- por `ord` apagaria a cor na primeira vez que a ação rodasse sobre um
          -- vocabulário nesse estado, e a tela mostraria "sem cor" logo depois de
          -- alguém ter escolhido uma.
          select distinct on (lower(x.chave)) x.valor, x.ord
          from (
            select btrim(coalesce(e.valor ->> 'tag', e.valor #>> '{}')) as chave,
                   case
                     when lower(btrim(coalesce(e.valor ->> 'tag', e.valor #>> '{}'))) = lower(v_tag)
                     then case
                            when nullif(v_cor, '') is null
                            then (case when jsonb_typeof(e.valor) = 'string'
                                       then jsonb_build_object('tag', e.valor #>> '{}')
                                       else e.valor end) - 'cor'
                            else jsonb_set(
                                   case when jsonb_typeof(e.valor) = 'string'
                                        then jsonb_build_object('tag', e.valor #>> '{}')
                                        else e.valor end,
                                   '{cor}', to_jsonb(v_cor))
                          end
                     else case when jsonb_typeof(e.valor) = 'string'
                               then jsonb_build_object('tag', e.valor #>> '{}')
                               else e.valor end
                   end as valor,
                   e.ord
            from jsonb_array_elements(v_antes) with ordinality as e(valor, ord)
            where btrim(coalesce(e.valor ->> 'tag', e.valor #>> '{}')) <> ''
          ) x
          where x.valor is not null
          order by lower(x.chave),
                   ((x.valor ->> 'cor') is not null or (x.valor ->> 'descricao') is not null) desc,
                   x.ord
        ) as entrada
      ),
      '[]'::jsonb
    );

    -- A etiqueta que ainda não tinha entrada no vocabulário curado — semente, ou
    -- nome que só existe em uso (`no_vocabulario = false` na leitura) — GANHA
    -- uma. É deliberado: dar cor é curar. Sem isto, a tela ofereceria cor para
    -- uma etiqueta que continuaria marcada como "em uso, fora do vocabulário", e
    -- a leitura devolveria a cor de uma linha que não está na lista curada.
    if nullif(v_cor, '') is not null and not exists (
      select 1 from jsonb_array_elements(v_depois) as e(valor)
      where lower(btrim(coalesce(e.valor ->> 'tag', e.valor #>> '{}'))) = lower(v_tag)
    ) then
      v_depois := v_depois || jsonb_build_array(jsonb_build_object('tag', v_tag, 'cor', v_cor));
    end if;

    if v_depois <> v_antes then
      v_settings := jsonb_set(v_settings, '{tags}', v_depois);
      update public.organizations o
         set settings = v_settings,
             updated_at = now()
       where o.id = p_org;
      v_definido := true;
    end if;

    return jsonb_build_object(
      'acao', p_acao,
      'tag', v_tag,
      'destino', null,
      'cor', nullif(v_cor, ''),
      'contatos', 0,
      'leads', 0,
      'conversas', 0,
      'regras', 0,
      'alterou', v_definido
    );
  end if;

  -- (a) contatos
  for v_id in
    with alvo as (
      select c.id, public.fn_tags_normalizar(c.tags, v_tag, v_destino, v_remover) as novas
      from public.contacts c
      where c.organization_id = p_org
        and exists (
          select 1 from unnest(coalesce(c.tags, '{}'::text[])) as x(valor)
          where lower(btrim(x.valor)) = lower(v_tag)
        )
    ), mudou as (
      update public.contacts c
         set tags = a.novas
        from alvo a
       where c.id = a.id
         and c.tags is distinct from a.novas
      returning c.id
    )
    select id from mudou
  loop
    v_contatos := v_contatos + 1;
  end loop;

  -- (b) leads
  for v_id in
    with alvo as (
      select l.id, public.fn_tags_normalizar(l.tags, v_tag, v_destino, v_remover) as novas
      from public.crm_leads l
      where l.organization_id = p_org
        and exists (
          select 1 from unnest(coalesce(l.tags, '{}'::text[])) as x(valor)
          where lower(btrim(x.valor)) = lower(v_tag)
        )
    ), mudou as (
      update public.crm_leads l
         set tags = a.novas
        from alvo a
       where l.id = a.id
         and l.tags is distinct from a.novas
      returning l.id
    )
    select id from mudou
  loop
    v_leads := v_leads + 1;
  end loop;

  -- (c) conversas
  for v_id in
    with alvo as (
      select v.id, public.fn_tags_normalizar(v.tags, v_tag, v_destino, v_remover) as novas
      from public.conversations v
      where v.organization_id = p_org
        and exists (
          select 1 from unnest(coalesce(v.tags, '{}'::text[])) as x(valor)
          where lower(btrim(x.valor)) = lower(v_tag)
        )
    ), mudou as (
      update public.conversations v
         set tags = a.novas
        from alvo a
       where v.id = a.id
         and v.tags is distinct from a.novas
      returning v.id
    )
    select id from mudou
  loop
    v_conversas := v_conversas + 1;
  end loop;

  -- (d) as regras dos agentes — o ponto da issue.
  --
  -- `excluir` NÃO apaga a regra: quem exclui a etiqueta é avisado de quantas
  -- regras a escrevem (o número volta no jsonb e a tela pede confirmação), mas
  -- apagar `add_tag` de um agente em produção é decisão de outra tela. Aqui a
  -- lista da regra só é reescrita quando o nome muda ou quando ele sai.
  select coalesce(o.settings, '{}'::jsonb) into v_settings
  from public.organizations o where o.id = p_org;

  if v_settings is null then
    v_settings := '{}'::jsonb;
  end if;

  if not v_remover then
    with alvo as (
      select r.id,
             jsonb_agg(
               case
                 when a.valor ->> 'type' = 'add_tag'
                  and jsonb_typeof(a.valor -> 'config' -> 'tags') = 'array'
                 then jsonb_set(
                        a.valor,
                        '{config,tags}',
                        to_jsonb(public.fn_tags_normalizar(
                          array(select jsonb_array_elements_text(a.valor -> 'config' -> 'tags')),
                          v_tag, v_destino, false
                        ))
                      )
                 else a.valor
               end
               order by a.ord
             ) as novas
      from public.automation_rules r
      cross join lateral jsonb_array_elements(coalesce(r.actions, '[]'::jsonb))
        with ordinality as a(valor, ord)
      where r.organization_id = p_org
      -- ⚠️ `group by r.id` E SÓ. Agrupar também pelo TIPO da ação devolvia uma
      -- linha por (regra, tipo), cada uma com `novas` = só o subconjunto daquele
      -- tipo; o `update ... from alvo` casava as duas linhas, o Postgres usava
      -- UMA arbitrária, e `is distinct from` é sempre verdadeiro num subconjunto
      -- — então a regra com ações de dois tipos era TRUNCADA a um tipo só, em
      -- toda organização, mesmo que ela nunca tenha citado a etiqueta renomeada.
      -- Medido num Postgres real: regra com `add_tag` + `assign_owner` ficava com
      -- uma ação, e a tela dizia "atualizada em 1 regra(s) de agente".
      group by r.id
    ), mudou as (
      update public.automation_rules r
         set actions = alvo.novas,
             updated_at = now()
        from alvo
       where r.id = alvo.id
         and r.actions is distinct from alvo.novas
      returning r.id
    )
    select count(*) into v_regras from mudou;
  else
    -- Exclusão: conta as regras que ainda escrevem a etiqueta, sem tocar nelas.
    select count(distinct r.id) into v_regras
    from public.automation_rules r
    cross join lateral jsonb_array_elements(coalesce(r.actions, '[]'::jsonb)) as a(valor)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(a.valor -> 'config' -> 'tags') = 'array'
           then a.valor -> 'config' -> 'tags' else '[]'::jsonb end
    ) as e(valor)
    where r.organization_id = p_org
      and a.valor ->> 'type' = 'add_tag'
      and lower(btrim(e.valor #>> '{}')) = lower(v_tag);
  end if;

  -- (e) o vocabulário da organização, nos dois lugares onde ele mora.
  -- Mesma guarda do ramo de renomear: `settings.tags` malformado não pode
  -- derrubar a cor (a leitura tolera; a escrita agora também).
  v_antes := case
    when jsonb_typeof(v_settings -> 'tags') = 'array' then v_settings -> 'tags'
    else '[]'::jsonb
  end;
  v_depois := coalesce(
    (
      select jsonb_agg(entrada.valor order by entrada.ord)
      from (
        -- Dedupe pela chave DEPOIS da substituição (mesma razão de
        -- `fn_tags_normalizar`): juntar duas entradas de chaves diferentes num
        -- nome só deixava as duas no vocabulário, agora com o mesmo `tag`.
        --
        -- ⚠️ `cor` e `descricao` da entrada sobrevivem ao rename: o `jsonb_set`
        -- mexe só em `{tag}`. Renomear não é perder a cor que alguém escolheu.
        select distinct on (lower(x.chave)) x.valor, x.ord
        from (
          select case
                   when v_remover then null
                   when lower(btrim(coalesce(e.valor ->> 'tag', e.valor #>> '{}'))) = lower(v_tag)
                     then v_destino
                   else btrim(coalesce(e.valor ->> 'tag', e.valor #>> '{}'))
                 end as chave,
                 case
                   when v_remover then null
                   when lower(btrim(coalesce(e.valor ->> 'tag', e.valor #>> '{}'))) = lower(v_tag)
                     then jsonb_set(
                            case when jsonb_typeof(e.valor) = 'string' then jsonb_build_object('tag', e.valor #>> '{}')
                                 else e.valor end,
                            '{tag}', to_jsonb(v_destino))
                   else case when jsonb_typeof(e.valor) = 'string' then jsonb_build_object('tag', e.valor #>> '{}')
                             else e.valor end
                 end as valor,
                 e.ord
          from jsonb_array_elements(v_antes) with ordinality as e(valor, ord)
          where btrim(coalesce(e.valor ->> 'tag', e.valor #>> '{}')) <> ''
        ) x
        where x.valor is not null and coalesce(x.chave, '') <> ''
        order by lower(x.chave), x.ord
      ) as entrada
      where entrada.valor is not null
    ),
    '[]'::jsonb
  );
  if v_depois <> v_antes then
    v_settings := jsonb_set(v_settings, '{tags}', v_depois);
    v_definido := true;
  end if;

  v_antes := coalesce(v_settings -> 'canonical_conversation_tags', '[]'::jsonb);
  v_depois := coalesce(
    (
      select jsonb_agg(semente.valor order by semente.ord)
      from (
        -- Dedupe pela chave DEPOIS da substituição, como acima.
        select distinct on (lower(y.valor)) y.valor, y.ord
        from (
          select case
                   when v_remover then null
                   when lower(btrim(s.valor #>> '{}')) = lower(v_tag) then v_destino
                   else btrim(s.valor #>> '{}')
                 end as valor,
                 s.ord
          from jsonb_array_elements(v_antes) with ordinality as s(valor, ord)
          where btrim(s.valor #>> '{}') <> ''
        ) y
        where coalesce(y.valor, '') <> ''
        order by lower(y.valor), y.ord
      ) as semente
      where semente.valor is not null
    ),
    '[]'::jsonb
  );
  if v_depois <> v_antes then
    v_settings := jsonb_set(v_settings, '{canonical_conversation_tags}', v_depois);
    v_definido := true;
  end if;

  if v_definido then
    update public.organizations o
       set settings = v_settings,
           updated_at = now()
     where o.id = p_org;
  end if;

  return jsonb_build_object(
    'acao', p_acao,
    'tag', v_tag,
    'destino', nullif(v_destino, ''),
    'cor', null,
    'contatos', v_contatos,
    'leads', v_leads,
    'conversas', v_conversas,
    'regras', v_regras,
    'alterou', (v_contatos + v_leads + v_conversas + v_regras > 0 or v_definido)
  );
end;
$function$;

revoke all on function public.fn_vocabulario_de_tags_operar(uuid,text,text,text,text) from public, anon;

grant execute on function public.fn_vocabulario_de_tags_operar(uuid,text,text,text,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_definir_colegas_podem_mexer_na_agenda(p_org uuid, p_ligado boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_atual boolean; v_linhas int;
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/settings/tenant/agenda') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;

 if p_ligado is null then raise exception 'agenda_dos_colegas_invalido' using errcode='22023'; end if;
 if auth.uid() is null
    or not public.fn_role_at_least(p_org,'manager')
    or not public.fn_support_write_allowed(p_org) then
  raise exception 'agenda_dos_colegas_forbidden' using errcode='42501';
 end if;
 if not public.fn_session_mfa_proven() then raise exception 'mfa_required' using errcode='42501'; end if;
 v_atual := public.fn_colegas_podem_mexer_na_agenda(p_org);
 if v_atual is not distinct from p_ligado then
  return jsonb_build_object('ligado',v_atual,'mudou',false);
 end if;
 update public.organizations
    set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('colegas_podem_mexer_na_agenda',to_jsonb(p_ligado))
  where id = p_org;
 get diagnostics v_linhas = row_count;
 if v_linhas = 0 then raise exception 'agenda_dos_colegas_sem_organizacao' using errcode='P0002'; end if;
 return jsonb_build_object('ligado',p_ligado,'mudou',true);
end; $function$;

revoke all on function public.fn_definir_colegas_podem_mexer_na_agenda(uuid,boolean) from public, anon;

grant execute on function public.fn_definir_colegas_podem_mexer_na_agenda(uuid,boolean) to authenticated, service_role;


create or replace function public.fn_appointment_change(p_org uuid, p_id uuid, p_revision bigint, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.fn_managed_area_allowed(p_org, '/app/agenda') then
    raise exception 'managed_area_denied' using errcode = '42501';
  end if;
  return public.fn_appointment_change_core(p_org, p_id, p_revision, p_patch, false, null);
end;
$$;
revoke all on function public.fn_appointment_change(uuid,uuid,bigint,jsonb) from public, anon;
grant execute on function public.fn_appointment_change(uuid,uuid,bigint,jsonb) to authenticated;

-- A validação de perda roda como trigger da escrita operacional. A base de
-- funis já está fechada na 0419; leia o vocabulário projetado, sem perder a regra.

CREATE OR REPLACE FUNCTION public.fn_validate_lost_reason_required()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_canonical text[] := array['requested_by_customer','price','no_response','product_unavailable',
                              'cancelled_by_store','cancelled_by_customer','payment_failed','other',
                              'moved_to_another_pipeline'];
  v_pipeline_extra text[];
begin
  if new.status = 'lost' then
    if new.lost_reason is null or length(new.lost_reason) = 0 then
      raise exception 'lost_reason_required' using errcode = '22023';
    end if;

    select coalesce(
      array(select jsonb_array_elements_text(settings->'lost_reasons')), '{}'::text[]
    ) into v_pipeline_extra
    from public.operational_crm_pipelines where id = new.pipeline_id;

    if not (new.lost_reason = any (v_canonical) or new.lost_reason = any (v_pipeline_extra)) then
      raise exception 'lost_reason_invalid: %', new.lost_reason using errcode = '22023';
    end if;
  end if;
  return new;
end$function$;

-- Leitura da agenda respeita a mesma área; nenhum segredo OAuth é retornado.
CREATE OR REPLACE FUNCTION public.fn_google_coverage(p_org uuid, p_owner uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select case when auth.uid() is not null and (p_org not in(select public.fn_user_org_ids()) or not public.fn_managed_area_allowed(p_org,'/app/agenda')) then true else exists(
  select 1 from public.calendar_connection_calendars k join public.calendar_connections c on c.organization_id=k.organization_id and c.id=k.connection_id
  where k.organization_id=p_org and c.user_id=p_owner and k.counts_for_conflicts and (
   not k.available or c.status<>'healthy' or k.access_role not in ('owner','writer','reader','writerWithoutPrivateAccess') or k.sync_coverage is null or k.sync_error is not null or k.last_sync_at is null or k.last_sync_at<now()-interval '30 minutes'
   or (k.sync_coverage->>'window_start')::timestamptz>p_start or (k.sync_coverage->>'window_end')::timestamptz<p_end)) end;
$function$;
revoke all on function public.fn_google_coverage(uuid,uuid,timestamp with time zone,timestamp with time zone) from public, anon;
grant execute on function public.fn_google_coverage(uuid,uuid,timestamp with time zone,timestamp with time zone) to authenticated, service_role;

-- Leitura da agenda respeita a mesma área; nenhum segredo OAuth é retornado.
CREATE OR REPLACE FUNCTION public.fn_google_counts_for_conflicts(p_org uuid, p_connection uuid, p_calendar text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 -- ⚠️ FALHA ABERTO na AUSÊNCIA de catálogo, e a direção é deliberada.
 -- A forma `exists(... and counts_for_conflicts)` exigia linha em
 -- calendar_connection_calendars para o evento contar. Antes desta migration os
 -- três leitores (grade, semente da página e o motor de horários livres) liam
 -- `calendar_external_events` DIRETO: toda ocupação contava. Numa conexão cujo
 -- catálogo ainda não foi montado — ou cujo calendário saiu do catálogo com os
 -- eventos ainda gravados — a ocupação sumia da grade E deixava de bloquear o
 -- horário. O erro barato é mostrar "Ocupado" a mais; o caro é marcar por cima
 -- de uma consulta que existe. A negativa só vale quando alguém a declarou.
 select (auth.uid() is null or (p_org in (select public.fn_user_org_ids()) and public.fn_managed_area_allowed(p_org,'/app/agenda'))) and not exists(
  select 1 from public.calendar_connection_calendars where organization_id=p_org and connection_id=p_connection and external_calendar_id=p_calendar and not counts_for_conflicts);
$function$;
revoke all on function public.fn_google_counts_for_conflicts(uuid,uuid,text) from public, anon;
grant execute on function public.fn_google_counts_for_conflicts(uuid,uuid,text) to authenticated, service_role;

-- Leitura da agenda respeita a mesma área; nenhum segredo OAuth é retornado.
CREATE OR REPLACE FUNCTION public.fn_agenda_ocupacao_google_do_dono(p_org uuid, p_owner uuid, p_de timestamp with time zone, p_ate timestamp with time zone)
 RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone, transparency text, status text, connection_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.starts_at, e.ends_at, e.transparency, e.status, c.status
    from public.calendar_selected_external_events e
    join public.calendar_connections c
      on c.organization_id = e.organization_id
     and c.id = e.connection_id
   where (auth.uid() is null
          or p_org in (select public.fn_user_org_ids())
          or public.fn_is_platform_admin())
     and (auth.uid() is null or public.fn_managed_area_allowed(p_org,'/app/agenda'))
     and e.organization_id = p_org
     and c.user_id = p_owner
     -- Cruzamento ESTRITO, a régua de `colide`: encostar não é ocupar.
     and e.starts_at < p_ate
     and e.ends_at > p_de;
$function$;
revoke all on function public.fn_agenda_ocupacao_google_do_dono(uuid,uuid,timestamp with time zone,timestamp with time zone) from public, anon;
grant execute on function public.fn_agenda_ocupacao_google_do_dono(uuid,uuid,timestamp with time zone,timestamp with time zone) to authenticated, service_role;

-- Leitura da agenda respeita a mesma área; nenhum segredo OAuth é retornado.
CREATE OR REPLACE FUNCTION public.fn_agenda_conexoes_google_do_dono(p_org uuid, p_owner uuid)
 RETURNS TABLE(status text, last_sync_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.status, c.last_sync_at
    from public.calendar_connections c
   where (auth.uid() is null
          or p_org in (select public.fn_user_org_ids())
          or public.fn_is_platform_admin())
     and c.organization_id = p_org
     and c.user_id = p_owner
     and (auth.uid() is null or public.fn_managed_area_allowed(p_org,'/app/agenda'));
$function$;
revoke all on function public.fn_agenda_conexoes_google_do_dono(uuid,uuid) from public, anon;
grant execute on function public.fn_agenda_conexoes_google_do_dono(uuid,uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_colegas_podem_mexer_na_agenda(p_org uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if auth.uid() is not null and not public.fn_managed_area_allowed(p_org,'/app/agenda') then
  raise exception 'managed_area_denied' using errcode='42501';
 end if;
 if auth.uid() is not null and public.fn_user_role_in_org(p_org) is null then
  raise exception 'organization_not_available' using errcode='42501';
 end if;
 return coalesce(
   (select (o.settings->'colegas_podem_mexer_na_agenda') is distinct from 'false'::jsonb
      from public.organizations o where o.id = p_org),
   true);
end;
$function$;
revoke all on function public.fn_colegas_podem_mexer_na_agenda(uuid) from public, anon;
grant execute on function public.fn_colegas_podem_mexer_na_agenda(uuid) to authenticated, service_role;
