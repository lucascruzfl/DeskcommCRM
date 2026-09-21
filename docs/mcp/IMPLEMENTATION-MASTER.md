# DeskcommCRM 1.41.0 — MCP Full Control — implementação mestre

Atualizado em: 2026-09-21

Branch: `feat/mcp-full-control`
Estado deste checkpoint: Partes 1 a 7 concluídas; Parte 7 preparada para a auditoria final.

## 1. Objetivo

Construir um MCP Full Control operacional para o DeskcommCRM sem criar uma API paralela nem um CRUD direto sobre tabelas. Cada tool deve descobrir e reutilizar o serviço, handler, RPC, worker ou fluxo oficial do produto; manter autorização, multi-tenancy, idempotência, auditoria, eventos e efeitos que a UI/API já preservam; e expor somente a autoridade necessária ao token.

A versão 1.41.0 é a base auditada, não um congelamento do MCP. A fonte de verdade do catálogo executável é `MCP_REGISTRY`, servido ao cliente por `tools/list` após os filtros de autorização.

## 2. Base e contagens

- Versão base: DeskcommCRM 1.41.0.
- Arquitetura MCP original: endpoint Streamable HTTP em `app/api/mcp/route.ts`; autenticação Bearer `dsk_...` por hash; `McpServer` em `lib/mcp/server.ts`; handlers agregados em `lib/mcp/tools/index.ts`; contexto de organização/ator resolvido no servidor; Supabase service role com filtros explícitos; auditoria em `api_audit_log`.
- Tools originais: 63.
- Tools antes da Parte 5: **118**, calculadas diretamente por `MCP_REGISTRY.length` no commit da Parte 4.
- Tools novas na Parte 5: **35** (9 agenda, 11 follow-up, 10 automações, 5 routing).
- Tools atuais: **202**, calculadas diretamente por `MCP_TOOL_COUNT`/`MCP_REGISTRY.length` neste checkpoint.
- Tools antes da Parte 7: **190**.
- Tools novas na Parte 7: **12**.
- Total derivado atual: **202**, calculado por `MCP_TOOL_COUNT`/`MCP_REGISTRY.length`.
- Branch atual: `feat/mcp-full-control`.
- Base anterior às implementações: `6eceb0e60`.

## 3. Commits implementados

- Parte 2: `0a1fe1a97 feat(mcp): add authorization foundation and complete AI administration`.
- Parte 3: `44c9de0e3 feat(mcp): complete core CRM administration`.
- Parte 1 foi uma auditoria documental e não possui commit de implementação MCP neste histórico.
- Parte 4: `feat(mcp): complete conversations and messaging operations` (commit que contém este documento).
- Merge da `origin/main` anterior à Parte 5: `8656c4066`.
- Parte 5: `feat(mcp): complete scheduling automation and routing operations` (commit que conterá este documento).
- Merge único da Parte 7: `4ab5dfabe` (incorpora `origin/main` em `3538380b9`).
- Parte 7: `752625aa1 feat(mcp): complete import export and bulk operations`.

## 4. Fases concluídas

### Parte 1 — auditoria

A auditoria de 1.41.0 inventariou 63 tools originais, 338 rotas REST no recorte medido à época, domínios do produto, serviços reutilizáveis, gaps A/B/C, riscos de acesso direto e a estratégia de não espelhar toda rota como tool. O relatório de retomada está em `/root/DESKCOMM-141-MCP-AUDITORIA.md`.

### Parte 2 — fundação e IA

Adicionou 25 tools, elevando o registry de 63 para 88. Entregou registry e perfil público autorizados, domínios, scopes, allowlist por tool, capabilities, preset opt-in “Operação completa via MCP”, erros e sanitização centrais, auditoria sem payload sensível e administração completa de providers, modelos, credenciais seguras, agentes, drafts, versões, preflight, teste sandbox, publicação, ativação e runs.

Testes: 24 arquivos focados, 468 testes aprovados; typecheck, lint dos arquivos alterados, diff-check e release check aprovados. Não foram executados nessa fase `test:db`, `test:e2e`, `test:shell`, build nem suíte global.

### Parte 3 — CRM comercial

Adicionou 20 tools, elevando o registry de 88 para 108. Entregou contatos, oportunidades/leads, pipelines, stages, campos personalizados em `pipeline.settings.fields`, tags, responsáveis, timeline, tarefas e movimentação oficial entre funis. Reutilizou handlers e extraiu operações canônicas para `lib/leads/mover-para-funil.ts`, `lib/pipelines/operations.ts`, `lib/tarefas/operations.ts` e validações compartilhadas, preservando eventos, automações, timeline e auditoria.

