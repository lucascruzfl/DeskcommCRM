# Auditoria diferencial MCP v1.62.0 → v1.69.0

**Fechamento local: os seis gaps A foram implementados e testados; gaps A = 0 no recorte desta auditoria.**
Jev permanece exclusivamente observacional no MCP. Os gates finais da candidata
são registrados em [PARITY-1.69.0-REVIEW.md](PARITY-1.69.0-REVIEW.md).
Nenhuma release foi iniciada; RELEASE-AUDIT não foi atualizado.

## Referências e método

- Base oficial do delta: `v1.62.0`, `f12130953174088b201f1591779f8e484eb76976`.
- Alvo funcional congelado: `v1.69.0`, `e8e2912178031d321caf0912b270ee06bd2c36c7`.
- Base MCP preservada: `1fb9afd535d4bdad3874166b5dd0bcfd79db3ec2`.
- Merge estrutural verde auditado: `2b045879eebd51f83324d2d3d8c0d3dc6eee4973`.
- Os dois pais são a base MCP e o commit upstream acima, nessa ordem.

A auditoria inicial começou depois do merge local e não alterou código, SQL, tools,
catálogo, scopes ou policy. Comparação entre os dois commits oficiais: 295 commits,
310 arquivos no produto; 115 caminhos no recorte pedido — 21 API (14 de produto e
7 de testes), 81 lib e 13 em migrations (12 SQL + MANIFEST). `app/actions/**` não
tem delta. Também foi lida a mudança de ação em `app/app/ai/agents/[id]/_actions.ts`
e a nova interação de adoção de Skills em `app/app/ai/skills/_client.tsx`.
As 14 rotas/handlers de produto modificados já existiam: houve ampliação de
contratos, não criação de 14 endpoints novos.

Inventário por superfície, leitura dos handlers e serviços, comparação com
`lib/mcp/tools/**`, `lib/mcp/tools/catalogo/**`, registry, `lib/mcp/policy.ts`,
`lib/mcp/server.ts`, scopes, capabilities e `lib/managed-clients/policy.ts`.
A contagem é de gaps semânticos; não é requisito de quantidade de tools. Helpers,
colunas, triggers e cópias de testes não viram operações MCP independentes.
Dívida preexistente sem mudança no delta não foi incorporada à contagem.

A = operação org-scoped, sem segredo/binário obrigatório/decisão humana exclusiva,
adequada à delegação com o papel e policy reais. B = decisão humana, alteração
crítica ativa, efeito externo, segredo, binário ou irreversibilidade. C = mecanismo
interno, UI, infraestrutura ou preflight sem uma nova superfície independente.
Uma mesma família tem leituras A, decisões B e execução interna C.

## Matriz A/B/C da auditoria inicial (histórica)

