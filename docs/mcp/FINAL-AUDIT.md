# Auditoria final ponta a ponta do MCP

Data: 2026-09-22

Branch: `feat/mcp-full-control`

Base da fase: `a3a744462bfa269d120223abc1b7776f673ace27`
Upstream medido: `origin/main` = merge-base `3538380b9925dba9203dc01170d9bc73452cdf53`, atraso 0, 12 commits próprios, sobreposição vazia.

## Veredito

Sim: o MCP administra praticamente toda operação do tenant que é canônica, org-scoped e delegável a um manager. O denominador foi a matriz do produto atual — UI, API/actions, services, workers e schema — e não a quantidade histórica de tools.

- Tools antes: 202.
- Tools novas: 0.
- Tools atuais: 202, derivadas de `MCP_REGISTRY.length`.
- Correção final: rate limit compartilhado por todas as tools (60/min por token, 600/min por organização, 30 writes/min por token), `X-Request-Id` também nos erros pré-transporte e mensagens internas genéricas sem erro bruto.
- Cobertura: 100% das operações classe A auditadas; 12 grupos B permanecem humanos/externos; 12 grupos C permanecem deliberadamente fora.
- Gaps A finais: 0.

“100%” não inclui B/C. Incluir consentimento OAuth, secret de saída, infraestrutura ou operação inexistente no denominador premiaria justamente a quebra da fronteira de autoridade.

## Matriz diferencial CRM × MCP

`Coberta = SIM` significa tool direta ou composição oficial sem adivinhar ID. `HUMANO` significa contrato estruturado que termina no fluxo humano oficial.