Testes: 21 arquivos focados, 239 testes aprovados; typecheck, lint com 0 erros/0 warnings, diff-check e release check aprovados. Não foram executados por escopo `test:db`, `test:e2e`, `test:shell` nem a suíte global.

### Parte 4 — atendimento completo

Adicionou 10 tools, elevando o registry de 108 para 118: `crm_get_message`, `crm_reply_message`, `crm_close_conversation`, `crm_reopen_conversation`, `crm_mark_conversation_read`, `crm_list_internal_notes`, `crm_create_internal_note`, `crm_delete_internal_note`, `crm_list_messaging_channels` e `crm_list_handoff_history`.

Também completou tools preexistentes: filtros e paginação de conversas; histórico seguro de mensagens; envio storage-first e templates; início de conversa; atribuição/transferência/liberação; solicitação de handoff; casos humanos e retomada da IA. O produto não possui uma entidade `queue_id`: fila é estado derivado de conversas `open|pending`, elegibilidade e posição. Por isso não foi inventado CRUD de fila; `crm_get_queue_status`, filtros de conversa, atribuição/liberação e handoff expõem o subsistema real.

Envio e reply usam `sendMessageHandler`; início compõe `openSharedContactConversation` com esse handler. A `idempotency_key` é obrigatória nessas três operações e `comIdempotencia` reserva a chave antes do efeito, devolvendo conflito `idempotency_in_progress` em corrida. Mídia aceita somente `media_storage_path` da conversa, valida MIME/tamanho/tipo e ownership no fluxo oficial; URLs privadas e signed URLs não aparecem no retorno. Descoberta de canais usa projeção segura e retorna `human_action_required` para QR sem expor nome interno de sessão ou credencial.

Testes finais desta fase: 10 arquivos focados/90 testes e regressão MCP de 23 arquivos/203 testes. Typecheck, lint dos arquivos alterados, `lint:channels`, diff-check e release check são registrados na seção de checkpoint final após a execução. Não houve WhatsApp real, mutação de conversa real, mudança de schema, UI ou packaging.

### Parte 5 — agenda, follow-up, automações e routing

Depois do merge da `origin/main`, a auditoria delta confirmou as fontes canônicas: agenda em `calendar_event_types`, `attendant_availability`, `calendar_availability_exceptions` e handlers de compromissos; follow-up em pointers/versions/graphs, enrollments e workers; automações em `automation_rules`, `event_log` e schemas do motor; routing em settings globais, políticas por canal e `decideRouting` nos modos `manual|round_robin`.

Foram adicionadas 35 tools. Agenda ganhou administração de tipos completa (inclusive intervalo, preço e lembretes), disponibilidade tz-aware e exceções. Follow-up ganhou CRUD de flows, preflight/publish, ativação/desativação, list/detail de enrollments e pause/resume/snooze/skip/cancel. Automações ganharam discovery, CRUD inativo, preflight, simulação sem side effect e detalhe de run sanitizado. Routing ganhou leitura/escrita global, destinos reais, política atômica por canal via `fn_set_channel_routing` e simulação pelo engine oficial. Nenhum `queue_id` ou motor genérico foi criado.

Segurança: `organization_id` vem apenas do contexto; referências são validadas no tenant; secrets são cifrados e removidos de respostas; publicação/ativação/destruição exigem capabilities; simulações não gravam nem entregam efeito externo. `crm_set_appointment_outcome` retorna `human_confirmation_required: true` quando a confirmação precisa ocorrer pela pessoa na Agenda.

Validação da fase: 14 arquivos/168 testes focados; regressão MCP 26/230; catálogo/mapa 3/619; banco relevante 8/84; typecheck aprovado com heap 3584 MB; ESLint dos alterados, `lint:channels`, `lint:role-rank` e release check aprovados. O `test:db` global passou 253/254 arquivos e 2119 testes, com 5 falhas reproduzíveis somente em `prospecting-agent-setup.test.ts` por ausência de provider/modelo — domínio fora do diff. Nenhuma migration, UI ou mudança de packaging.

## 5. Decisões arquiteturais

