# Tela a tela — a ordem que o sistema impõe, os campos e o que cada um faz

Os rótulos abaixo foram conferidos em `lib/navigation/catalogo.ts` e nas páginas atuais da base
`mcp/stable` em `4431d9cf5155449610b2bdb604d7f317d1aa741d`. O grupo continua **Agente de IA**;
**Ver tudo em IA** abre o hub. Não dependa de um número de versão para encontrar a tela.

| Tela/rótulo de navegação | Caminho atual |
|---|---|
| Conexões | `/app/connections` |
| Credenciais / Provedores | `/app/ai/credentials` / `/app/ai/providers` |
| CRM › Funis | `/app/kanban` |
| CRM › Ver tudo em CRM › Etapas do funil | `/app/settings/tenant/pipelines` |
| Conhecimento | `/app/ai/knowledge/sources` |
| Follow-ups | `/app/ai/followups` |
| Agentes / Novo agente / editor | `/app/ai/agents` / `/app/ai/agents/new` / `/app/ai/agents/[id]` |
| Roteadores | `/app/ai/routers` |
| Memória / Skills | `/app/ai/memory` / `/app/ai/skills` |
| Inbox / Casos | `/app/inbox` / `/app/ai/cases` |
| Uso e orçamento / Equipe | `/app/ai/usage` / `/app/team` |
| API Tokens / Audit Log | `/app/settings/api-tokens` / `/app/audit` |

Criar/editar/publicar agente pela tela exige admin; ver o editor exige manager. Outras telas têm
guards próprios. No tenant **managed**, as áreas agency exigem membership admin; cliente agent
opera só as áreas permitidas, e not_applicable continua bloqueado. Para provisionar um cliente,
siga `cliente-gerenciado.md`: o fluxo gerenciado atual é MCP, sem tela nova de criação.

Cada peça tem dependências: agente WhatsApp publica com número conectado e credencial resolvida;
fluxo só roda publicado; material precisa de indexação pronta. Equivalentes MCP comprovados e
limites estão em `por-arquivo.md`.

## 1. Conexões — o número (pré-requisito de tudo)

O onboarding conecta por QR. Para conferir: **Conexões** → o número aparece com status *WORKING*.
Número novo em modo de teste (lista de telefones autorizados) fica assim até alguém liberar na
Central de avisos — o agente não responde a estranhos até lá. Proteção de envio (janela, ritmo,
aquecimento) fica no próprio número.

## 2. IA › Credenciais

**Adicionar** → provedor (Anthropic, OpenAI, Google, OpenRouter), um nome ("Chave principal") e a
chave. A validação roda em segundo plano contra o provedor; só credencial **validada** publica um
agente. Sem credencial, o agente pode usar a chave da instalação (a do `.env`) para Anthropic,
OpenAI e OpenRouter — Google só funciona como credencial daqui. A chave da OpenAI para áudio e
base de conhecimento entra aqui também.

## 3. IA › Provedores

Um modelo por **ponto de uso**: atendimento (precisa usar ferramentas), roteador (classificador —
um modelo barato basta), follow-up, transcrição de áudio, embeddings (fixo: `text-embedding-3-small`
da OpenAI). "Automático" usa o provedor padrão da organização. É aqui que se troca de provedor
depois da instalação.

## 4. Funil — CRM › Funis e Ver tudo em CRM › Etapas do funil

Crie o funil com o nome do pacote; etapas na ordem, marcando exatamente uma como **ganhou** e uma
como **perdeu** (o sistema recusa duas). Em cada etapa, o **passo do agente** (novo, contatado,
qualificando, qualificado, negociando, ganhou, perdeu) — é o mapa que deixa o agente mover o lead;
etapa sem passo não recebe movimento automático por esse mapa. Para ISP, mantenha os fechamentos
Sem cobertura, Desistiu e Sem retorno como motivos distintos de uma etapa de perda, não três
flags de perda. Preserve o contato sem cobertura para expansão futura. Vocabulário
(como chamar cliente/negócio/ganhou/perdeu) e
motivos de perda ficam na configuração do funil. O primeiro funil ativo vira o padrão.