| Domínio     | Recurso            | Operação                                         | UI                          | Service/API                                | MCP tool                                                                                        | Role                                                | Scope                      | Capability                              | Side effect                   | Human action                    | Coberta | Observação                           |
| ----------- | ------------------ | ------------------------------------------------ | --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------- | --------------------------------------- | ----------------------------- | ------------------------------- | ------- | ------------------------------------ |
| IA          | providers          | listar/consultar                                 | Agentes › Credenciais       | `lib/ai/pontos`/providers API              | `crm_list/get_ai_provider`                                                                      | manager                                             | ai:read                    | —                                       | não                           | não                             | SIM     | catálogo canônico                    |
| IA          | models             | listar/consultar ativos/compatíveis              | seletor do draft            | catálogo `ai_models`                       | `crm_list/get_ai_model`                                                                         | manager                                             | ai:read                    | —                                       | não                           | não                             | SIM     | elimina ID/modelo adivinhado         |
| IA          | credentials        | metadados seguros                                | Credenciais                 | `lib/ai/mcp-service`                       | `crm_list/get_ai_credential`                                                                    | manager                                             | ai:read                    | —                                       | não                           | não                             | SIM     | somente last4/status                 |
| IA          | agent config       | validar/create/update/duplicate                  | editor de agente            | `lib/ai/mcp-service`                       | `crm_validate_agent_ai_configuration`, `crm_create/update/duplicate_ai_agent`                   | manager                                             | agents:write               | —                                       | banco                         | não                             | SIM     | org do token                         |
| IA          | versions           | list/get/draft/update/preflight                  | versões                     | publish/validation services                | família `crm_*_ai_agent_version`                                                                | manager                                             | agents:read/write          | publication no publish                  | LLM só no teste               | não                             | SIM     | publicada é imutável                 |
| IA          | lifecycle          | teste/publicar/consultar/ativar/pausar/arquivar  | editor/runs                 | preview + publish                          | `crm_test/publish/get_published/activate/pause/archive_*`                                       | manager                                             | agents:write               | publication/activation/destructive      | sandbox/publicação            | não                             | SIM     | publicar não ativa                   |
| IA          | runs               | listar/consultar                                 | Uso/runs                    | `llm_calls` seguro                         | `crm_list/get_ai_agent_run`                                                                     | manager                                             | agents:read                | —                                       | não                           | não                             | SIM     | sem prompt/secret desnecessário      |
| CRM         | contacts           | buscar/get/create/update/timeline                | Contatos/Inbox              | handlers de contacts                       | família `crm_*contact*`                                                                         | agent/manager                                       | contacts:*                 | destructive na anonimização             | banco                         | confirmação no delete           | SIM     | merge continua B                     |
| CRM         | leads              | CRUD/owner/ganho-perda/mover/histórico           | Kanban                      | handlers + `moverLeadParaOutroFunil`       | família `crm_*lead*`                                                                            | agent/manager                                       | leads:*                    | destructive onde aplicável              | eventos/timeline              | reativação protegida            | SIM     | next action via tarefas              |
| CRM         | pipelines          | list/get/create/update/default/archive           | Funis                       | `lib/pipelines/operations`                 | família `crm_*pipeline*`                                                                        | manager                                             | pipelines:*                | destructive no archive                  | banco                         | não                             | SIM     | destino validado                     |
| CRM         | stages             | CRUD/ordem/semântica/archive                     | editor de funil             | handlers oficiais                          | família `crm_*stage*`                                                                           | manager                                             | pipelines:*                | destructive no archive                  | board/timeline                | não                             | SIM     | sem posição inteira fictícia         |
| CRM         | custom fields      | schema e valores                                 | Funis/ficha                 | schema dinâmico                            | `crm_update_pipeline_schema`, `crm_set_custom_field_values`                                     | manager                                             | pipelines/leads:*          | —                                       | banco                         | não                             | SIM     | valida por tipo                      |
| CRM         | tags               | vocabulário/attach/rename/merge/delete           | CRM                         | RPC/vocabulário oficial                    | `crm_list/update/merge_or_delete_tag`, `crm_manage_tags`                                        | agent/manager                                       | contacts/leads:*           | destructive no merge/delete             | timeline                      | não                             | SIM     | transacional                         |
| CRM         | tasks              | list/get/create/update/delete                    | tarefas/timeline            | `lib/tarefas/operations`                   | família `crm_*task`                                                                             | agent                                               | leads:*                    | destructive no delete                   | atividade                     | não                             | SIM     | owner tenant-scoped                  |
| CRM         | bulk/import/export | preview/preparo/status                           | importadores/auditoria/LGPD | endpoints/RPC/job oficiais                 | tools Parte 7                                                                                   | manager                                             | operations/audit/privacy:* | destructive só no commit humano         | nenhum no MCP                 | HUMANO                          | SIM     | sem loop ingênuo                     |
| Atendimento | conversations      | list/get/history/close/reopen/read               | Inbox                       | handlers + `fn_service_status`             | família conversation                                                                            | agent                                               | conversations:*            | —                                       | estado/timeline               | não                             | SIM     | snooze não é necessário aos fluxos A |
| Atendimento | messages           | get/send/reply/start                             | Inbox                       | `sendMessageHandler` + idempotência        | `crm_get/send/reply/start_*`                                                                    | agent/manager                                       | messages:*                 | send_messages                           | canal real                    | mock nos testes                 | SIM     | storage-first                        |
| Atendimento | media              | instrução/upload path                            | Inbox                       | endpoint multipart oficial                 | instruções + send/reply                                                                         | agent                                               | messages:*                 | send_messages                           | storage/canal                 | HUMANO no upload                | SIM     | sem base64/signed URL                |
| Atendimento | assignment         | assign/transfer/release/fila                     | Inbox/Fila                  | `fn_conversation_assign`/elegibilidade     | `crm_assign_conversation`, `crm_get_queue_status`                                               | agent                                               | conversations:*            | —                                       | timeline                      | não                             | SIM     | fila derivada, sem queue_id          |
| Atendimento | handoff            | pedir/histórico/caso/retomar IA                  | Inbox/Casos                 | passagens e orquestradores                 | família handoff/cases                                                                           | agent                                               | conversations:*            | human_handoff                           | passagem                      | humano assume/devolve           | SIM     | continuidade bidirecional            |
| Atendimento | notes              | list/create/delete                               | Inbox                       | operação compartilhada                     | família internal_note                                                                           | agent                                               | conversations:*            | destructive no delete                   | auditoria                     | não                             | SIM     | edição não existe                    |
| Agenda      | event types        | list/get/create/update/active                    | Agenda                      | tabelas/handlers oficiais                  | família event_type                                                                              | manager                                             | appointments:*             | destructive ao desativar quando exigido | banco                         | não                             | SIM     | preço/lembretes inclusos             |
| Agenda      | availability       | listar/editar/exceções                           | Agenda                      | roster/schemas                             | família availability                                                                            | manager                                             | appointments:*             | destructive no delete                   | agenda                        | não                             | SIM     | fuso IANA                            |
| Agenda      | appointments       | slots/book/reschedule/cancel/confirm/outcome     | Agenda                      | handlers oficiais                          | família appointment                                                                             | ai_operator/manager                                 | appointments:*             | —                                       | calendário/notificação        | confirmação no outcome          | SIM     | harness não entrega externamente     |
| Follow-up   | flows              | CRUD/preflight/publish/active                    | Follow-up                   | pointers/versions/graph                    | família followup_flow                                                                           | manager                                             | followups:*                | automation_activation/destructive       | worker futuro                 | não                             | SIM     | publicação atômica                   |
| Follow-up   | enrollments        | list/get/enroll/pause/resume/snooze/skip/cancel  | Follow-up                   | enroll/intervenção                         | `crm_*followup_enrollment`, `crm_control_*`                                                     | manager                                             | followups:*                | —                                       | agenda worker                 | mock                            | SIM     | sem envio imediato                   |
| Automações  | catalogs           | triggers/actions                                 | Automações                  | schemas do engine                          | `crm_discover_automation_*`                                                                     | manager                                             | automations:read           | —                                       | não                           | não                             | SIM     | derivado, não duplicado              |
| Automações  | rules              | CRUD/preflight/simulate/activate/runs            | Automações/Runs             | engine/event_log                           | família automation                                                                              | manager                                             | automations:*              | activation/destructive                  | somente quando ativa          | mock/simulação                  | SIM     | simulação declara zero efeitos       |
| Routing     | config             | get/update global/canal                          | Configurações › Routing     | settings + RPC                             | `crm_get/update_routing_*`                                                                      | manager                                             | routing:*                  | —                                       | worker futuro                 | não                             | SIM     | manual/round_robin reais             |
| Routing     | decision           | destinos/simular                                 | Routing                     | `loadEligibleAttendants` + `decideRouting` | `crm_list_routing_destinations`, `crm_simulate_routing`                                         | manager                                             | routing:read               | —                                       | não                           | não                             | SIM     | não altera conversa                  |
| Knowledge   | sources            | list/get/create/update/archive/status/reindex    | Acervo                      | fontes + event_log/rag-indexer             | família knowledge_source                                                                        | manager                                             | knowledge:*                | destructive no archive                  | worker indexa                 | upload humano                   | SIM     | sem embedding cru                    |
| Knowledge   | FAQ                | substituir atomicamente                          | Acervo                      | `fn_replace_knowledge_faq_items`           | `crm_replace_knowledge_faq`                                                                     | manager                                             | knowledge:write            | —                                       | indexação posterior           | não                             | SIM     | valida antes do delete               |
| Knowledge   | binding            | vincular ao agente                               | editor do draft             | versões de agente                          | `crm_update_ai_agent_version`                                                                   | manager                                             | agents:write               | —                                       | publicação posterior          | não                             | SIM     | source IDs descobertos               |
| Templates   | internos           | CRUD/duplicate/render                            | Respostas prontas           | render canônico                            | família message_template                                                                        | manager                                             | templates:*                | destructive no delete                   | não envia                     | não                             | SIM     | preview sem entrega                  |
| Templates   | externos           | catálogo/mídia/aprovação                         | Canais                      | APIs de canal                              | list + instrução de upload                                                                      | manager                                             | templates/channels:read    | —                                       | plataforma externa            | HUMANO                          | SIM     | aprovação não é automatizada         |
| Produtos    | products           | list/search/get/CRUD/import                      | Produtos                    | catálogo/moeda da org                      | família product + instrução                                                                     | manager                                             | products:*                 | destructive no delete                   | banco                         | import humano                   | SIM     | sem inventar estoque                 |
| Pedidos     | orders             | list/get histórico                               | Pedidos                     | histórico sincronizado                     | `crm_list/get_order`                                                                            | manager                                             | products:read              | —                                       | não                           | não                             | SIM     | nenhuma escrita existe               |
| Webhooks    | inbound sources    | list/get/CRUD/active/events                      | Integrações                 | serviços de entrada                        | família webhook_source                                                                          | manager                                             | webhooks:*                 | destructive no delete                   | recebe no futuro              | secret write-only               | SIM     | sem outbound inexistente             |
| Integrações | connections        | discovery/status/metadata/action                 | Integrações                 | `tenant_integrations`                      | `crm_discover_integrations`, `crm_prepare_integration_action`                                   | manager                                             | channels:read              | —                                       | externo só após consentimento | HUMANO                          | SIM     | sem token/refresh token              |
| Canais      | sessions           | list/health/admin/AI access/action               | Canais                      | estado/RPC canônicos                       | `crm_list_messaging_channels`, `crm_get_channel_admin`, `crm_update_channel_ai_access`, prepare | manager                                             | channels:*                 | —                                       | canal                         | HUMANO para QR/reconnect/remove | SIM     | sem session name secreto             |
| Equipe      | members/invites    | list/get/invite/interface/role/revoke/reactivate | Equipe                      | serviços oficiais de convite               | família team                                                                                    | manager + provisionador admin nas mutações críticas | team:*                     | destructive onde aplicável              | e-mail/acesso                 | mock nos testes                 | SIM     | nunca aceita admin/owner/self        |
| MCP tokens  | gestão             | instruir emissão/revogação                       | Configurações › Tokens      | API admin/MFA                              | `crm_prepare_mcp_token_management`                                                              | manager                                             | settings:read              | —                                       | novo bearer                   | HUMANO                          | SIM     | token não se autoeleva               |
| Diagnostics | operação           | health agregado                                  | telas de operação           | consultas agregadas limitadas              | `crm_get_operational_diagnostics`                                                               | manager                                             | operations:read            | —                                       | não                           | não                             | SIM     | sem IP/filesystem/secret             |