- Não há tool universal de SQL, REST ou CRUD.
- `organization_id`, role e identidade do ator nunca são inputs públicos; vêm do contexto autenticado.
- Tools compõem ou extraem operações canônicas usadas também pela UI/API.
- Efeitos externos e destrutivos recebem capabilities explícitas; role `manager` é suficiente quando o risco não exige `admin`.
- Publicar agente não ativa automaticamente; testar versão usa sandbox sem efeito real.
- Movimentação entre funis cria o sucessor e encerra a origem pelo fluxo oficial.
- Descoberta e contratos são dinâmicos; números de tools são medidos, não codificados em documentação ou clientes.
- Mensagem externa nunca é INSERT direto: passa pelo handler oficial, adapter do canal, delivery tracking, eventos e auditoria.
- Fechar/reabrir usa `fn_service_status`; atribuir/transferir/liberar usa `fn_conversation_assign`; handoff e retomada usam os orquestradores de continuidade existentes.
- Upload binário permanece no endpoint bearer oficial de mídia; o MCP consome somente o path privado resultante, evitando base64 e URL assinada no protocolo.
- A fila desta versão é derivada, não uma tabela/entidade administrável; nenhuma `queue_id` fictícia foi criada.
- Classes B exigem desenho adicional, confirmação ou interação humana. Classes C permanecem fora.

## 6. Autorização, scopes e capabilities

O servidor autentica o token, resolve organização, ator, role, token e usuário provisionador, filtra `tools/list` e repete a autorização na chamada. A decisão soma:

1. role mínima (`viewer < agent < manager < admin`);
2. scope legado `mcp:read` ou `mcp:write`;
3. scope granular do domínio quando o token usa scopes granulares;
4. allowlist `tool:<nome>` quando presente;
5. capability exigida pela operação.

Domínios atuais: `agents`, `ai`, `appointments`, `automations`, `channels`, `contacts`, `conversations`, `followups`, `knowledge`, `leads`, `messages`, `pipelines`, `products`, `routing`, `team`, `templates` e `webhooks`.

Capabilities atuais: `agent_activation`, `agent_publication`, `automation_activation`, `destructive_operations`, `human_handoff` e `send_messages`. Envio externo exige `capability:send_messages`; handoff exige `capability:human_handoff`; destruição exige `capability:destructive_operations` somente onde há efeito destrutivo.

No atendimento, as leituras e escritas granulares usam `conversations:read/write`, `messages:read/write`, `channels:read` e `team:read` conforme o domínio de cada tool. `manager` com scopes e `send_messages` pode enviar; `admin` não é exigido. Solicitar handoff e devolver para IA exigem `human_handoff`; apagar nota interna exige `destructive_operations` além da regra autor ou manager+.

## 7. Multi-tenancy e secrets

- Toda query por service role filtra `organization_id` do contexto.
- Todo ID relacionado é validado no mesmo tenant antes de uso, inclusive referências de usuário/membership.
- Inputs MCP não aceitam `organization_id`.
- Credenciais, tokens, secrets, ciphertext, valores de credencial, refresh tokens e client secrets são sanitizados centralmente e também omitidos nas projeções específicas.
- Plaintext de token é mostrado somente na criação pelo fluxo administrativo original, não pelas tools operacionais.
- Auditoria nunca deve persistir conteúdo de mensagem, secret ou mídia privada quando identificadores e desfecho bastam.

## 8. Auditoria e erros

`lib/mcp/server.ts` audita toda chamada por `auditMcpToolCall()`, com tool, ator, organização, request, duração, sucesso/erro e recurso concreto declarado por `auditResource`. Mutações críticas podem emitir também o evento/auditoria do domínio canônico. Ausência esperada pode ser marcada como `sem_resultado` por `motivoDoVazio`; não é convertida em sucesso enganoso.

Erros MCP passam por `McpToolError`, códigos estruturados e `mcpErrorPayload()`. `sanitizeMcpPayload()` protege tanto sucesso quanto erro. Erros brutos de provider/banco não devem virar contrato público nem carregar secrets.

## 9. Registry e descoberta

- `lib/mcp/tools/index.ts`: registry executável agregado.
- `lib/mcp/registry.ts`: `MCP_REGISTRY`, contagem derivada e perfil público.
- `lib/mcp/tools/catalogo/`: apresentação humana e risco/pacotes.
- `lib/mcp/policy.ts`: domínio, scopes e capabilities.
- `tools/list`: fonte de verdade para clientes MCP; devolve apenas tools visíveis e autorizadas.

### Regra para a futura Skill Codex/Claude Code

A futura Skill **não deve depender de uma lista fixa**, como “180 tools”, nem embutir uma enumeração congelada. Ela deve consultar `tools/list` como fonte de verdade e escolher entre as tools realmente descobertas. Assim novas tools, capabilities e domínios podem aparecer sem quebrar a Skill.

