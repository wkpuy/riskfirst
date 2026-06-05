const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({args: ['--allow-file-access-from-files', '--disable-web-security']});
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', error => console.log('ERR:', error.message));
  await page.goto('file:///Users/mtb730773/riskfirst/web/index.html');
  await new Promise(r => setTimeout(r, 1000));
  
  console.log("Clicking btn-port-trader");
  await page.evaluate(() => document.getElementById('btn-port-trader').click());
  await new Promise(r => setTimeout(r, 500));
  
  const modalVisible = await page.$eval('#capital-modal', el => !el.classList.contains('hidden'));
  console.log("Modal visible after click:", modalVisible);
  await browser.close();
})();
