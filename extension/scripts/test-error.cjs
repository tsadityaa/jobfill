const puppeteer = require('puppeteer');
const path = require('path');

const extensionPath = path.resolve(__dirname, '../.output/chrome-mv3');

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const dummyPage = await browser.newPage();
  await dummyPage.goto('chrome://extensions');

  const targets = await browser.targets();
  let extensionId = '';
  
  for (const target of targets) {
    if (target.url().startsWith('chrome-extension://')) {
      extensionId = target.url().split('/')[2];
      break;
    }
  }

  if (!extensionId) {
    console.error('Could not determine extension ID');
    await browser.close();
    process.exit(1);
  }

  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.error('PAGE ERROR:', error.message));
  page.on('requestfailed', request => {
    console.error('REQUEST FAILED:', request.url(), request.failure()?.errorText);
  });

  console.log('Navigating to popup...');
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`);
  
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('Page content:', await page.content());
  
  await browser.close();
})();
