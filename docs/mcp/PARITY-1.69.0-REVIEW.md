# Paridade local MCP v1.69.0

Candidata `sync/upstream-1.69.0`, worktree `/tmp/deskcomm-upstream-169`.
Entrada: `970a78d93b7026d24f4c0bed7e1919529c78e5fc`; merge estrutural
`2b045879eebd51f83324d2d3d8c0d3dc6eee4973` preservado.
Base MCP `1fb9afd535d4bdad3874166b5dd0bcfd79db3ec2`.
Alvo congelado: v1.69.0 `e8e2912178031d321caf0912b270ee06bd2c36c7`; v1.70+ fora do ciclo.

Os seis gaps A estão fechados no recorte autorizado; **gaps A = 0**.
Contratos, campos, origem de Skills, B/C e segurança:
[DELTA-1.62-1.69-REVIEW.md](DELTA-1.62-1.69-REVIEW.md).
Tools novas: `crm_update_channel_pacing` e `crm_get_jev_status`.
Tools ampliadas: `crm_get_channel_admin`, `crm_get_ai_skill`, `crm_save_ai_skill`,
`crm_get_ai_agent_version`, `crm_list_ai_agent_versions`,
`crm_get_published_ai_agent_version` (projeção compartilhada; preflight também a lê).
Histórico/restore de Skills mantidos, sem adoção automática.

## Read-model e conectividade

`lib/ai/decisao/status.ts` é a extração read-only do GET Jev, usada pela rota
`app/api/v1/ai/jev/route.ts` e por `crm_get_jev_status`. PATCH e gravarConfigDoJev
continuam fora do serviço. A projeção MCP expõe estados, novidade, only-observe,
impedimentos e métricas da tela sem mensagens/PII/credenciais/consentimento pessoal.
Follow-up continua somente observando; nenhuma ação write Jev registrada.

Living System Checklist — seis gaps:

1. Fontes: channel_sessions/channel_knobs; ai_agent_versions; skill_pointers/versions
   locais e plataforma; organizations/settings, llm_calls, jev_observacoes e notas
   numéricas de messages, filtradas por tenant.
2. Consumidores: handlers HTTP pacing/Jev, CartaoDoJev, leitura MCP administrativa,
   editor/histórico de Skills e runtime canônico que já lê esses campos.
3. Registro: `auditMcpToolCall` nos dois ingressos; pacing e Skill save mantêm audit
   de negócio, token e recurso, sem conteúdo; leituras não emitem mutação.
4. Tela: AntiBanSheet em Conexões, versões do agente, Skills e CartaoDoJev mostram
   o mesmo estado; ferramentas e chamadas aparecem no catálogo/auditoria existentes.
5. Portas: `/app/connections`, `/app/ai/agents`, `/app/ai/skills`,
   `/app/ai/atendimento`, `/api/mcp`; managed policy mapeia as áreas exatas.
6. Anti-morte: leitura pura dispensa; falha tipada/redigida não simula sucesso.
7. Configuração: pacing por serviço comum e bounds; decisões B continuam na tela.
8. Continuidade: MCP observa e informa pessoa administradora, sem decidir pedidos
   humano/opt-out ou tomar atendimento.
9. Retorno: observações/concordância e falha segura vêm do read-model do cartão;
   pessoa decide na UI. Não foi criado loop autônomo ou escrita Jev.
10. Mapa: `docs/architecture/mcp-fundacao-ia.architecture.json` registra arestas
    HTTP/MCP → serviços → tenantdb.

## Evidências e gates

Dirigidos finais: 56 arquivos/882 testes; os 53 casos dos seis gaps passaram
novamente após a fixture usar o provider canônico. Nenhuma allowlist de dívida
foi ampliada. Logs locais em `.parity169-evidence/` (fora da distribuição).

