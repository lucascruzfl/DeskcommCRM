# 7D — certificação sintética do provedor gerenciado

> **FICTÍCIO — APENAS TESTE — NÃO USAR COMO DEFAULT DE PRODUÇÃO.** Fibra Horizonte Demo não é uma empresa real. A transcrição estruturada está em [`tests/fixtures/managed-isp/piloto-reuniao-ficticia.md`](../../tests/fixtures/managed-isp/piloto-reuniao-ficticia.md). Nenhum preço, bairro, horário ou prazo deste piloto pertence ao preset global.

## Pergunta que a certificação responde

Um operador poderá entregar uma transcrição ao Codex/Claude Code, revisar fatos e pendências e então configurar o cliente pelas tools oficiais, sem SQL manual por cliente. A certificação usa Supabase local e tenant descartável. No teste E2E, o transporte de convite é capturado no processo, o canal `WORKING` existe apenas no banco local sem sessão WAHA, e a credencial de IA é uma chave fictícia criptografada e marcada como validada **somente na fixture local**. O provider controlado impede chamada de modelo externo. Não há mensagem externa, pagamento, integração de rede, tag, release ou deploy.

O destino é **núcleo**, pois a prévia de um router draft é uma capacidade geral de operação do MCP. O piloto e seus dados são fixture/documentação. O contrato 7B/7C continua compartilhado pelos tenants ISP gerenciados; clínica e tenant comum não recebem o preset ISP.

## Reunião → configuração

O operador primeiro separa `FACTS`, `POLICIES`, `FOLLOWUP_TIMINGS`, `KNOWLEDGE`, `MEMORY_RULES`, `HUMAN_DEPENDENCIES`, `UNRESOLVED` e `IDEAS` no arquivo da transcrição. Ideia da IA não é fato do cliente e não é aplicada sem decisão. Para o piloto, as decisões confirmadas são:

| Fonte | Configuração no tenant fictício |
| --- | --- |
| Bairros com rede informada | FAQ: Centro, Planalto, São José, Lagoa Nova, com ressalva de cobertura por endereço |
| Cobertura específica | CEP, rua, número, complemento opcional, bairro e cidade; verificação humana e disponibilidade de porta |
| Planos residenciais | FAQ: 300 Mbps/R$ 79,90; 500 Mbps/R$ 99,90; 700 Mbps/R$ 119,90 |
| Horário | FAQ: segunda a sexta 8h–18h, sábado 8h–12h; mensagem fora do horário continua aceita |
| Suporte | FAQ: equipamentos ligados, luzes, roteador desligado 30 s e religado uma vez; depois humano |
| Instalação | FAQ: referência de até três dias úteis após cobertura/documentos, sujeita à agenda |
| Proibições e dependências | Org memory: não inferir cobertura, não prometer instalação grátis sem política confirmada, não inventar boleto/PIX, segunda via/pagamento/desbloqueio dependem de pessoa, não guardar senha Wi-Fi, data exata exige confirmação, caso humano ou handoff conforme necessidade |

Não há endereço, pessoa, senha, chave ou telefone de assinante no acervo e na memória. A fonte FAQ nasce com indexação assíncrona solicitada; o vínculo com a versão draft é imediato, mas busca semântica só pode ser considerada pronta depois de `index_state=ready` e teste direto de `crm_search_knowledge` com o mesmo texto usado no teste do agente. O teste E2E local não força a indexação pelo banco.

## Sequência pública e limites da fixture

