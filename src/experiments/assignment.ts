import type { CatalogExperiment } from './catalog';
import type { ExperimentKey, ExperimentVariant } from './registry';
import type { ExperimentState } from './store';

async function bucket(input: string): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const data = new DataView(digest);
  return data.getUint32(0) % 10_000;
}

function compareBuilds(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(part => !Number.isSafeInteger(part) || part < 0)) return Number.NaN;
  for (let index = 0; index < 3; index++) {
    if (a[index]! !== b[index]!) return a[index]! - b[index]!;
  }
  return 0;
}

export type Assignment = { key: ExperimentKey; variant: ExperimentVariant; assignmentVersion: number } | null;
export async function assignExperiment(
  experiment: CatalogExperiment,
  state: ExperimentState,
  capabilities: { build: string; driveConnected: boolean },
  now = new Date(),
): Promise<Assignment> {
  if (!state.experimentsConsent || experiment.killSwitch || !experiment.enabled) return null;
  const eligible = experiment.eligibility;
  if ((eligible.requiresDrive && !capabilities.driveConnected) ||
    (eligible.startsAt && now < new Date(eligible.startsAt)) ||
    (eligible.endsAt && now >= new Date(eligible.endsAt)) ||
    (eligible.minBuild && !(compareBuilds(capabilities.build, eligible.minBuild) >= 0)) ||
    (eligible.maxBuild && !(compareBuilds(capabilities.build, eligible.maxBuild) <= 0))) return null;
  if (await bucket(`${experiment.key}|${experiment.assignmentVersion}|${state.seed}|rollout`) >= experiment.rolloutBasisPoints) return null;
  const saved = state.assignments[experiment.key];
  if (saved?.assignmentVersion === experiment.assignmentVersion && experiment.variants.some((item) => item.key === saved.variant)) {
    return { key: experiment.key, variant: saved.variant as ExperimentVariant, assignmentVersion: saved.assignmentVersion };
  }
  const choice = await bucket(`${experiment.key}|${experiment.assignmentVersion}|${state.seed}|variant`);
  let cursor = 0;
  for (const variant of experiment.variants) {
    cursor += variant.weight;
    if (choice < cursor) return { key: experiment.key, variant: variant.key, assignmentVersion: experiment.assignmentVersion };
  }
  return null;
}
