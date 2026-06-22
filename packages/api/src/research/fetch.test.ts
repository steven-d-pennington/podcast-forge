import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractReadableContent, fetchSourceSnapshot } from './fetch.js';

function response(html: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null },
    text: async () => html,
  };
}

describe('research source fetching and readability extraction', () => {
  it('prefers article/main content over navigation and page chrome', () => {
    const html = `<!doctype html>
      <html>
        <head><title>Article headline - News Site</title><style>.nav{display:none}</style></head>
        <body>
          <nav>Latest U.S. World Politics Entertainment HealthWatch MoneyWatch</nav>
          <main>
            <article>
              <h1>Article headline</h1>
              <p>Emergency managers say fabricated disaster images spread faster than corrections.</p>
              <p>Researchers documented coordinated accounts pushing false rescue information.</p>
            </article>
          </main>
          <footer>About Contact Privacy</footer>
        </body>
      </html>`;

    const extracted = extractReadableContent(html);

    assert.equal(extracted.title, 'Article headline - News Site');
    assert.match(extracted.text, /Emergency managers say fabricated disaster images/);
    assert.match(extracted.text, /Researchers documented coordinated accounts/);
    assert.doesNotMatch(extracted.text, /Latest U\.S\. World Politics/);
    assert.doesNotMatch(extracted.text, /About Contact Privacy/);
  });

  it('strips long script/router payloads before applying the source text cap', async () => {
    const scriptPayload = 'window.__ROUTES__ = ' + JSON.stringify({ routes: 'x'.repeat(230_000) });
    const html = `<!doctype html><html><head><title>Router polluted article</title></head><body>
      <article><p>The article body should survive the extraction step.</p></article>
      <script>${scriptPayload}</script>
    </body></html>`;

    const document = await fetchSourceSnapshot('candidate-1', 'https://example.com/router-polluted', async () => response(html));

    assert.equal(document.fetchStatus, 'fetched');
    assert.equal(document.title, 'Router polluted article');
    assert.match(document.textContent ?? '', /article body should survive/);
    assert.doesNotMatch(document.textContent ?? '', /window\.__ROUTES__/);
    assert.ok((document.textContent ?? '').length < 2_000);
    assert.equal(document.metadata.originalLength, html.length);
    assert.equal(document.metadata.truncatedBeforeExtraction, false);
    assert.equal(document.metadata.extractedLength, document.textContent?.length);
  });

  it('removes stray unsafe closing tags without deleting earlier article text', () => {
    const html = `<!doctype html><html><head><title>Literal tag example</title></head><body>
      <article>
        <p>Analysts quoted a literal closing script tag before the important finding: </script>.</p>
        <p>The important finding should remain visible after cleanup.</p>
      </article>
    </body></html>`;

    const extracted = extractReadableContent(html);

    assert.equal(extracted.title, 'Literal tag example');
    assert.match(extracted.text, /Analysts quoted a literal closing script tag/);
    assert.match(extracted.text, /important finding should remain visible/);
  });

  it('bounds oversized HTML before readability extraction', async () => {
    const article = '<article><p>The bounded article text should still be extracted.</p></article>';
    const oversizedTail = `<div>${'tail '.repeat(120_000)}</div>`;
    const html = `<!doctype html><html><head><title>Bounded extraction</title></head><body>${article}${oversizedTail}</body></html>`;

    const document = await fetchSourceSnapshot('candidate-2', 'https://example.com/oversized', async () => response(html));

    assert.equal(document.fetchStatus, 'fetched');
    assert.equal(document.title, 'Bounded extraction');
    assert.match(document.textContent ?? '', /bounded article text/);
    assert.equal(document.metadata.originalLength, html.length);
    assert.equal(document.metadata.extractionInputLength, 500_000);
    assert.equal(document.metadata.truncatedBeforeExtraction, true);
    assert.equal(document.metadata.extractedLength, document.textContent?.length);
  });
});
