import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const template = readFileSync(new URL('../infra/frontend.yml', import.meta.url), 'utf8');
const match = template.match(/      FunctionCode: \|\n((?:        .*\n)+)  FrontendDistribution:/);
assert.ok(match, 'Canonical redirect function must be present in the template');
const source = match[1].split('\n').map(line => line.startsWith('        ') ? line.slice(8) : line).join('\n');
const handler = runInNewContext(`${source}\nhandler`);
const request = (host, uri = '/livro', querystring = {}) => ({ headers: { host: { value: host } }, uri, querystring });
for (const host of ['www.livroalivro.app.br', 'livroalivro.com.br', 'www.livroalivro.com.br']) {
  const result = handler({ request: request(host, '/privacidade.html', { lang: { value: 'pt-BR' }, id: { multiValue: [{ value: '1' }, { value: '2' }] } }) });
  assert.equal(result.statusCode, 301);
  assert.equal(result.headers.location.value, 'https://livroalivro.app.br/privacidade.html?lang=pt-BR&id=1&id=2');
  const parsed = new URL(result.headers.location.value);
  assert.equal(parsed.pathname, '/privacidade.html');
  assert.deepEqual(parsed.searchParams.getAll('id'), ['1', '2']);
}
assert.equal(handler({ request: request('livroalivro.app.br') }).uri, '/livro');
assert.equal(handler({ request: request('d36pvibsr6v8wx.cloudfront.net') }).uri, '/livro');
for (const logical of ['WwwSiteAlias', 'RedirectApexAlias', 'RedirectWwwAlias']) {
  assert.match(template, new RegExp(`  ${logical}:`));
  assert.match(template, new RegExp(`  ${logical}Ipv6:`));
}
assert.equal((template.match(/FunctionAssociations:/g) || []).length, 2);
console.log('DOMAIN_GATE_PASS');
