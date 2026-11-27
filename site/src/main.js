// Small touches: copy buttons, the navigation's border once scrolled, content rising
// into view. The page reads fine without any of it.

const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
if (motion && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('js');
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        seen.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const el of document.querySelectorAll('[data-reveal]')) seen.observe(el);
  // The hero's terminal types itself out: the command, a pause, then a line at a time.
  document.querySelectorAll('.hero-terminal .line').forEach((line, i) => {
    line.style.animationDelay = `${i ? 600 + i * 190 : 250}ms`;
  });
}

// The theme switch: as the system's → light → dark → as the system's. The choice is kept
// in this browser (theme.js applies it before the page draws next time).
const toggle = document.querySelector('.theme-toggle');
if (toggle) {
  const names = { auto: "as the system's", light: 'light', dark: 'dark' };
  const show = (mode) => {
    toggle.dataset.mode = mode;
    toggle.setAttribute('aria-label', `Theme: ${names[mode]}`);
    toggle.title = `Theme: ${names[mode]} (click to change)`;
  };
  show(document.documentElement.dataset.theme ?? 'auto');
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    const next = { auto: 'light', light: 'dark', dark: 'auto' }[toggle.dataset.mode];
    if (next === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      if (next === 'auto') localStorage.removeItem('brokit-theme');
      else localStorage.setItem('brokit-theme', next);
    } catch {
      // No storage: the choice lasts for this page only.
    }
    show(next);
  });
}

const nav = document.querySelector('.nav');
const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

for (const button of document.querySelectorAll('.copy-button')) {
  button.addEventListener('click', async () => {
    // A command's button carries its text; a code block's copies the block.
    const text = button.dataset.copy ?? button.closest('figure')?.querySelector('pre')?.innerText ?? '';
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      button.classList.add('done');
    } catch {
      button.textContent = 'Select it';
    }
    clearTimeout(button.timer);
    button.timer = setTimeout(() => {
      button.textContent = 'Copy';
      button.classList.remove('done');
    }, 1600);
  });
}

// Docs pages: the list of pages and the contents are folded where they sit above the text
// (a phone), open beside it; and so on as the window changes (a tablet turned).
const narrow = matchMedia('(max-width: 900px)');
for (const folding of document.querySelectorAll('.docs-menu, .toc')) {
  folding.open = !narrow.matches;
  narrow.addEventListener('change', () => (folding.open = !narrow.matches));
}

// The contents list marks the section being read.
const toc = document.querySelector('.toc');
if (toc) {
  const links = new Map([...toc.querySelectorAll('a')].map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
  const headings = [...document.querySelectorAll('.prose h2[id], .prose h3[id]')].filter((h) => links.has(h.id));
  let current = null;
  const mark = () => {
    // The last heading above the top quarter of the window is the one being read.
    const line = innerHeight * 0.25;
    let here = headings[0];
    for (const h of headings) if (h.getBoundingClientRect().top <= line) here = h;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) here = headings.at(-1);
    if (here === current) return;
    links.get(current?.id)?.classList.remove('here');
    current = here;
    links.get(current?.id)?.classList.add('here');
  };
  let queued = false;
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => ((queued = false), mark()));
  }, { passive: true });
  mark();
}
