# Revisão diferencial final: v1.57.0-mcp → v1.62.0

> Estado final validado em 2026-10-03: gaps A conhecidos = 0 e todos os gates finais verdes.
> Resultados completos em [revisão local](PARITY-1.62.0-REVIEW.md), seção Fechamento validado.
> Menções a gates pendentes abaixo são checkpoints históricos anteriores ao fechamento.

Referências locais: `v1.57.0-mcp` = `10b15555fcdfdd499279e44b1adef2845f8ff89f`; `v1.62.0` = `f12130953174088b201f1591779f8e484eb76976`. Implementação candidata sobre HEAD `fc4d663c795ebf994516d02274179120deb0b953` em `fix/mcp-b2b-parity-162`. Não houve fetch/push ou alteração da base. A distribuição MCP já contém operações além da tag upstream; comparação é com registry/catálogo/policy/scopes da árvore local preservada.

## Método e limite

Inventário Git do delta em app/api/v1, app/actions, lib e supabase/migrations: 616 arquivos, incluindo testes, documentação, remoções e renomes. Separação de endpoints novos, operações existentes alteradas, funções canônicas exportadas novas e migrations que introduzem estado/contratos. Leitura dos caminhos novos e dos deltas de handlers existentes; comparação com lib/mcp/tools, registry, catalog, policy e scopes. Uma nova coluna/projeção/implementação não é automaticamente uma operação nova. Não ampliar gaps preexistentes fora do delta para transformar toda rota HTTP em tool.

## Matriz restante

