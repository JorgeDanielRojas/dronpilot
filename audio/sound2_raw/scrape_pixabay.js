// Scraper Pixabay sound-effects: clica cada playOverlay, lee audio.src del CDN, dedup.
// NODE_PATH=~/cAlgo/playwright-tool/node_modules node scrape_pixabay.js
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUERIES = process.env.QUERIES
  ? process.env.QUERIES.split('|')
  : [
      'electric drone propeller',
      'quadcopter motor',
      'drone flying loop',
      'fpv drone',
      'drone hover',
      'brushless motor',
      'drone buzz',
    ];

async function gotoRetry(page, url) {
  for (let a = 0; a < 3; a++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
      await sleep(4500);
      return true;
    } catch (e) {
      console.error(`  goto fail ${a}: ${e.message}`);
      await sleep(2000);
    }
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 950 },
  });
  const page = await ctx.newPage();
  const found = new Map(); // url -> {url, query, title}
  let cookieDone = false;

  for (const q of QUERIES) {
    const url = `https://pixabay.com/sound-effects/search/${encodeURIComponent(q)}/`;
    console.error(`\n=== ${q} ===`);
    if (!(await gotoRetry(page, url))) { console.error('  SKIP (goto)'); continue; }
    if (!cookieDone) {
      try {
        const b = await page.$('button:has-text("Accept")');
        if (b) { await b.click(); await sleep(1000); cookieDone = true; }
      } catch (e) {}
    }
    // scroll para cargar mas tarjetas
    for (let s = 0; s < 4; s++) { await page.mouse.wheel(0, 2600); await sleep(1100); }
    await page.mouse.wheel(0, -12000); await sleep(800);

    const btns = await page.$$('[class*="playOverlay"]');
    console.error(`  playOverlay: ${btns.length}`);
    let clicks = 0, newUrls = 0;
    for (const b of btns) {
      if (clicks >= 22) break;
      try {
        await b.scrollIntoViewIfNeeded();
        await b.click({ timeout: 3000 });
        clicks++;
        await sleep(650);
        const src = await page.$eval('audio', (a) => a.src || a.currentSrc || '').catch(() => '');
        if (src && src.startsWith('http') && !found.has(src)) {
          // intentar titulo: link cercano
          let title = '';
          try {
            title = await b.evaluate((el) => {
              let n = el;
              for (let i = 0; i < 6 && n; i++) {
                n = n.parentElement;
                if (!n) break;
                const a = n.querySelector('a[href*="/sound-effects/"]');
                if (a) return a.getAttribute('href') || '';
              }
              return '';
            });
          } catch (e) {}
          found.set(src, { url: src, query: q, title });
          newUrls++;
        }
      } catch (e) {}
    }
    console.error(`  clicks=${clicks} nuevos=${newUrls} total=${found.size}`);
  }

  console.log(JSON.stringify([...found.values()], null, 2));
  await browser.close();
})();