| Gate | Resultado local |
| --- | --- |
| Dirigidos | 56 arquivos, 882 testes aprovados; recorte de seis gaps: 53 aprovados |
| `NODE_OPTIONS=--max-old-space-size=6144 pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; zero erros, 466 warnings preexistentes; arquivos de código alterados sem warnings |
| `pnpm lint:channels` | exit 0; 62 arquivos de dívida conhecida, nenhum novo |
| `pnpm lint:role-rank` | exit 0 |
| `pnpm cercas` | exit 0; 267 arquivos, 2619 testes aprovados |
| `pnpm test:unit` completo | exit 0; 1729 arquivos, 18907 aprovados + 1 expected fail (18908 casos) |
| `pnpm test:db`, PG15 | exit 0; 349 arquivos, 2827 aprovados + 1 expected fail + 1 skipped (2829 casos) |
| `TEST_DB_IMAGE=pgvector/pgvector:pg17 pnpm test:db` | exit 0; mesmos 349 arquivos/2829 casos e estados do PG15 |
| INSTALL e reaplicação UPDATE, PG15/PG17 | baseline alvo, `ON_ERROR_STOP=1`, zero erro; isolamento do kit: 181 regras presentes |
| Upgrade real com dados, PG15/PG17 | `pnpm test:db:update`, INSTALL da baseline MCP `1fb9afd` via `TEST_DB_INSTALL_BASELINE`, UPDATE para a candidata; 10 linhas intactas, 8 objetos com identidade preservada, view legada migra e fica estável na passada seguinte |
| `pnpm skills:sync` | exit 0; oito espelhos fiéis, sem regravação |
| `git diff --check` | exit 0; conferência de fechamento, também sobre o índice antes do commit |

Estados preexistentes conservados: o expected fail unitário é o compromisso em
andamento da agenda (`agenda-separar-historico`); o expected fail de banco é STOP
em enrollment pausado manualmente (`followup-reactivity`); o skip é o rate limit
HTTP 429 de `webhooks-inbound`, já coberto pelo teste unitário do fallback em
memória. Não são regressões dos seis gaps nem foram removidos para obter verde.

A primeira sessão PG15 terminou sem recibo e foi descartada como inconclusiva.
O gate completo foi repetido em banco novo; PG15/PG17 e upgrades usam contêineres
efêmeros separados, sem tocar banco operacional. A árvore ficou sem edições
concorrentes; snapshot antes/depois dos gates idêntico: 7027 arquivos,
SHA-256 `7403f8f45f7b2111348bee5b74b13af6158b029a34115c66b287a66077c4ce3c`.
Somente este recibo documental foi finalizado depois; cercas e diff-check fazem
a conferência final do fechamento, sem edições durante a corrida.

## Autorização e contratos administrativos

| Contrato | Role | Scope global; granular quando exigido pela policy | Área managed |
| --- | --- | --- | --- |
| Leitura de canal/pacing | manager | `mcp:read`; `channels:read` | `/app/connections` |
| Escrita limitada de pacing | manager | `mcp:write`; `channels:write` | `/app/connections` |
| Leitura de debounce nas versões do agente | manager | `mcp:read`; `agents:read` | `/app/ai/agents` |
| Leitura/comparação de Skill | manager | `mcp:read`; `ai:read` | `/app/ai/skills` |
| Save de Skill preexistente | manager | `mcp:write`; `ai:write`; `capability:agent_publication` | `/app/ai/skills` |
| Estado agregado do Jev | manager | `mcp:read`; `ai:read` | `/app/ai/atendimento` |

Allowlist por tool, capabilities/module gates e role-rank conservados, com
registry/catálogo 1:1 e contratos administrativos `apenasHumano` no catálogo.
Nenhum novo scope ou capability; nenhum acesso administrativo foi ampliado para
agent. Histórico de Skill mantém a leitura segura preexistente; save/restore
textuais mantêm publicação autorizada. Não foi aberto input de debounce, nem
adoção de catálogo, nem escrita Jev. A projeção de versões também é lida por
preflight e respostas de operações preexistentes, sem novo controle de escrita.

## Limites de publicação e ambiente

Nenhuma migration, baseline ou MANIFEST foi alterado nesta etapa. Nenhum teste
foi removido; a cerca de provedores passou a declarar o serviço extraído do Jev
em vez da rota anterior, conservando a mesma restrição de modelos de conversa.

RELEASE-AUDIT.json permanece byte-a-byte igual à entrada/base: declara somente 1.57.
Compatibilidade formal de release depende da etapa posterior em mcp/stable.
Não houve uso da raiz operacional para desenvolvimento, nem acesso a leep 2,
backups ou .env operacional. Banco é exclusivamente o efêmero dos harnesses.
Sem push, PR, tag, release ou deploy. Build/E2E visual e publicação não fazem
parte da matriz solicitada; UI não foi redesenhada e os contratos HTTP foram
medidos por seus testes canônicos.
