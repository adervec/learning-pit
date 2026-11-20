// Runs selftest.html in headless Chrome and prints the result; exit 1 on any failure.
//   python -m http.server 8002 --bind 127.0.0.1      (in another shell)
//   node tools/run-selftest.mjs [http://127.0.0.1:8002]
// playwright-core is CoworkSyncHub's, not this app's: the app itself still has no dependencies.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../CoworkSyncHub/', import.meta.url));
const { chromium } = require('playwright-core');

const base = process.argv[2] || 'http://127.0.0.1:8002';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.log('page error:', e.message));
await page.goto(`${base}/selftest.html?v=${Date.now()}`);
await page.waitForFunction(() => !/running/.test(document.getElementById('summary')?.textContent || 'running'),
  null, { timeout: 15 * 60 * 1000, polling: 1000 });
const { summary, fails } = await page.evaluate(() => ({
  summary: document.getElementById('summary').textContent,
  fails: [...document.querySelectorAll('#out .fail')].map(e => e.textContent),
}));
fails.forEach(f => console.log(f));
console.log(summary);
await browser.close();
process.exit(fails.length || !/\b0 failed/.test(summary) ? 1 : 0);
