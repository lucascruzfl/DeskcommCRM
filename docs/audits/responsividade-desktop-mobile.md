# Auditoria responsiva — 22/09/2026

Base: `e47387a09b7b4f0f8c96071959881d86072ef805`, checkout inicialmente limpo e
com HEAD destacado. Trabalho em `fix/responsividade-desktop-mobile`, sem merge,
push, deploy ou acesso de escrita a serviços reais.

## Critério e sistema visual

Skills lidas e aplicadas: `frontend-design`, `ui-ux-pro-max`, `deskcomm-doutrina`,
`deskcomm-contribuir` e `sistema-vivo`; contratos `AGENTS.md` e `CLAUDE.md`.
O CLAUDE do checkout e o de `origin/main` tinham o mesmo SHA256 na leitura.
Graphify não está instalado; consumidores localizados por busca no código.

Preservados os tokens Sage/greige de `app/globals.css`: fundo `#faf9f6`, superfície
`#ffffff`, texto `#1c1a16`, texto secundário `#5d594f`, borda `#e7e3da`, acento
`#506d48`, com variação por marca/tema. Tipografia Atkinson e mono existente,
escala de espaçamento de quatro pixels, raios e componentes mantidos.

Composição: títulos e ajuda acima dos campos, ações ao fim, margens de 16px nos
modais, padding de página menor no celular. `DialogBody` é opt-in para manter
cabeçalho/ações visíveis enquanto o centro rola. Consumidores legados conservam
sua estrutura e ganham rolagem do dialog inteiro. Não foi introduzido sticky
indiscriminado dentro de formulários, imagens ou painéis que já possuem scroll.

Stack: Next/React, Tailwind 4 CSS-first, shadcn/Radix. Breakpoints padrão Tailwind
(sm 640, md 768, lg 1024, xl 1280, 2xl 1536). Não há primitive Drawer separado:
os drawers do produto usam Sheet. Formulários usam HTML/react-hook-form e
Input/Label/Select compartilhados. Tabelas usam Table com overflow local; Kanban
mantém o scroll horizontal funcional em KanbanBoard.

## Matriz

“Browser” significa componentes reais + CSS real, renderizados em bancada Vite
isolada, com APIs substituídas por fixtures locais. **Não** significa jornada
Next autenticada contra Supabase. “Fonte” significa inspeção estática; não implica
que a tela foi aberta no navegador.

