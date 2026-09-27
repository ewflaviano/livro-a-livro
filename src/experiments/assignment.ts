import type { CatalogExperiment } from './catalog';
import type { ExperimentState } from './store';

async function bucket(input: string): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const data = new DataView(digest);
  return data.getUint32(0) % 10_000;
}

export type Assignment = { key: string; variant: string; assignmentVersion: number } | null;
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
    (eligible.minBuild && capabilities.build < eligible.minBuild) ||
    (eligible.maxBuild && capabilities.build > eligible.maxBuild)) return null;
  const saved = state.assignments[experiment.key];
  if (saved?.assignmentVersion === experiment.assignmentVersion && experiment.variants.some((item) => item.key === saved.variant)) {
    return { key: experiment.key, variant: saved.variant, assignmentVersion: saved.assignmentVersion };
  }
  if (await bucket(`${experiment.key}|${experiment.assignmentVersion}|${state.seed}|rollout`) >= experiment.rolloutBasisPoints) return null;
  const choice = await bucket(`${experiment.key}|${experiment.assignmentVersion}|${state.seed}|variant`);
  let cursor = 0;
  for (const variant of experiment.variants) {
    cursor += variant.weight;
    if (choice < cursor) return { key: experiment.key, variant: variant.key, assignmentVersion: experiment.assignmentVersion };
  }
  return null;
}
