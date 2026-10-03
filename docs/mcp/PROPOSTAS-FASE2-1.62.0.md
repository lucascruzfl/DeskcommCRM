# Propostas: revalidação da fase 2

> Estado final validado em 2026-10-03: gaps A conhecidos = 0 e todos os gates finais verdes.
> Resultados completos em [revisão local](PARITY-1.62.0-REVIEW.md), seção Fechamento validado.
> Menções a gates pendentes abaixo são checkpoints históricos anteriores ao fechamento.

Recuperação em `fix/mcp-b2b-parity-162`, base `fc4d663c795ebf994516d02274179120deb0b953`. Primeira fase preservada. A = operação interna canônica delegável; B = interação humana/efeito externo/budget/binário; C = detalhe de interface/preflight sem contrato MCP independente. Classificação antes da implementação, não extrapolação da matriz histórica.

## Matriz canônica

Rotas abaixo relativas a `/api/v1`. Todas as operações Propostas MCP exigem a capacidade organizacional **propostas**, inclusive com service role. HTTP mantém seus papéis e suas portas. Nenhuma operação A dispara WhatsApp, chama LLM, gera arquivo/PDF, consome orçamento, aceita/recusa pelo cliente ou exige confirmação humana canônica. Escritas MCP são administrativas manager; as leituras administrativas também manager. Não é ampliação do agent HTTP.

| Operação / rota / handler canônico | Papel HTTP | Leitura / escrita interna | Classe / equivalente |
|---|---|---|---|
| GET proposals | viewer | leitura | A: crm_list_proposals, existente local |
| GET proposals/[id] | viewer | leitura com itens/drift | A: crm_get_proposal, existente local |
| PATCH proposals/[id] | agent | rascunho/revision/itens | A: crm_update_draft_proposal, existente local |
| GET proposals/[id]/documento; montarDocumentoDaProposta | viewer | leitura de seções/pendências/prontidão | A: obter representação estruturada; sem storage/URL/PDF |
| PATCH proposals/[id]/documento: campo | manager | briefing validado contra modelo | A: preencher campo explícito, não aplicar sugestão automaticamente |
| PATCH proposals/[id]/documento: seção | manager | reescrever/restaurar seção | A: edição explícita de rascunho |
| POST proposals/[id]/revise; decidirRevisao/resolverItensDaProposta | manager | cria nova versão em rascunho | A: criar revisão, não aprovar |
| DELETE proposals/[id] | manager | status rascunho → cancelada | A: descarte explícito, preserva histórico |
| POST proposals/[id]/send | agent | estado/envio/snapshot | B: WhatsApp/efeito externo; gate humano mantido |
| POST proposals/[id]/decide | agent | aceita/recusa | B: representa decisão do cliente |
| POST proposals/[id]/assistant; gerarMudancas/runModelCall | agent | somente gera sugestão, não grava proposta | B: provedor externo recebe proposta/briefing; budget e geração probabilística; acionamento humano pago, não leitura |
| GET proposals/[id]/assistant/disponibilidade | agent | leitura/preflight | C: preflight isolado, deliberadamente sem tool |
| POST proposals/[id]/assistant/apply | agent | aplica mudanças já revisadas | B: revisão humana expressa, não contornar pelo MCP |
| POST proposals/[id]/preencher-com-conversa; sugerirValoresDaConversa | manager | sugestão sem gravação | B: envia transcrição a provedor LLM e consome budget; requer pessoa revisar. Não existe GET de sugestão persistida |
| PATCH proposals/[id]/modelo | manager | confirma modelo/descarta reescritas | B: confirmação explícita permanece humana |
| GET proposals/[id]/previa | viewer | gera PDF | B: binário/PDF, distinto do documento JSON |
| GET settings/proposal-templates; listarModelosDaOrganizacao | viewer | lista completa, incluindo ocultos | A: lista administrativa; preparar_proposta lista apenas modelos ativos resumidos e não substitui esta operação |
| GET settings/proposal-templates/[slug] | viewer | modelo completo/base pública ou cópia org | A: obter modelo |
| POST settings/proposal-templates: novo | manager | cria modelo org, sem LLM | A: criação estruturada |
| POST settings/proposal-templates: personalizar | manager | copia base para org | A: personalização interna |
| POST settings/proposal-templates: ocultar/mostrar | manager | visibilidade da base na org | A: não altera instalação/base global |
| PATCH settings/proposal-templates/[slug] | manager | edita cópia ativa/versiona | A: edição validada |
| DELETE settings/proposal-templates/[slug] | manager | is_active=false | A: desativa cópia, sem exclusão física; base volta como fallback canônico |
| POST settings/proposal-templates/importar | manager | arquivo + extração/LLM | B: binário obrigatório/provedor/budget |
| GET settings/proposals | viewer | configurações da org | A: consulta administrativa com capacidade MCP; HTTP permite configurar módulo instalado antes de habilitar org |
| PATCH settings/proposals: default_valid_days/default_conditions | manager | defaults comerciais da org | A: subconjunto seguro explícito, merge canônico |
| PATCH settings/proposals: enabled/followup_dias/avisar_no_whatsapp | manager | controla capacidade/followup/avisos | B: habilitação de automação/WhatsApp exige decisão humana; não expor por defaults |

## Revisão, concorrência e isolamento