| Superfície upstream                                                                            | Mudança v1.62 → v1.69                                                                                                        | Classe e cobertura real                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ai/pacing; pacing-knobs; channel_knobs; migrations 0538/0541                                   | Janela da resposta separada do disparo e quatro tempos de resposta por conexão                                               | A: leitura e edição limitada dos seis campos novos, gaps A1/A2. `crm_get_channel_admin` lê a conexão e AI access, não channel_knobs. `crm_update_campaign_pacing` governa campanhas, não substitui esta operação. B: pular aquecimento/assumir risco e habilitar recurso opcional continuam decisões humanas. C: cálculo efetivo, defaults e execução anti-ban.    |
| ai/agents/versions; validation; migration 0540                                                 | inbound_debounce_ms por versão, null herda instalação, 0 imediato, teto 60000 ms                                             | A: escrever já atravessa schemas compartilhados, spreads de criação/patch e serviço canônico de duplicação. A3: projeção MCP de leitura omite o campo. C: coalescência de rajada no dreno e fallback de env.                                                                                                                                                       |
| ai/agents/pause e assignable                                                                   | Comentários reconciliados com paused_at e diretório de quem atende                                                           | A existente: `crm_pause_ai_agent` mantém versão/ponteiro; diretório seguro preservado. Não há operação nova. Ativação e publicação mantêm capabilities próprias; sem ampliação.                                                                                                                                                                                    |
| ai/skills GET; skills/comparativo e versao-nova-catalogo                                       | Aviso de versão nova, vínculo de origem e comparação descrição/matcher/corpo                                                 | A4: falta leitura MCP do estado e comparativo com a plataforma; histórico da org não permite descobrir a versão atual do catálogo. Helpers puros C.                                                                                                                                                                                                                |
| ai/skills/[name] PUT                                                                           | Edição conserva forked_from_version_id para não apagar o aviso de atualização                                                | A5: `crm_save_ai_skill` já existe, mas lê só manifest e não passa forkedFromVersionId ao serviço de versionamento. Consultar/restaurar versão própria continuam cobertos. Pacote com arquivos exige upload humano B.                                                                                                                                               |
| SkillsClient: Adotar versão nova → POST /skills/[name]/install (rota preexistente)             | Nova interação substitui o procedimento ativo pela cópia atual do catálogo; customização anterior fica no histórico          | B nesta auditoria: decisão explícita sobre substituir o procedimento em uso, após conferir alterações. Não inferir A só porque o endpoint é manager ou adicionar uma tool de install para atingir contagem. O comparativo anterior à decisão é A4. Não altera a delegação textual já consolidada de save/restore.                                                  |
| ai/jev GET; novas tarefas humano, opt_out e followup; ai/runs GET                              | Percebidos/concordância, sem_atendente/sem_fluxo, estados efetivos e explicações das chamadas novas                          | A6: leitura segura org-scoped sem equivalente para as novas observações. É o domínio maior a destacar. `crm_list_ai_agent_runs`/get filtram purpose=agent_turn; diagnóstico operacional não lê Jev. Não cobrem tarefas/calls novas.                                                                                                                                |
| ai/jev PATCH; decisao/config/tarefas; workers                                                  | Novos modos observacionais, pedido humano/opt-out e follow-up só observa                                                     | B: admin, credencial validada, aceite LGPD, escolha do modo e ativação; não delegar bloqueio, handoff, consentimento ou troca de fornecedor. C: observação, aviso, preconditions e execução interna. Followup rejeita decidindo (`jev_tarefa_so_observa`); a IA habitual escolhe a saída.                                                                          |
| ai/inbox/[id] PATCH; migrations 0536/0542                                                      | Reabrir duplicado responde 409; dedupe atômico e avisos Jev resolvidos quando pedido já foi atendido                         | C: integridade e representação de erro. Resolução/decisão humana B existente; não é autorização para o MCP atender automaticamente o pedido observado.                                                                                                                                                                                                             |
| contacts/_handler; termo-de-busca                                                              | Piso de busca e normalização de pontuação/espaços, sem consulta abaixo do piso                                               | A já coberto: `crm_search_contacts` chama o mesmo listContactsHandler. Sem tool duplicada.                                                                                                                                                                                                                                                                         |
| contacts DELETE; migration 0533                                                                | Exclusão atômica da ficha/histórico, rollback e detalhes de vínculos impeditivos                                             | Operação irreversível B para nova delegação. A tool preexistente `crm_delete_contact` e sua capability destructive_operations foram preservadas sem ampliar permissões; catálogo a marca apenasHumano. A nova RPC SECURITY INVOKER mantém RLS e organization_id em cada DELETE; ingresso service-role MCP continua com filtro explícito. Não criar nova tool LGPD. |
| contacts/import, csv, schemas e perfil-do-pais                                                 | Exemplo E.164 do país e mensagens coerentes, em vez de DDI brasileiro fixo                                                   | B: upload CSV oficial; instrução MCP existente preservada. C: apresentação/validação compartilhada, sem operação administrativa nova.                                                                                                                                                                                                                              |
| followup engine/node-handlers/turn/classify; migrations 0534/0535                              | Classificar espera a carência efetiva, lê resposta ao envio correto, registra classify_waiting e outcome no_reply            | A já coberto: tools existentes administram grafo e consultam inscrições/eventos; crm_get_followup_enrollment devolve event_type/payload dos eventos novos. C: deadline, ponte, execução e RLS por operação. Nenhuma tool nova para classificar prematuramente ou enviar mensagem.                                                                                  |
| agent-engine/edge/crm/move-lead-stage e inbound-turn                                           | Respeita pipeline_ids da versão publicada ao sincronizar estágio                                                             | C: enforcement de autorização em runtime. Configuração A já passa pelos schemas e validação org-scoped de versões MCP. Funis não autorizados não viram fallback implícito.                                                                                                                                                                                         |
| LGPD: cascata, export-collector; migrations 0531/0537/0539                                     | Seções opcionais protegidas, notas/IA/estado do lead, social_identity, transcrição e export sem resultados de outras pessoas | C: registro fechado, triggers/RPC internas e transformação JSON. B: exportação/anonimização, PII, confirmação humana e irreversibilidade. Nenhuma ampliação automática de MCP; status/preparação existentes permanecem.                                                                                                                                            |
| reports/tags                                                                                   | Relatório por etiquetas entre os recursos do produto alvo                                                                    | A já coberto por crm_get_tags_report, manager, mcp:read + conversations:read quando granular, área inbox e handler compartilhado. O handler de reports/tags não muda neste delta; a entrega já entrou no checkpoint 1.62. Sem duplicação.                                                                                                                          |
| agenda/fuso/grade, tipos de lead/card-state, auth currency/country                             | Grade/confirmar no mesmo fuso, relógio do estágio correto, moeda/país atravessam sessão e suporte                            | C: correções internas e de UI. Agendamento, leads e handlers MCP existentes permanecem; sem operação nova, refresh OAuth ou mudança de organização via token.                                                                                                                                                                                                      |
| IA: repository, budgets/cost/pricing, before-send, duplicate reply, saldo, webhook/event drain | Turnos não duplicam resposta, parâmetros de resposta/atraso e retry do provedor coerentes                                    | C: execução e confiabilidade; orçamento/segredo/fornecedor não são automaticamente delegados. Dados de rascunho e escopo MCP consolidados preservados.                                                                                                                                                                                                             |
| prospecting/agent-setup e playbook seed 0532                                                   | Agenda aprende dois passos e setup adota schemas/serviços canônicos                                                          | C: instrução/runtime. Onboarding MCP/managed e ISP não são expandidos; autorização platform_admin full permanece.                                                                                                                                                                                                                                                  |
| update/install/ARM64; workflows; skill mirrors                                                 | Imagens ARM64, guards do update e matriz multiarch/manifesto junto com docs-safe MCP                                         | C: kit/infra/CI. Nenhuma superfície MCP nova. Credenciais/OAuth/binários permanecem B. Sem atualizar VPS, publicar imagens ou fazer deploy.                                                                                                                                                                                                                        |
| baseline/MANIFEST/database.types e demais migrations                                           | União de schema, RLS/grants/revokes, funções e triggers do alvo com história MCP/managed                                     | C: suporte às operações acima. 12 SQL oficiais com timestamp e bytes intactos, bloco 0531–0542; 416 históricos intactos. Revisão RPC de 277 funções sem mudar ACL antigo.                                                                                                                                                                                          |

