import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.resolve(__dirname, '../.output/chrome-mv3');

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new', // Use new headless mode which supports extensions
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  // Find extension background target to get the ID
  const dummyPage = await browser.newPage();
  await dummyPage.goto('chrome://extensions');

  const targets = await browser.targets();
  const extensionTarget = targets.find(target => target.type() === 'service_worker' || target.type() === 'background_page');
  
  let extensionId = '';
  if (extensionTarget) {
    const url = extensionTarget.url();
    extensionId = url.split('/')[2];
    console.log('Found extension ID:', extensionId);
  } else {
    console.log('Could not find extension target automatically, trying to find it via targets list');
    for (const target of targets) {
      if (target.url().startsWith('chrome-extension://')) {
        extensionId = target.url().split('/')[2];
        console.log('Found extension ID:', extensionId);
        break;
      }
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
    console.error('REQUEST FAILED:', request.url(), request.failure().errorText);
  });

  console.log('Navigating to popup...');
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`);
  
  // Wait a bit for React to render or throw
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('Page content:', await page.content());
  
  await browser.close();
})();