## 10. Serviços canônicos reutilizados

Entre os serviços já reutilizados estão handlers de contatos/leads/conversas/mensagens, runtime e serviços de IA, `moverLeadParaOutroFunil`, operações de pipeline e tarefas, validação de custom fields, `openSharedContactConversation`, `sendMessageHandler`, `comIdempotencia`, `getConversationHandler`, `markConversationReadHandler`, `fn_service_status`, `fn_conversation_assign`, `listSelectableChannels`, estado canônico de canal, fila/eligibilidade de roteamento, passagem/handoff/retomada oficiais, agenda, follow-up, conhecimento, memória, templates e webhooks existentes.

Notas internas usam uma operação compartilhada em `lib/atendimento/notas-da-conversa.ts`, preservam autor e menções e auditam somente identificadores. Histórico de handoff lê `passagens_de_atendimento`; a timeline de transferência usa `registrarTrocaDeComando`. Nenhuma dessas operações grava mensagem externa por acesso direto à tabela.

## 11. Itens deliberadamente fora do MCP

- secrets existentes ou de saída;
- billing, infraestrutura, deploy e administração da plataforma;
- exclusão de tenant, impersonação e autoelevação/transferência de owner;
- SQL arbitrário e bypass de guardrails/RLS;
- conclusão automática de OAuth, QR/pairing ou consentimento humano;
- desativação de controles fundamentais;
- import/upload genérico sem prepare/preview/commit;
- operações administrativas de alto risco sem desenho de aprovação.

No recorte atual também não foram criados loops paralelos para operações comerciais inexistentes, merge/bulk/import/export sem serviço seguro, CRUD de fila inexistente e tipos de mensagem que o produto não suporta. Pairing QR/OAuth e ações de sessão que exigem consentimento continuam humanas. Upload/import/export genérico permanece fora.

## 12. Migrations do projeto MCP

Até o fim da Parte 5, nenhuma migration nova foi criada pelo projeto MCP. A Parte 6 adicionou a tripla `20260921092259_0382_replace_faq_atomico.sql` + baseline + MANIFEST para substituir FAQs atomicamente por `fn_replace_knowledge_faq_items`. As demais implementações reutilizaram schema, RPCs e mecanismos existentes, inclusive a reserva idempotente da migration 0321 e `fn_set_channel_routing`.

## 13. Arquivos importantes

- `/root/DESKCOMM-141-MCP-AUDITORIA.md`: auditoria original.
- `/root/DESKCOMM-141-MCP-PROGRESSO.md`: checkpoint operacional entre sessões.
- `/root/DESKCOMM-141-MCP-MASTER.md`: espelho de retomada deste documento.
- `docs/mcp/IMPLEMENTATION-MASTER.md`: histórico versionado.
- `lib/mcp/{auth,policy,registry,scopes,server,errors,audit,types}.ts`.
- `lib/mcp/tools/index.ts`, `lib/mcp/tools/catalogo/` e handlers por domínio.
- `docs/architecture/mcp-fundacao-ia.architecture.json`.
- `.changes/mcp-full-control.md`.

## 14. Compatibilidade com futuras versões do DeskcommCRM

O MCP não está congelado na 1.41.0. O fluxo de manutenção é:

```text
upstream oficial
→ fork do usuário
→ merge/update oficial
→ auditoria delta
→ testes de compatibilidade MCP
→ correções incrementais
→ deploy
```

Atualizações futuras não devem reconstruir o MCP do zero. Devem comparar a versão anterior com a nova e produzir uma auditoria delta contendo, no mínimo:

- VERSÃO ANTERIOR;
- VERSÃO NOVA;
- NOVOS DOMÍNIOS;
- NOVAS FUNCIONALIDADES;
- SERVIÇOS ALTERADOS;
- TOOLS AFETADAS;
- TOOLS NOVAS NECESSÁRIAS;
- SCOPES NOVOS;
- CAPABILITIES NOVAS;
- MIGRATIONS;
- TESTES QUEBRADOS.

O delta identifica contratos afetados, executa regressão MCP e corrige somente o necessário. `tools/list`, os testes de registry e os testes dos serviços compartilhados detectam evolução sem transformar uma estimativa histórica em contrato.

## 15. Documentação final futura

Ao final do projeto serão produzidos, sem antecipar conteúdo ainda instável:

