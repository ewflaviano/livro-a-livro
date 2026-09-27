/**
 * Experiments are deliberately a small, compiled allowlist. A remote catalog
 * can only choose among these variants; it can never send executable behavior
 * or unlock a data flow.
 */
export const experimentRegistry = {
  'shelf-summary-layout': {
    variants: ['control', 'compact'] as const,
    defaultVariant: 'control' as const,
    owner: 'produto',
    issue: 12,
    hypothesis: 'Uma apresentação mais compacta das métricas facilita a leitura da estante.',
    removal: 'Remover o gate quando a decisão de produto for permanente.',
  },
} as const;

export type ExperimentKey = keyof typeof experimentRegistry;
export type ExperimentVariant<K extends ExperimentKey = ExperimentKey> =
  (typeof experimentRegistry)[K]['variants'][number];

export function isExperimentKey(value: unknown): value is ExperimentKey {
  return typeof value === 'string' && value in experimentRegistry;
}

export function isExperimentVariant<K extends ExperimentKey>(key: K, value: unknown): value is ExperimentVariant<K> {
  return typeof value === 'string' && (experimentRegistry[key].variants as readonly string[]).includes(value);
}
