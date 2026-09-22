# Troubleshooting do MCP

Use `X-Request-Id` para correlacionar erro e auditoria sem expor bearer. Nunca cole token, JWT,
chave Supabase, secret de canal ou conteúdo pessoal em logs compartilhados.

| Problema                  | O que significa                                      | Diagnóstico seguro / correção                                                                                       |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `JWT failed verification` | sessão web/JWT inválido; não é bearer MCP válido     | confirme que o cliente envia `Authorization: Bearer dsk_...` para `/api/mcp`; não use JWT de sessão                 |
| token MCP inválido        | formato, hash, revogação ou expiração                | gere/revise em Configurações › Tokens; reinstale sem imprimir o token                                               |
| tools ausentes            | catálogo filtrado pelo token                         | atualize `tools/list`; revise role, scopes, allowlist e preset; não fixe contagem                                   |
| `capability missing`      | efeito crítico não concedido                         | conceda explicitamente pela UI se autorizado; não use REST/SQL como bypass                                          |
| `scope missing`           | domínio/read/write não concedido                     | revise scopes do token e tente novamente                                                                            |
| cross-tenant              | ID não pertence à organização do token               | descubra IDs novamente no tenant atual; nunca envie `organization_id` manual                                        |
| `model_not_found`         | modelo/provider não disponível                       | descubra providers/modelos/credenciais e valide antes de criar draft                                                |
| `credential_not_found`    | credencial de IA ausente/inativa                     | cadastre secret pela superfície humana; MCP não revela secret existente                                             |
| `human_action_required`   | consentimento, binário, privilégio ou decisão humana | apresente reason/resource/instruction e endpoint/href; retome com verify depois                                     |
| Codex config              | TOML/helper/Skill não carregou                       | rode `doctor codex`, `codex mcp get deskcomm --json`, reinicie Codex e confira caminhos                             |
| Claude config             | JSON/bridge/Skill não carregou                       | rode `doctor claude`; confira `.mcp.json`/`~/.claude.json`; Claude CLI não foi testado nesta VPS                    |
| build OOM                 | Turbopack morto com exit 137                         | meça `free -m`; repita em runner maior ou swap temporária controlada; não trate como erro de código sem diagnóstico |
| migrations                | clone atualizado não recebeu schema                  | confira tripla migration/baseline/MANIFEST e rode `pnpm test:db`; não aplique SQL avulso                            |
| `tools/list` mismatch     | snapshot/documento difere do runtime                 | runtime vence; valide metadata e execute auditoria delta se contrato esperado sumiu                                 |

## Sequência de diagnóstico

1. Rode `bash hostgator-setup-kit/healthcheck.sh` na VPS.
2. Confirme HTTPS e que `POST /api/mcp` é alcançável; não conclua saúde por `docker ps` sozinho.
3. Rode `verify-connection` no computador do cliente.
4. Rode `doctor codex` ou `doctor claude`.
5. Compare o catálogo atual com [COMPATIBILITY.md](COMPATIBILITY.md) e execute as sentinelas.
6. Se o erro continuar, colete código estruturado, status HTTP e `X-Request-Id`, nunca o token.