- `docs/mcp/INSTALL-NEW-VPS.md`;
- `docs/mcp/UPDATE-DESKCOMM.md`;
- `docs/mcp/ARCHITECTURE.md`;
- `docs/mcp/COMPATIBILITY.md`;
- `docs/mcp/AUDIT-NEW-VERSION.md`;
- `docs/mcp/TROUBLESHOOTING.md`.

Posteriormente será criado o repositório `deskcomm-mcp-skill`, com suporte a Codex e Claude Code, instalação local/global, descoberta dinâmica via `tools/list` e verificação de conexão. **A Skill não será criada durante as Partes 1–4.**

## 16. Pendências e próxima fase

Pendências deliberadas: pairing/conexão por QR ou OAuth continua humano; upload binário usa o endpoint bearer oficial em vez de uma tool MCP com base64; não existe entidade `queue_id`; não há edição de nota interna no produto, somente criação e exclusão autorizada; import/export genérico segue sem serviço compartilhado seguro. O produto não possui escrita/transição oficial de pedidos, webhook outbound genérico, delivery log outbound nem simulação de entrega, portanto essas operações não foram inventadas. O gate global de banco mantém a falha alheia documentada em `prospecting-agent-setup.test.ts`.

Próxima fase: a fase definida pelo roteiro seguinte, começando por auditoria delta do domínio escolhido. Não iniciar automaticamente. Antes de ampliar o MCP, medir `tools/list`, reler serviços oficiais e executar testes de compatibilidade.

## 19. Living System Checklist — Parte 5

1. Entrada: token MCP e `tools/list`, sem organização no payload.
2. Saída: handlers de agenda, workers/enrollments, `event_log` e routing worker reais.
3. Registro: audit actions canônicas mais eventos/timeline preservados pelos serviços.
4. Tela: Agenda, Follow-up, Automações, Runs e Configurações › Routing existentes.
5. Porta: registry/catálogo MCP e navegação já existente; nenhuma tela paralela.
6. Anti-morte: horários/preflight, `next_eval_at`, estados terminais e requeue/backoff.
7. Configuração: as mesmas superfícies que a UI lê e altera; ausência retorna erro acionável.
8. Continuidade: confirmação humana explícita e simulações sem efeito irreversível.
9. Laço: enrollment events, runs, audit, erros e decisões simuladas orientam a próxima ação.
10. Mapa: `docs/architecture/mcp-fundacao-ia.architecture.json` contém a Parte 5 e suas arestas.

## 20. Validação final da Parte 5

- Foco: 14 arquivos/168 testes.
- Regressão MCP: 26 arquivos/230 testes.
- Catálogo e mapa: 3 arquivos/619 testes.
- Banco relevante: 8 arquivos/84 testes.
- Typecheck: aprovado com `NODE_OPTIONS=--max-old-space-size=3584`.
- ESLint alterados, `lint:channels`, `lint:role-rank` e release check: aprovados.
- `test:db` global: 253/254 arquivos; 5 falhas fora do diff em prospecting, reproduzidas isoladamente.
- Migrations: nenhuma. E2E, `test:shell`, build e suíte unitária global não executados por escopo.

## 21. Parte 6 — knowledge, templates, comércio, integrações, canais e equipe

Estado de entrada: 153 tools. A Parte 6 acrescenta 37 handlers e eleva o registry derivado a 190; `tools/list`, e não este número histórico, continua sendo a fonte de verdade para clientes futuros.

Auditoria delta concluída nos nove recortes solicitados:

- Knowledge real: `ai_knowledge_sources`, `ai_faq_items`, versões/chunks, storage privado, `event_log` e `rag-indexer`. O MCP administra texto e FAQ, consulta estado/erro, solicita indexação pelo evento oficial e encaminha upload binário ao endpoint oficial. Vínculo com agente permanece em `ai_agent_versions.knowledge_source_ids`, já coberto pela administração de drafts.
- Templates internos: `message_templates`, separados dos templates externos em `meta_templates`. CRUD e duplicação não enviam mensagem; preview continua em `crm_render_message_template`; aprovação externa permanece humana.
- Comércio: CRUD do `catalog_products`, com moeda da organização e estoque somente porque existe no modelo. `orders` é histórico sincronizado sem serviço de criação/transição; por isso ganhou somente list/get.
- Webhooks: o recurso real é a entrada inbound `webhook_sources`, não uma assinatura outbound genérica. Configuração, ativação, recebimentos e exclusão omitem `secret_encrypted`; não foi inventado teste externo ou delivery log inexistente.
- Integrações: `tenant_integrations` expõe somente provider, estado, scopes e metadados não sensíveis. OAuth e desconexão retornam ação humana na superfície oficial; access/refresh token, secret e ciphertext nunca saem.
- Canais: leitura de health/status e configuração atômica de acesso da IA. Provisionamento, pairing/QR, reconexão e arquivamento permanecem humanos e não expõem o nome/segredo interno de sessão.
- Equipe: consulta, convites, reenvio/revogação, áreas operacionais, role delegável, revogação e reativação. O MCP só aceita `viewer|agent|manager`, bloqueia o provisionador do token e transforma qualquer alteração de `admin`/owner em ação humana. As mutações administrativas ainda validam que o token foi provisionado por um admin ativo; o `role:manager` do token não concede esse privilégio. Áreas de interface não concedem autorização.
- Configurações: routing e agenda já estavam na Parte 5; billing, infraestrutura, branding de plataforma, secrets e exclusão de tenant ficaram fora. Nenhuma configuração genérica paralela foi criada.

