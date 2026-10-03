# Propostas — matriz de paridade v1.62.0

> Estado final validado em 2026-10-03: gaps A conhecidos = 0 e todos os gates finais verdes.
> Resultados completos em [revisão local](PARITY-1.62.0-REVIEW.md), seção Fechamento validado.
> Menções a gates pendentes abaixo são checkpoints históricos anteriores ao fechamento.

## Estado vigente — fase 2, 2026-10-03

A auditoria atual está em [Propostas fase 2](PROPOSTAS-FASE2-1.62.0.md)
e [revisão diferencial final](DELTA-1.57-1.62-FINAL.md).
Os gaps A conhecidos estão cobertos localmente; os gates amplos finais ainda
estão pendentes. As seções abaixo preservam os checkpoints anteriores.

## Retomada local — 2026-10-02

O estado abaixo desta seção é o checkpoint histórico recuperado. Nesta retomada,
foram implementadas `crm_list_proposals`, `crm_get_proposal`,
`crm_update_draft_proposal` e `crm_list_honorarios_contratos` em
`lib/mcp/tools/parity-162.ts`, registradas pelo agregador existente e pelo
catálogo. Esses quatro gaps A estão cobertos localmente; a paridade geral
continua incompleta e sem commit.

HTTP e MCP compartilham `lib/propostas/administracao.ts` e
`lib/honorarios/handlers.ts`. Listagem de propostas conserva projeção, ordem,
limite 500 e filtros HTTP; o schema MCP valida UUID/status (inclui `vencida`).
Detalhe conserva itens e drift de preço do catálogo com tenant explícito.
PATCH conserva moeda, resolvedor, revision/status no UPDATE, total/pricing,
substituição de itens, aviso e audit. Não adiciona transação: cabeçalho e itens
continuam operações separadas, como no handler HTTP anterior. Não envia nem decide.

As novas tools exigem manager, domínio `operations`, scopes read/write,
allowlist e áreas `/app/proposals` ou `/app/honorarios`. Descoberta e handler
revalidam capacidade de propostas / módulo honorários. A listagem de contratos
conserva projeção e teto 200, aceita lead opcional e traduz 42P01. HTTP recebeu
filtro explícito de organização além da RLS; mensagens internas de banco não
são expostas pelo novo serviço. Metadados de edição registram apenas revision,
item_count e nomes de campos; auditoria universal redige presenças de IDs e
filtros, sem conteúdo comercial ou erro cru.

A releitura de `revise`, `documento`, `assistant`, `assistant/apply`,
`preencher-com-conversa`, `send`, `decide`, `modelo`, `previa` e settings/modelos
confirmou o conjunto grande adicional já documentado. Não foi implementado.
A regra do usuário manda parar antes de expandir outro domínio grande;
portanto não há alegação de auditoria diferencial encerrada nem de gaps A zero.

Living System Checklist: entrada pelo token autorizado ou HTTP; saída pelas
mesmas propostas/contratos em `/app/proposals` e `/app/honorarios`; registro em
`proposal.edited` e `mcp.tool_called`; porta pelo catálogo/scopes e telas
existentes; capacidade da organização e módulo da instalação controlam acesso.
Leituras não abrem demanda. Edição conserva resolução do aviso de revisão na
Central e envio posterior humano. Conflito exige recarregar e decidir de novo.
O mapa `mcp-fundacao-ia.architecture.json` liga HTTP/MCP ao serviço compartilhado,
ao banco e à auditoria. Destino: núcleo MCP com módulos oficiais opcionais;
sem ativação, a operação comum continua inteira.

Validação desta retomada será registrada em `PARITY-1.62.0-REVIEW.md`.

## Checkpoint anterior (histórico)

Estado: **auditoria com ponto de parada; nenhuma tool implementada nesta sessão**.
Branch `fix/mcp-b2b-parity-162`, HEAD
`fc4d663c795ebf994516d02274179120deb0b953`. As alterações B2B e as três
tools adicionais que já estavam no disco foram preservadas.

## Por que parar

A família não se limita a listar, obter e editar itens de um rascunho. Há
operações canônicas delegáveis de documento estruturado, revisão e modelos
textuais. Elas não podem ser excluídas da classe A apenas por estarem em
Configurações ou por antecederem o envio humano. Isso revela a **segunda fase
grande** prevista na instrução desta sessão: parar e reportar antes de inflar
a branch. Não foi pedido novo consentimento; este é o ponto de parada já
autorizado pelo usuário.

As classificações abaixo descrevem operações, não equivalência automática
entre um endpoint e uma tool. Uma operação B pode futuramente ter uma tool de
preparo; isso não autoriza executá-la nem ignorar a confirmação humana.

