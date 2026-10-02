import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const valuedFlags = new Set(['--key', '--expected-revision', '--revision', '--rollout', '--assignment-version']);
const switchFlags = new Set(['--enabled', '--kill-switch', '--apply']);
const parsed = new Map();
const usage = 'Uso: --key shelf-summary-layout --expected-revision N --revision N+1 --rollout 0..100 [--enabled] [--kill-switch] [--assignment-version N] [--apply]';
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (parsed.has(flag)) throw new Error(usage);
  if (switchFlags.has(flag)) { parsed.set(flag, true); continue; }
  if (!valuedFlags.has(flag) || i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error(usage);
  parsed.set(flag, args[++i]);
}
const value = (flag) => parsed.get(flag);
const expected = Number(value('--expected-revision'));
const revision = Number(value('--revision'));
const rollout = Number(value('--rollout'));
const assignmentVersion = Number(value('--assignment-version') ?? '1');
if (value('--key') !== 'shelf-summary-layout' || !Number.isSafeInteger(expected) || expected < 0 ||
  !Number.isSafeInteger(revision) || revision <= expected || !Number.isInteger(rollout) || rollout < 0 || rollout > 100 ||
  !Number.isInteger(assignmentVersion) || assignmentVersion < 1) {
  throw new Error(usage);
}
const config = {
  catalogRevision: revision,
  experiments: [{
    key: 'shelf-summary-layout', assignmentVersion,
    enabled: parsed.has('--enabled'), killSwitch: parsed.has('--kill-switch'), rolloutBasisPoints: rollout * 100,
    variants: [{ key: 'compact', weight: 10_000 }],
    eligibility: { minBuild: null, maxBuild: null, startsAt: null, endsAt: null, requiresDrive: false },
  }],
};
process.stdout.write(`${JSON.stringify({ expectedRevision: expected, publication: config }, null, 2)}\n`);
if (!parsed.has('--apply')) process.exit(0);
const aws = (parameters) => execFileSync('aws', parameters, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const table = aws(['cloudformation', 'describe-stack-resource', '--stack-name', 'livro-a-livro-api',
  '--logical-resource-id', 'ExperimentsTable', '--query', 'StackResourceDetail.PhysicalResourceId', '--output', 'text']);
aws(['dynamodb', 'update-item', '--table-name', table,
  '--key', JSON.stringify({ pk: { S: 'CATALOG' } }),
  '--update-expression', 'SET #config = :config, catalogRevision = :revision',
  '--condition-expression', expected === 0 ? 'attribute_not_exists(pk)' : 'catalogRevision = :expected',
  '--expression-attribute-names', JSON.stringify({ '#config': 'config' }),
  '--expression-attribute-values', JSON.stringify({ ':config': { S: JSON.stringify(config) }, ':revision': { N: String(revision) }, ...(expected ? { ':expected': { N: String(expected) } } : {}) }),
  '--return-values', 'NONE']);
process.stdout.write(`Catálogo publicado na revisão ${revision}.\n`);