| Família / fonte | Delta relevante | Classe e conclusão MCP |
|---|---|---|
| B2B: companies, people, company-people, contacts/person, imports; migrations 0448/0449 | Empresas/pessoas/vínculos/lotes e LGPD | A coberto pelas 13 tools locais preservadas. Upload CSV/XLSX e enrich/cliente BrasilAPI B; sem enriquecimento externo por tool. crm_b2b, tenant explícito, proveniência humana e PII redigida. |
| reports/tags | Novo agregado por etiquetas, janela/fuso e limites | A coberto por crm_get_tags_report, manager, conversations:read; handler HTTP/MCP compartilhado e redaction. |
| reports/activities | Troca de projeção de pipelines/agentes | Operação já existente, sem nova operação delegável no delta; não criar tool por troca interna de tabela. |
| Migration 0444 fn_relatorio_financeiro / lib/money | por_moeda aditivo, soma sem conversão, topo legado preservado | Correção de representação de relatório existente, não novo endpoint/operação. Não inventar operação de financeiro para aumentar escopo desta paridade. |
| Honorários, migration 0480 | Contratos/parcelas/pagamento interno | A coberto: get contrato, list parcelas, create contrato/parcela e list contratos sem lead. Todas as tools revalidam módulo; novas administrativas manager. Pagar B: confirma pagamento real e cria lançamento no caixa, RPC autentica auth.uid()/membership humano. Service role não é proveniência da confirmação; sem novo caminho de pagamento por MCP. |
| Propostas e modelos, migrations 0462–0477 | Ciclo comercial, documento, revisão, modelos, defaults, PDF/LLM/envio | Revisão integral e classes por operação em PROPOSTAS-FASE2-1.62.0.md. A cobertos pelas tools antigas, fase 1 e 14 administrativas novas. B/C preservados deliberadamente. |
| ai/knowledge/busca; migration 0484; lib/ai/knowledge/busca | Consulta do acervo inteiro, limiar de agente configurado e telemetria de autoria | A pequeno coberto por crm_search_organization_knowledge, manager/knowledge:read. Reusa queryKnowledgeHandler HTTP/MCP, buscarConhecimento e resolverAcervoDoAgente; máximo 1000 caracteres/10 trechos e teto token/org. Embedding pago usa credencial configurada, sem segredo nos argumentos, sem mudança de fornecedor nem geração probabilística. A busca RAG já é delegada no MCP; nova tool cobre consulta administrativa de toda org que crm_search_knowledge (assistente obrigatório/limiar padrão) não substitui. author_kind ai para token; nunca forjar sessão humana; telemetria não grava pergunta. |
| ai/knowledge/provedor, chave, reindex-all, embeddings/chave/estado, reprepara-tudo | Escolha de família, chave e reenfileiramento canônico | Escolher fornecedor B: admin, material enviado ao provedor e credencial utilizável necessária. Chave B: segredo. Reindex-all já existia, extração de fila não é nova operação; tools de knowledge-administracao preservam preparação por fonte. Sem alteração desses controles. |
| channel-sessions/groups, lib/grupos/servico, migration 0482 | Consultar grupos presentes/órfãos e alternar intake | GET A pequeno coberto por crm_list_channel_groups, manager/channels:read, área connections. Reusa serviço existente, filtra sessão/linhas por tenant antes do provider. Retorna somente dados do grupo, sem credencial/ref de sessão. PUT B: muda intake no WhatsApp e consentimento de entrada, confirmação do filtro/humano preservada. Ingest/sincronização C: execução interna. |
| notes/media, migration 0483, schemas/notes | Upload privado e redirect assinado para binário; notas com anexo | Upload/download B: arquivo obrigatório/URL assinada TTL e sessão humana com visibilidade de conversa. As operações textuais de notas já têm list/create/delete MCP; não inventar transporte binário ou anexar caminho arbitrário via tool. Colunas de anexo não criam nova operação administrativa distinta. |
| Automação: gatilhos-de-tempo, cron/lead-time-triggers, migration 0481, schemas/webhooks | lead.silent_for/lead.stage_stale com N/direção e cooldown | A já configurável nas tools existentes através do schema canônico com superRefine. Gap pequeno de descoberta fechado: crm_discover_automation_triggers agora declara dias/direcao/opcionais reais; limites vêm das constantes do motor. Criação/edição continuam inativas, ativação capability separada; cron C. |
| automation-rules/runs/resend, call-webhook | Identidade de entrega/tentativa e assinatura aprimoradas | B para reenvio: webhook externo; operação preexistente, sem nova delegação automática. Funções de assinatura/retry C internas; não exportar segredos. |
| CRM: contacts, leads/clone/move/bulk/reactivation, pipelines/board/default/stages; actions/updatePipelineConfig | Projeções/RLS substituídas, handlers inline, filtros e regras existentes | Sem novos endpoints/operações delegáveis nesta família; equivalentes MCP existentes em contacts/leads/pipelines/tags/tarefas e serviços da distribuição preservados. Mudança de funil/clone, schema, campos e etapas já cobertos; importação binária B. Configuração nova de filtros não deve se tornar uma tool duplicada. |
| Atendimento: conversations/counts/filtros/close/draft-reply/passagens/pause-ai/retention/snooze/usable-for-rag; messages/media/_handler | Projeções, escopo, filtros de múltiplas etiquetas, claim/handoff/origem/mídia | Operações já existentes, sem novo gap por substituir projeção/tabela. Registro/handoff/notas/mensagens têm superfícies MCP e gates canônicos; alterações de mídia não autorizam novo upload binário. |
| Agenda: agendamentos, google/calendarios, atualizar, configuracao, vinculos | Projeções → tabelas, formatação e guardas de vínculo/entrega | Sem operação nova: calendário pertence à sessão humana e OAuth; ações de agenda já cobertas por agendamento MCP e canonicals. Não inventar refresh de conexão humana por token. |
| AI: agents/versions/assignable/automatico-ativo/evolution/providers, followup-flows/duplicate, graph-schema | Diretório seguro/projeções, versões e ponteiros/cópia | Sem nova operação no delta: tools ia/followup/evolucao já cobrem versão, administração e cópia; o novo nó internal_task já atravessa patchFollowupFlowSchema/flowGraphSchema e validateFlowForPublish canônicos na tool existente. Diretório/rotas UI não criam tool independente. Provider/credencial e ações admin não ampliam agent. |
| Actions integrations/onboarding/shell; prospecting/agents | Guardas, membership/troca de org, bootstrap/funil e admin | Sessão/onboarding C ou B para OAuth; trocar org da sessão não troca org confiável do MCP. Preparação/admin da prospecção não ampliada para manager. |
| definirVendaPeloCanal; channels/conversao-pelo-canal/zernio; conversions/venda-pelo-canal | Novo controle de conversão pelo canal | B: admin + MFA; configura comunicação/conversão externa. Nenhuma tool nova para manager. |
| Modulos, resources opcionais, capabilities; actions/updateModuloDaInstalacao; migrations RLS removidas/renomeadas | Instalar módulos, portas org/instalação, pacote núcleo e policy | C para instalação/global; capacidadades existentes determinam descoberta e execução MCP. Não expor configuração da instalação. Remoções/renomes de migrations managed e mudanças de projeções não são novas operações delegáveis. |
| Branding/marca/logo/icone, sons, voice, system/update/version/health | Ícone binário, RLS, arquivos/sons, runtime/instalação | Binários/OAuth B; UI e operação global C. Restantes endpoints preexistentes, sem novo A manager org-scoped. Não tocar produção/update/release nesta sessão. |
| agent-engine/abertura/checkpoint/ritual, entrega-de-capacidade, runtime/projecao, supabase/fetch/url-servidor, waha/ingest/envelope/remetente | Execução, continuidade, transporte e instalação | C: infraestrutura interna, sem nova operação canônica delegável independente; não transformar helper/trigger em tool. |
| Migrations: 0478 notas/realtime, 0477 privacidade, 0443 ícone, 0462–0477 proposta, 0448/0449 B2B, 0480 honorários, 0482/0483/0484 | Schema, constraints, RLS, redação e suporte às operações acima | Operações avaliadas nas linhas de domínio. RLS/cross-tenant, um rascunho e cadeia têm testes de banco; não criar RPC/migration nova para contornar auth.uid() ou gates humanos. |