## 5. IA › Conhecimento — acervo de materiais

**Adicionar material** → tipo: *FAQ* (pares pergunta/resposta — cole em markdown com
`## Pergunta:` / `## Resposta:` ou preencha os pares), *documento* (PDF, MD, TXT ou CSV até 20 MB; ou
texto colado), *catálogo* (vem da loja integrada) e *conversas* (aprendizado automático). Nome
único por material. A indexação é assíncrona: confira o estado de indexação do material, além de estar ativo;
sem chave de embeddings resolvida ele fica sem indexar e a tela avisa. Materiais são da organização; cada agente
escolhe quais usa.

## 6. IA › Follow-ups ("Fluxos")

**Começar de um modelo** é o caminho curto, e para clínica é o caminho certo: quatro fluxos
prontos, com os textos escritos — *consulta* (retomar quem sumiu na marcação, dispara com um dia
de silêncio), *exame* (marcar o que foi pedido, dispara na etapa do funil que você escolher),
*cirurgia* (acompanhar a decisão por quase três meses) e *falta* (remarcar quem não veio, dispara
quando alguém confirma a falta na agenda). Instalar **não manda mensagem**: o fluxo nasce
rascunho, com o gatilho armado, e abre no construtor para a pessoa ler os textos na voz da
clínica. Nos quatro, responder qualquer coisa encerra o fluxo e devolve a conversa a quem
atende. Os modelos vivem em `lib/followup/modelos/`; para ver os que existem sem confiar nesta
linha: `grep -n 'jornada:' lib/followup/modelos/clinica.ts`.

⚠️ Depois de instalar faltam **dois** passos, e sem eles o fluxo fica vivo na lista e morto no
motor: **Publicar** no construtor, e ligar o fluxo no agente (passo 7 abaixo, campo
*follow-ups que arma*). Gatilho automático só cria inscrição se um agente **publicado** arma o
ponteiro. Esquecer o segundo passo não é mais silencioso: uma verificação de hora em hora abre
na **Central de avisos** um aviso por fluxo publicado que nenhum agente arma, e o fecha sozinho
quando o vínculo aparece. Vale para silêncio, cliente voltou, etapa, atendimento aberto e falta —
manual e webhook funcionam sem agente e não geram aviso.

**Novo fluxo** → nome (único). No editor: **gatilho** (manual; silêncio por N minutos; cliente voltou
depois de X sem falar — número + minutos/horas/dias, padrão 1 dia, teto 90 dias; mudança de
etapa; falta a compromisso; caso aberto; webhook) com *cancelar quando responder*; depois os nós:
**espera** (fixa, de 5 min a 90 dias, ou inteligente com mínimo/máximo), **mensagem** (texto,
gerada pela IA com uma orientação, ou modelo de mensagem), **condição** (etapa, tag, passos dados,
último desfecho), **classificar resposta** (até 8 classes, com carência mínima de 15 min), **fim**
(convertido, esgotado, personalizado). Política ao passar para humano: pausar, cancelar ou seguir.
**Publicar** valida o grafo (gatilho presente, nada inalcançável, caminho de fallback, ciclos só com
espera). Rascunho não roda.

## 7. IA › Agentes

