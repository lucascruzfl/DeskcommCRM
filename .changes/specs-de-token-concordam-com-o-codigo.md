---
impacto: nada_mudou
secao: corrigido
titulo: As specs do token de servidor declaram o mesmo prefixo que o código emite
---

As especificações do token de servidor (Spec 01 e Spec 11) descreviam um prefixo e um formato que o código nunca emitiu; agora as duas declaram o formato implementado (`dsk_` + 8 hex aleatórios + segredo, com os 12 primeiros caracteres virando o prefixo que a tela exibe), e a Spec 01 registra por que o prefixo não carrega ambiente. Nenhum token é emitido, revogado ou regravado por isso: é alinhamento de documentação, e não há ação para quem opera a VPS.

Contribuição de @webtecnica (#1601).
