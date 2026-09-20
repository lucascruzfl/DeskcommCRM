import { z } from "zod";
import type { CustomFieldDef } from "@/lib/schemas/settings";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";

function schemaFor(field: CustomFieldDef): z.ZodType {
  switch (field.type) {
    case "number": return z.number().finite();
    case "boolean": return z.boolean();
    case "date": return z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    case "email": return z.string().email();
    case "phone": return z.string().regex(/^\+\d{8,15}$/);
    case "url": return z.string().url();
    case "select": return z.string().refine((v) => (field.options ?? []).some((o) => o.value === v), "Opção não permitida");
    case "multiselect": return z.array(z.string()).refine((values) => values.every((v) => (field.options ?? []).some((o) => o.value === v)), "Opção não permitida");
    case "text":
    case "textarea": return z.string();
  }
}

export function validarValoresDeCampos(
  settings: Record<string, unknown> | null | undefined,
  values: Record<string, unknown>,
  clearKeys: string[],
): Record<string, unknown> {
  const definitions = camposDoFunil(settings);
  const byKey = new Map(definitions.map((field) => [field.key, field]));
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const field = byKey.get(key);
    if (!field) throw new Error(`custom_field_not_defined:${key}`);
    output[key] = schemaFor(field).parse(value);
  }
  for (const key of clearKeys) {
    const field = byKey.get(key);
    if (!field) throw new Error(`custom_field_not_defined:${key}`);
    if (field.required) throw new Error(`custom_field_required:${key}`);
    output[key] = null;
  }
  return output;
}
