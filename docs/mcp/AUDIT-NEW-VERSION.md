# Auditoria do MCP após uma nova versão

Registro concreto desta integração: [AUDIT-1.42.0.md](AUDIT-1.42.0.md).

Use este roteiro sobre a branch de integração da **tag da release oficial**. Não reconstrua o MCP do zero.

Para o canal de imagem, uma nova tag oficial não é release instalável. A
auditoria gera um commit integrado e só após os gates uma tag `vX.Y.Z-mcp` e o
manifesto de publicação. Veja [MCP-UPDATE-CHANNEL.md](MCP-UPDATE-CHANNEL.md).

## 1. Proteja a branch

1. Confirme branch, HEAD e árvore limpa.
2. Faça fetch da tag oficial pelo workflow, sem depender de Sync fork.
3. Meça merge-base, atraso, commits próprios e sobreposição.
4. Integre a tag sobre `mcp/stable` em branch isolada. Conflito bloqueia automaticamente; nunca use ours/theirs sem revisão.

## 2. Gere o delta do produto

Compare a base anterior e a nova em:

- `app/app`, `components`, `hooks` (operações visíveis);
- `app/api/v1`, `app/actions` (bordas);
- `lib` e `workers` (serviços, regras e efeitos);
- `supabase/migrations`, baseline e MANIFEST (contratos de dados);
- registry, catálogo, policy, scopes e capabilities MCP.
- scripts de atualização, CI de imagens e manifesto de release;
- módulos novos upstream, especialmente operações A que antes não existiam.

Para cada diferença registre domínio, recurso, operação, UI, API/action, service, tool, role, scope, capability, side effect, ação humana e cobertura.

## 3. Classifique

- A: operação org-scoped, canônica e delegável que deve estar no MCP. Implemente agora.
- B: precisa de pessoa, consentimento, endpoint externo, secret write-only, binário/download ou confirmação adicional.
- C: segredo de saída, infraestrutura, plataforma, autoelevação, SQL arbitrário, bypass de controle ou funcionalidade inexistente.

Nunca transforme B/C em tool genérica para zerar a planilha.

## 4. Valide contratos

Rode, no mínimo:

```bash
pnpm exec vitest run tests/unit/mcp-compatibility-sentinels.test.ts tests/unit/mcp-final-flows.test.ts
pnpm test:unit
pnpm test:db
pnpm typecheck
pnpm lint
pnpm lint:channels
pnpm lint:role-rank
pnpm release:conferir
git diff --check
```

Se tocar UI, acrescente Playwright e evidência visual. Se tocar packaging, `pnpm test:shell`. Antes do build, meça memória e swap.

## 5. Critérios de fechamento

- gaps A zero;
- `tools/list` é derivado e filtrado;
- preset manager alcança todas as operações públicas desejadas sem admin;
- nenhuma entrada aceita organização pública ou SQL genérico;
- nenhuma saída revela secret;
- cross-tenant e migrations aprovados no banco real descartável;
- todo efeito externo foi mockado/simulado ou entregue à ação humana;
- matriz, mapa vivo, compatibilidade e relatório final atualizados.
- `RELEASE-AUDIT.json` registra a versão, o snapshot de tools, gaps A e o
  veredito. `mcp_compatible` só vira `true` com todos os itens acima medidos.

A auditoria automática gera inventário, não interpretação de segurança.
Confira [AUDIT-1.45.0.md](AUDIT-1.45.0.md) para o caso atual.
