-- 0500 — Fechar áreas upstream opcionais para clientes gerenciados.
-- Migrations 0458–0475 já foram distribuídas em v1.57.0-mcp e permanecem
-- imutáveis. As tabelas de 1.60/1.61 nasceram depois: gate RESTRICTIVE compõe
-- com as policies oficiais sem ampliar o acesso de tenants legados.
-- O snapshot de área de um cliente existente não contém essas novas áreas:
-- fn_managed_area_allowed falha fechado. Honorários cria tabelas só ao instalar
-- o módulo; a função de provisionamento precisa pôr o gate nesse instante.

do $$
declare gate record;
begin
  for gate in select * from (values
    ('companies', '/app/companies'),
    ('people', '/app/people'),
    ('company_people', '/app/people'),
    ('import_batches', '/app/imports'),
    ('import_rows', '/app/imports'),
    ('crm_proposals', '/app/proposals'),
    ('crm_proposal_items', '/app/proposals'),
    ('proposal_templates', '/app/settings/tenant/proposals/modelos'),
    ('honorarios_contratos', '/app/honorarios'),
    ('honorarios_parcelas', '/app/honorarios')
  ) as t(table_name, area_href) loop
    if to_regclass('public.' || gate.table_name) is null then
      if gate.table_name in ('honorarios_contratos', 'honorarios_parcelas') then continue; end if;
      raise exception 'managed_area_table_missing: %', gate.table_name;
    end if;
    if not exists (select 1 from pg_attribute
       where attrelid = to_regclass('public.' || gate.table_name)
         and attname = 'organization_id' and attnum > 0 and not attisdropped) then
      raise exception 'managed_area_organization_id_missing: %', gate.table_name;
    end if;
    execute format('drop policy if exists managed_area_gate on public.%I', gate.table_name);
    execute format(
      'create policy managed_area_gate on public.%I as restrictive for all to authenticated using (public.fn_managed_area_allowed(organization_id, %L)) with check (public.fn_managed_area_allowed(organization_id, %L))',
      gate.table_name, gate.area_href, gate.area_href
    );
  end loop;
end $$;