1. `crm_list_managed_client_presets`, `crm_preflight_managed_client`, `crm_create_managed_client` são as portas públicas. A spec existente `managed-client-onboarding.spec.ts` mede criação MCP com SMTP local. A spec 7D usa o **mesmo serviço oficial de onboarding** com transporte de convite injetado no processo de teste, para não alterar SMTP compartilhado; preflight e criação do piloto passam por esse serviço. Não se escreve diretamente nas tabelas para provisionar o tenant.
2. O onboarding aplica 7B automaticamente. A spec 7D observa o funil `Vendas — Internet`, as sete etapas, campos, tags e política; `crm_configure_managed_internet_provider` verifica o plano no token do tenant alvo. As três rules automáticas de tag e os motivos de perda pertencem ao contrato 7B e são cobertos pelos testes próprios de 7B.
3. `crm_create_knowledge_source` grava a FAQ do **tenant fictício** e emite evento de indexação; `crm_get_knowledge_source` lê o material. Uma pessoa usa `crm_save_org_memory` para gravar regras duráveis aprovadas com `source=manual` e `created_by` do provisionador do token; o handler recusa escrita de `ai_agent`. `crm_get_org_memory` continua disponível para leitura pelos agentes e confirma o resultado. A documentação não promove este conteúdo para o preset.
4. `crm_configure_managed_internet_provider_ai` com `confirm=false` verifica política, ator, referências, canal e prazos sem escrita. Com `confirm=true` prepara cinco versões `draft` de `mcp_agent`: Atendimento geral ISP, Comercial, Suporte, Financeiro e Instalação. A fonte FAQ é vinculada às cinco versões; Instalação também recebe `crm_search_knowledge` para consultar a previsão operacional antes de responder. O router inativo tem quatro intents e fallback geral. Repetir o prepare não duplica recursos.
5. Quatro follow-ups ficam em `draft`, com grafo `somente_interno`, nó `wait`, nó `internal_task` e fim. Plano apresentado: 1440 minutos, cancelamento por resposta; documentos: 2880; instalação: 1440; Sem cobertura: 43200 e gatilho manual. `task_due_days=0` vence no dia em que a tarefa é criada **depois da espera**; a reunião não definiu prazo adicional de conclusão. O motivo Sem cobertura exige classificação humana, e o motor não deve inferi-lo a partir da etapa perdida.
6. `crm_test_ai_agent_version` é a prévia oficial de cada draft; no E2E, `INTERNAL_AGENT_RUN_STUB=true` substitui apenas o provider, deixando o core e os gates ativos. O playbook de plataforma também é semeado no Postgres local para a prévia. `crm_get_ai_router` inspeciona pelo MCP o draft, os quatro membros e o fallback reais. `crm_test_ai_router` aceita ID do router e mensagem, inclusive router inativo; carrega pelo tenant do token, valida os agentes do mesmo tenant, chama `classifyIntent` e `destinoDoVeredito` do runtime, devolve intenção, confiança, fallback e agente. A decisão da prévia é provada em teste unitário com classificador controlado; o E2E não classifica mensagens por essa tool. A prévia não cria conversa, não chama WAHA e não grava `ai_router_decisions`. A chamada pode consumir modelo real fora do teste. O texto da mensagem é retirado da auditoria MCP.
7. Para o ciclo humano, a spec cria um contato e uma conversa fictícios no banco local. As transições usam `openCase`, `performHumanHandoff` e `resolveCaseFromHuman` do engine, com aviso ao lead explicitamente não enviado. O MCP lê o caso e o histórico e uma pessoa com token autorizado chama `crm_resume_ai_attendance`. A tela `/app/ai/cases` mostra o caso e seu bloqueio; prova em `evidence/managed/isp-7d-human-case.png`. A spec confirma que a IA silencia durante o handoff, volta após a devolução e não há mensagens nem registros no `send_ledger`. Isto prova continuidade de estado, não entrega pelo canal.

Os cinco drafts fictícios vistos na tela estão em `evidence/managed/isp-7d-synthetic-drafts.png`.

## Roteiro de aceite das mensagens

As frases abaixo são **texto cru** do caso. O E2E usa provider controlado em oito prévias dos cinco papéis dos agentes; inspeciona via MCP o router real, os quatro membros e o fallback configurado, sem classificar mensagens pelo router. O teste unitário chama `crm_test_ai_router` com vereditos controlados para provar classificação e fallback pela decisão canônica, sem medir a qualidade de um LLM real. Uma busca direta no acervo deve usar o mesmo texto do teste do agente quando a resposta depender dele. A fixture não certifica o conteúdo semântico das respostas dos agentes nem a indexação do acervo.

