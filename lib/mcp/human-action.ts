export interface HumanActionResource {
  type: string;
  id?: string | null;
}

export interface HumanActionInput {
  code: string;
  reason: string;
  resource: HumanActionResource;
  instruction: string;
  endpoint?: string;
  href?: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  uploadRequired?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Contrato único para uma continuação que precisa de pessoa, navegador ou binário.
 * Não recebe autenticação nem credencial: a pessoa conclui no fluxo oficial.
 */
export function humanAction(input: HumanActionInput): Record<string, unknown> {
  return {
    human_action_required: true,
    ...(input.uploadRequired ? { upload_required: true } : {}),
    code: input.code,
    reason: input.reason,
    resource: input.resource,
    instruction: input.instruction,
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    ...(input.href ? { href: input.href, url: input.href } : {}),
    ...(input.method ? { method: input.method } : {}),
    ...(input.metadata ?? {}),
  };
}