**Novo agente** → aba **Configuração**: nome, descrição, prioridade (desempata quando dois agentes
publicados atendem o mesmo número); o **prompt**; provedor, modelo e credencial (ou "chave desta
instalação"); o **número** que atende; **funis** em que pode mover leads (nenhum = só conversa);
**materiais** que consulta; **follow-ups** que arma; palavras de passagem para humano (padrão:
"falar com humano", "atendente", "pessoa real"); casos (abrir demanda para o time); dividir
mensagens longas; horário de atendimento (fora dele, adia). Na seção **Capacidades** da Configuração,
selecione os pacotes
(*vender* já traz agenda, catálogo, conhecimento, notas e funil) e as capacidades **críticas**
uma a uma (enviar mensagem avulsa, cancelar agenda, fechar caso) — o teto é 25.
A aba **Capacidades** acompanha o uso; a seleção fica na Configuração.

**ISP:** o pacote vender inclui agenda. Selecione só capacidades permitidas para comercial,
conhecimento, notas/funil e passagem/casos. Agenda/calendário OFF inicialmente, sem agendamento
de instalação/visita nem financeiro fictício; uma integração futura precisa de fonte real e
política revisada. Suporte e Financeiro têm responsáveis humanos, sem promessa de automação total.

Salvar cria a **versão 1 em rascunho**. Mudou algo depois de publicado? É versão nova — versão
publicada é imutável, e **Reverter** cria outra a partir da anterior.

## 8. Testar (na versão, antes de publicar)

Aba **Teste** da versão, botão **Testar**: uma mensagem, um contato fictício. Volta o texto que o agente mandaria,
as ações que tentaria (oferecer horário, registrar, mover) e os portões que passaram ou vetaram.
Consome crédito da IA. Sem histórico nem memória do lead — é o teste da primeira mensagem.
`crm_test_ai_agent_version` também oferece prévia controlada. Ela não confirma envio ou handoff
real: depois valide o caso/passagem, o humano assumindo no Inbox e a retomada autorizada da IA.

## 9. Publicar

Botão **Publicar** com confirmação. O sistema recusa com motivo claro quando falta credencial
validada, o número não está WORKING, o modelo saiu do catálogo ou uma capacidade não existe. A
publicação vale no próximo atendimento, sem reiniciar nada. Confira também o estado ativo do
agente. Via MCP, publicar e ativar são operações separadas e autorizadas (`por-arquivo.md`).

## 10. IA › Roteadores (só com dois ou mais agentes no mesmo número)

**Novo roteador** → nome, **Número de WhatsApp** (só um roteador ativo por número). Depois,
**Intenções**: para cada uma, **Nome da intenção** ("quer agendar"), **Agente que atende**,
**Quando escolher esta intenção** (a descrição é o que o classificador lê — escreva como o cliente
fala) e **Frases de exemplo**. **Agente de fallback** para quando nenhuma casa; **Modelo do
classificador** ("Automático" usa o provedor da organização). Ative. Roteador sem intenções e sem
fallback não sequestra o número; membro sem versão publicada cai no fallback.
No ISP, intenções-alvo: contratar → Comercial, internet caiu → Suporte/humano, segunda via →
Financeiro, quando instalar → Instalação. Destinos humanos usam passagem/casos e equipe real.
Não existe tool de criação de roteador IA no catálogo auditado; routing de atendentes é outra peça.

## 11. IA › Memória

**Documento da organização**: as regras da casa em texto corrido — **Publicar versão** (vale para
todos os agentes no próximo atendimento; só admin publica). **Aprendizados**: itens curtos com
**Título** e **O que o agente deve saber**; os "aprendidos automaticamente" vêm das propostas de
melhoria e ficam para revisar.

## 12. IA › Skills

As duas da plataforma (`agendamento`, `objecao-preco`) já valem para todo agente. Presença do
texto não habilita ferramenta: no ISP, mantenha capacidades de agenda OFF e não instale uma
personalização de `agendamento` para simular calendário. **Instalar** cria
uma cópia da organização para personalizar; **Importar** aceita um `.zip` com `SKILL.md` (nome,
descrição, palavras-chave que ativam) — é um roteiro condicional de texto, não um programa.

## 13. Depois

Webhooks (`/app/webhooks`) e regras de automação; Equipe
(convites, papéis, distribuição manual ou rodízio); Uso e orçamento (teto mensal de IA). Tokens de
API quando houver sistema externo via MCP ou rota REST que aceite bearer. Confira a tool/rota
específica e seu guard; não há autorização universal. No cliente managed, o gestor troca de
organização pelo organization switcher; tokens continuam vinculados ao tenant onde foram criados.