| Tela/componente | Faixa | Problema / causa | Correção ou decisão | Verificação |
|---|---|---|---|---|
| Dialog | Todas, especialmente altura baixa | Sem teto de altura nem margem lateral | dvh, largura disponível, rolagem e quebra intrínseca | Browser |
| AlertDialog | Mobile/altura baixa | Mesmo defeito + ações sem gap consistente | Mesmos limites, footer com wrap/empilhamento | Browser |
| Sheet | Mobile/desktop baixo | Altura antiga, conteúdo sem scroll por padrão | dvh, scroll local, safe area | Browser |
| Popover | Mobile | Largura/altura sem limite | Limite de viewport e altura disponível do Radix | Browser |
| Dropdown e submenu | Mobile/altura baixa | Submenu podia cortar conteúdo | Largura limitada, scroll e quebra de texto | Browser no menu principal; fonte no submenu |
| Select | Mobile | Valor/opções longas expandiam largura | Trigger encolhe; opções quebram, conteúdo limitado | Browser |
| Tabs | Mobile/tablet | justify-center perdia início de uma faixa larga | Alinhar início e não encolher triggers | Browser + teclado |
| Input/Textarea | Mobile | Largura intrínseca em flex/grid | min-w-0 | Browser |
| Card | Mobile/tablet | Strings e filhos aumentavam largura mínima | min-w-0 e overflow-wrap:anywhere | Browser |
| Table | Mobile/tablet | Ancestor podia crescer com tabela | Limite no wrapper; scroll local | Browser |
| API Tokens — criar | Todas | Scopes empurravam ações para fora | Header + DialogBody rolável + footer; submit vinculado ao form | Browser + criação em fixture |
| API Tokens — resultado/lista | Mobile | Dados longos e tabela comprimida | Token já tinha break-all; tabela ganha largura mínima legível | Browser |
| Conexões — excluir | Mobile | Nome longo + footer local em linha | Header + DialogBody + DialogFooter visível, quebra central | Browser + exclusão somente da fixture |
| Conexões — cards/toolbar/QR | Mobile/tablet | Ações em linha, identificador e QR rígidos | Toolbar quebra, identificador quebra, QR max-w-full | Browser na lista; fonte no QR |
| Conexões — proteção de envio | Mobile | Rodapé próprio somava largura maior que o painel | SheetFooter compartilhado | Fonte |
| Equipe — horários | Mobile | Dia + dois horários + remover numa linha | Dia ocupa linha; horários em grid; desktop preservado | Fonte |
| Equipe — membros/convites | Mobile/tablet | Tabela comprimida | Largura mínima e scroll local | Fonte |
| Marca | Mobile | Erro técnico longo empurrava ação | Wrap no footer e quebra no erro | Fonte |
| Perfil | Mobile | Campos em duas colunas | Uma coluna antes de sm | Fonte |
| Organização | Mobile | Campos em duas colunas | Uma coluna antes de sm | Fonte |
| Segurança/MfaEnrollModal | Altura baixa | Modal próprio fora de Dialog | Teto dvh e rolagem, sem mudar autenticação | Fonte |
| Contatos — novo | Mobile/desktop baixo | Form extenso sem teto | Herdado de Dialog | Browser |
| Contatos — edição/importação/anonimização | Mobile/desktop baixo | Mesmo primitive | Herdado de Dialog | Fonte |
| Contatos — mesclar | Mobile/desktop baixo | Teto vh legado | dvh, mantém scroll existente | Fonte |
| Contatos — tabela | Mobile/tablet | Muitas colunas | Largura mínima, scroll local | Fonte |
| CRM — novo lead | Mobile/desktop baixo | Campos duplos e formulário extenso | Grid colapsa, Dialog limita | Browser |
| CRM — editar lead/LeadFieldsForm | Mobile | Campos duplos | Grid colapsa | Fonte |
| CRM — KanbanBoard/BulkActionBar | Todas | Scroll horizontal é funcional | Mantido no quadro; barra já quebra ações | Fonte |
| CRM — LeadDossier | Altura baixa | Drawer extenso | Herdado de Sheet; scroll existente preservado | Fonte |
| Tarefas | Mobile/desktop baixo | Datas, prioridade e situação em duas colunas | Colapsar grid e limitar dialog | Browser |
| Webhooks — criar fonte | Todas | Formulário usa primitive sem limites | Herdado de Dialog | Browser |
| Webhooks — tabs/loading | Mobile | Skeleton SSR de 432px | max-w-full; abas corrigidas centralmente | Fonte |
| Webhooks — SourceDetail/RuleEditor/CapturaDetail | Altura baixa | Sheets extensos | Herdado de Sheet; RuleEditor usa SheetFooter | Fonte |
| IA — AgentForm | Mobile | Campos duplos | Grid colapsa | Fonte |
| IA — horários/TriggerEditor | Mobile | Fuso e horários em três colunas | Uma coluna antes de sm | Fonte |
| IA — FollowupWindowEditor | Mobile | Horários em duas colunas | Uma coluna antes de sm | Fonte |
| IA — novo follow-up | Todas | Formulário usa primitive sem limites | Herdado de Dialog | Browser |
| IA — memória | Mobile | Cancelar e salvar aprendizado em linha | Footer empilha antes de sm | Fonte |
| IA — fila de follow-ups / Webhooks capturas | Mobile/tablet | Muitas colunas | Largura mínima legível + scroll local | Fonte |
| IA — ModelosDialog | Mobile/altura baixa | Teto vh legado | dvh, scroll existente preservado | Fonte |
| IA — roteadores/criar/publicar/excluir | Todas | Dialogs herdavam ausência de limite | Primitives corrigidos | Fonte |
| IA — credenciais/adicionar/rotacionar/excluir | Todas | Dialogs herdavam ausência de limite | Primitives corrigidos | Fonte |
| IA — knowledge (novo material, trechos, FAQ) | Mobile/altura baixa | Teto vh em composição flex | dvh, composição preservada | Fonte |
| Integração de dados — formulário | Altura baixa | Teto vh legado | dvh | Fonte |
| LGPD — PreviewPanel | Altura baixa | Teto vh legado | dvh | Fonte |
| Métricas | Mobile/tablet | Filtro fixo e rótulos de funil largos | Filtro quebra, select fluido, rótulos menores no celular | Fonte |
| Análise — atividades | Mobile | Série com muitas barras | Já tem scroll local; mantido | Fonte |
| AppShell | Todas | Gutter grande no celular; main era scroll horizontal genérico | Padding responsivo; min-w-0; remover overflow genérico do main | Fonte |
| Sidebar/MobileSidebar | Todas | Altura e contração da região de navegação | dvh, min-h-0, safe area | Browser + testes existentes |
| TopBar/TenantSwitcher/SearchTrigger | Mobile/tablet | Busca só com ícone sem nome acessível | aria-label; tenant já oculta nome no celular | Fonte + teste existente |
| CommandPalette | Altura baixa | Dialog deslocado a 15% precisava teto próprio | max-height desconta o deslocamento | Fonte |
| Toast (Sonner) | Mobile | Conferir composição existente | Biblioteca mantém layout; sem alteração cosmética | Browser nas mutações de fixture |

