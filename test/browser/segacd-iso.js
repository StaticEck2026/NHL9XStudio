/**
 * Browser test: an NHL 94 Sega CD disc image opened with Open file loads as NHL 94 (Sega CD), not as a PC game,
 * and a 95 PC / 96 PC disc still opens as its own game. Runs with the API blocked, like the GitHub Pages site.
 */
const assert = require('assert');
const { withBrowser } = require('./harness');
const iso9660 = require('../../lib/iso9660');

const buf = (name, data) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(data) });

(async () => {
  const segaCd = iso9660.encode([
    { name: 'GRAPH2.BIN', data: Buffer.alloc(3051520 + 0x10000) },
    { name: 'HOCKEY.BIN', data: Buffer.alloc(0x10000) },
    { name: 'ANAHEIM.PCM', data: Buffer.from([0x90, 0x91, 0xff]) }
  ]);
  const pc95 = iso9660.encode([{ name: '000_049.PPV', data: Buffer.alloc(64) }, { name: 'HOMEPALS.BIN', data: Buffer.alloc(448) }]);
  await withBrowser('segacd-iso', async ({ url, newPage }) => {
    for (const [name, data, want] of [['NHL94CD.iso', segaCd, 'nhl94cd'], ['disc.iso', segaCd, 'nhl94cd'], ['NHL95.iso', pc95, 'nhl95pc']]) {
      const page = await newPage(1280);
      await page.route('**/api/**', (route) => route.abort());
      await page.goto(url);
      await page.waitForTimeout(1500);
      await page.setInputFiles('#file-open', buf(name, data));
      await page.waitForTimeout(2500);
      const got = await page.evaluate(() => document.getElementById('game').value);
      assert.strictEqual(got, want, name + ' opened as ' + got);
      const text = await page.evaluate(() => document.body.innerText);
      assert.ok(!/not a 95\/96 PC|has no files/.test(text), name + ': ' + text.slice(0, 200));
      await page.close();
    }
  });
  console.log('segacd-iso: ok');
})().catch((err) => { console.error(err); process.exit(1); });
