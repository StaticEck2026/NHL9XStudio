/**
 * Browser test: the SPF, SPA and Images lists collapse by group. SPF and SPA groups start open. In Images a group
 * with more than 8 items starts collapsed (and Player cards always does); a smaller one starts open.
 *
 *   node test/browser/list-folds.js
 */
const assert = require('assert');
const { withBrowser } = require('./harness');

const heads = (page) => page.$$eval('#catalog .group-label', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));

(async () => {
  const ran = await withBrowser('list-folds', async ({ url, newPage }) => {
    const page = await newPage(1300);
    await page.addInitScript((v) => localStorage.setItem('nhl9x-about-seen', v), require('../../package.json').version);
    await page.goto(url);
    await page.selectOption('#game', 'nhl94');
    await page.waitForTimeout(1000);
    await page.click('#mode-spf');
    await page.waitForSelector('#catalog .item', { timeout: 60000 });
    const first = page.locator('#catalog .group-label.is-toggle').first();
    assert.strictEqual(await first.getAttribute('aria-expanded'), 'true');
    const before = await page.locator('#catalog .item').count();
    await first.click();
    assert.ok((await page.locator('#catalog .item').count()) < before, 'collapsing hides the items');
    await page.locator('#catalog .group-label.is-toggle').first().click();
    assert.strictEqual(await page.locator('#catalog .item').count(), before);

    await page.click('#mode-image');
    await page.waitForSelector('#catalog .group-label.is-toggle:has-text("Screens")', { timeout: 60000 });
    const cards = page.locator('#catalog .group-label.is-toggle', { hasText: 'Player cards' });
    assert.strictEqual(await cards.count(), 1, 'Player cards group exists: ' + (await heads(page)).join(', '));
    assert.strictEqual(await cards.getAttribute('aria-expanded'), 'false');
    // Every Images group starts closed when it holds more than 8 items, open otherwise.
    for (const head of await page.$$eval('#catalog .group-label.is-toggle', (n) => n.map((x) => ({ text: x.textContent.replace(/\s+/g, ' ').trim(), open: x.getAttribute('aria-expanded') === 'true' })))) {
      const m = /\((\d+)\)$/.exec(head.text);
      if (!m || /Player cards/.test(head.text)) continue;
      assert.strictEqual(head.open, Number(m[1]) <= 8, 'Images group starts ' + (Number(m[1]) <= 8 ? 'open' : 'collapsed') + ': ' + head.text);
    }
    await cards.click();
    assert.strictEqual(await page.locator('#catalog .group-label.is-toggle', { hasText: 'Player cards' }).getAttribute('aria-expanded'), 'true');
  });
  console.log(ran ? 'list-folds: ok' : 'list-folds: skipped (no browser)');
})();
