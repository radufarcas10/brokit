// The docs pages' Markdown converter (site/lib/markdown.mjs).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inline, markdown, slug } from '../site/lib/markdown.mjs';

describe('markdown (the docs pages)', () => {
  it('ids as GitHub makes them', () => {
    assert.equal(slug('Comparing images'), 'comparing-images');
    assert.equal(slug('Where: points'), 'where-points');
    assert.equal(slug('In CI and containers'), 'in-ci-and-containers');
    assert.equal(slug('JS scenarios'), 'js-scenarios');
  });

  it('inline: code first, then links, bold, emphasis; everything escaped', () => {
    assert.equal(inline('a `<b>*x*</b>` c'), 'a <code>&lt;b&gt;*x*&lt;/b&gt;</code> c');
    assert.equal(inline('**bold** and *em* <script>'), '<strong>bold</strong> and <em>em</em> &lt;script&gt;');
    assert.equal(inline('[docs](SECURITY.md)', { link: (h) => (h === 'SECURITY.md' ? 'security.html' : h) }), '<a href="security.html">docs</a>');
    assert.equal(inline('[gone](tools/)', { link: () => null }), 'gone');
    assert.equal(inline('**JS (`*.mjs`) is code.**'), '<strong>JS (<code>*.mjs</code>) is code.</strong>');
    assert.equal(inline('every `*.check.json` and `*.check.mjs`'), 'every <code>*.check.json</code> and <code>*.check.mjs</code>');
    assert.match(inline('[x](https://a.b/?q=1&r=2)'), /href="https:\/\/a\.b\/\?q=1&amp;r=2" rel="noopener"/);
  });

  it('headings, paragraphs, a title and a table of contents', () => {
    const r = markdown('# brokit\n\nOne line\nand the next.\n\n## Quick start\n\n### Where: points\n\n## Quick start\n');
    assert.equal(r.title, 'brokit');
    assert.match(r.html, /<h1 id="brokit">brokit<\/h1>/);
    assert.match(r.html, /<p>One line and the next\.<\/p>/);
    assert.deepEqual(r.toc.map((t) => t.id), ['quick-start', 'where-points', 'quick-start-1']);
    assert.match(r.html, /<h2 id="quick-start">Quick start<a class="anchor" href="#quick-start"/);
  });

  it('lists: continued lines, numbers, nesting', () => {
    const r = markdown('- **a:** one\n  more\n- b\n\n1. first,\n   still first\n2. second\n\n- outer\n  - inner\n');
    assert.match(r.html, /<ul>\n<li><strong>a:<\/strong> one more<\/li>\n<li>b<\/li>\n<\/ul>/);
    assert.match(r.html, /<ol>\n<li>first, still first<\/li>\n<li>second<\/li>\n<\/ol>/);
    assert.match(r.html, /<li>outer\n<ul>\n<li>inner<\/li>\n<\/ul><\/li>/);
  });

  it('tables, with | inside code', () => {
    const r = markdown('| Step | Does |\n|---|---:|\n| `{ "a": 1 }` | x `a|b` y |\n');
    assert.match(r.html, /<div class="table"><table>/);
    assert.match(r.html, /<th>Step<\/th><th class="align-right">Does<\/th>/);
    assert.match(r.html, /<td><code>\{ &quot;a&quot;: 1 \}<\/code><\/td><td class="align-right">x <code>a\|b<\/code> y<\/td>/);
  });

  it('code: highlighted and escaped, in a terminal window with a copy button', () => {
    const r = markdown('```json\n{ "a": "<b>" }\n```\n\n```sh\nnpx brokit check --update   # a note\n```\n\n```\n$ brokit check\n✓ ok\n```\n');
    assert.match(r.html, /<span>JSON<\/span><button type="button" class="copy-button copy-code">Copy<\/button>/);
    assert.match(r.html, /<span class="str">&quot;&lt;b&gt;&quot;<\/span>/);
    assert.match(r.html, /<span class="cmd">npx<\/span> brokit check <span class="k">--update<\/span>\s+<span class="c"># a note<\/span>/);
    assert.match(r.html, /<span>terminal<\/span>[\s\S]*<span class="prompt">\$<\/span> brokit check/);
    assert.doesNotMatch(r.html, /<b>/);
  });

  it('the real files convert without leftovers', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['README.md', 'SECURITY.md', 'CHANGELOG.md', 'bench/README.md']) {
      const { html } = markdown(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { link: () => '#' });
      assert.doesNotMatch(html, /```|\*\*|^\|/m, file);
      assert.doesNotMatch(html, /<p>\s*<\/p>/, file);
    }
  });
});
