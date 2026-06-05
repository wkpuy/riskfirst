const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  
  await page.goto('file:///Users/mtb730773/riskfirst/web/index.html');
  await page.waitForTimeout(1000);
  
  console.log("Clicking btn-port-trader");
  await page.evaluate(() => document.getElementById('btn-port-trader').click());
  await page.waitForTimeout(500);
  
  const modalVisible = await page.$eval('#capital-modal', el => !el.classList.contains('hidden'));
  console.log("Modal visible after click:", modalVisible);
  
  const inputVal = await page.$eval('#input-edit-capital', el => el.value);
  console.log("Input value:", inputVal);
  
  await browser.close();
})();
