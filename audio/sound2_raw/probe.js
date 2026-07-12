const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
  });
  const page = await ctx.newPage();
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      await page.goto('https://pixabay.com/sound-effects/search/quadcopter/', { waitUntil: 'commit', timeout: 60000 });
      await sleep(5000);
      ok = true;
    } catch (e) {
      console.error(`attempt ${attempt} fail: ${e.message}`);
      await sleep(2000);
    }
  }
  if (!ok) { await browser.close(); process.exit(1); }
  try { const b = await page.$('button:has-text("Accept")'); if (b) { await b.click(); await sleep(1000);} } catch(e){}
  await sleep(2000);
  const info = await page.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const audios = [...document.querySelectorAll('audio')].map(a=>({src:a.src||a.currentSrc||''}));
    const btns = [...document.querySelectorAll('button')].map(b=>({al:b.getAttribute('aria-label'),cls:b.className.toString().slice(0,50)}));
    return {
      title: document.title,
      url: location.href,
      audioCount: q('audio'),
      buttonCount: q('button'),
      audios,
      sampleButtons: btns.filter(b=>b.al||/play/i.test(b.cls)).slice(0,25),
      hasPlayAria: q('button[aria-label*="Play"]'),
    };
  });
  console.log(JSON.stringify(info,null,2));
  await browser.close();
})();