Fontes: handlers HTTP da família `proposals` e dos dois grupos de settings;
`lib/schemas/propostas.ts`, tools MCP existentes, policy, catálogo e serviços
de itens, documento, revisão, briefing e sugestões. Regra A/B/C em
`docs/mcp/AUDIT-NEW-VERSION.md`; autoridade em `docs/mcp/ARCHITECTURE.md` e
`docs/mcp/IMPLEMENTATION-MASTER.md`; envio humano declarado pela tool existente
e pelo catálogo `lib/mcp/tools/catalogo/comercio.ts`.

**Limite da leitura:** todas as rotas da matriz foram inspecionadas, mas o
ponto de parada interrompeu a leitura integral de todos os arquivos e testes
de `lib/propostas/**` e a revisão diferencial restante. Não tratar este
documento como validação final dos handlers nem como auditoria encerrada.

## Matriz de operações

Prefixos: P = `/api/v1/proposals`; S = `/api/v1/settings`.
Capacidade `propostas` = módulo da instalação ligado **e**
`organizations.settings.proposals.enabled === true`, resolvidos por
`capacidadesDaOrganizacao`. Settings de propostas exige somente módulo da
instalação, pois é a porta para ligar a capacidade da organização.

“Documento” distingue JSON/texto de PDF. “Humano” indica exigência específica
de revisão, decisão ou confirmação; não significa apenas ter papel no CRM.
Todas as operações são da organização ativa. Nenhuma autoriza caller a
fornecer `organization_id`.

