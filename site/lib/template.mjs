// The landing page's templates: plain HTML with a few placeholders, filled in at build
// time. A placeholder is {{kind:argument}}:
//
//   {{include:sections/hero.html}}   another file from site/src, itself filled in
//   {{json:examples/steps.json}}     a JSON file (from site/), highlighted, as a <pre>
//   {{output:signup}}                a captured terminal output (site/captured/signup.txt),
//                                    highlighted, as a <pre>
//   {{bar:~/my-app}}                 a terminal window's title bar
//   {{copy:npm install brokit}}      a command with a copy button
//   {{value:version}}                a value from site/captured/values.json
//   {{slot:content}}                 HTML the build made for this page (its navigation,
//                                    a docs page's content and contents list)
//
// Every placeholder must resolve: a typo fails the build, naming the file and line.
// Everything inserted is escaped as HTML, except what these functions build themselves.

import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

export function escape(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const span = (cls, text) => `<span class="${cls}">${escape(text)}</span>`;

/** JSON as highlighted HTML: keys, strings, numbers and words, punctuation. */
export function highlightJson(text) {
  let out = '';
  let at = 0;
  const token = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;
  for (const m of text.matchAll(token)) {
    out += escape(text.slice(at, m.index));
    if (m[1] && m[2]) out += span('k', m[1]) + span('p', m[2]);
    else if (m[1]) out += span('str', m[1]);
    else if (m[3] || m[4]) out += span('n', m[0]);
    else out += span('p', m[0]);
    at = m.index + m[0].length;
  }
  return out + escape(text.slice(at));
}

/**
 * brokit's terminal output as highlighted HTML, a span per line: the prompt, ✓ and ok in
 * green, ✗ and FAILED in red, quoted strings, and the quieter lines (the URL a run
 * opened, when it was ready) dimmed.
 */
export function highlightOutput(text) {
  return text
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => {
      let html;
      if (line.startsWith('$ ')) html = `${span('prompt', '$')} ${escape(line.slice(2))}`;
      else if (/^brokit (run|check)[ :]|^\s+ready \(/.test(line)) html = span('dim', line);
      else {
        html = '';
        let at = 0;
        for (const m of line.matchAll(/("[^"]*")|(✓)|(✗)|(FAILED)|^(ok)(?= in )|( passed)(?= in )/g)) {
          html += escape(line.slice(at, m.index));
          html += m[1] ? span('str', m[1]) : m[2] || m[5] || m[6] ? span('ok', m[0]) : span('fail', m[0]);
          at = m.index + m[0].length;
        }
        html += escape(line.slice(at));
      }
      return `<span class="line">${html}</span>`;
    })
    .join('\n');
}

/**
 * Fill in a template. `root` is site/ (files are read from under it, never outside);
 * `values` the captured values. Returns HTML.
 */
export function render(file, { root, values, slots = {}, depth = 0 }) {
  if (depth > 8) throw new Error(`${file}: includes nested too deep`);
  const read = (path) => {
    const full = join(root, path);
    const rel = relative(root, full);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${path} is outside site/`);
    return readFileSync(full, 'utf8');
  };
  const source = read(file);
  const kinds = {
    include: (arg) => render(join('src', arg), { root, values, slots, depth: depth + 1 }).replace(/\n$/, ''),
    // The build's own HTML (made from escaped text), inserted as it is.
    slot: (arg) => {
      if (!(arg in slots)) throw new Error(`no slot "${arg}" for this page`);
      return slots[arg];
    },
    json: (arg) => `<pre>${highlightJson(read(arg).replace(/\n$/, ''))}</pre>`,
    output: (arg) => `<pre>${highlightOutput(read(join('captured', `${arg}.txt`)))}</pre>`,
    bar: (arg) => `<div class="terminal-bar" aria-hidden="true"><i></i><i></i><i></i><span>${escape(arg)}</span></div>`,
    copy: (arg) => `<div class="copy"><code><span class="prompt">$</span> ${escape(arg)}</code><button type="button" class="copy-button" data-copy="${escape(arg)}">Copy</button></div>`,
    value: (arg) => {
      if (!(arg in values)) throw new Error(`no captured value "${arg}" (run node site/build.mjs --capture)`);
      return escape(values[arg]);
    },
  };
  return source.replace(/\{\{\s*([a-z]+):([^}]+?)\s*\}\}/g, (whole, kind, arg, offset) => {
    const line = source.slice(0, offset).split('\n').length;
    if (!kinds[kind]) throw new Error(`${file}:${line}: unknown placeholder ${whole} (${Object.keys(kinds).join(', ')})`);
    try {
      return kinds[kind](arg.trim());
    } catch (e) {
      throw new Error(`${file}:${line}: ${whole}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`);
    }
  });
}
