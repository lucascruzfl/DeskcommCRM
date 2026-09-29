# Cliente gerenciado — criação e gestão pela agência

Use quando a agência precisar criar uma organização para outra pessoa ou administrar um tenant
managed existente. Contrato conferido na base `mcp/stable` em
`4431d9cf5155449610b2bdb604d7f317d1aa741d`, após Fase 6 e Etapa 7A. Para revalidar no clone,
consulte `lib/managed-clients/presets.ts`, `policy.ts`, `onboarding.ts`, `lib/mcp/auth.ts` e
`lib/mcp/tools/managed-clients.ts`; o catálogo recebido por `tools/list` decide o que o token pode usar.

## Preset de áreas e pacote operacional são etapas diferentes

Os presets **managed** existem no registro oficial:

| Preset | Tipo de negócio | Uso |
| --- | --- | --- |
| `managed/aesthetic-clinic` | `aesthetic_clinic` | Clínica de estética gerenciada; não é o preset de toda clínica/consultório |
| `managed/internet-provider` | `internet_provider` | Provedor de internet gerenciado; calendário OFF inicialmente |

Eles persistem uma política por área. O snapshot aplicado à organização continua sendo a
autoridade; uma atualização do código não troca silenciosamente seus acessos. O preset ISP
por si só não cria operação. Após o onboarding, com token do provedor alvo,
`crm_configure_managed_internet_provider`
planeja e, com confirmação, instala funil, motivos, campos e vocabulário de tags.
Agentes, roteador, follow-ups e integrações exigem implantação posterior.

| Classificação | Significado operacional |
| --- | --- |
| `client` | Área de trabalho do cliente, ainda sujeita aos papéis e guards existentes |
| `agency` | Configuração técnica/comercial reservada ao membership admin da organização |
| `shared` | Área compartilhada entre agência e cliente, respeitando o RBAC de cada ação |
| `not_applicable` | Área bloqueada inicialmente, inclusive para o gestor admin |

Menu visível não concede permissão. A política alcança página, API, server action, MCP e RLS.
No ISP, Inbox, Contatos, Funis, Tarefas e métricas são client; Produtos, Equipe e casos humanos
são shared; configuração de IA, etapas do funil, conexões e tokens são agency. Agenda, tipos de
agendamento, Financeiro da organização e Faturamento são not_applicable. A clínica tem sua
própria classificação: não copie o perfil ISP sobre ela. Consulte as áreas retornadas pela tool
para a lista completa, com papel mínimo e bloqueios atuais.

## Quem pode criar

**Somente platform_admin ativo com scope `full` cria cliente gerenciado.** Admin comum do tenant,
manager e agent não criam. `requiresRole: manager` na definição da tool é apenas um dos gates,
não autorização suficiente.

O MCP exige token de API com `mcp:write`, `capability:managed_client_onboarding` e identidade real
do provisionador, revalidada em `platform_admins`. O provisionador precisa de membership aceito,
não revogado, admin ou manager na organização de origem. Se usa scopes granulares, precisa também
de `settings:write`; se usa allowlist `tool:`, a tool deve estar incluída. Num tenant managed,
a policy agency exige role admin do token, dentro do teto do membership atual.

Bearer não traz prova AAL2: se a política do platform_admin exige MFA, o fluxo atual bloqueia a
criação (`mfa_session_required`). Não desligue MFA para contornar a recusa. Não existe bypass por
impersonation, papel escrito no pedido ou token universal.

## Fluxo oficial pelo MCP

1. **Descobrir** com `crm_list_managed_client_presets` (agent + `mcp:read`; também sujeito a
   scopes/área). Confira ID, tipo, áreas e `executable`; isso não garante elegibilidade do ator.
2. **Planejar** com `crm_preflight_managed_client`: `business_type`, `management_mode: managed`,
   `name`, `slug`, `client_email` e, normalmente, `overrides: []`. Leia `can_execute`, conflitos,
   avisos, papéis e ações humanas. Não cria organização, membership ou convite.
   Overrides são planejamento e **não são executáveis** no onboarding atual.
3. **Mostrar o plano** à pessoa e obter confirmação explícita para criar e enviar o convite,
   caso ainda não exista autorização no pedido. Use dados fornecidos pela pessoa no ambiente
   autorizado; exemplos e documentação nunca carregam dados de clientes reais.
4. **Criar** com `crm_create_managed_client`: `organization_name`, `preset`, `client_email`,
   `slug` opcional, `idempotency_key` opcional e `confirm: true`. O schema difere do preflight.
   Com `confirm: false`, devolve só preflight, mas continua exigindo os gates da tool de escrita.
5. **Conferir o resultado**: organização criada, convite oficial enviado para o cliente como
   **agent** e membership permanente **admin** do gestor. `completed` confirma o provisionamento
   e envio; não confirma aceite do convite nem conclusão do wizard da organização.
6. **Continuar no tenant certo**: o gestor entra pelo **organization switcher**, conclui o wizard
   e configura as áreas agency. A pessoa convidada aceita pelo fluxo oficial e opera com seu
   próprio membership. Cliente agent não recebe acesso ao wizard.

Sem transporte de e-mail configurado, o preflight avisa `email_delivery_not_configured` e bloqueia
a execução. Falha no envio pode devolver `retryable`; repita o mesmo pedido com a mesma chave
para retomar o recibo, sem duplicar a organização. Chave reaproveitada com outro pedido/preset
conflita. Consulte a trilha em **Audit Log** (`/app/audit`); o resultado não expõe link secreto do
convite ou erro interno do banco.

## Gestão posterior

A criação é a exceção privilegiada para provisionar o tenant. A gestão cotidiana usa
**membership oficial + organization switcher**, com RBAC e policy managed de cada organização.
O token original continua vinculado ao tenant de origem: trocar a organização na tela não muda
o tenant do token. Se houver automação MCP no novo tenant, use token próprio dessa organização,
com scopes e teto de role adequados. Sem impersonation e sem supertoken cross-tenant.

Teste o seletor para gestor e cliente, o acesso às áreas permitidas e a recusa das áreas agency
para o cliente. No ISP, prove também calendário OFF e financeiro de assinantes indisponível.
Billing, fatura, boleto, PIX, confirmação de pagamento e desbloqueio precisam de integração real
futura. A assinatura da plataforma é configuração da agência, sem equivalência com a fatura do
assinante. Agenda para instalação/visita poderá entrar depois, com política e capacidades
revisadas; o onboarding atual não oferece override executável para ligá-la.
