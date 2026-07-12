const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 950 },
  });
  const page = await ctx.newPage();
  try { await page.goto('https://pixabay.com/sound-effects/search/quadcopter/', { waitUntil: 'commit', timeout: 60000 }); } catch(e){ console.error(e.message); }
  await sleep(5000);
  try { const b = await page.$('button:has-text("Accept")'); if (b) { await b.click(); await sleep(1000);} } catch(e){}
  await sleep(1500);
  // Inspeccionar cada playOverlay: subir parents y encontrar el link + texto visible
  const cards = await page.evaluate(() => {
    const overlays = [...document.querySelectorAll('[class*="playOverlay"]')];
    return overlays.map((el, i) => {
      let n = el, link = '', txt = '';
      for (let k = 0; k < 8 && n; k++) {
        n = n.parentElement;
        if (!n) break;
        const a = n.querySelector('a[href*="/sound-effects/"]');
        if (a && !link) { link = a.getAttribute('href') || ''; txt = (a.textContent||'').trim().slice(0,60); }
      }
      return { i, link, txt };
    });
  });
  console.log(JSON.stringify(cards, null, 2));
  await browser.close();
})();