Serviços e decisões: `emit_event`/`rag-indexer`, storage oficial, `fn_replace_knowledge_faq_items`, render canônico de templates, `moedaDaOrganizacao`, serviços de entradas automáticas, `fn_configurar_pre_go_live_canal` e `emitirConvite`/`reenviarConvite`. Configurar continua distinto de executar: template não envia mensagem, webhook não chama destino, canal não envia e produto não conclui pedido.

Schema: migration `0382_replace_faq_atomico`, apêndice idempotente no baseline e MANIFEST. A rota HTTP e o MCP compartilham a RPC transacional, que valida todo o novo conjunto antes do delete e só concede EXECUTE ao `service_role`. O número foi corrigido de `0381` para `0382` após a checagem ampliada encontrar o primeiro em dois PRs abertos.

Compatibilidade preservada:

```text
upstream → fork → merge oficial → auditoria delta → testes MCP → correção incremental → deploy
```

Nesta fase houve um único merge seguro de `origin/main` (`de74202f2`) sobre a base comum `a796ea3c9`; os commits MCP foram preservados. A checagem posterior de colisões atualizou a ref para `df1b18f2eb`; conforme a regra de um merge por fase, os 23 commits novos não foram mesclados novamente e ficam para a próxima auditoria delta.

## 22. Living System Checklist — Parte 6

1. Entrada: token MCP e IDs, nunca `organization_id` público.
2. Saída: serviços/RPCs oficiais alimentam as mesmas tabelas e workers das telas.
3. Registro: toda escrita declara recurso auditável; indexação e convites preservam eventos/auditoria do domínio.
4. Tela: Acervo, Respostas prontas, Produtos, Integrações, Conexões e Equipe continuam sendo as superfícies humanas.
5. Porta: registry/catálogo MCP; nenhuma UI paralela.
6. Anti-morte: index state/error, health, status de integração, convite e revogação deixam próximo passo explícito.
7. Configuração: toda configuração nova tem superfície existente; QR/OAuth/upload e privilégio elevado voltam à pessoa.
8. Continuidade: conhecimento indexado retorna ao agente; humano mantém controle de canal, consentimento e equipe.
9. Laço: worker, estado, erro, auditoria e reconsulta fecham cada mutação assíncrona.
10. Mapa: `docs/architecture/mcp-fundacao-ia.architecture.json` inclui a Parte 6 e as ações humanas.

## 23. Validação final da Parte 6

- Foco/registry/perfil público: 4 arquivos, 25 testes aprovados.
- Regressão MCP das Partes 2–6: 21 arquivos, 201 testes aprovados.
- Catálogo, classificação read/write e mapa: 3 arquivos, 725 testes aprovados. A sonda de mutação passou a reconhecer também as definições tipadas pelos factories `read()`/`write()` de IA.
- Banco focado: 1 arquivo, 4 testes aprovados; instalação e reaplicação idempotente do baseline aprovadas.
- Banco global: 254/255 arquivos e 2.132 testes aprovados; as únicas 5 falhas são as preexistentes de `prospecting-agent-setup.test.ts`, por ausência de credencial/modelo, fora do diff.
- Typecheck aprovado com `NODE_OPTIONS=--max-old-space-size=3584`.
- ESLint global aprovado com zero erro; avisos preexistentes permanecem. ESLint dos alterados, `lint:channels`, `lint:role-rank`, release check e `git diff --check` aprovados.
- Colisão de migration conferida contra `origin/main`, 65 outras refs e 17 PRs abertos: `0382` e seu timestamp estão livres.
- E2E, `test:shell` e build não foram executados: não houve mudança de UI, jornada visual ou packaging.

