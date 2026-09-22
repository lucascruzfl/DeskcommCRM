# Arquitetura do MCP

Atualizado em 2026-09-21. A fonte executável é `MCP_REGISTRY`; este documento descreve o contrato, não congela uma lista de tools.

## Caminho de uma chamada

```text
Bearer dsk_...
→ hash e resolução em api_tokens
→ contexto confiável (organization, actor, role, token, provisionador)
→ rate limit (token, organização e writes)
→ tools/list filtrado por role + scope + allowlist + capability
→ Zod do input
→ handler fino
→ handler/service/RPC/worker oficial do domínio
→ filtro explícito de organization_id quando há service role
→ audit MCP + evento/timeline do domínio
→ sanitização recursiva
→ resposta MCP com X-Request-Id
```

O servidor é Streamable HTTP stateless em `app/api/mcp/route.ts`. Cada request cria transporte e server novos. `lib/mcp/registry.ts` deriva registry, contagem e perfil público da mesma coleção. `lib/mcp/server.ts` repete autorização antes do handler, aplica o teto menor de writes, audita sucesso/ausência/erro e sanitiza a saída.

## Autoridade

- A organização nunca é argumento público; vem do token.
- O preset completo é `manager`, não `admin`, e exige escolha explícita de scopes, allowlist e capabilities.
- `tools/list` omite o que o token não pode chamar; a chamada repete o mesmo gate.
- Capabilities distinguem publicação/ativação de agente, ativação de automação/follow-up, envio, handoff e destruição.
- QR, OAuth, binário, download com PII e decisões humanas retornam `human_action_required`/`human_confirmation_required`.
- Secrets de entrada são write-only quando o produto realmente os aceita; secrets nunca são retorno.

## Serviços canônicos

| Domínio       | Contratos compartilhados principais                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| IA            | `lib/ai/mcp-service.ts`, validação/publicação em `lib/ai/agents/`, runtime de preview                                  |
| CRM           | handlers de `contacts`/`leads`, `moverLeadParaOutroFunil`, operações de pipeline, tarefas e custom fields              |
| Atendimento   | `sendMessageHandler`, `openSharedContactConversation`, `comIdempotencia`, RPCs de status/atribuição e passagem/handoff |
| Agenda        | `lib/agenda/consulta.ts` e handlers de `agenda/agendamentos`                                                           |
| Follow-up     | graph/pointers/versions, `validateFlowForPublish`, `publishFollowupFlowVersion`, enrollments e intervenções            |
| Automação     | schemas/vocabulários do engine, cifra de actions e runs oficiais                                                       |
| Routing       | `loadEligibleAttendants`, `decideRouting`, settings e `fn_set_channel_routing`                                         |
| Knowledge     | fontes/FAQ, `fn_replace_knowledge_faq_items`, `event_log` e `rag-indexer`                                              |
| Equipe/canais | serviços de convite, estado canônico de canal e RPC atômica de acesso da IA                                            |

## Limites de segurança

- 60 requests/min por token, 600/min por organização e 30 writes/min por token; as chaves usam IDs resolvidos, nunca o bearer.
- Service role sempre filtra organização; IDs relacionados são validados no mesmo tenant.
- Sem SQL/REST/CRUD universal, execução de infraestrutura, autoelevação ou transporte binário.
- Auditoria não persiste conteúdo de mensagem, segredo ou mídia quando IDs e desfecho bastam.
- O mapa vivo é `docs/architecture/mcp-fundacao-ia.architecture.json`.

## Sistema Vivo

Entrada: token e descoberta dinâmica. Saída: serviços oficiais e suas telas existentes. Registro: `api_audit_log`, `event_log` e timeline do domínio. Anti-morte: erros/preflight/status e ações humanas trazem próximo passo. Continuidade: handoff e retomada usam os registros oficiais. Laço: runs, status, recibos, auditoria e reconsulta mudam a próxima decisão. O rate limit entra entre token e registry e devolve recusa correlacionada, sem deixar uma falha silenciosa.
