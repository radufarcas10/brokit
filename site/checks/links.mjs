// The page's broken links, as a JS expression for an expect step or page.eval: every link
// to this site must answer, and every #anchor must exist on its page. Links elsewhere
// aren't followed (no network in a check).
export const BROKEN_LINKS = `(async () => {
  const bad = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    const u = new URL(href, location.href);
    if (u.origin !== location.origin) continue;
    const id = decodeURIComponent(u.hash.slice(1));
    if (u.pathname === location.pathname) {
      if (id && !document.getElementById(id)) bad.push(href);
      continue;
    }
    const res = await fetch(u.pathname);
    if (!res.ok) bad.push(href + ' (HTTP ' + res.status + ')');
    else if (id && !(await res.text()).includes('id="' + id + '"')) bad.push(href + ' (no #' + id + ')');
  }
  return bad;
})()`;
