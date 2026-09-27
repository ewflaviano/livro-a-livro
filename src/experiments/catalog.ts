import { z } from 'zod';
import { isExperimentKey, isExperimentVariant, type ExperimentKey, type ExperimentVariant } from './registry';

const eligibleSchema = z.strictObject({
  minBuild: z.string().max(80).nullable(),
  maxBuild: z.string().max(80).nullable(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  requiresDrive: z.boolean(),
});

const entrySchema = z.strictObject({
  key: z.string().min(1).max(80),
  assignmentVersion: z.number().int().min(1).max(1_000_000),
  enabled: z.boolean(),
  killSwitch: z.boolean(),
  rolloutBasisPoints: z.number().int().min(0).max(10_000),
  variants: z.array(z.strictObject({ key: z.string().min(1).max(80), weight: z.number().int().min(1).max(10_000) })).min(1).max(10),
  eligibility: eligibleSchema,
});

export const catalogSchema = z.strictObject({
  catalogRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  expiresAt: z.string().datetime(),
  experiments: z.array(entrySchema).max(20),
});

export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogExperiment<K extends ExperimentKey = ExperimentKey> = Omit<z.infer<typeof entrySchema>, 'key' | 'variants'> & {
  key: K;
  variants: Array<{ key: ExperimentVariant<K>; weight: number }>;
};

export function parseCatalog(input: unknown): { catalogRevision: number; expiresAt: string; experiments: CatalogExperiment[] } | null {
  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) return null;
  const experiments: CatalogExperiment[] = [];
  for (const raw of parsed.data.experiments) {
    if (!isExperimentKey(raw.key)) continue;
    const key = raw.key as ExperimentKey;
    if (!raw.variants.every((variant) => isExperimentVariant(key, variant.key))) continue;
    const total = raw.variants.reduce((sum, variant) => sum + variant.weight, 0);
    if (total !== 10_000) continue;
    experiments.push(raw as CatalogExperiment);
  }
  return { catalogRevision: parsed.data.catalogRevision, expiresAt: parsed.data.expiresAt, experiments };
}

export async function fetchCatalog(fetcher: typeof fetch, baseUrl: string): Promise<ReturnType<typeof parseCatalog>> {
  if (!baseUrl || navigator.onLine === false) return null;
  try {
    const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/v1/experiments/catalog`, {
      credentials: 'omit', cache: 'no-store', headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return parseCatalog(await response.json());
  } catch { return null; }
}