Inventário mecânico inicial: **91** usos em **79 arquivos**: 46 DialogContent, 29 AlertDialogContent e
16 SheetContent em `app` e `components`. Esse número não é “91 jornadas testadas”.
Os overlays próprios de MFA também foram inspecionados. O teste visual cobre os
primitives e consumidores indicados, sem alegar cobertura de todas as rotas.

## Reproduzir

`pnpm test:responsive` (requer browser Chromium do Playwright). A bancada não lê
`.env`, não usa o client Supabase, não publica rota na aplicação e só escuta em
127.0.0.1. As chamadas `/api/` são interceptadas pelo Playwright; uma fixture
faltante falha. O script é separado do E2E autenticado, cuja configuração exige
`.env.e2e` e Supabase local.

Resoluções: 320×568, 360×640, 375×667, 390×844, 412×915, 430×932, 768×1024,
820×1180, 1024×768, 1280×720, 1366×768, 1440×900, 1920×1080, mais 390×360 para
altura reduzida. Esta última não simula teclado físico nem o comportamento do
visualViewport no Safari. Screenshots/trace em `.superpowers/evidence/responsive/`.

## Living System Checklist

Destino: núcleo. A operação continua inteira sem nenhuma extensão ativa.
Entrada: conteúdo/ações dos consumidores da matriz. Saída: primitives renderizam
campos, leitura e ações existentes. Logs/auditoria: nenhum evento novo; callbacks
já existentes continuam emitindo suas mutações. Tela/porta: mesmas rotas e
navegação, sem rota de produto nova. Anti-morte: ações voltam a ser alcançáveis;
não há cron ou demanda nova. Configuração: nenhuma nova. Continuidade IA/humano:
nenhum payload alterado. Retorno: asserções de geometria falham quando os limites
regredirem. Mapa: nenhuma aresta de domínio criada ou removida.

## Contagem e limites de cobertura

A matriz contém 52 áreas (telas e componentes, com alguns consumidores agrupados).
O inventário de overlays contém 75 dialogs/alert dialogs e 16 sheets; inventário
não equivale a inspeção visual individual. A bancada exercita 10 dialogs/alert
dialogs (incluindo o resultado de criação do token) e dois sheets.

Foram revisadas 20 superfícies de formulário: token, novo contato, novo/editar
lead, tarefa, fonte de webhook, regra de webhook, novo follow-up, agente,
gatilhos, janela de follow-up, perfil, organização, horários da equipe, marca,
integração de dados, novo material, FAQ, memória e proteção de envio.
Seis são exercitadas no browser: token, contato, lead, tarefa, webhook e follow-up.
As demais têm revisão de fonte nesta entrega.

Dez tabelas/listas/quadro constam da revisão: tokens, conexões, membros, convites,
contatos, fila de follow-ups, capturas de webhook, métricas, Kanban e atividades.
A medição de overflow desativa temporariamente o corte global preexistente de
`html/body`, para não mascarar o componente que estourar.
A bancada exercita tokens/conexões e uma tabela longa do primitive; as outras
não têm prova de browser nesta entrega.

O CSS é o do produto, mas a bancada não executa `next/font`: a fonte usa o
fallback local. Capturas não são aprovação pixel a pixel da aplicação Next.
Safari/iOS, teclado real, todos os estados autenticados, tradução para outros
idiomas e todas as rotas não foram validados. Zero overflow na bancada não
significa ausência comprovada de overflow em toda a aplicação.

## Validação e impedimentos

- `pnpm lint`: exit 0, 419 avisos, nenhum erro. ESLint dos arquivos alterados:
  exit 0, sete avisos em código existente, nenhum erro.
- `pnpm lint:channels`, `pnpm lint:role-rank` e `pnpm release:conferir`: passaram.
- `pnpm typecheck --incremental false`: inconclusivo por esgotamento de heap
  (tentativas com limite padrão e 3 GB). Não equivale a aprovação de tipos.