-- Reinstala o provisionador oficial com apenas as duas policies acima. O SQL
-- oficial renumerado 0480 permanece intacto; módulo desligado continua sem tabela.
create or replace function public.fn_honorarios_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.honorarios_contratos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,

    -- Preservado mesmo se o lead for excluído (mesma decisão de
    -- `financial_entries.sale_id`): o contrato é registro financeiro e sobrevive
    -- à linha operacional que o originou.
    lead_id uuid references public.crm_leads(id) on delete set null,

    -- `text` + CHECK, não enum (doutrina: enum é difícil de estender).
    modelo text not null check (modelo in ('fixo', 'exito', 'misto')),

    valor_fixo_cents bigint check (valor_fixo_cents is null or valor_fixo_cents > 0),
    percentual_exito numeric(5,2) check (percentual_exito is null or (percentual_exito > 0 and percentual_exito <= 100)),
    repasse_advogado_pct numeric(5,2) check (repasse_advogado_pct is null or (repasse_advogado_pct >= 0 and repasse_advogado_pct <= 100)),

    -- Modelo declara o campo que faz sentido: fixo pede valor, êxito pede
    -- percentual, misto pede os dois. Não impede o resto de ficar em branco.
    constraint honorarios_contratos_modelo_tem_o_campo check (
      (modelo = 'fixo' and valor_fixo_cents is not null)
      or (modelo = 'exito' and percentual_exito is not null)
      or (modelo = 'misto' and valor_fixo_cents is not null and percentual_exito is not null)
    ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists honorarios_contratos_org_idx
    on public.honorarios_contratos (organization_id);
  create index if not exists honorarios_contratos_lead_idx
    on public.honorarios_contratos (organization_id, lead_id) where lead_id is not null;

  create table if not exists public.honorarios_parcelas (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contrato_id uuid not null references public.honorarios_contratos(id) on delete cascade,

    numero integer not null check (numero > 0),
    vencimento date not null,
    valor_cents bigint not null check (valor_cents > 0),

    -- Preservada mesmo se o lançamento do caixa for desfeito — a MESMA decisão
    -- de `financial_entries.sale_id`: o link é conveniência de navegação, nunca
    -- a fonte da verdade do valor ou da data.
    financial_entry_id uuid references public.financial_entries(id) on delete set null,

    status text not null default 'pendente' check (status in ('pendente', 'pago', 'atrasado')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint honorarios_parcelas_numero_unico unique (contrato_id, numero)
  );

  create index if not exists honorarios_parcelas_org_idx
    on public.honorarios_parcelas (organization_id);
  create index if not exists honorarios_parcelas_contrato_idx
    on public.honorarios_parcelas (organization_id, contrato_id);
  create index if not exists honorarios_parcelas_vencimento_idx
    on public.honorarios_parcelas (organization_id, vencimento) where status = 'pendente';

  -- ── RLS POR OPERAÇÃO (D5, ligada aqui e não pela rotina automática) ────────
  -- Molde da 0464 (propostas): uma policy por operação, espelhando as ROTAS,
  -- porque o PostgREST é porta tão aberta quanto elas (o JWT da sessão fala com
  -- ele direto; ver 0150) e o baseline dá GRANT ALL a `authenticated`.
  --   SELECT  qualquer papel da organização (GET /honorarios/... é `viewer`);
  --   INSERT  `manager` (POST de contrato e de parcela é `manager`);
  --   UPDATE  `manager` — nenhuma rota edita, e dinheiro não é coisa que
  --           `agent` configure (mesmo piso do caixa núcleo, migration 0350);
  --   DELETE  `manager`, e PARCELA PAGA NÃO SE APAGA: nem ela, nem o contrato
  --           que a tem (o `on delete cascade` levaria a parcela junto, e a
  --           cascata de FK não passa por RLS).
  -- A policy anterior era UMA só, `for all`, com USING = membro e WITH CHECK =
  -- manager+. DELETE só avalia o USING: `viewer` e `agent` apagavam contrato
  -- (com as parcelas) ou parcela paga (revisão do #1578).
  --
  -- Parcela paga é imutável pela sessão, e a sessão não marca parcela como
  -- paga: `pago` com `financial_entry_id` só nasce em fn_honorarios_parcela_pagar
  -- (definer, dona da tabela, não passa por aqui), que lança o caixa junto.
  -- Deixar a sessão escrever `status`/`financial_entry_id` à mão desfaria esse
  -- par: "pago" sem lançamento, ou "pendente" de novo para pagar duas vezes.
  -- A parcela só aponta para contrato da própria organização (a FK só confere
  -- que o contrato existe).
  alter table public.honorarios_contratos enable row level security;
  drop policy if exists tenant_isolation_honorarios_contratos_all on public.honorarios_contratos;

  drop policy if exists honorarios_contratos_select on public.honorarios_contratos;
  create policy honorarios_contratos_select on public.honorarios_contratos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );

  drop policy if exists honorarios_contratos_insert on public.honorarios_contratos;
  create policy honorarios_contratos_insert on public.honorarios_contratos
    for insert
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));

  drop policy if exists honorarios_contratos_update on public.honorarios_contratos;
  create policy honorarios_contratos_update on public.honorarios_contratos
    for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));

  drop policy if exists honorarios_contratos_delete on public.honorarios_contratos;
  create policy honorarios_contratos_delete on public.honorarios_contratos
    for delete
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and not exists (select 1 from public.honorarios_parcelas p
                            where p.contrato_id = honorarios_contratos.id and p.status = 'pago'));
  revoke all on public.honorarios_contratos from anon;

  alter table public.honorarios_parcelas enable row level security;
  drop policy if exists tenant_isolation_honorarios_parcelas_all on public.honorarios_parcelas;

  drop policy if exists honorarios_parcelas_select on public.honorarios_parcelas;
  create policy honorarios_parcelas_select on public.honorarios_parcelas
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );

  drop policy if exists honorarios_parcelas_insert on public.honorarios_parcelas;
  create policy honorarios_parcelas_insert on public.honorarios_parcelas
    for insert
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and status <> 'pago' and financial_entry_id is null
                and exists (select 1 from public.honorarios_contratos c
                             where c.id = contrato_id
                               and c.organization_id = honorarios_parcelas.organization_id));

  drop policy if exists honorarios_parcelas_update on public.honorarios_parcelas;
  create policy honorarios_parcelas_update on public.honorarios_parcelas
    for update
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and status <> 'pago')
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and status <> 'pago' and financial_entry_id is null
                and exists (select 1 from public.honorarios_contratos c
                             where c.id = contrato_id
                               and c.organization_id = honorarios_parcelas.organization_id));

  drop policy if exists honorarios_parcelas_delete on public.honorarios_parcelas;
  create policy honorarios_parcelas_delete on public.honorarios_parcelas
    for delete
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and status <> 'pago');
  revoke all on public.honorarios_parcelas from anon;

  -- Cliente gerenciado não recebeu Honorários no snapshot do preset. O gate
  -- nasce JUNTO das tabelas, inclusive quando o módulo é instalado depois.
  drop policy if exists managed_area_gate on public.honorarios_contratos;
  create policy managed_area_gate on public.honorarios_contratos as restrictive
    for all to authenticated
    using (public.fn_managed_area_allowed(organization_id, '/app/honorarios'))
    with check (public.fn_managed_area_allowed(organization_id, '/app/honorarios'));
  drop policy if exists managed_area_gate on public.honorarios_parcelas;
  create policy managed_area_gate on public.honorarios_parcelas as restrictive
    for all to authenticated
    using (public.fn_managed_area_allowed(organization_id, '/app/honorarios'))
    with check (public.fn_managed_area_allowed(organization_id, '/app/honorarios'));

  comment on table public.honorarios_contratos is
    'Modelo de cobrança do caso (fixo/êxito/misto). Financeiro real (contas, lançamentos) é o caixa núcleo — este módulo só descreve o contrato.';
  comment on table public.honorarios_parcelas is
    'Calendário de parcelas do contrato. Pagar uma parcela cria um financial_entries e liga por financial_entry_id; não há tabela de "pagamento" própria.';

  -- RLS já ligada por nós, então esta rotina não mexe mais nelas (D5) — só
  -- aplica as travas de suporte, que dependem de RLS já estar de pé.
  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

