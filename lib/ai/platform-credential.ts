/**
 * Resolve a credencial de instalação sem carregar nenhum runtime de agente.
 * A função devolve a chave apenas aos consumidores internos; superfícies MCP
 * usam exclusivamente o booleano de disponibilidade.
 */
export function chaveDePlataforma(provider: string): string | null {
  const nome = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  }[provider];
  if (!nome) return null;
  const value = (process.env[nome] ?? "").trim();
  return value === "" ? null : value;
}
