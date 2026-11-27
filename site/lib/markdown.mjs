// Markdown to HTML for the docs pages: the part of Markdown brokit's own files use.
//
// Blocks: headings (with GitHub's ids, so links like #comparing-images work), paragraphs,
// bullet and numbered lists (an item's text may continue on indented lines; lists may
// nest), pipe tables, fenced code (highlighted; see highlightCode), quotes (shown as
// callouts). Inline: `code`, **bold**, *emphasis*, [links](...), ![images](...).
// Everything else is text, and all text is escaped: no raw HTML passes through.
//
// markdown(text, { link }) returns { html, title, toc }. `link(href)` turns a link into
// where it should go on the site, or null to show its text without a link.

import { escape, highlightJson, highlightOutput } from './template.mjs';

/** A heading's id as GitHub makes it: lowercase, punctuation dropped, spaces to dashes. */
export function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

// Inline Markdown: code spans are set aside first (nothing inside them is Markdown, and
// bold or a link may contain one), then links, bold and emphasis on the escaped rest,
// then the code goes back in.
export function inline(text, { link = (h) => h } = {}) {
  const codes = [];
  const held = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, ticks, code) => {
    codes.push(`<code>${escape(code.replace(/^ (.*) $/, '$1'))}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  return prose(held, link).replace(/\u0000(\d+)\u0000/g, (_, k) => codes[Number(k)]);
}

function prose(text, link) {
  // Images and links first, on the raw text (their targets mustn't be touched by the rest).
  let out = '';
  let at = 0;
  for (const m of text.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    out += emphasis(escape(text.slice(at, m.index)));
    const href = link(m[3]);
    if (m[1]) {
      // An image: only one the site publishes (an image it can't show keeps its alt text).
      out += href === null ? escape(m[2]) : `<img src="${escape(href)}" alt="${escape(m[2])}" loading="lazy">`;
    } else {
      const label = emphasis(escape(m[2]));
      out += href === null ? label : `<a href="${escape(href)}"${/^https?:/.test(href) ? ' rel="noopener"' : ''}>${label}</a>`;
    }
    at = m.index + m[0].length;
  }
  return out + emphasis(escape(text.slice(at)));
}

function emphasis(html) {
  return html.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '$1<em>$2</em>');
}

const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
// A fence's language, and the file it shows, if any: ```json checks/form.check.json
const FENCE = /^```\s*([\w-]*)(?:[ \t]+([^`\s][^`]*?))?\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const QUOTE = /^\s{0,3}> ?/;
const TABLE_RULE =/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Cells of a table row, split on | outside code spans. */
function cells(row) {
  const s = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out = [];
  let cell = '';
  let tick = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      tick = tick === n ? 0 : tick || n;
      cell += s.slice(i, i + n);
      i += n - 1;
    } else if (ch === '|' && !tick) {
      out.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/** Convert Markdown. Resolves to { html, title, toc: [{ level, id, text }] }. */
export function markdown(text, { link = (h) => h } = {}) {
  const ids = new Map();
  const toc = [];
  let title = null;
  const uniqueId = (base) => {
    const n = ids.get(base) ?? 0;
    ids.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
  const plain = (md) => md.replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]*)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  const blocks = (lines) => {
    let html = '';
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      const fence = FENCE.exec(line);
      if (fence) {
        const code = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
        i++;
        html += codeBlock(fence[1], code.join('\n'), fence[2]);
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        const level = heading[1].length;
        const id = uniqueId(slug(plain(heading[2])));
        if (level === 1 && title === null) title = plain(heading[2]);
        if (level === 2 || level === 3) toc.push({ level, id, text: plain(heading[2]) });
        const content = inline(heading[2], { link });
        html += level === 1 ? `<h1 id="${id}">${content}</h1>\n` : `<h${level} id="${id}">${content}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>\n`;
        i++;
        continue;
      }
      if (QUOTE.test(line)) {
        // A quote is a callout: "> **Note:** ..." reads as a note beside the text.
        const inner = [];
        while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].replace(QUOTE, ''));
        html += `<blockquote class="callout">\n${blocks(inner)}</blockquote>\n`;
        continue;
      }
      if (line.trim().startsWith('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
        const head = cells(line);
        const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : null));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
        const td = (tag, c, k) => `<${tag}${align[k] ? ` class="align-${align[k]}"` : ''}>${inline(c, { link })}</${tag}>`;
        html += `<div class="table"><table>\n<thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead>\n<tbody>\n${rows.map((r) => `<tr>${r.map((c, k) => td('td', c, k)).join('')}</tr>`).join('\n')}\n</tbody></table></div>\n`;
        continue;
      }
      const item = LIST.exec(line);
      if (item) {
        const indent = item[1].length;
        const ordered = /\d/.test(item[2]);
        const items = [];
        while (i < lines.length) {
          const m = LIST.exec(lines[i]);
          if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
          // The item: its first line, then lines indented past the marker (or blank
          // lines followed by those), dedented.
          const body = [m[3]];
          const inner = indent + m[2].length + 1;
          i++;
          while (i < lines.length) {
            const next = lines[i];
            if (!next.trim()) {
              if (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && lines[i + 1].search(/\S/) > indent) {
                body.push('');
                i++;
                continue;
              }
              break;
            }
            if (next.search(/\S/) <= indent) break;
            body.push(next.slice(Math.min(inner, next.search(/\S/))));
            i++;
          }
          items.push(body);
        }
        const tag = ordered ? 'ol' : 'ul';
        html += `<${tag}>\n${items
          .map((body) => {
            // A tight item is just its text; one with a nested list or paragraphs, blocks.
            const nested = body.slice(1).some((l) => LIST.test(l) || !l.trim());
            const inner = nested ? blocks(body).replace(/^<p>([\s\S]*?)<\/p>\n/, '$1\n') : inline(body.join(' '), { link });
            return `<li>${inner.trim()}</li>`;
          })
          .join('\n')}\n</${tag}>\n`;
        continue;
      }
      // A paragraph: lines until a blank one or the start of another block.
      const para = [];
      while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !LIST.test(lines[i]) && !QUOTE.test(lines[i]) && !(lines[i].trim().startsWith('|') && TABLE_RULE.test(lines[i + 1] ?? ''))) {
        para.push(lines[i++].trim());
      }
      html += `<p>${inline(para.join(' '), { link })}</p>\n`;
    }
    return html;
  };

  const html = blocks(text.replace(/\r\n?/g, '\n').split('\n'));
  return { html, title, toc };
}

// --- code -----------------------------------------------------------------------

// Each language: [pattern, class] in order; the first that matches at a place wins.
const COMMENT_HASH = [/#[^\n]*/, 'c'];
const STRINGS = [/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/, 'str'];
const RULES = {
  sh: [COMMENT_HASH, STRINGS, [/(?<=^|\n|&& |\| |; )\s*(?:npx|npm|node|brokit|docker|cd|apt-get|su|git)\b/, 'cmd'], [/(?<=\s)--?[\w-]+(?:=\S+)?/, 'k']],
  yaml: [COMMENT_HASH, STRINGS, [/^[ \t]*-?[ \t]*[\w.-]+(?=:)/m, 'k'], [/\b(?:true|false|null|\d+)\b/, 'n']],
  toml: [COMMENT_HASH, STRINGS, [/^\[[^\]\n]+\]/m, 'k'], [/^[ \t]*[\w.-]+(?=[ \t]*=)/m, 'k']],
  dockerfile: [COMMENT_HASH, STRINGS, [/^(?:FROM|RUN|COPY|ADD|USER|WORKDIR|CMD|ENTRYPOINT|ENV|ARG|EXPOSE|LABEL)\b/m, 'k'], [/(?<=\s)--[\w-]+(?:=\S+)?/, 'k']],
  js: [[/\/\/[^\n]*|\/\*[\s\S]*?\*\//, 'c'], [/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/, 'str'], [/\b(?:export|import|from|const|let|default|async|await|for|of|return|new|if|else|function)\b/, 'k'], [/\b\d+(?:\.\d+)?\b|\b(?:true|false|null|undefined)\b/, 'n']],
};
RULES.html = [[/<!--[\s\S]*?-->/, 'c'], [/<\/?[\w-]+|\/?>/, 'k'], [/"[^"\n]*"|'[^'\n]*'/, 'str'], [/(?<=\s)[\w:-]+(?==)/, 'n']];
RULES.css = [[/\/\*[\s\S]*?\*\//, 'c'], [/"[^"\n]*"|'[^'\n]*'/, 'str'], [/(?<=^|[;{]\s*)--?[\w-]+(?=\s*:)|(?<=^|[;{]\s*)[a-z-]+(?=\s*:)/m, 'k'], [/#[0-9a-fA-F]{3,8}\b|-?\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|deg|fr)?\b/, 'n'], [/@[\w-]+/, 'k']];
RULES.shell = RULES.bash = RULES.sh;
RULES.yml = RULES.yaml;
RULES.javascript = RULES.mjs = RULES.js;

function highlightWith(rules, text) {
  const combined = new RegExp(rules.map(([re]) => `(${re.source})`).join('|'), 'gm');
  let out = '';
  let at = 0;
  for (const m of text.matchAll(combined)) {
    if (!m[0]) continue;
    const k = m.slice(1).findIndex((g) => g !== undefined);
    out += escape(text.slice(at, m.index)) + `<span class="${rules[k][1]}">${escape(m[0])}</span>`;
    at = m.index + m[0].length;
  }
  return out + escape(text.slice(at));
}

/** A code block as the site shows it: a terminal window (titled with its file, if it has one) with a copy button. */
export function codeBlock(lang, code, file) {
  const language = lang.toLowerCase();
  let body;
  if (language === 'json') body = highlightJson(code);
  else if (RULES[language]) body = highlightWith(RULES[language], code);
  else if (/^\$ /.test(code)) body = highlightOutput(code); // a terminal: a command and what it printed
  else body = escape(code);
  const label = file ?? { sh: 'shell', js: 'JavaScript', json: 'JSON', yaml: 'YAML', toml: 'TOML', dockerfile: 'Dockerfile', html: 'HTML', css: 'CSS' }[language] ?? (/^\$ /.test(code) ? 'terminal' : 'text');
  return `<figure class="terminal code-block"><div class="terminal-bar"><i></i><i></i><i></i><span>${escape(label)}</span><button type="button" class="copy-button copy-code">Copy</button></div><pre><code>${body}</code></pre></figure>\n`;
}
