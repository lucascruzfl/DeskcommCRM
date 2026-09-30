import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { loadActiveRouter, loadRouterForPreview } from './router-config';

function poolSeq(responses: Array<{ rows: unknown[] }>): pg.Pool {
  const query = vi.fn();
  for (const r of responses) query.mockResolvedValueOnce(r);
  return { query } as unknown as pg.Pool;
}

describe('loadActiveRouter', () => {
  it('devolve null quando o canal não tem router ativo', async () => {
    const router = await loadActiveRouter(poolSeq([{ rows: [] }]), 'org1', 'cs1');
    expect(router).toBeNull();
  });

  it('monta router com membros ordenados por position', async () => {
    const pool = poolSeq([
      { rows: [{ id: 'r1', name: 'Atendimento', config: { classifier_model: 'claude-haiku-4-5', sticky: true, min_confidence: 0.6 }, fallback_agent_id: 'a-fb' }] },
      { rows: [
        { agent_id: 'a2', intent_name: 'suporte', intent_description: 'Problemas técnicos', examples: ['não consigo entrar'] },
        { agent_id: 'a1', intent_name: 'vendas', intent_description: 'Quer comprar', examples: [] },
      ] },
    ]);
    const router = await loadActiveRouter(pool, 'org1', 'cs1');
    expect(router?.id).toBe('r1');
    expect(router?.classifierModel).toBe('claude-haiku-4-5');
    expect(router?.sticky).toBe(true);
    expect(router?.minConfidence).toBe(0.6);
    expect(router?.fallbackAgentId).toBe('a-fb');
    expect(router?.members.map((m) => m.intentName)).toEqual(['suporte', 'vendas']);
  });

  it('config malformada cai nos defaults (modelo do seam, sticky, 0.6)', async () => {
    const pool = poolSeq([
      { rows: [{ id: 'r1', name: 'X', config: { min_confidence: 'muito' }, fallback_agent_id: null }] },
      { rows: [] },
    ]);
    const router = await loadActiveRouter(pool, 'org1', 'cs1');
    // null = "Automático": quem decide é o seam, nunca um id fixo de provedor.
    expect(router?.classifierModel).toBeNull();
    expect(router?.sticky).toBe(true);
    expect(router?.minConfidence).toBe(0.6);
  });
});

describe('loadRouterForPreview', () => {
  it('carrega draft pelo par organização/router e mantém a régua do runtime', async () => {
    const pool = poolSeq([
      { rows: [{ id: 'r1', name: 'Rascunho', config: { min_confidence: 0.7 }, fallback_agent_id: 'a-fb' }] },
      { rows: [{ agent_id: 'a1', intent_name: 'comercial', intent_description: 'Contratação', examples: [] }] },
    ]);
    const loaded = await loadRouterForPreview(pool, 'org-a', 'r1');
    expect(loaded).toMatchObject({ id: 'r1', minConfidence: 0.7, fallbackAgentId: 'a-fb' });
    expect(loaded?.members[0]?.intentName).toBe('comercial');
    expect(vi.mocked(pool.query).mock.calls[0]?.[1]).toEqual(['org-a', 'r1']);
    expect(vi.mocked(pool.query).mock.calls[1]?.[1]).toEqual(['org-a', 'r1']);
    expect(String(vi.mocked(pool.query).mock.calls[0]?.[0])).not.toContain('is_active');
  });

  it('não carrega router ausente do tenant', async () => {
    const pool = poolSeq([{ rows: [] }]);
    expect(await loadRouterForPreview(pool, 'org-b', 'r1')).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('loadActiveRouter — provedor do classificador', () => {
  it('lê classifier_provider da config', async () => {
    const pool = poolSeq([
      { rows: [{ id: 'r1', name: 'X', config: { classifier_model: 'gpt-5-mini', classifier_provider: 'openai' }, fallback_agent_id: null }] },
      { rows: [] },
    ]);
    const router = await loadActiveRouter(pool, 'org1', 'cs1');
    expect(router?.classifierModel).toBe('gpt-5-mini');
    expect(router?.classifierProvider).toBe('openai');
  });

  it('sem classifier_provider → null (usa o provedor da organização, como antes)', async () => {
    const pool = poolSeq([
      { rows: [{ id: 'r1', name: 'X', config: { classifier_model: 'claude-haiku-4-5' }, fallback_agent_id: null }] },
      { rows: [] },
    ]);
    const router = await loadActiveRouter(pool, 'org1', 'cs1');
    expect(router?.classifierProvider).toBeNull();
  });

  it('classifier_provider vazio ou não-string é ignorado — não vira provedor ""', async () => {
    for (const valor of ['', '   ', 42, null, {}]) {
      const pool = poolSeq([
        { rows: [{ id: 'r1', name: 'X', config: { classifier_provider: valor }, fallback_agent_id: null }] },
        { rows: [] },
      ]);
      const router = await loadActiveRouter(pool, 'org1', 'cs1');
      expect(router?.classifierProvider).toBeNull();
    }
  });
});
