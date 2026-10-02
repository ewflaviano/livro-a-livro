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
const grouped = handler({ request: request('livroalivro.com.br', '/test', {
  a: { multiValue: [{ value: '1' }, { value: '3' }] }, b: { value: '2' },
}) });
const groupedQuery = new URL(grouped.headers.location.value).searchParams;
assert.deepEqual(groupedQuery.getAll('a'), ['1', '3']);
assert.equal(groupedQuery.get('b'), '2');
const encoded = handler({ request: request('livroalivro.com.br', '/test', {
  nome: { value: 'livro%20novo' }, sinal: { value: 'a%2Bb' }, espaco: { value: 'a+b' },
  porcento: { value: '100%25' }, 't%C3%ADtulo': { value: 'fic%C3%A7%C3%A3o' },
}) });
const encodedQuery = new URL(encoded.headers.location.value).searchParams;
assert.equal(encodedQuery.get('nome'), 'livro novo');
assert.equal(encodedQuery.get('sinal'), 'a+b');
assert.equal(encodedQuery.get('espaco'), 'a b');
assert.equal(encodedQuery.get('porcento'), '100%');
assert.equal(encodedQuery.get('título'), 'ficção');
assert.equal(handler({ request: request('livroalivro.app.br') }).uri, '/livro');
assert.equal(handler({ request: request('d36pvibsr6v8wx.cloudfront.net') }).uri, '/livro');
for (const logical of ['WwwSiteAlias', 'RedirectApexAlias', 'RedirectWwwAlias']) {
  assert.match(template, new RegExp(`  ${logical}:`));
  assert.match(template, new RegExp(`  ${logical}Ipv6:`));
}
assert.equal((template.match(/FunctionAssociations:/g) || []).length, 2);
console.log('DOMAIN_GATE_PASS');