-- D4: as DUAS origens de EXECUTE (CLAUDE.md, migrations item 9) — o grant a PUBLIC que o
-- Postgres dá ao criar a função, e o `alter default privileges ... to anon` do baseline.
revoke execute on function public.fn_honorarios_provisionar() from public, anon, authenticated;
grant execute on function public.fn_honorarios_provisionar() to service_role;


-- A RPC de pagamento é SECURITY DEFINER e pode ser chamada diretamente pela
-- chave authenticated. Ela precisa repetir o gate da área dentro da função.
create or replace function public.fn_honorarios_parcela_pagar(
  p_org uuid,
  p_parcela uuid,
  p_account_id uuid,
  p_account_plan_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parcela record;
  v_entry uuid;
begin
  if auth.uid() is null or not public.fn_role_at_least(p_org, 'manager')
     or not public.fn_managed_area_allowed(p_org, '/app/honorarios') then
    raise exception 'honorarios_forbidden' using errcode = '42501';
  end if;

  select * into v_parcela from public.honorarios_parcelas
   where id = p_parcela and organization_id = p_org
   for update;

  if not found then
    raise exception 'parcela_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_parcela.status = 'pago' then
    raise exception 'parcela_ja_paga' using errcode = '22023';
  end if;

  -- A conta e o plano vêm do corpo da requisição, e a função é definer: sem esta
  -- conferência a FK aceitaria a conta de OUTRA organização e o dinheiro desta
  -- entraria no extrato de lá. fn_finalizar_comanda resolve a conta pela forma de
  -- pagamento filtrada por p_org; aqui a conta chega direto, então o filtro é este.
  if not exists (
    select 1 from public.financial_accounts
     where id = p_account_id and organization_id = p_org and is_active
  ) then
    raise exception 'conta_invalida' using errcode = '22023';
  end if;
  if p_account_plan_id is not null and not exists (
    select 1 from public.account_plans
     where id = p_account_plan_id and organization_id = p_org and is_active
  ) then
    raise exception 'conta_invalida' using errcode = '22023';
  end if;

  insert into public.financial_entries
    (organization_id, account_id, account_plan_id, direction, amount_cents,
     description, status, paid_at, origin, created_by_user_id)
  values (
    p_org, p_account_id, p_account_plan_id, 'in', v_parcela.valor_cents,
    format('Parcela %s de honorários', v_parcela.numero), 'paid', now(), 'manual', auth.uid()
  )
  returning id into v_entry;

  update public.honorarios_parcelas
     set status = 'pago', financial_entry_id = v_entry
   where id = p_parcela;

  return jsonb_build_object(
    'id', v_parcela.id,
    'contrato_id', v_parcela.contrato_id,
    'numero', v_parcela.numero,
    'valor_cents', v_parcela.valor_cents,
    'status', 'pago',
    'financial_entry_id', v_entry
  );
end;
$$;

revoke execute on function public.fn_honorarios_parcela_pagar(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.fn_honorarios_parcela_pagar(uuid, uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