## Gaps A exatos

| ID  | Contrato que falta                                                                                      | Evidência upstream e MCP                                                                                                                                                                         | Papel/limite para uma próxima etapa                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Ler os seis campos novos de janela de resposta/atraso por conexão, efetivos + overrides/defaults/bounds | [GET pacing](../../app/api/v1/ai/pacing/route.ts), [knobsView](../../lib/ai/pacing-knobs.ts); nenhuma tool lê channel_knobs                                                                      | GET canônico agent; mcp:read e channels:read quando granular; área connections, sessão/org explícitas e recurso opcional real. Sem credenciais.                                                                                                               |
| A2  | Editar os seis campos novos de pacing por conexão com a mesma validação de estado resultante            | PUT pacing; resposta_start_hour, resposta_end_hour, atraso_notar_ms, ms_por_caractere, atraso_minimo_ms, atraso_maximo_ms; nenhuma tool usa pacingKnobsUpdateSchema                              | manager; mcp:write + channels:write quando granular; área connections, canal não arquivado, filtro org, ranges e pares efetivos. Excluir skip_warmup/ativação humana. Não enviar mensagem.                                                                    |
| A3  | Devolver inbound_debounce_ms em versões lidas pelo MCP                                                  | [rotas de versões](../../app/api/v1/ai/agents/[id]/versions/route.ts) incluem campo; [MCP_VERSION_COLUMNS](../../lib/ai/mcp-service.ts) não inclui                                               | Ampliar semântica das leituras existentes manager/agents:read/área agents; criação, patch e duplicação já cobertos. Sem tool paralela.                                                                                                                        |
| A4  | Consultar versao_nova_catalogo e comparativo da cópia da org versus versão corrente da plataforma       | [GET skills](../../app/api/v1/ai/skills/route.ts), [compararSkill](../../lib/ai/skills/comparativo.ts); get MCP só versão org e list só histórico próprio                                        | GET canônico agent; MCP existente get é manager, list é agent. Auditar papel por dado, mcp:read, domínio/área skills explícitos; plataforma somente organization_id null, nenhuma org vizinha. Consulta não adota versão.                                     |
| A5  | Conservar forked_from_version_id ao salvar versão textual de Skill pelo MCP                             | [PUT skill](../../app/api/v1/ai/skills/[name]/route.ts) passa forkedFromVersionId; [crm_save_ai_skill](../../lib/mcp/tools/skill-versions.ts) não passa                                          | Corrigir equivalente existente, manager + mcp:write + capability:agent_publication, área skills. Tenant explícito e pacote recusado continuam obrigatórios; sem nova tool.                                                                                    |
| A6  | Consultar estado/indicadores e explicações das observações novas do Jev (humano/opt_out/followup)       | [GET Jev](../../app/api/v1/ai/jev/route.ts), [tarefas](../../lib/ai/decisao/tarefas.ts), [runs](../../app/api/v1/ai/runs/route.ts); tools de runs restringem agent_turn e diagnóstico não lê Jev | manager como GET canônico, somente leitura; policy da superfície ai_jev aponta /app/ai/atendimento. DTO seguro, contagens/limites e filtros org; não expor frase do cliente, chave ou erro cru do provedor. Não ligar, decidir, bloquear nem passar conversa. |