## Cobertura por domínio

| Domínio                               | Classe A | Cobertura A | Limite deliberado                                              |
| ------------------------------------- | -------: | ----------: | -------------------------------------------------------------- |
| IA                                    | completa |        100% | credencial plaintext/routers avançados de alto impacto ficam B |
| CRM/Kanban                            | completa |        100% | merge/import/execução bulk exigem fluxo humano                 |
| Atendimento                           | completa |        100% | binário/QR externos ficam humanos                              |
| Agenda                                | completa |        100% | OAuth Google e outcome protegido exigem pessoa                 |
| Follow-up                             | completa |        100% | rollback destrutivo continua B                                 |
| Automações                            | completa |        100% | replay com efeito externo continua B                           |
| Routing                               | completa |        100% | simulação nunca grava                                          |
| Knowledge/templates                   | completa |        100% | upload/aprovação externa continuam B                           |
| Produtos/pedidos                      | completa |        100% | pedido é leitura porque o produto não escreve                  |
| Webhooks/integrações/canais           | completa |        100% | consentimento/QR/secret continuam B                            |
| Equipe/tokens                         | completa |        100% | admin/owner/MFA continuam fora                                 |
| Upload/import/export/bulk/diagnostics | completa |        100% | transporte/download/commit continuam humanos                   |