A revisão só aceita **enviada**, exige numero/ano consistentes, herda moeda/número/ano, incrementa versao e aponta substitui_id. A anterior permanece enviada até envio humano futuro. O índice único do banco garante um rascunho por negócio; 23505 retorna conflito. A rota canônica não oferece expected revision para criação de revisão; não inventar aprovação/concurrency inexistente. Reprecificação usa resolvedor canônico que recusa produto de outra organização. Falha na cópia dos itens remove somente a versão recém-criada da própria org.

Documento canônico não tem revision otimista; preservar esse contrato, mas fechar corrida de estado na escrita com predicado rascunho no UPDATE. Discard já tem esse predicado. Modelos usam proximaVersao scoped, sem revision otimista HTTP. Não prometer transações onde o canônico usa múltiplas queries.

Todas as queries privadas usam organization_id do contexto; organizations usa id do contexto. Slug de base pública pode resolver para base quando não existe cópia local, nunca para cópia estrangeira. Documento não devolve storage/URL. Não oferecer ativação de cópia inexistente: criação/personalização já ativa e ocultar/mostrar só controla bases.

## Autorização, policy e auditoria

Domínios granulares: operations para proposta/documento/revisão/descarte; templates para modelos; settings para configuração. Scopes globais mcp:read/mcp:write e escopos de domínio/tool seguem policy real. Descarte/desativação exigem destructive_operations. Managed policy: /app/proposals para proposta/documento/revisão/descarte; /app/settings/tenant/proposals/modelos para modelos; /app/settings/tenant/proposals para defaults/configuração. Nunca herdar área de mensagens templates nem dar configuração por autorização apenas da lista de propostas.

Auditoria universal registra apenas presença de proposal_id/template_slug, nomes de campos conhecidos, quantidade de seções, action_kind e revision quando existente. Nunca texto, slug derivado de nome, briefing, conteúdo de modelo/documento/sugestão, valor de campo nem erro cru. Auditoria de domínio usa ator real (api_token não personificado como user) e metadados seguros. B/C não recebem tool por objetivo numérico de paridade.

## Estado dos gates

A revalidados implementados: 14 tools administrativas em lib/mcp/tools/propostas-administracao.ts. Testes e revisão diferencial final detalhados em DELTA-1.57-1.62-FINAL.md; gates amplos finais ainda pendentes neste checkpoint. Gates históricos da fase 1 não são gates finais desta fase. Sem commit enquanto houver A aberto ou qualquer gate final pendente.

## Respostas de efeito por operação

A tabela canônica acima responde rota/handler, papel HTTP, leitura/escrita e equivalente. Todas as linhas A novas têm módulo instalação propostas + capacidade org propostas, confirmação humana canônica **não**, delegação **sim**, equivalente anterior **não** (exceto A fase 1 explicitamente marcado existente). Para documento/seções/campos/revisão/descarte/modelos/defaults, nenhum efeito WhatsApp/LLM/arquivo/budget/decisão de cliente é provocado pelo handler. Aviso de revisão resolve apenas aviso interno, sem enviar WhatsApp.

| Operação B/C | Apenas lê | Escreve estado interno | WhatsApp | LLM/provedor | Arquivo/PDF | Budget | Decisão do cliente | Gate humano / delegação / equivalente MCP |
|---|---|---|---|---|---|---|---|---|
| send | não | sim | sim | transporte externo, sem gerar sugestão LLM | PDF/storage | não LLM direto | não | envio humano; B, não delegar nesta paridade, sem equivalente novo |
| decide | não | sim | não pelo handler | não | não | não | sim | decisão de cliente; B, sem tool nova |
| assistant gerar | não (executa geração) | não grava proposta | não | LLM | não | sim | não | acionamento humano pago, saída requer revisão; B, sem tool nova |
| assistant/apply | não | sim | não | não (usa mudanças já revistas) | não | não | não | revisão humana prévia explícita; B, sem tool nova |
| disponibilidade | sim | não | não | não | não | apenas consulta saldo | não | C, preflight da interface; sem tool |
| preencher-com-conversa | não (executa geração) | não grava proposta | não | LLM/transcrição | não | sim quando há conversa/campos | não | pessoa revisa sugestões, B; sem GET de sugestão persistida |
| modelo | não | sim | não | não | não | não | não | confirmação e descarte de reescritas explícitos; B, sem tool nova |
| previa | não (renderiza arquivo) | não persiste proposta | não | não LLM | PDF | não LLM | não | B, leitura binária via interface humana; sem tool PDF |
| importar modelo | não | geração sugerida, sem confirmação automática | não | LLM | lê binário PDF/MD/TXT | sim | não | B, pessoa importa/revisa; sem tool binária |
| configuração enabled/followup/WhatsApp | não | sim | controla efeito futuro | não imediato | não | não imediato | não | B, decisão humana sobre automação; tool defaults exclui essas chaves |

Tools novas da fase 2: crm_get_proposal_document, crm_update_proposal_document_field, crm_update_proposal_document_section, crm_create_proposal_revision, crm_discard_draft_proposal, crm_list_proposal_templates, crm_get_proposal_template, crm_create_proposal_template, crm_customize_proposal_template, crm_set_proposal_template_visibility, crm_update_proposal_template, crm_deactivate_proposal_template, crm_get_proposal_settings, crm_update_proposal_defaults. O destino das escritas é registro interno de proposta/modelo/configuração; leituras só respondem dados à chamada. A edição textual explícita não é assistant/apply nem confirmação de modelo.