A1/A2 são contratos de leitura e escrita distintos, não duas tools prescritas.
A3/A5 são ajustes de equivalentes já existentes. A4/A6 podem usar superfícies
existentes ou compartilhadas após desenho: a auditoria não fixa nomes nem contagem.

**Domínio maior: observabilidade do Jev (A6).** Não é só acrescentar campo ao schema:
as novas tarefas possuem famílias, estado efetivo, preconditions, contagens,
concordância, chamadas/falhas e limites próprios. Não reusar um filtro agent_turn
como se cobrisse tudo, nem classificar o domínio inteiro como A. Escritas, aceite,
ativação, observar/avisar equipe e decisões humano/opt-out continuam B/C conforme
acima. Este recorte exigiu a etapa própria autorizada pelo prompt seguinte; seu
fechamento está registrado abaixo, sem delegar as escritas B.

Adoção de catálogo ficou B por substituir imediatamente o procedimento ativo e
poder tirar customizações de uso; isso não cancela as operações textuais de
save/restore já consolidadas. Uma eventual proposta futura de delegação exigiria
revisão semântica explícita, não conversão automática feita durante este merge.

## Preservação e limites

Nenhum arquivo de lib/mcp ou lib/managed-clients mudou no merge estrutural em
relação à base MCP. Schemas/serviços upstream compartilhados evoluíram conforme o
alvo; os gaps acima registram onde a adaptação de projeção/comportamento ainda falta.
Continuam token→org, scopes, roles, capabilities, managed policy, filtro explícito
com service-role, audit/redaction/PII, API-token provenance, platform_admin full,
onboarding oficial, B2B, tags/reports, Honorários, Propostas, ISP, knowledge/memory,
Intent Router, agents/followups, human handoff, docs-safe e espelhos de skills.

[Integração estrutural e provas SQL](INTEGRATION-1.69.0.md) e
[fotografia canônica da reserva](INTEGRATION-1.69.0-RESERVATION.json).
Typecheck/lint/channels/role-rank, testes dirigidos de aplicação/MCP, shell e
install/update PG15/PG17 estão verdes. Não foi executado fechamento completo de
release, nem foi afirmada equivalência funcional exaustiva por toda a suíte E2E.
RELEASE-AUDIT.json permanece idêntico à base, ainda descrevendo somente 1.57.0.

A etapa inicial foi documental: não implementou tools ou gaps. A etapa de
fechamento abaixo implementa apenas os seis gaps A, sem integrar código posterior a v1.69.0. Sem push, PR, tag,
release, deploy ou acesso aos artefatos operacionais proibidos da raiz.

## Inventário rastreável das rotas/handlers modificados