Commits recuperáveis da fase:

- `598ac209e` — merge único e seguro do upstream no início da fase;
- `45b3900d4` — implementação, testes, migration tripla, catálogo e arquitetura da Parte 6;
- `1edc92c48` — renumeração da migration após a sonda ampliada detectar colisão em PRs abertos.

## 17. Living System Checklist — Parte 4

1. Entrada: token MCP autenticado e `tools/list`; nenhuma tool aceita `organization_id`.
2. Saída: handlers/RPCs oficiais alimentam Inbox, canal, delivery tracking, fila e histórico.
3. Registro: envio, estado, transferência, handoff, retomada e notas têm auditoria/evento/timeline sem conteúdo sensível desnecessário.
4. Tela: conversas, mensagens, notas, casos, canais e histórico continuam visíveis nas superfícies existentes; não surgiu tela paralela.
5. Porta: registry e catálogo são a porta MCP; a navegação do produto não mudou.
6. Anti-morte: fila, responsável, handoff, fechamento, erros de envio e próxima ação são estados observáveis.
7. Configuração: disponibilidade, roteamento e canais continuam nas superfícies reais; o MCP apenas descobre o que está utilizável.
8. Continuidade: passagem IA→humano carrega contexto e histórico; retomada humano→IA usa checkpoint e validações oficiais.
9. Laço de retorno: status/erro/ack de mensagem, auditoria, timeline e respostas idempotentes fecham o resultado da ação.
10. Mapa: `docs/architecture/mcp-fundacao-ia.architecture.json` inclui atendimento, canal e ação humana.

## 18. Validação final da Parte 4

- Foco da Parte 4: 10 arquivos, 90 testes aprovados.
- Regressão MCP relevante: 23 arquivos, 203 testes aprovados.
- Typecheck: aprovado.
- ESLint somente nos arquivos TypeScript alterados: 0 erros e 0 warnings.
- `lint:channels`: aprovado, sem dívida nova.
- `git diff --check`: aprovado.
- `pnpm release:conferir`: aprovado; próxima versão calculada 1.42.0, sem escrever arquivos.
- Não executados por escopo: suíte global, `test:db`, `test:e2e`, `test:shell` e build. Não houve mudança de schema, UI ou packaging.
- Não houve envio real, alteração de conversa real, push ou deploy.

## 24. Parte 7 — uploads, importações, exportações, bulk e gaps finais

Estado de entrada: 190 tools. A auditoria delta encontrou 12 operações seguras e elevou o registry derivado a 202 tools. O upstream `3538380b9` estava 31 commits à frente da base comum; um único merge seguro gerou `4ab5dfabe`, preservando a FAQ MCP e o novo bloco upstream de configurações por empresa no baseline.

| Domínio                        | Operação real                                                         | Cobertura MCP                                             | Classe/ação                                                |
| ------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Contatos, leads e produtos     | importação CSV multipart, 5 MB/500 linhas                             | instrução com formato, campos, limites, dedupe e endpoint | B: confirmação/upload humano; não há preview/job oficial   |
| Conversas e templates externos | upload oficial de mídia com MIME/tamanho                              | instrução; conversa e mídia validadas no tenant           | B: binário no endpoint oficial                             |
| Knowledge e skills             | PDF/DOC/TXT/MD/ZIP nos endpoints oficiais                             | instrução padronizada, sem base64 ou credencial           | B: upload/revisão humana                                   |
| Leads                          | bulk oficial, máximo 50                                               | preview tenant-scoped e preparo da ação                   | B: execução humana; endpoint não possui idempotência       |
| Auditoria                      | exportação CSV filtrada, até 10 mil registros                         | preparo com filtros/endpoint e alerta de PII              | B: download humano                                         |
| LGPD                           | job/worker e estado de exportação                                     | consulta de estado/resultado higienizado                  | A: implementado; arquivo permanece no fluxo humano oficial |
| Tokens MCP                     | API/UI admin, plaintext uma vez na criação                            | instrução sem emitir, ler plaintext ou autoelevar         | B/C: administração humana; autoelevação proibida           |
| Operação                       | health agregado de canais, knowledge, automações, follow-up e eventos | diagnóstico seguro, sem IP, filesystem ou segredo         | A: implementado                                            |

Uploads de logo continuam C por exigirem administração/MFA e alterarem branding; avatar não possui upload independente, pois é sincronizado do canal. Não existem imports oficiais de pedidos ou knowledge em lote, exports gerais de contatos/leads/produtos/pedidos/conversas/knowledge, nem bulk seguro para esses domínios. Nenhum serviço foi inventado.

