import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const origin = 'https://livroalivro.app.br';
const publicPaths = ['/sobre.html', '/about.html', '/privacidade.html', '/privacy.html'];
const readBuilt = (path) => readFile(new URL(`../dist${path}`, import.meta.url), 'utf8');

const app = new JSDOM(await readBuilt('/index.html')).window.document;
assert.match(app.querySelector('meta[name="robots"]')?.content ?? '', /\bnoindex\b/i, 'App shell must stay out of search results');

const sitemap = new JSDOM(await readBuilt('/sitemap.xml'), { contentType: 'application/xml' }).window.document;
assert.equal(sitemap.querySelector('parsererror'), null, 'Sitemap must be valid XML');
const sitemapUrls = [...sitemap.querySelectorAll('url > loc')].map((element) => element.textContent);
assert.deepEqual(sitemapUrls, publicPaths.map((path) => `${origin}${path}`));
assert.ok(sitemapUrls.every((url) => !url.includes('#') && !url.includes('?')), 'Sitemap cannot contain private app routes or query data');

const robots = await readBuilt('/robots.txt');
assert.match(robots, /^Sitemap: https:\/\/livroalivro\.app\.br\/sitemap\.xml$/m);

for (const path of publicPaths) {
  const html = await readBuilt(path);
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('link[rel="canonical"]')?.href, `${origin}${path}`, `${path} needs its canonical URL`);
  assert.ok(document.querySelector('h1')?.textContent?.trim(), `${path} needs visible static content`);
  assert.ok(document.querySelector('a[href^="/"]'), `${path} needs crawlable links`);
  assert.equal(document.querySelector('meta[name="robots"]')?.content?.includes('noindex') ?? false, false, `${path} must remain indexable`);

  if (path === '/sobre.html' || path === '/about.html') {
    const data = JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent ?? 'null');
    assert.equal(data['@type'], 'WebApplication');
    assert.equal(data.url, `${origin}${path}`);
    assert.equal(data.offers.price, '0');
    assert.equal(data.isAccessibleForFree, true);
    assert.ok(document.body.textContent.includes('MIT'), `${path} must display its license claim`);
    assert.ok(document.querySelector('a[href="https://github.com/ewflaviano/livro-a-livro/blob/main/LICENSE"]'));
    assert.ok(document.querySelector('a[href="/#/estante"]'), `${path} must link to the app`);
    assert.equal(document.querySelector('script[src]'), null, `${path} must not need JavaScript`);
  }
}

console.log('Public search pages, sitemap, robots, schema and app noindex verified.');