| Caminho de produto                                | Veredito nesta auditoria                                        |
| ------------------------------------------------- | --------------------------------------------------------------- |
| app/api/v1/ai/agents/[id]/pause/route.ts          | Comentário/estado existente; A coberto, sem operação nova       |
| app/api/v1/ai/agents/[id]/versions/[vid]/route.ts | Campo novo GET/PATCH; A3 leitura pendente, escrita coberta      |
| app/api/v1/ai/agents/[id]/versions/route.ts       | Campo novo GET/POST; A3 leitura pendente, escrita coberta       |
| app/api/v1/ai/agents/assignable/route.ts          | Comentário/diretório; C sem operação nova                       |
| app/api/v1/ai/agents/route.ts                     | Projeção de versão; A3 nas leituras de versão MCP               |
| app/api/v1/ai/inbox/[id]/route.ts                 | 409 para duplicação; C, ação humana existente                   |
| app/api/v1/ai/jev/route.ts                        | A6 novas leituras; B admin/ativação/aceite; C preflight/runtime |
| app/api/v1/ai/pacing/route.ts                     | A1/A2 novas configurações, B bypass do aquecimento              |
| app/api/v1/ai/runs/route.ts                       | Explicações das chamadas novas, recorte A6; apresentação C      |
| app/api/v1/ai/skills/[name]/route.ts              | A5 origem preservada ao editar, pacote B                        |
| app/api/v1/ai/skills/route.ts                     | A4 aviso/comparativo novo, helper C                             |
| app/api/v1/contacts/[id]/route.ts                 | Detalhes da recusa de DELETE; B/C, contrato existente           |
| app/api/v1/contacts/_handler.ts                   | Busca A coberta, transação de DELETE B/C preservada             |
| app/api/v1/contacts/import/route.ts               | Upload B, exemplo de telefone C                                 |

Testes API (7 caminhos), helpers puros, tipos e fontes restantes estão refletidos
nas famílias da matriz. A existência de teste ou função SQL nova não cria gap A.

## Fechamento dos seis gaps A — candidata local v1.69.0

Estado inicial desta etapa: branch `sync/upstream-1.69.0`, HEAD
`970a78d93b7026d24f4c0bed7e1919529c78e5fc`, árvore limpa na worktree
`/tmp/deskcomm-upstream-169`. Merge `2b045879eebd51f83324d2d3d8c0d3dc6eee4973`
e commit documental preservados. Alvo exclusivo continua `e8e2912178031d321caf0912b270ee06bd2c36c7`.

| Gap | Fechamento confirmado por código e testes                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | `crm_get_channel_admin` acrescenta `canal.pacing` para canal de mensagem; mantém o contrato anterior. `lib/ai/pacing-service.ts` e `knobsView` fornecem effective, overrides, defaults, bounds, warmup, duas janelas, quatro atrasos, throttle/jitter, fuso e teto diário. Sem credencial de conexão.                                                                                                                                                  |
| A2  | `crm_update_channel_pacing`: manager, mcp:write, domínio channels:write conforme policy granular/allowlist vigente. HTTP PUT e MCP usam `salvarPacingDaConexao`: mesmos bounds e validação do par resultante de ambas as janelas e dos atrasos; tenant e canal ativo verificados antes de qualquer escrita.                                                                                                                                            |
| A3  | `MCP_VERSION_COLUMNS` inclui `inbound_debounce_ms`: get/list/published retornam configuração da versão (draft ou publicada); null significa herdar instalação, 0 é imediato. Os schemas MCP de create/update excluem o campo: nesta etapa ele é só leitura; duplicação canônica preexistente conserva configuração da origem, sem nova operação. A classificação de escrita automática da auditoria inicial foi restringida pelo prompt de fechamento. |
| A4  | `crm_get_ai_skill` expõe source, versão local, fork/origem adotada, versão atual disponível, aviso e `comparativo` de `compararSkill`/`temVersaoNovaNoCatalogo`. Leitura do catálogo somente organization_id NULL e mesmo nome; sem pacote, binário ou adoção.                                                                                                                                                                                         |
| A5  | `crm_save_ai_skill` passa ao `insertSkillVersion` a versão OFICIAL originalmente adotada (`forkedFromVersionId`), depois usa `setSkillPointer` canônico. Não aponta para a cópia anterior nem para uma versão nova não adotada. Versão nova continua da organização; versão anterior imutável, aviso/comparação/histórico e restore preservados. Manual continua manual.                                                                               |
| A6  | `crm_get_jev_status`: uma leitura agregada, manager, mcp:read/ai:read, área managed exata `/app/ai/atendimento`. `lib/ai/decisao/status.ts` extrai somente o read-side do GET; HTTP e MCP compartilham tarefas, estados, impedimentos, métricas e limites de amostra. A projeção MCP exclui consentimento individual, rótulo/erro de credencial, links de conversas e mensagens.                                                                       |

