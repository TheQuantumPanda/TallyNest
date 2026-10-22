import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const mongoose = requireBackend('mongoose');

process.chdir(fileURLToPath(new URL('../', import.meta.url)));

const backendDir = fileURLToPath(new URL('../backend/', import.meta.url));
const frontendDir = fileURLToPath(new URL('../frontend/', import.meta.url));
const { chromium } = await import(
  fileURLToPath(new URL('../frontend/node_modules/@playwright/test/index.mjs', import.meta.url))
);

const database = `tallynest_fresh_v2_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
const jwtSecret = randomBytes(32).toString('hex');
const password = `WorkflowDemo-${randomBytes(12).toString('base64url')}!9a`;
const uri = `mongodb://127.0.0.1:27017/${database}`;
const pattern = /^tallynest_fresh_v2_test_\d{13}_[a-f0-9]{12}$/;

let api,
  vite,
  failed = false;

function waitForLine(child, regex, message) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(message)), 45000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = regex.exec(output);
      if (match) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(match);
      }
      if (output.length > 8000) output = output.slice(-4000);
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Service exited before readiness (${code})`));
    });
  });
}

async function waitForUrl(url) {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Service at ${url} did not become ready`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGINT');
  });
}

async function setupDatabase() {
  const { MongoClient } = mongoose.mongo;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const { installFreshCycleSchema } = await import('../backend/src/config/fresh-cycle-setup.js');
    await installFreshCycleSchema(client.db());
  } finally {
    await client.close();
  }
}

async function cleanupDatabase() {
  if (!pattern.test(database)) throw new Error('Unexpected cleanup target');
  const client = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27017', {
    serverSelectionTimeoutMS: 10000,
  });
  await client.connect();
  try {
    await new Promise((r) => setTimeout(r, 500));
    const listed = async () =>
      (await client.db().admin().listDatabases({ nameOnly: true })).databases.some(
        (entry) => entry.name === database,
      );
    if (await listed()) await client.db(database).dropDatabase();
    await new Promise((r) => setTimeout(r, 500));
    if (await listed()) throw new Error('Disposable database recreated');
    console.log(`Cleaned up disposable database: ${database}`);
  } finally {
    await client.close();
  }
}