## Gaps finais

### A — 0

O único gap A encontrado nesta fase foi rate limit da borda MCP. Foi corrigido e coberto por teste; não adicionou tool nem migration.

### B — 12 grupos

1. criar/rotacionar/revalidar credencial de IA com secret write-only;
2. QR/pairing/reconnect/disconnect/provisionamento de canal;
3. consentimento OAuth e conexão/desconexão de integrações;
4. uploads binários de mídia, knowledge, skills e templates;
5. imports CSV multipart e revisão de resultado;
6. execução bulk oficial sem chave idempotente;
7. download de auditoria/LGPD e aprovação/anonimização legal;
8. merge de contatos e outros efeitos destrutivos de difícil reversão;
9. approval/publicação de template externo;
10. rollback de follow-up e replay de automação com efeitos;
11. Google Calendar connect/disconnect/retry que exige conta externa;
12. emissão/revogação de tokens e mudanças privilegiadas de equipe/segurança.

### C — 12 grupos

1. revelar/exportar/descriptografar secrets;
2. billing/plano/cobrança;
3. excluir tenant ou apagar toda a operação;
4. autoelevação, conceder admin/owner ou transferir owner;
5. MFA, recovery codes e recuperação de conta;
6. deploy/restart/update/prune/backup/restore da VPS;
7. SQL/REST/CRUD universal ou banco externo irrestrito;
8. impersonação e administração transversal de tenants/platform admins;
9. desligar RLS, auditoria, LGPD, opt-out ou guardrails fundamentais;
10. instalar código/extensão arbitrária pelo MCP;
11. concluir consentimento OAuth em nome da pessoa;
12. operações inexistentes: write de pedidos, webhook outbound genérico, `queue_id`, edição de nota e transporte binário MCP.