Campos A permitidos em pacing: `throttle_ms`, `jitter_max_ms`,
`window_start_hour`, `window_end_hour`, `resposta_start_hour`, `resposta_end_hour`,
`allow_sunday`, `timezone`, `daily_message_limit`, `atraso_notar_ms`,
`ms_por_caractere`, `atraso_minimo_ms`, `atraso_maximo_ms`.
`number_activated_at`, `skip_warmup` e `warmup_daily_caps` não são inputs MCP.
A escrita de ritmo não altera AI access/credenciais, não reconecta nem envia WhatsApp.

Jev lê clima, manipulação, roteador, humano, opt_out e followup. Usa as mesmas
regras `estadoEfetivoDaTarefa`, `estadoAoLigar`, `tarefaEhNova`, `tarefaPodeDecidir`,
`tarefaSemCamada`, `tarefaSemRoteador`, `tarefaSemAtendente`, `tarefaSemFluxo`,
`algumRoteadorQuePergunta`, `algumFluxoQueClassifica` e os agregadores extraídos do
GET. `followup` sempre informa `so_observa=true`, `pode_decidir=false` nesta versão,
inclusive com `decidindo` legado. PodeDecidir descreve o produto humano, não concede
uma operação MCP. Contagens e concordância conservam os limites de 7/30 dias,
500 pares de clima, 1000 irritados e 50 páginas semanais; não afirmam medir toda
população além dos limites canônicos. Erro desconhecido vira código seguro fixo.

### Matriz B/C final preservada

| Classe            | Recorte deliberadamente fora das novas tools                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B pacing          | Declarar idade do número, pular/alterar aquecimento e assumir risco operacional.                                                                                                                                       |
| B Skills          | Adotar catálogo, substituir automaticamente a cópia ativa, upload/download de pacote/binário. Save/restore textual preexistentes conservam capability agent_publication.                                               |
| B Jev             | Ligar/desligar, alterar aceite, modo/estado, decidir, avisar equipe, voltar a observar, bloquear/opt-out, transferir conversa, escolher agente ou mudar saída de follow-up. Nenhuma escrita Jev foi registrada no MCP. |
| B demais famílias | LGPD irreversível e decisões/upload/credenciais humanas da matriz inicial continuam sem nova delegação.                                                                                                                |
| C                 | Runtime pacing/debounce/Jev/follow-up, guardrails, classificação, triggers, migrations, infraestrutura, apresentação e helpers internos continuam canônicos. Sem novas migrations ou mudança na cadeia SQL.            |

Roles/scopes/capabilities/module gates existentes preservados. Não foi inventado
scope/capability: novos contratos usam os domínios atuais, allowlist por tool e
preset completo; compatibilidade do preset integral anterior não transforma
allowlist parcial em acesso amplo. Managed policy de pacing é exatamente
`/app/connections`, Skills `/app/ai/skills`, versões `/app/ai/agents`.
Tenant deriva exclusivamente de ctx.organizationId: filtros explícitos inclusive
nos embeds tenant-aware do Jev; catálogo é exceção somente de plataforma NULL.
404 e listas vazias seguras não distinguem ID estrangeiro de ausente.

Auditoria universal usa flags, nomes de campos, operação e contagens/comprimentos;
sem telefone/nome de conexão, body/diff/keywords de Skill, mensagens, prompt,
credencial, texto livre ou erro cru. Erros MCP de pacing/Skills/Jev são redigidos.
Logs de mutação têm org/token/recurso/fields_changed; não carregam valores editados.

Testes: `lib/mcp/tools/parity-169.test.ts` exercita os seis gaps pelo serviço e
pelo MCP SDK (53 casos), com dublê service-role que aplica filtros e projeção SELECT,
mais regressões canônicas HTTP e demais MCP. Os gates completos e suas limitações
ficam no relatório de paridade. **Gaps A finais = 0** neste recorte autorizado.
Isto não publica a candidata nem altera a declaração formal de RELEASE-AUDIT (1.57).
