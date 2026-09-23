# Compatibilidade do MCP com novas versões

O MCP não é acoplado a um número fixo de tools nem à versão 1.41.0. Clientes consultam `tools/list`; o servidor deriva catálogo, policy e handlers do registry atual.

## Contratos estáveis

- Transporte: MCP Streamable HTTP stateless em `/api/mcp`.
- Auth: bearer `dsk_...`; plaintext nunca persiste.
- Contexto: organização, ator, role e token resolvidos no servidor.
- Autorização: role + `mcp:read|write` + scope de domínio + allowlist + capability.
- Erros: códigos MCP estruturados e payload sanitizado.
- Ação humana: `human_action_required` ou `human_confirmation_required` com instrução e recurso.
- Descoberta: `tools/list`, nunca uma contagem ou enumeração embutida no cliente.

## Pontos frágeis intencionais

O teste `tests/unit/mcp-compatibility-sentinels.test.ts` referencia nomes de services canônicos. Renomeá-los deve quebrar a sentinela para forçar decisão explícita: atualizar import/adapter ou reconhecer mudança de contrato. As áreas vigiadas são envio/idempotência, movimento de lead, agenda, publish/intervenção de follow-up, routing, FAQ atômica e convites.

Mudanças de schema são frágeis por outra razão: o self-host aplica `supabase/baseline.sql`. Toda evolução continua em tripla (migration, baseline, MANIFEST), com instalação e reaplicação testadas.

## Sentinelas

As suítes finais acusam:

- handler removido ou catálogo diferente do registry;
- domínio, scope, capability ou role inválidos;
- schema público com organização/SQL/token de saída como input genérico;
- regressão do preset manager e do `tools/list` filtrado;
- vazamento de secret pela cerca final;
- renomeação dos services canônicos;
- cross-tenant via invariantes de banco;
- regressão dos fluxos compostos, incluindo campanhas da 1.42.0;
- migration FAQ sem atomicidade, grants fechados ou baseline correspondente.

## Política de evolução

```text
fetch/merge seguro da main
→ inventário diferencial de UI/API/actions/services/workers/schema
→ comparar registry/policy/scopes/capabilities
→ classificar A/B/C
→ implementar todo A por serviço canônico
→ rodar sentinelas, regressão MCP, banco e build
→ atualizar FINAL-AUDIT e documentação
```

Compatibilidade não significa manter handler interno antigo. Significa detectar a mudança, preservar o contrato público quando possível e versionar qualquer quebra deliberada.

Na 1.42.0, a borda do MCP passou a receber o limite de falhas de token do
upstream e o filtro de módulos opcionais. O Full Control mantém o teto de
requests na rota e o de escritas por tool, sem debitar token/organização duas
vezes em `tools/call`. O catálogo interno cresceu de forma derivada; nenhum
teste usa 202 como valor esperado.

O workflow `publish-mcp-release.yml` impede publicação quando a auditoria
da nova versão não confirma gaps A zero. O agente do painel valida manifesto e
imagens no registry antes de oferecer a tag MCP. O próprio `update.sh` repete a
validação, inclusive quando chamado com `--force`.