| Rota                            | Método/operação                           | Papel HTTP mínimo | Módulo/capacidade    | Efeito                                                                                                       | Integração externa              | WhatsApp                               | Documento                          | IA                  | Humano                                                               | MCP existente equivalente                                                      | Classe e justificativa                                                                                                                                        |
| ------------------------------- | ----------------------------------------- | ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------------------------------------- | ---------------------------------- | ------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P                               | GET/listar                                | viewer            | propostas            | Lê até 500, status e lead_id opcionais                                                                       | Não                             | Não                                    | Não                                | Não                 | Sem gate específico                                                  | Não                                                                            | **A aberto**: consulta administrativa canônica, distinta do preparo/draft                                                                                     |
| P                               | POST/rascunhar                            | agent             | propostas            | Cria rascunho e itens; timeline                                                                              | Não diretamente                 | Não diretamente                        | Não                                | Não no handler      | Draft do atendimento exige briefing e confirmação do cliente         | `crm_draft_proposal`, com contrato específico de atendimento                   | **A, cobertura específica existente**: não criar outro draft só pelo endpoint; criação manual não é semanticamente idêntica à tool                            |
| P/:id                           | GET/obter                                 | viewer            | propostas            | Proposta completa, itens ordenados e preço atual do catálogo                                                 | Não                             | Não                                    | Não                                | Não                 | Sem gate específico                                                  | Não                                                                            | **A aberto**: drift é parte da leitura, não deve ser omitido                                                                                                  |
| P/:id                           | PATCH/editar rascunho                     | agent             | propostas            | Revision otimista, itens canônicos, total, pricing_status, aviso/audit                                       | Não diretamente                 | Não diretamente                        | Não                                | Não                 | Não envia nem confirma documento final                               | Não                                                                            | **A aberto**: alteração interna; MCP administrativo deve exigir manager                                                                                       |
| P/:id                           | DELETE/descartar                          | manager           | propostas            | Rascunho vira cancelada; fecha aviso; sem delete físico                                                      | Não                             | Não                                    | Não                                | Não                 | Autorização destrutiva explícita no desenho MCP                      | Não                                                                            | **A aberto, crítico**: fechamento interno delegável, com `destructive_operations`; não classificar B apenas por ser DELETE                                    |
| P/:id/send                      | POST/enviar                               | manager           | propostas            | Numera, muda estado, congela snapshots, salva PDF, envia, atualiza lead e retorno                            | Storage e canal                 | **Sim**, PDF ao cliente                | PDF                                | Não                 | **Revisão/envio por pessoa**, contrato existente                     | Não                                                                            | **B**: envio composto irreversível; `send_messages` isoladamente não substitui o gate humano de propostas                                                     |
| P/:id/decide                    | POST/aceitar                              | agent             | propostas            | Enviada vira aceita; grava usuário/data; timeline e cancelamento de retorno                                  | Não                             | Não                                    | Não                                | Não                 | **Decisão do cliente registrada por pessoa**                         | Não                                                                            | **B**: token/modelo não é prova de aceite; não usar provisionador como decididor                                                                              |
| P/:id/decide                    | POST/recusar                              | agent             | propostas            | Enviada vira recusada; motivo, usuário/data; timeline e retorno                                              | Não                             | Não                                    | Não                                | Não                 | **Decisão do cliente registrada por pessoa**                         | Não                                                                            | **B**: mesma proveniência de decisão; texto do caller não basta como evidência                                                                                |
| P/:id/revise                    | POST/criar revisão                        | manager           | propostas            | Cria próxima versão em rascunho, copia modelo/briefing, reprecifica itens; enviada anterior continua vigente | Não                             | Não                                    | Não                                | Não                 | Envio posterior continua humano                                      | Não                                                                            | **A aberto**: criar versão não envia nem substitui a vigente; merece handler e testes próprios                                                                |
| P/:id/documento                 | GET/ler documento                         | viewer            | propostas            | Monta seções, pendências e prontidão; não salva PDF                                                          | Não                             | Não                                    | **JSON/texto**                     | Não                 | Sem gate específico; handler hoje cobra support-write                | Não                                                                            | **A aberto**: leitura estruturada não é download binário; `crm_get_proposal` simples não a substitui                                                          |
| P/:id/documento                 | PATCH/preencher campo                     | manager           | propostas            | Campo de briefing validado pelo modelo, só rascunho; aviso/audit                                             | Não                             | Não                                    | Edita dados do documento           | Não                 | Revisão/envio posterior por pessoa                                   | Não                                                                            | **A aberto**: preenchimento textual explícito é delegável; exige paths seguros, não edição JSON universal                                                     |
| P/:id/documento                 | PATCH/reescrever ou restaurar seção       | manager           | propostas            | `secoes_editadas`, só rascunho; aviso/audit                                                                  | Não                             | Não                                    | Texto de seção                     | Não                 | Revisão/envio posterior por pessoa                                   | Não                                                                            | **A aberto**: edição textual administrativa; não equivale a aplicar sugestão de IA já revisada                                                                |
| P/:id/modelo                    | PATCH/confirmar, trocar ou remover modelo | manager           | propostas            | Define slug/versão; pode apagar reescritas com confirmação explícita                                         | Não                             | Não                                    | Muda documento futuro              | Não                 | **Pessoa confirma modelo; troca pode exigir descarte de reescritas** | Draft só sugere slug; não confirma                                             | **B**: confirmação comercial e potencial perda de edição; preparo futuro não deve confirmar automaticamente                                                   |
| P/:id/previa                    | GET/PDF de prévia                         | agent             | propostas            | Monta PDF sem número novo, Storage ou envio; permite pendências                                              | Não                             | Não                                    | **PDF binário**                    | Não                 | Pessoa confere arquivo pelo fluxo oficial                            | Não                                                                            | **B**: binário/download; não transportar PDF/base64 via tool genérica                                                                                         |
| P/:id/assistant                 | POST/gerar sugestões                      | agent             | propostas            | Lê rascunho/itens; chama LLM; devolve mudanças e revision, não aplica                                        | **LLM**, custo/orçamento tenant | Não                                    | Não                                | **Sim**             | Pessoa revisa antes de aplicar                                       | Não                                                                            | **A aberto, sugestões apenas**: LLM externo não torna automaticamente B; exposição exige orçamento e separação gerar/aplicar                                  |
| P/:id/assistant/apply           | POST/aplicar sugestões                    | agent             | propostas            | Aplica mudanças já revisadas; revision, reprecificação, briefing e timeline                                  | Não nesta aplicação             | Não                                    | Dados textuais                     | Não nesta aplicação | **Mudanças JÁ REVISADAS pela pessoa**, contrato do serviço           | Não                                                                            | **B**: não converter sugestão em autorização; gate de revisão tem de ser preservado                                                                           |
| P/:id/assistant/disponibilidade | GET/preflight do assistente               | agent             | propostas            | Confere proposta e orçamento do mês                                                                          | Não; RPC local                  | Não                                    | Não                                | Não chama modelo    | Sem gate específico                                                  | Não                                                                            | **C como tool isolada**: mecanismo de preflight do assistente; integrar à resposta/preparo da futura operação A, sem inventar operação comercial separada     |
| P/:id/preencher-com-conversa    | POST/sugerir campos                       | manager           | propostas            | Lê até 60 mensagens; sugere apenas briefing faltante; não grava                                              | **LLM**, custo/orçamento tenant | Não                                    | Sugestões textuais                 | **Sim**             | Pessoa escolhe/aplica sugestões posteriormente                       | Não                                                                            | **A aberto, sugestões apenas**: leitura assistida delegável; não expor transcrição na auditoria nem aplicação automática                                      |
| S/proposals                     | GET/configuração                          | viewer            | **Módulo** propostas | Lê enabled/defaults/follow-up/aviso                                                                          | Não                             | Não                                    | Não                                | Não                 | Sem gate específico                                                  | Não                                                                            | **A aberto**: consulta administrativa; não confundir capacidade desligada com configuração inacessível                                                        |
| S/proposals                     | PATCH/configuração completa               | manager           | **Módulo** propostas | Merge de enabled, validade, condições, retorno e aviso WhatsApp                                              | Não no request                  | **Potencial futuro**, avisos da equipe | Não                                | Não                 | Ativação de comportamento/notificações exige desenho de autorização  | Não                                                                            | **B para o contrato completo**: não liberar ativação/notificação implicitamente; defaults textuais/validade são um subconjunto A que merece contrato separado |
| S/proposal-templates            | GET/listar modelos                        | viewer            | propostas            | Catálogo base + empresa, incluindo estado administrativo                                                     | Não                             | Não                                    | Definições textuais                | Não                 | Sem gate específico                                                  | `crm_preparar_proposta` lista **ativos**, sem contrato administrativo completo | **A aberto, cobertura parcial**: preparo do atendimento não cobre catálogo administrativo                                                                     |
| S/proposal-templates            | POST/personalizar base                    | manager           | propostas            | Cria cópia tenant, versão e seções oficiais                                                                  | Não                             | Não                                    | Modelo textual                     | Não                 | Sem confirmação específica do serviço                                | Não                                                                            | **A aberto**: edição org-scoped, sem publicação de imagem/arquivo                                                                                             |
| S/proposal-templates            | POST/novo modelo                          | manager           | propostas            | Valida nome/seções/ordem; slug e versão tenant                                                               | Não                             | Não                                    | Modelo textual                     | Não                 | Sem confirmação específica do serviço                                | Não                                                                            | **A aberto**: criação declarativa textual canônica; não é upload                                                                                              |
| S/proposal-templates            | POST/ocultar modelo base                  | manager           | propostas            | Merge de modelos_ocultos; muda opções futuras do atendimento                                                 | Não                             | Não                                    | Não                                | Não                 | Seleção administrativa explícita                                     | Não                                                                            | **A aberto**: alteração interna de catálogo, sem instalar módulo nem enviar proposta                                                                          |
| S/proposal-templates            | POST/mostrar modelo base                  | manager           | propostas            | Remove slug de modelos_ocultos                                                                               | Não                             | Não                                    | Não                                | Não                 | Seleção administrativa explícita                                     | Não                                                                            | **A aberto**: mesmo contrato tenant e catálogo canônico                                                                                                       |
| S/proposal-templates/:slug      | GET/obter modelo                          | viewer            | propostas            | Cópia ativa tenant ou base; seções, ordem, versão e origem                                                   | Não                             | Não                                    | Modelo textual                     | Não                 | Sem gate específico                                                  | Preparo lista rótulos de campos; não devolve modelo completo                   | **A aberto**: consulta administrativa distinta                                                                                                                |
| S/proposal-templates/:slug      | PATCH/editar modelo                       | manager           | propostas            | Valida seções, ordem, nome; incrementa versão                                                                | Não                             | Não                                    | Modelo textual                     | Não                 | Revisão de propostas continua separada                               | Não                                                                            | **A aberto**: gravação canônica org-scoped; precisa preservar versões/snapshots                                                                               |
| S/proposal-templates/:slug      | DELETE/desativar cópia                    | manager           | propostas            | is_active=false, sem apagar histórico                                                                        | Não                             | Não                                    | Não                                | Não                 | Autorização crítica no desenho MCP                                   | Não                                                                            | **A aberto, crítico**: desativação interna delegável, com capability destrutiva explícita                                                                     |
| S/proposal-templates/importar   | POST/importar arquivo                     | manager           | propostas            | Multipart ≤5 MB, extrai PDF/md/txt, LLM devolve modelo proposto; não salva modelo                            | **LLM**                         | Não                                    | Lê arquivo, devolve modelo textual | **Sim**             | Upload e revisão por pessoa                                          | Não                                                                            | **B**: fluxo binário e de revisão; texto canônico já tem criação separada                                                                                     |

