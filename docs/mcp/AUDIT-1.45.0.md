# Auditoria diferencial 1.42.0-mcp → upstream v1.45.0

Histórico: as releases oficiais v1.46.0 e v1.47.0 chegaram antes de publicar
a 1.45.0-mcp. Esta candidata foi incorporada à
[PR #5](https://github.com/lucascruzfl/DeskcommCRM/pull/5); o alvo atual e seus
gates estão em [AUDIT-1.47.0.md](AUDIT-1.47.0.md).

Estado em 2026-09-23: **candidata integrada; publicação bloqueada**. Fonte: release oficial `v1.45.0`, commit
`4778e7e9c7b0f91bdec7bb9b8a5c475aaccee2e0`. Base MCP publicada:
`v1.42.0-mcp` (`381fb71c3fe8eb25d81f1ab15e2050b01b9437c5`). A comparação
`v1.42.0..v1.45.0` altera 263 arquivos; não se usou a `main` como versão.

## Integração

Merge único `git merge --no-commit --no-ff v1.45.0` sobre a linha MCP encontrou:

- `lib/mcp/tools/messages.ts` e seu teste: upstream introduziu ritmo de envio por token, enquanto o MCP Full Control já tinha idempotência e envio de mídia próprios.
- `lib/mcp/tools/start-conversation.ts` e seu teste: mesmo conflito para abertura e envio.
- `package.json`: as duas linhas acrescentaram testes diferentes em `test:shell`.

Os cinco conflitos foram conciliados manualmente na branch `mcp/integrate/1.45.0`: reserva idempotente antes do efeito, freio anti-ban dentro do efeito e registro depois do envio; scripts de shell das duas linhas unidos. Os 14 testes focados de `messages.test.ts` e `start-conversation.test.ts` passaram em Node 22. O typecheck completo foi interrompido por limite de memória do ambiente de análise; não é gate verde. **Sem tag, imagens ou manifesto 1.45.0-mcp.**

No CI da primeira candidata, o typecheck apontou dois contratos da integração:
os nomes antigos dos limites de requisição na rota REST de mensagens e os
campos extras da entrada de catálogo da duplicação. A correção foi enviada à
PR; somente o novo CI pode dar o veredito.

## Delta de produto a classificar

| Área | Mudança oficial | Classe provisória | Decisão pendente |
| --- | --- | --- | --- |
| Envio MCP/API | ritmo anti-ban, teto diário e Retry-After | A | preservar idempotência do fork e aplicar o ritmo no caminho MCP inteiro |
| Follow-up | duplicar/renomear fluxo, retorno e gatilho por lead | A | `crm_update_followup_flow` cobre rename; preflight aceita `lead_created` e `inbound_after_silence`; `crm_duplicate_followup_flow` compartilha serviço canônico com a rota. |
| Skills de IA | edição, versões e restauração | A | `crm_get_ai_skill`, `crm_save_ai_skill`, `crm_list_ai_skill_versions` e `crm_restore_ai_skill_version` cobrem editor e rollback com isolamento org, recusa de pacote e capability de publicação. |
| Produtos | fotos privadas e envio pelo agente | A/B | leitura segura versus upload binário e ação humana |
| Canais Datafy/Graph | modelos e credenciais | B/C | não expor segredo nem ativação sem consentimento |
| LGPD | anonimização de conversas e mídia | B | operação destrutiva permanece sob confirmação humana |
| Registro e OAuth | aprovações e recuperação | C | identidade/plataforma fora da autoridade MCP |
| UI e responsividade | painel de atualização e telas operacionais | A/B | validar regressão visual após integração |
| Updater/Docker | guardas de backup e shell tests novos | A operacional | manter fail-closed e rodar harness |

As operações novas do changelog foram verificadas contra as bordas correspondentes:

| Operação | Classe | Cobertura/limite nesta candidata |
| --- | --- | --- |
| Consultar banco externo conectado | A | `crm_describe_external_data` e `crm_query_external_data` já existem, com escopo e capability próprios; a integração conserva o módulo opcional desligado por padrão. |
| Duplicar e renomear follow-up; gatilhos Lead criado e Cliente voltou | A | duplicação usa o mesmo serviço da API; rename já passa por `crm_update_followup_flow`; preflight reconhece os dois gatilhos. |
| Editar, versionar e restaurar skill textual | A | quatro tools novas com filtro de organização, papel manager na leitura de corpo/escrita e capability de publicação; pacote com arquivos é recusado. |
| Ritmo anti-ban de mensagem MCP | A | reserva idempotente continua antes do efeito; freio e registro do envio agora seguem a regra oficial. |
| Ver se produto tem foto | A | busca MCP usa somente a contagem, sem expor caminho do bucket privado. O agente oficial envia a foto pelo fluxo de mensagens. |
| Subir/reordenar/remover foto | B | binário e bucket privado exigem a interface/ação humana; o MCP não recebe upload genérico. |
| Criar/sincronizar modelo Datafy; conectar canal | B | ação externa e credenciais de administrador; não há tool que receba segredo ou faça publicação na plataforma sem revisão humana. |
| Anonimizar contato/conversa/mídia | B | operação destrutiva segue o fluxo humano de LGPD. |
| Aprovar cadastro, ligar módulos opcionais, instalar banco na VPS | C | autoridade de instalação/plataforma, fora do token MCP de organização. |

Preço/modelos de IA, roteador automático, atribuição de anúncio, correções de
follow-up e backup são mudanças de execução ou dados, sem nova operação MCP.
O catálogo é derivado de `tools/list`; 226 continua só como snapshot da release
anterior e não é critério de aceite.

Esta tabela é triagem, **não** certificação de cobertura. Os gaps A identificados nesta triagem foram implementados na branch candidata. O total de gaps A da 1.45.0 ainda é **indeterminado** até a auditoria por operação, os invariantes de banco e o CI completo. `RELEASE-AUDIT.json` não declara zero. `RELEASE-AUDIT.json` continua em
1.42.0 e impede a publicação de uma tag 1.45.0-mcp.

## Migrations e salto de versão

A tag 1.45.0 inclui as migrations oficiais `0383`, `0385`, `0386`, `0387`,
`0390`, `0391` (timestamps e nomes completos em `supabase/migrations/`). A
linha MCP preserva a `0382` própria e a renumeração anterior registrada em
`INSTALL-NEW-VPS.md`. O novo `0385_memoria_da_org_aceita_origem_agente`
colidiu com a `0385_link_salvo_no_modelo` já implantada na linha MCP; foi
movido para `20260924093000_0398_memoria_da_org_aceita_origem_agente.sql`
antes de qualquer deploy. SQL e bloco idempotente do baseline mantidos. O instalador e atualizador reaplicam o **baseline
acumulado**, não percorrem tags/release por release. Portanto não há exigência
estrutural de publicar 1.43 e 1.44 separadamente. A prova operacional do salto
1.42 → 1.45 depende de merge completo, teste de instalação e reaplicação do
baseline, invariantes de banco e updater harness. Até esses gates passarem, o
salto continua bloqueado.

## Gates ainda pendentes

Revisão do código conciliado; classificação A/B/C por operação;
`gaps_a=0` demonstrado; sentinelas MCP; typecheck; lint; banco descartável;
baseline install/reapply; shell/updater; build das quatro imagens; digests
públicos; manifesto validado e publicado por último.
