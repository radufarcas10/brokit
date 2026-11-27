// Tabs, as the ARIA tabs pattern has them: a click or the arrow keys pick a tab, and only
// its panel shows.
const tabs = [...document.querySelectorAll('[role=tab]')];

function select(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
  tab.focus();
}

for (const tab of tabs) tab.addEventListener('click', () => select(tab));

document.querySelector('[role=tablist]').addEventListener('keydown', (e) => {
  const i = tabs.indexOf(document.activeElement);
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  select(tabs[(next + tabs.length) % tabs.length]);
});