- `pnpm exec tsc --noEmit -p tsconfig.json --incremental false`: passou;
  esta configuração cobre produção, mas exclui a suíte completa de testes.
- E2E autenticado: configuração recusa iniciar sem `.env.e2e`/Supabase local.
  Nenhuma credencial nem banco de produção foi usado para contornar essa falta.
- Falhas de cron (`cron-aceita-os-dois-segredos`, rota `campaign-worker`) e de
  resolução de agente (`resolve-turn-agent`, caso sem inbound) foram reproduzidas
  em uma cópia do HEAD inicial: dois testes falharam, 21 passaram. São externas
  ao diff de UI; autenticação e domínio permanecem fora do escopo desta correção.

Os logs completos ficam em `/tmp/deskcomm-responsive-*.log` nesta máquina.

- Responsividade final: **56/56 passaram**, nas 14 resoluções, inclusive com o
  corte global desativado durante a medição. Nenhuma ação fora da viewport nem
  overflow acidental detectado nos cenários exercitados. Não extrapolar para
  as rotas sem prova de browser.
- Prova negativa: o mesmo teste de API Tokens em 320×568, sobre uma cópia
  intocada do HEAD inicial, falhou como previsto: `dialog.y = -119,5px`.
  Uma falha prevista em um caso executado. A árvore de trabalho não foi
  sabotada; a comparação usa fonte original em outra pasta.

- Tipos de produção + sete arquivos TypeScript da bancada: passaram, usando
  configuração temporária que estende `tsconfig.json` e inclui esses arquivos
  explicitamente. Isso cobre o código novo sem alegar aprovação do typecheck
  completo que esgotou memória.

- Prova negativa desktop: no HEAD inicial, o dialog longo em 1366×768 falhou
  com `dialog.y = -489px`; o cenário corrigido passou na matriz final.
  Portanto, as comparações mobile e desktop produziram duas falhas previstas
  em dois casos executados sobre a fonte original.

- Suíte completa (`pnpm test:unit --maxWorkers=2`, em cópia sem `.env`):
  1.262 arquivos passaram e três falharam (1.265 no total); 12.758 testes
  passaram, três falharam e um teve falha esperada (12.762 no total).
  Além das duas falhas preexistentes reproduzidas no HEAD inicial, houve timeout
  na varredura de hidratação durante concorrência de suítes. A repetição isolada
  desse arquivo passou: **6/6**, com a varredura em 8,55 segundos. O resultado
  original da suíte completa permanece vermelho; a repetição não o reescreve.

- Build: executado em cópia isolada, sem variáveis de produção. A primeira
  tentativa encontrou a restrição do Turbopack a `node_modules` fora da raiz;
  isso foi resolvido copiando as mesmas dependências para dentro da cópia.
  A segunda tentativa foi encerrada por `oom-kill` no escopo limitado a 3 GB
  e um núcleo de CPU. **Build inconclusivo**, sem alegar sucesso de compilação.
- `git diff --check`: passou.
- Commit não criado: a condição do pedido (“se tudo passar”) não foi atendida.
  As mudanças estão na branch e há patch recuperável em
  `.superpowers/evidence/responsividade-desktop-mobile.patch`, aplicável sobre
  o HEAD inicial. Nenhum push, deploy ou reinício de produção foi realizado.

Pendências de validação: E2E autenticado com Supabase local, build e typecheck
completo em ambiente com memória suficiente, Safari/iOS e teclado real, além
das telas marcadas apenas como fonte na matriz. As duas falhas de domínio
preexistentes exigem trabalho separado; não foram corrigidas nesta tarefa de UI.

## Integração com DeskcommCRM 1.42.0 + MCP

O patch preservado foi aplicado ao merge `b8d383a9d` em
`feat/mcp-update-channel-1.42`. Os 60 arquivos do patch foram incorporados.
No conflito de `ApiTokensClient.tsx`, o modal rolável e os alvos maiores foram
combinados com o preset **Operação completa via MCP**. O typecheck completo
passou com heap Node de 4 GB. A matriz visual fez 55/56 na primeira corrida;
um cenário abriu página branca por timeout do servidor de teste e passou em
repetição isolada junto com os outros quatro cenários do recorte (5/5). A
primeira tentativa antes de instalar as dependências do navegador nem chegou a
abrir o Chromium, por ausência de `libatk` no host. A correção do `audit:read`
duplicado removeu o aviso de chaves React na repetição.