## Fluxos validados

`tests/unit/mcp-final-flows.test.ts` valida 11 contratos compostos descobertos pelo perfil manager: IA, CRM/Kanban, atendimento, agenda, follow-up, automações, routing, knowledge, integração/canal, equipe e import/export/bulk. Não há UUID fixo. Envio, agenda, convite e automação usam mock/sandbox; outcomes e operações B terminam em ação humana.

## Segurança e perfil público

- Registry, catálogo e handlers são 1:1; `tools/list` vem dessa fonte.
- Todas as tools públicas têm role, scope, domínio e capabilities válidos.
- Não autorizadas não são registradas nem listadas; autorização é repetida na chamada.
- Nenhuma tool aceita `organization_id`/`organizationId` ou SQL público.
- Service role filtra organização; invariantes exercitam dois tenants.
- Secrets são omitidos na projeção e redigidos recursivamente em sucesso/erro/auditoria.
- Manager + preset explícito alcança as 202 tools sem `role:admin`.
- O token não pode alterar a si, conceder admin/owner, transferir owner ou escapar dos guards.
- Rate limit usa somente IDs resolvidos; bearer não entra na chave.

## Migrations MCP

Uma tripla foi criada pelo trabalho MCP:

| Migration                                     | Baseline               | MANIFEST   | Idempotência/dependência/ordem                                                                                                                                                                     |
| --------------------------------------------- | ---------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260921092259_0382_replace_faq_atomico.sql` | bloco 0382 no apêndice | linha 0382 | `create or replace`, valida todo conjunto antes do delete, EXECUTE revogado de public/anon/authenticated e concedido só a service_role; depende de sources/FAQ existentes; número/timestamp únicos |

Nenhuma migration nova foi necessária na Parte 8.

## Fixtures E2E acidentais

O artefato local na lixeira identifica, sem secret:

- organização `E2E Test Org`: `343aec32-6be0-4164-889f-550ae3313ee7`;
- usuários/memberships admin `894801fa-803f-459c-af4f-b05792a5cd7c`, manager `ae94beda-5bac-46ed-8b4d-2e96416d3c20`, agent `74b09738-29c6-4231-b242-08e003381fa9`, viewer `6df9a39b-353b-4d7e-b1c9-b30ae2f15548`, dono `3752e57f-451e-4267-a698-fdbae04c2781`;
- fatores TOTP `c2106b53-c1ae-4f97-8aad-1b2fe96b60c7` e `308c882d-f02e-4372-acfb-eb47bbb9bee9`;
- agente default `6748666f-53a0-4483-9d21-b0ccb5abc5c7`.

Não houve consulta remota nem exclusão. Plano seguro: uma pessoa autorizada confirma projeto/host e organização; exporta contagens/FKs por esses IDs; verifica que nomes/e-mails têm o prefixo E2E; produz preview transacional; remove dependentes na ordem de FK; exclui auth users por ID; valida zero resíduos; guarda recibo. Só executar após autorização explícita.

## Compatibilidade e Skill readiness

`docs/mcp/COMPATIBILITY.md` e `docs/mcp/AUDIT-NEW-VERSION.md` definem o delta futuro. As sentinelas cobrem handler/service, registry, policy, scope/capability, schema, tenant, secret e manager. A futura Skill está pronta para conectar, chamar `tools/list`, descobrir capabilities, escolher tools dinamicamente e interpretar ação humana sem depender de 202.

## Living System Checklist — auditoria final

1. Entrada: bearer validado, rate limit e `tools/list` filtrado.
2. Saída: handlers/services/RPCs/workers oficiais listados na matriz.
3. Registro: audit MCP, eventos e timeline dos domínios.
4. Tela: cada operação volta às telas existentes citadas na matriz.
5. Porta: endpoint MCP, registry e catálogo; nenhuma tela paralela.
6. Anti-morte: preflight, status, erro tipado e ação humana sempre declaram próximo passo.
7. Configuração: presets e tokens na UI; cada domínio usa a superfície existente.
8. Continuidade: passagem/handoff e retorno IA preservados; efeitos irreversíveis são interruptíveis.
9. Laço: runs, status, recibos, audit e reconsulta alimentam a correção seguinte.
10. Mapa: `mcp-fundacao-ia.architecture.json` inclui o novo rate limit com entrada e saídas.

## Testes finais

Nenhum teste usou produção real; efeitos externos foram mockados.

| Gate                                  | Resultado                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Novos harnesses/sentinelas/rate limit | 3 arquivos, 14/14 verdes                                                                                                  |
| Regressão MCP                         | 29 arquivos, 256/256 verdes                                                                                               |
| Banco focado                          | 3 arquivos, 13/13 verdes                                                                                                  |
| Banco global                          | 254/255 arquivos, 2.133 verdes; 5 falhas anteriores em prospecting fora do diff                                           |
| Unit global                           | interrompido após hang de um worker por mais de 19 min; seis falhas anteriores já visíveis em cinco arquivos fora do diff |
| Typecheck                             | aprovado com heap de 3.584 MB                                                                                             |
| ESLint                                | global com 0 erros/414 warnings anteriores; foco limpo                                                                    |
| Canal/role                            | `lint:channels` e `lint:role-rank` aprovados                                                                              |
| Release/migrations                    | `release:conferir` e colisão de migration aprovados                                                                       |
| Shell                                 | `test:shell` aprovado                                                                                                     |
| Build                                 | tentou com 7,8 GiB RAM, 3,7 GiB disponíveis, sem swap; exit 137/OOM no Turbopack                                          |

O OOM do build é limitação do ambiente, separado de erro de código. A suíte unit global incompleta não invalida os 270 testes MCP/focados verdes, mas permanece uma pendência de infraestrutura/dívidas globais.
