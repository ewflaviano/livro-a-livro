import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const value = (flag) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
const expected = Number(value('--expected-revision'));
const revision = Number(value('--revision'));
const rollout = Number(value('--rollout'));
const assignmentVersion = Number(value('--assignment-version') ?? '1');
if (value('--key') !== 'shelf-summary-layout' || !Number.isSafeInteger(expected) || expected < 0 ||
  !Number.isSafeInteger(revision) || revision <= expected || !Number.isInteger(rollout) || rollout < 0 || rollout > 100 ||
  !Number.isInteger(assignmentVersion) || assignmentVersion < 1 ||
  args.some(arg => arg.startsWith('--') && !['--key', '--expected-revision', '--revision', '--rollout', '--assignment-version', '--enabled', '--kill-switch', '--apply'].includes(arg))) {
  throw new Error('Uso: --key shelf-summary-layout --expected-revision N --revision N+1 --rollout 0..100 [--enabled] [--kill-switch] [--assignment-version N] [--apply]');
}
const config = {
  catalogRevision: revision,
  experiments: [{
    key: 'shelf-summary-layout', assignmentVersion,
    enabled: args.includes('--enabled'), killSwitch: args.includes('--kill-switch'), rolloutBasisPoints: rollout * 100,
    variants: [{ key: 'compact', weight: 10_000 }],
    eligibility: { minBuild: null, maxBuild: null, startsAt: null, endsAt: null, requiresDrive: false },
  }],
};
process.stdout.write(`${JSON.stringify({ expectedRevision: expected, publication: config }, null, 2)}\n`);
if (!args.includes('--apply')) process.exit(0);
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