async function convertVideoToGif(webmPath, gifPath, fps = 8, width = 1000) {
  console.log(`Encoding GIF: ${gifPath}...`);
  const ffmpegArgs = [
    '-y',
    '-ss',
    '0.9', // Trim initial navigation; each workflow waits for its ready control.
    '-i',
    webmPath,
    '-vf',
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=112:reserve_transparent=0[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
    '-loop',
    '0',
    gifPath,
  ];
  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${err}`));
    });
  });

  // Layer optimization
  await new Promise((resolve, reject) => {
    const proc = spawn('magick', [gifPath, '-layers', 'Optimize', gifPath], { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`magick optimize failed (${code})`));
    });
  });
  console.log(`Finished ${gifPath}`);
}

async function main() {
  console.log('Setting up disposable database and services...');
  await mkdir('docs/media', { recursive: true });
  await setupDatabase();

  api = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '5500',
      MONGO_URI: uri,
      JWT_SECRET: jwtSecret,
      CLIENT_ORIGIN: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForLine(api, /TallyNest API listening on port 5500/, 'API failed to start');

  vite = spawn(
    fileURLToPath(new URL('../frontend/node_modules/.bin/vite', import.meta.url)),
    ['--host', 'localhost', '--port', '5173', '--strictPort'],
    {
      cwd: frontendDir,
      env: { ...process.env, VITE_API_URL: 'http://localhost:5500/api' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await waitForLine(vite, /http:\/\/localhost:5173\//, 'Vite failed to start');
  await waitForUrl('http://localhost:5173');

  console.log('Services ready. Launching Playwright browser...');
  const browser = await chromium.launch({ headless: true });
  const recDir = join(tmpdir(), `tallynest-rec-${Date.now()}`);
  await mkdir(recDir, { recursive: true });

  const email = `demo.alex-${randomUUID().slice(0, 8)}@tallynest.example.test`;

  try {
    // 1. Initial Account Registration
    const initContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const initPage = await initContext.newPage();
    await initPage.goto('http://localhost:5173/register');
    await initPage.getByRole('textbox', { name: 'Full name' }).fill('Alex Vance');
    await initPage.getByRole('textbox', { name: 'Email address' }).fill(email);
    await initPage.locator('input[name="password"]').fill(password);
    await initPage.getByRole('button', { name: 'Create account' }).click();
    await initPage.waitForURL(/\/app/);

    // Seed initial transactions so tables have real context
    await initPage.goto('http://localhost:5173/app/transactions');
    await initPage.getByRole('button', { name: 'Add transaction', exact: true }).click();
    let diag = initPage.getByRole('dialog', { name: 'Add transaction' });
    await diag.getByRole('button', { name: 'Income' }).click();
    await diag.locator('input[name="title"]').fill('Client Retainer Payment');
    await diag.locator('input[name="amount"]').fill('45000.00');
    await diag.locator('select[name="category"]').selectOption('salary');
    await diag.locator('button[type="submit"]').click();
    await initPage.waitForTimeout(600);

    await initPage.getByRole('button', { name: 'Add transaction', exact: true }).click();
    diag = initPage.getByRole('dialog', { name: 'Add transaction' });
    await diag.locator('input[name="title"]').fill('Supermarket Groceries');
    await diag.locator('input[name="amount"]').fill('3250.00');
    await diag.locator('select[name="category"]').selectOption('food_dining');
    await diag.locator('button[type="submit"]').click();
    await initPage.waitForTimeout(600);

    const cookies = await initContext.cookies();
    await initContext.close();

    // ==========================================
    // WORKFLOW 1: Transactions & Instant Ledger
    // ==========================================
    console.log('Recording Workflow 1: Transaction Management...');
    const ctx1 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: recDir, size: { width: 1280, height: 800 } },
    });
    await ctx1.addCookies(cookies);
    const page1 = await ctx1.newPage();
    await page1.goto('http://localhost:5173/app/transactions');
    await page1.getByRole('button', { name: 'Add transaction', exact: true }).waitFor();
    await page1.waitForTimeout(1000);

    // Open Add Transaction modal
    await page1.getByRole('button', { name: 'Add transaction', exact: true }).click();
    const tForm = page1.getByRole('dialog', { name: 'Add transaction' });
    await page1.waitForTimeout(500);

    // Fill form with realistic human-like pacing
    await tForm.locator('input[name="title"]').fill('Cloud Server Hosting');
    await page1.waitForTimeout(300);
    await tForm.locator('input[name="amount"]').fill('1450.00');
    await page1.waitForTimeout(300);
    await tForm.locator('select[name="category"]').selectOption('utilities');
    await page1.waitForTimeout(400);

    // Submit
    await tForm.locator('button[type="submit"]').click();
    await page1.waitForTimeout(1200);

    // Filter by Utilities and search Cloud
    if (await page1.locator('#filter-category').count()) {
      await page1.locator('#filter-category').selectOption('utilities');
      await page1.waitForTimeout(1000);
      await page1.locator('#filter-search').fill('Cloud');
      await page1.waitForTimeout(1200);
    }
    await page1.waitForTimeout(1500); // hold for inspection
    const v1Path = await page1.video().path();
    await ctx1.close();

    await convertVideoToGif(v1Path, 'docs/media/transaction-workflow.gif', 8, 1000);

    // ==========================================
    // WORKFLOW 2: Monthly Budget Management
    // ==========================================
    console.log('Recording Workflow 2: Budget Management...');
    const ctx2 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: recDir, size: { width: 1280, height: 800 } },
    });
    await ctx2.addCookies(cookies);
    const page2 = await ctx2.newPage();
    await page2.goto('http://localhost:5173/app/budgets');
    await page2.getByRole('button', { name: 'Add budget', exact: true }).waitFor();
    await page2.waitForTimeout(1000);

    // Click Add budget
    await page2.getByRole('button', { name: 'Add budget', exact: true }).click();
    const bForm = page2.getByRole('dialog', { name: 'Add budget' });
    await page2.waitForTimeout(500);

    await bForm.locator('select[name="category"]').selectOption('food_dining');
    await page2.waitForTimeout(400);
    await bForm.locator('input[name="amount"]').fill('8000.00');
    await page2.waitForTimeout(500);

    await bForm.locator('button[type="submit"]').click();
    await page2.waitForTimeout(1500);

    // Add a second budget for comparison
    await page2.getByRole('button', { name: 'Add budget', exact: true }).click();
    const bForm2 = page2.getByRole('dialog', { name: 'Add budget' });
    await page2.waitForTimeout(500);
    await bForm2.locator('select[name="category"]').selectOption('utilities');
    await page2.waitForTimeout(400);
    await bForm2.locator('input[name="amount"]').fill('5000.00');
    await page2.waitForTimeout(500);
    await bForm2.locator('button[type="submit"]').click();
    await page2.waitForTimeout(2000); // hold for inspection

    const v2Path = await page2.video().path();
    await ctx2.close();

    await convertVideoToGif(v2Path, 'docs/media/budgets-workflow.gif', 8, 1000);

    // ==========================================
    // WORKFLOW 3: Recurring Transaction Schedules
    // ==========================================
    console.log('Recording Workflow 3: Recurring Transactions...');
    const ctx3 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: recDir, size: { width: 1280, height: 800 } },
    });
    await ctx3.addCookies(cookies);
    const page3 = await ctx3.newPage();
    await page3.goto('http://localhost:5173/app/recurring');
    await page3.getByRole('button', { name: 'Add schedule', exact: true }).waitFor();
    await page3.waitForTimeout(1000);

    await page3.getByRole('button', { name: 'Add schedule', exact: true }).click();
    const rForm = page3.getByRole('dialog', { name: 'Add recurring schedule' });
    await page3.waitForTimeout(500);

    await rForm.locator('input[name="title"]').fill('Developer SaaS Subscription');
    await page3.waitForTimeout(350);
    await rForm.locator('input[name="amount"]').fill('799.00');
    await page3.waitForTimeout(350);
    await rForm.locator('select[name="category"]').selectOption('subscriptions');
    await page3.waitForTimeout(350);
    await rForm.locator('select[name="frequency"]').selectOption('monthly');
    await page3.waitForTimeout(500);

    await rForm.locator('button[type="submit"]').click();
    await page3.waitForTimeout(2200); // hold

    const v3Path = await page3.video().path();
    await ctx3.close();

    await convertVideoToGif(v3Path, 'docs/media/recurring-workflow.gif', 8, 1000);

    // ==========================================
    // WORKFLOW 4: Group Finances & Cycle Lifecycle
    // ==========================================
    console.log('Recording Workflow 4: Collaborative Group & Cycle Lifecycle...');
    const ctx4 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: recDir, size: { width: 1280, height: 800 } },
    });
    await ctx4.addCookies(cookies);
    const page4 = await ctx4.newPage();
    await page4.goto('http://localhost:5173/app/groups');
    await page4.getByRole('button', { name: 'Create group', exact: true }).waitFor();
    await page4.waitForTimeout(1000);

    // Create group
    await page4.getByRole('button', { name: 'Create group', exact: true }).click();
    const gForm = page4.getByRole('dialog', { name: 'Create group' });
    await page4.waitForTimeout(400);
    await gForm.getByRole('textbox', { name: 'Group name' }).fill('Studio Co-working Collective');
    await page4.waitForTimeout(400);
    await gForm.getByRole('button', { name: 'Save' }).click();
    await page4.waitForTimeout(1000);

    // Open first cycle
    await page4.getByRole('button', { name: 'Open first cycle' }).click();
    const cycleDialog = page4.getByRole('dialog', { name: 'Open first cycle' });
    await page4.waitForTimeout(400);
    await cycleDialog.getByRole('button', { name: 'Open first cycle' }).click();
    await page4.waitForTimeout(1000);

    // Add shared expense
    await page4
      .getByRole('navigation', { name: 'Cycle sections' })
      .getByRole('button', { name: 'expenses' })
      .click();
    await page4.waitForTimeout(500);
    await page4.getByRole('button', { name: 'Add shared expense' }).click();
    const expDialog = page4.getByRole('dialog', { name: 'Add shared expense' });
    await page4.waitForTimeout(400);
    await expDialog
      .getByRole('textbox', { name: 'Expense title' })
      .fill('High-Speed Fiber Internet');
    await page4.waitForTimeout(300);
    await expDialog.getByRole('textbox', { name: 'Total amount (INR)' }).fill('1800.00');
    await page4.waitForTimeout(400);
    await expDialog.getByRole('button', { name: 'Save' }).click();
    await page4.waitForTimeout(1200);

    // View Balances
    await page4
      .getByRole('navigation', { name: 'Cycle sections' })
      .getByRole('button', { name: 'balances' })
      .click();
    await page4.waitForTimeout(1200);

    // Freeze cycle
    await page4.getByRole('button', { name: 'Freeze cycle' }).click();
    const fDialog = page4.getByRole('dialog', { name: 'Freeze cycle' });
    await page4.waitForTimeout(400);
    await fDialog.getByRole('button', { name: 'Freeze cycle' }).click();
    await page4.waitForTimeout(1200);

    // Close cycle (since single owner, net balance is 0.00, closes cleanly!)
    await page4.getByRole('button', { name: 'Close cycle' }).click();
    const cDialog = page4.getByRole('dialog', { name: 'Close cycle' });
    await page4.waitForTimeout(400);
    await cDialog.getByRole('button', { name: 'Close cycle' }).click();
    await page4.waitForTimeout(1500); // hold to show closed cycle status and "Open next cycle"

    const v4Path = await page4.video().path();
    await ctx4.close();

    await convertVideoToGif(v4Path, 'docs/media/groups-cycle-workflow.gif', 8, 1000);

    console.log('All 4 workflow recordings and GIF encodings completed successfully!');
  } catch (err) {
    failed = true;
    console.error('Error during recording:', err);
  } finally {
    await browser.close();
    await rm(recDir, { recursive: true, force: true });
    await stopChild(vite);
    await stopChild(api);
    await cleanupDatabase();
  }

  if (failed) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await stopChild(vite);
  await stopChild(api);
  await cleanupDatabase();
  process.exitCode = 1;
});