## Contratos confirmados para a fase mínima

Nomes coerentes com registry: `crm_list_proposals`, `crm_get_proposal`,
`crm_update_draft_proposal`. **Não foram criados.**

- List: mesma projeção, ordem descendente e teto 500 do GET; `status` com
  vocabulário canônico, `lead_id` UUID opcional; sempre filtro explícito da org
  do contexto. HTTP hoje não valida esses filtros com Zod; adicionar schema
  compartilhado requer avaliar compatibilidade, não mudar a rota em silêncio.
- Get: proposta e itens ordenados; incluir `preco_catalogo_atual_cents` por
  consulta tenant em lote. Produto manual/apagado resulta null. Proposta de
  outro tenant ou inexistente deve falhar fechada com not_found.
- Update: extrair **a mesma regra central do PATCH**, sem copiar queries para
  a tool. Preservar moeda existente; `resolverItensDaProposta`; filtro atômico
  org/id/revision/status=rascunho; erro `proposal_context_stale`; incremento de
  revision; total/pricing_status; delete/insert de itens com org; aviso e
  audit. Enviada/cancelada não editam. Resposta HTTP atual retorna id,
  revision e total. Não presumir transação inexistente: PATCH atualmente
  atualiza cabeçalho e substitui itens em operações separadas; não trocar
  essa semântica durante extração sem revisão específica.

