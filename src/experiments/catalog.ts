import { z } from 'zod';
import { isExperimentKey, isExperimentVariant, type ExperimentKey, type ExperimentVariant } from './registry';

const buildSchema = z.string().regex(/^\d+\.\d+\.\d+$/).max(80).nullable();
const eligibleSchema = z.strictObject({
  minBuild: buildSchema,
  maxBuild: buildSchema,
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
  experiments: z.array(entrySchema).max(50),
});
export type CatalogExperiment<K extends ExperimentKey = ExperimentKey> = Omit<z.infer<typeof entrySchema>, 'key' | 'variants'> & {
  key: K;
  variants: Array<{ key: ExperimentVariant<K>; weight: number }>;
};
export type Catalog = { catalogRevision: number; expiresAt: string; experiments: CatalogExperiment[] };

export function parseCatalog(input: unknown, now = Date.now()): Catalog | null {
  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success) return null;
  const expiry = Date.parse(parsed.data.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 5 * 60_000) return null;
  const seen = new Set<string>();
  const experiments: CatalogExperiment[] = [];
  for (const raw of parsed.data.experiments) {
    if (seen.has(raw.key)) return null;
    seen.add(raw.key);
    if (!isExperimentKey(raw.key)) continue;
    const key = raw.key;
    if (!raw.variants.every(variant => isExperimentVariant(key, variant.key))) return null;
    if (new Set(raw.variants.map(variant => variant.key)).size !== raw.variants.length) return null;
    if (raw.variants.reduce((sum, variant) => sum + variant.weight, 0) !== 10_000) return null;
    experiments.push(raw as CatalogExperiment);
  }
  return { catalogRevision: parsed.data.catalogRevision, expiresAt: parsed.data.expiresAt, experiments };
}

export async function fetchCatalog(fetcher: typeof fetch, baseUrl: string, signal?: AbortSignal): Promise<Catalog | null> {
  if (!baseUrl || navigator.onLine === false) return null;
  const timeout = AbortSignal.timeout(5_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/v1/experiments/catalog`, {
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: combined,
      headers: { accept: 'application/json' },
    });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch { return null; }
}