| Caso | Frase | Destino e limite exigido |
| --- | --- | --- |
| A | Quero contratar internet | Comercial |
| B | Vocês atendem o bairro Centro? | Comercial; rede no bairro pode ser citada, cobertura do endereço continua pendente |
| C | Meu CEP é 00000-000, tem cobertura? | Comercial; sem conclusão automática, caso humano para endereço |
| D | Quais planos vocês têm? | Comercial; apenas três planos e preços do tenant fictício |
| E | Minha internet caiu | Suporte; somente procedimento documentado, sem reinício remoto |
| F | Minha senha do Wi-Fi é 123... | Não repetir nem guardar segredo; orientar sem pedir senha |
| G | Me manda a segunda via | Financeiro; caso humano, sem boleto/PIX inventado |
| H | Já paguei, libera minha internet | Financeiro; sem confirmação/desbloqueio, caso humano |
| I | Quando o técnico vem? | Instalação; previsão condicionada, sem data exata; confirmação humana |
| J | Quero falar com uma pessoa | Handoff canônico, IA silencia |
| K | Resposta humana + devolução | Só pessoa devolve, briefing e continuidade preservados |
| L | Mensagem ambígua | Atendimento geral ISP |
| M | Baixa confiança | Atendimento geral ISP |
| N | Classificador falha | Atendimento geral ISP, sem silêncio |
| O | Tenant B usa recurso do A | Falha fechada para agente, knowledge, canal, router e flow |

O piloto verifica pelo token do tenant B a recusa de agente, FAQ, canal, router e flow do tenant A. O preflight 7C também recusa credencial, canal, acervo e flow de outro tenant nos testes de serviço. O ciclo humano sintético passa pelas funções canônicas e pela tela; não representa uma conversa ou uma entrega real.

## Lacunas e limites reais

- **Fechada:** `crm_list_managed_client_presets` devolvia um array no nível superior, rejeitado como `structuredContent` na chamada MCP real. Agora devolve `{ presets: [...] }`, preservando os dados e tornando a descoberta utilizável por Codex/Claude Code.
- **Fechada:** faltavam inspeção e prévia MCP de router inativo. A UI/REST testava apenas router ativo e exigia sessão de tela. `crm_get_ai_router` expõe o draft do tenant e `crm_test_ai_router` reutiliza a régua do runtime sem relaxar a ativação.
- **Fechada:** `crm_save_org_memory` gravava toda regra como origem `agent`, mesmo quando um operador usava seu token. Agora só uma pessoa com papel `manager` grava a regra confirmada; a entrada é `manual` com autor, como na rota da tela, para que um fato confirmado na reunião não pareça ideia da IA.
- **Ainda pela tela:** criação/edição genérica e ativação de `ai_routers`; no ISP o configurador 7C já cria router e membros. Ativação aguarda dados reais e aprovação. Não foi acrescentada tool de ativação só para este piloto.
- **Ainda pela tela:** credencial real validada, seleção de provider e equipe humana. O MCP lista e valida metadados, mas não transporta chave. A chave fictícia da fixture não serve para publicação/produção.
- **Ainda sem prova semântica ou de canal:** classificador real, conteúdo das respostas dos cinco agentes, busca após indexação e troca de mensagens pelo Inbox. O caso, handoff e devolução são provados no estado local com as funções canônicas e MCP; a 7D sintética não afirma entrega por canal.
- **Sem cobertura automática:** não existe consulta de rede, ERP, financeiro de assinantes, PIX, boleto ou calendário de instalação. Nenhum efeito externo foi simulado como se tivesse ocorrido.

## Living System Checklist da prévia MCP

| Pergunta | Artefato concreto |
| --- | --- |
| Entrada | `crm_test_ai_router` pelo token MCP do tenant, com router e texto validados por Zod |
| Saída | `classifyIntent` + `destinoDoVeredito` devolvem destino/fallback ao operador |
| Registro | `auditMcpToolCall` grava recurso e resultado, sem texto da mensagem |
| Visibilidade | Resultado no cliente MCP; auditoria em `/app/audit`; router revisável em `/app/ai/routers` |
| Porta | Registro MCP, catálogo `TOOLS_IA` e política de área `routing` |
| Próximo passo | Operador corrige configuração no router/telas antes de ativar; prévia não cria demanda de cliente |
| Configuração | `/app/ai/routers` altera router; 7C prepara o ISP |
| Continuidade IA↔humano | A prévia não abre conversa; o runtime mantém caso, handoff e `crm_resume_ai_attendance` |
| Laço de retorno | Resultado do teste orienta revisão humana de exemplos, confiança ou agente de reserva; nenhuma alteração automática |
| Mapa | `docs/architecture/managed-isp-ai-human.architecture.json` liga tool, router e auditoria |

Quando surgir o primeiro cliente real, substituímos a transcrição e os dados fictícios pelos dados da reunião real; não deve ser necessário mudar código para configurar esse cliente, salvo se surgir uma capacidade nova.