As 12 tools novas são: `crm_get_contact_import_instructions`, `crm_get_lead_import_instructions`, `crm_get_product_import_instructions`, `crm_get_conversation_media_upload_instructions`, `crm_get_template_media_upload_instructions`, `crm_get_ai_skill_import_instructions`, `crm_preview_lead_bulk_action`, `crm_prepare_lead_bulk_action`, `crm_prepare_audit_export`, `crm_get_privacy_export_status`, `crm_prepare_mcp_token_management` e `crm_get_operational_diagnostics`.

Todas são read-only no MCP. `organization_id` vem do contexto; referências são filtradas pela organização; respostas grandes são agregadas ou limitadas; caminhos privados, signed URLs, mensagens brutas de storage, credenciais e plaintext de token não saem. O contrato compartilhado de ação humana usa `human_action_required`, `code`, `reason`, `resource`, `instruction` e `endpoint|href` quando aplicável. Respostas anteriores de QR/OAuth/upload/privilégio elevado foram alinhadas a esse formato.

Gaps C mantidos fora: billing, secrets, infraestrutura/VPS, SQL arbitrário, exclusão de tenant, autoelevação, transferência de owner, MFA/segurança pessoal, consentimento OAuth automático, logo administrativo e CRUD/exports/imports inexistentes. Não houve migration na Parte 7.

## 25. Living System Checklist — Parte 7

1. Entrada: token MCP, filtros e IDs; nunca organização pública ou binário em base64.
2. Saída: endpoints multipart, RPC bulk, exportador CSV e worker LGPD oficiais.
3. Registro: as tools não mutam; os endpoints humanos preservam auditoria/eventos do domínio.
4. Tela: Inbox, importadores, Auditoria, LGPD, Tokens e diagnósticos existentes continuam sendo a superfície.
5. Porta: registry/catálogo MCP aponta para endpoints/hrefs oficiais, sem UI paralela.
6. Anti-morte: instrução, limite, dedupe, retry, estado e próximo passo ficam explícitos.
7. Configuração: tokens, uploads e consentimentos continuam nas superfícies humanas autorizadas.
8. Continuidade: o MCP prepara/observa e a pessoa conclui efeitos de alto impacto.
9. Laço: preview, status LGPD e diagnóstico permitem observar resultado e decidir a próxima ação.
10. Mapa: `docs/architecture/mcp-fundacao-ia.architecture.json` inclui arquivos/operações e ação humana.

## 26. Próxima fase

Executar a auditoria final do MCP inteiro, sem iniciar a Skill antes desse fechamento. Medir o registry por `tools/list`, revisar o delta após `3538380b9` e converter em tool somente eventual serviço novo que seja seguro e canônico.

## 27. Validação da Parte 7

- Foco Parte 7/registry/catálogo: 4 arquivos e 636 testes aprovados.
- Regressão MCP final: 29 arquivos e 256 testes aprovados. A primeira rodada encontrou somente um contador histórico, corrigido antes desta medição.
- Banco global: baseline install/update idempotente aprovado; 254/255 arquivos e 2.133 testes verdes. Permanecem as 5 falhas preexistentes de `prospecting-agent-setup.test.ts` por ausência de provider/modelo, fora do diff.
- Cercas: 140/141 arquivos e 1.369/1.370 testes verdes. A única falha é dívida anterior da Parte 3 em `lib/mcp/tools/tags.ts`, que usa a tag textual como `resourceId`; o HEAD de entrada já continha as duas ocorrências.
- A cerca específica da posição da varredura de privilégios passou 5/5 após o bloco FAQ ser recolocado antes dela. A Parte 7 não criou migration; a alteração no baseline corrige somente a ordem resultante do merge.
- Typecheck, ESLint dos alterados, `lint:channels`, `lint:role-rank`, release check e `git diff --check`: aprovados.
- Sonda de mutação: trocar temporariamente `human_action_required` para falso derrubou 3 testes pelo motivo esperado; a linha foi restaurada e a regressão final voltou a verde.
- E2E, `test:shell` e build não executados por escopo: não houve UI, packaging ou mudança de schema.

Incidente de teste: uma tentativa de configuração Vitest isolada ignorou o filtro e acionou o setup E2E disponível no ambiente, que criou fixtures de teste em um Supabase remoto antes da interrupção. O arquivo local de credenciais foi enviado à lixeira. A remoção remota ficou pendente para uma pessoa autorizada, pois esta fase não autoriza apagar dados externos.