Decisão de papel proposta para essas tools administrativas: **manager**,
inclusive na leitura agregada/inteira, com `mcp:read`/`mcp:write` e domínio
`operations:read/write`. Isto é decisão de desenho, **não autorização já
implementada**. `agent` do draft/preparo é atendimento específico e não
confere autoridade administrativa sobre todas as propostas. Área managed
exata `/app/proposals`, allowlist por tool e catálogo apenasHumano devem
acompanhar o registry 1:1; não deixar fallback implícito para `ai`.

No catálogo, capacidade `propostas` filtra a descoberta tanto externa quanto
in-process; no handler, conferir novamente `capacidadesDaOrganizacao` antes
de qualquer query/efeito. Service role não substitui isso. Configuração usa
gate de módulo, não capacidade da organização, para permitir ligá-la.

Auditoria universal: redigir args e erros nos **dois ingressos**. Guardar
presenças de IDs/filtros, item_count, campos alterados e revision; nunca
título, condições, pagamento, briefing, descrição de itens, transcrição ou
frase do cliente. Identidade atual vem de ctx.actor; provisionador não vira
ator atual. Testar a auditoria real, não só a função redatora isolada.

## Honorários

GET `/api/v1/honorarios/contratos` continua **A aberto**: lista até 200,
`lead_id` opcional e projeção id/lead/modelo/valores/repasse/created_at.
`crm_get_honorarios_contrato` exige lead e usa maybeSingle; não é equivalente.
Nome previsto: `crm_list_honorarios_contratos`, sem substituir a tool antiga.

Desenho previsto: manager, `mcp:read`, `operations:read`, área
`/app/honorarios`, catálogo com módulo `honorarios`, gate de módulo também no
handler, org explícita em toda consulta, UUID opcional e teto 200. Traduzir
42P01 para `module_not_installed`, não sucesso vazio ou erro cru. Redigir
lead_id/filtros para presenças e erros para código estável. Nenhuma cobrança
externa, emissão de pagamento ou registro de parcela paga. **Não implementado
por causa do ponto de parada desta sessão.**

## Continuação e gates

A revisão diferencial v1.57.0-mcp → v1.62.0 não prosseguiu após a descoberta
da segunda fase. Busca no acervo, grupos, pagamento de honorários, anexos,
actions/serviços/migrations restantes continuam com as pendências do documento
`PARITY-1.62.0-REVIEW.md`. Não afirmar ausência de outro gap A.

Não houve implementação, alteração de schema, rota, tool, policy ou catálogo
nesta sessão. Portanto não há novos resultados dirigidos, typecheck, lint,
channels, role-rank, cercas, unit ou DB. Os verdes anteriores relatados pelo
usuário permanecem históricos, não gates finais desta árvore. Skills sync
também não foi reexecutado. `git diff --check` será medido ao encerrar e seu
resultado entregue no relatório da sessão.

Sem commit local: os critérios do usuário não foram satisfeitos. Sem push,
PR, tag, release ou deploy. Arquivo protegido e backups não foram abertos,
copiados, movidos, removidos, adicionados ou alterados. Não foi usado
`git add .` nem qualquer comando de staging.

Living System Checklist desta auditoria: entrada pelos handlers/catálogo
atuais; saída pela matriz e pelo plano de contratos; registro neste documento;
telas consumidoras já existentes `/app/proposals`, configuração de propostas,
modelos e `/app/honorarios`. Sem nova peça de runtime ou demanda, portanto
sem novo anti-morte/mapa; próximo passo é delimitar a segunda fase, preservar
confirmações humanas e implementar/testar A em recorte controlável. Erros de
classificação corrigem a matriz antes de conceder autorização no MCP.