B2B, reports, honorários, toda família Propostas e restante do delta foram revisados. **Gaps A conhecidos finais: 0** nesta comparação de operações novas e delegáveis. B/C não são lacunas a expor para obter número zero. Nenhum outro domínio grande A foi identificado depois dos recortes acima. Esta conclusão de auditoria não substitui gates: commit permanece proibido até todos os gates finais verdes.

## Continuidade e prova

Entradas: token manager autorizado e módulo/capacidade reais; saídas: dados/rascunhos/configuração internos das telas existentes. Registros: audit universal redigido, audit de domínio com identidade real do token, telemetria sem pergunta. Erros/estado inválido requerem recarga/correção explícita; criações não idempotentes não prometem retry automático. Documento, modelos, defaults e revisão não geram proposta enviada nem decisão do cliente. Mapa existente mcp-fundacao-ia atualizado para handlers compartilhados e leituras restantes, sem renderização de HTML.

Controle negativo: retirar status=rascunho do UPDATE documental fez o caso de envio concorrente falhar (código 1). Handler restaurado antes dos dirigidos finais. O teste original HTTP foi ajustado ao builder PostgREST guardado e à auditoria redigida; contratos de resposta, papel, capability e aviso permanecem preservados.

Gates finais: pendentes no momento de consolidação deste documento. Resultados finais serão registrados em PARITY-1.62.0-REVIEW.md sem reaproveitar suítes históricas. Sem staging/commit até satisfazer todos os critérios. Arquivo protegido e backups permanecem intocados; sem push, PR, tag, release ou deploy.


## Catálogo de atendimento e importações

As 13 tools B2B permanecem no MCP externo, com os mesmos papéis/scopes.
As consultas de lotes de importação ficam marcadas apenasHumano no catálogo:
são histórico operacional de uploads humanos, e não capacidades de atendimento
da IA interna. As quatro leituras de empresas/pessoas continuam selecionáveis.
O pacote organizar tem 26 capacidades, respeitando o teto existente de 27,
sem ampliar onboarding, teto ou permissões. A/B da cerca de seleção: base 22,
candidato anterior 28; duas consultas operacionais fora do pacote resolvem o caso.
