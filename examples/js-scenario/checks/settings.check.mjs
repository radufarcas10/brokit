// The settings page's tabs, checked in a loop: each tab, then the arrow keys, then a
// setting that must survive a change of tab, then the tab bar on a phone.

export const url = '/index.html';
export const viewport = { size: '720x560', dpr: 2 };
export const ready = "document.readyState === 'complete'";

const tabs = ['General', 'Notifications', 'Privacy'];
const selected = "document.querySelector('[role=tab][aria-selected=true]').textContent";
const shown = "[...document.querySelectorAll('[role=tabpanel]')].filter((p) => !p.hidden).map((p) => p.id)";

export default async ({ page, expect, step, screenshot }) => {
  for (const tab of tabs) {
    const id = tab.toLowerCase();
    await page.click({ selector: `#tab-${id}` });
    expect.equal(await page.eval(selected), tab, `${tab}: its tab is selected`);
    expect.equal(await page.eval(shown), [`panel-${id}`], `${tab}: only its panel shows`);
    await screenshot(`tab-${id}`, { selector: '.settings', baseline: true });
  }

  // Focus is on the last tab now. ArrowRight goes round to the first, ArrowLeft back.
  for (const [key, tab] of [['ArrowRight', 'General'], ['ArrowLeft', 'Privacy'], ['ArrowLeft', 'Notifications'], ['Home', 'General']]) {
    await step({ key });
    expect.equal(await page.eval(selected), tab, `${key} selects ${tab}`);
  }

  // A switch turned on stays on after a visit to another tab.
  await page.click({ selector: '#tab-notifications' });
  await page.click({ selector: '#digest' });
  await page.click({ selector: '#tab-privacy' });
  await page.click({ selector: '#tab-notifications' });
  expect.ok(await page.eval("document.querySelector('#digest').checked"), 'the email digest is still on');

  // On a phone, the three tabs fit side by side.
  await page.emulate({ size: '360x740', mobile: true });
  const bar = await page.rect('[role=tablist]');
  const last = await page.rect('#tab-privacy');
  expect.atMost(last.x + last.width, bar.x + bar.width, 'on a phone, the last tab fits in the tab bar');
  expect.near(last.y, (await page.rect('#tab-general')).y, 0.5, 'on a phone, the tabs are on one line');
};
