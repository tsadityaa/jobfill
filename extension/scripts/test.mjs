import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '..', '.output', 'chrome-mv3');
const TEST_PAGE = 'file://' + path.join(__dirname, '..', 'test-pages', 'job-application.html').replace(/\\/g, '/');

(async () => {
  console.log('Building extension...');
  const { execSync } = await import('child_process');
  execSync('npm run build', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });

  console.log('Launching Puppeteer with extension...');
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  });

  // Find extension ID
  const backgroundPageTarget = await browser.waitForTarget(
    target => target.type() === 'service_worker' || target.type() === 'background_page'
  );
  
  if (!backgroundPageTarget) {
    throw new Error('Background page not found');
  }
  
  const extensionUrl = backgroundPageTarget.url();
  const [, , extensionId] = extensionUrl.split('/');
  console.log(`Extension ID: ${extensionId}`);

  // Open the extension popup in a tab
  const popupPage = await browser.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/index.html`);

  console.log('Filling profile details in popup...');
  // Wait for React to mount
  await popupPage.waitForSelector('#profile-first-name', { timeout: 5000 });
  await popupPage.type('#profile-first-name', 'John');
  await popupPage.type('#profile-last-name', 'Doe');
  
  // Add phone
  await popupPage.click('.section-header:has(.contact)');
  await popupPage.waitForSelector('.btn-add', { timeout: 1000 });
  await popupPage.click('.btn-add');
  await popupPage.type('input[type="tel"]', '+1 555-1234');
  await popupPage.click('.btn-primary'); // Add button

  // Open the test page
  console.log('Opening test page...');
  const testPage = await browser.newPage();
  await testPage.goto(TEST_PAGE);

  // Click autofill in popup (we need to bring the popup page back to front or just click it)
  await popupPage.bringToFront();
  console.log('Clicking Autofill...');
  await popupPage.click('#btn-autofill-scan');
  
  await popupPage.waitForSelector('#btn-autofill-fill', { timeout: 5000 });
  await popupPage.click('#btn-autofill-fill');

  // Verify fields on test page
  await testPage.bringToFront();
  console.log('Checking fields on test page...');
  const firstName = await testPage.$eval('#firstName', el => el.value);
  const lastName = await testPage.$eval('#lastName', el => el.value);
  
  // Notice that we have alternate names too (Test 2)
  const givenName = await testPage.$eval('#given-name', el => el.value);
  
  console.log('First Name (standard):', firstName);
  console.log('Last Name (standard):', lastName);
  console.log('Given Name (alternate):', givenName);

  if (firstName === 'John' && lastName === 'Doe' && givenName === 'John') {
    console.log('✅ TEST PASSED: Autofill successfully detected and filled fields!');
  } else {
    console.log('❌ TEST FAILED: Fields were not filled properly.');
  }

  await browser.close();
})();
