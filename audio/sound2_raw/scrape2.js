// Scraper Pixabay v2: filtra por TITULO antes de escuchar. Solo clica play en relevantes.
// NODE_PATH=~/cAlgo/playwright-tool/node_modules node scrape2.js
const { chromium } = require('playwright-core');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUERIES = [
  'electric drone propeller',
  'quadcopter motor',
  'drone flying loop',
  'fpv drone',
  'drone hover',
  'brushless motor',
  'drone buzz',
];

// Relevancia por titulo/slug
const GOOD = /(drone|quadcopter|quadrocopter|quadcopt|propeller|propela|brushless|fpv|rotor|motor|multicopter|copter|buzz|hover|prop\b|dron)/i;
const BAD = /(water|rain|wind|ocean|sea|river|storm|thunder|notification|alarm|bell|ring|chime|voice|speak|music|song|melody|piano|guitar|drum|bird|dog|cat|animal|footstep|door|car engine|traffic|crowd|applause|whoosh|swoosh|coin|click|beep|game over|explosion|gun|laser|magic|sword)/i;

function relevant(txt) {
  if (!txt) return false;
  if (BAD.test(txt) && !/(drone|quadcopter|brushless|fpv|propeller)/i.test(txt)) return false;
  return GOOD.test(txt);
}

async function gotoRetry(page, url) {
  for (let a = 0; a < 3; a++) {
    try { await page.goto(url, { waitUntil: 'commit', timeout: 60000 }); await sleep(4500); return true; }
    catch (e) { console.error(`  goto fail ${a}: ${e.message}`); await sleep(2000); }
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 950 },
  });
  const page = await ctx.newPage();
  const found = new Map();   // url -> {url, title, link, query}
  const rejected = [];       // {title, query} descartados por titulo
  let cookieDone = false;

  for (const q of QUERIES) {
    const url = `https://pixabay.com/sound-effects/search/${encodeURIComponent(q)}/`;
    console.error(`\n=== ${q} ===`);
    if (!(await gotoRetry(page, url))) { console.error('  SKIP goto'); continue; }
    if (!cookieDone) {
      try { const b = await page.$('button:has-text("Accept")'); if (b) { await b.click(); await sleep(1000); cookieDone = true; } } catch (e) {}
    }
    for (let s = 0; s < 4; s++) { await page.mouse.wheel(0, 2600); await sleep(1000); }
    await page.mouse.wheel(0, -14000); await sleep(700);

    // Recolectar tarjetas: indice de overlay -> titulo + link
    const cards = await page.evaluate(() => {
      const overlays = [...document.querySelectorAll('[class*="playOverlay"]')];
      return overlays.map((el, i) => {
        let n = el, link = '', txt = '';
        for (let k = 0; k < 8 && n; k++) {
          n = n.parentElement; if (!n) break;
          const a = n.querySelector('a[href*="/sound-effects/"]');
          if (a && !link) { link = a.getAttribute('href') || ''; txt = (a.textContent || '').trim().slice(0, 80); }
        }
        return { i, link, txt };
      });
    });
    const btns = await page.$$('[class*="playOverlay"]');
    console.error(`  cards=${cards.length}`);

    let clicks = 0, added = 0;
    for (const c of cards) {
      const label = c.txt || c.link;
      if (!relevant(label)) { rejected.push({ title: label, query: q }); continue; }
      const b = btns[c.i];
      if (!b) continue;
      if (clicks >= 22) break;
      try {
        await b.scrollIntoViewIfNeeded();
        await b.click({ timeout: 3000 });
        clicks++;
        await sleep(650);
        const src = await page.$eval('audio', (a) => a.src || a.currentSrc || '').catch(() => '');
        if (src && src.startsWith('http') && !found.has(src)) {
          found.set(src, { url: src, title: c.txt, link: c.link, query: q });
          added++;
          console.error(`    + [${c.txt}] ${src.split('/').pop()}`);
        }
      } catch (e) {}
    }
    console.error(`  relevantes-clicados=${clicks} nuevos=${added} total=${found.size}`);
  }

  fs.writeFileSync('urls.json', JSON.stringify([...found.values()], null, 2));
  fs.writeFileSync('rejected.json', JSON.stringify(rejected, null, 2));
  console.error(`\nTOTAL relevantes: ${found.size} | descartados por titulo: ${rejected.length}`);
  await browser.close();
})();
