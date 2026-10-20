import { test, expect, chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, appendFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const {
  mongo: { MongoClient, ObjectId },
} = createRequire(new URL('../../backend/package.json', import.meta.url))('mongoose');

const evidence = '../output/playwright/ui-polish';
async function screenshot(page, name, fullPage = false) {
  await mkdir(evidence, { recursive: true });
  if (!(await page.getByRole('dialog').count())) await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  const auth = page.locator('.auth-form-container');
  if (await auth.count()) await expect(auth).toHaveCSS('opacity', '1');
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage });
}
async function centered(page, dialog) {
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox();
      const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      return Math.max(
        Math.abs(box.x + box.width / 2 - view.width / 2),
        Math.abs(box.y + box.height / 2 - view.height / 2),
      );
    })
    .toBeLessThan(2);
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(box.width).toBeLessThanOrEqual(view.width);
  expect(box.height).toBeLessThanOrEqual(view.height);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
}

const password = process.env.TALLYNEST_NORMAL_E2E_PASSWORD;
if (!password) throw new Error('Disposable normal-app browser password is required');

test('normal app registers, creates a v2 group, opens and closes cycles, and keeps personal pages available', async ({
  page,
}) => {
  const email = `normal.first.last-${randomUUID()}@long-account.test.invalid`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await expect(page.locator('input[name="email"]')).toHaveCSS('font-size', '16px');
  await page.locator('input[name="email"]').fill('readable.first.last+test@example.invalid');
  await screenshot(page, 'login');
  await page.goto('/register');
  await page.getByRole('textbox', { name: 'Full name' }).fill('Normal Browser Owner');
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await screenshot(page, 'register');
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.locator('.header-email')).toHaveText(email);
  await expect(page.locator('.header-email')).toHaveCSS('font-size', '14px');

  await page.goto('/app/groups');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Create group' });
  await centered(page, form);
  await screenshot(page, 'group-dialog');
  await form.getByRole('textbox', { name: 'Group name' }).fill('Normal v2 browser group');
  const created = page.waitForResponse(
    (response) => response.url().endsWith('/api/groups') && response.request().method() === 'POST',
  );
  await form.getByRole('button', { name: 'Save' }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole('heading', { name: 'Normal v2 browser group' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open first cycle' })).toBeVisible();

  await page.getByRole('button', { name: 'Open first cycle' }).click();
  const open = page.getByRole('dialog', { name: 'Open first cycle' });
  await centered(page, open);
  await open.getByRole('button', { name: 'Open first cycle' }).click();
  await expect(page.getByRole('heading', { name: 'Cycle 1', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Cycle sections' })
      .getByRole('button', { name: 'invitations' }),
  ).toBeEnabled();
  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'expenses' })
    .click();
  await page.getByRole('button', { name: 'Add shared expense' }).click();
  const expense = page.getByRole('dialog', { name: 'Add shared expense' });
  await centered(page, expense);
  await screenshot(page, 'shared-expense-dialog');
  await expense.getByRole('textbox', { name: 'Expense title' }).fill('Cycle one expense');
  await expense.getByRole('textbox', { name: 'Total amount (INR)' }).fill('25.50');
  await expense.locator('#shared-date').fill('2026-10-18');
  const saveExpense = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith('/api/groups/' + new URL(page.url()).pathname.split('/')[3] + '/expenses') &&
      response.request().method() === 'POST',
  );
  await expense.getByRole('button', { name: 'Save' }).click();
  const expenseResponse = await saveExpense;
  expect(expenseResponse.status()).toBe(201);
  await expect(page.getByRole('heading', { name: 'Cycle one expense' })).toBeVisible();

  await expect(page.locator('.cycle-choice').first()).toHaveCSS('display', 'flex');
  await screenshot(page, 'cycle-workspace');
  await page.getByRole('button', { name: 'Freeze cycle' }).click();
  await centered(page, page.getByRole('dialog', { name: 'Freeze cycle' }));
  await page
    .getByRole('dialog', { name: 'Freeze cycle' })
    .getByRole('button', { name: 'Freeze cycle' })
    .click();
  await expect(page.locator('.cycle-current')).toContainText('frozen');
  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'balances' })
    .click();
  await expect(page.getByText('₹25.50').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close cycle' }).click();
  await page
    .getByRole('dialog', { name: 'Close cycle' })
    .getByRole('button', { name: 'Close cycle' })
    .click();
  await expect(page.locator('.cycle-current')).toContainText('closed');
  await page.getByRole('button', { name: 'Open next cycle' }).click();
  await page
    .getByRole('dialog', { name: 'Open next cycle' })
    .getByRole('button', { name: 'Open next cycle' })
    .click();
  await expect(page.getByRole('heading', { name: 'Cycle 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Cycle 1 closed/ }).click();
  await expect(page.getByRole('heading', { name: 'Cycle 1', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'expenses' })
    .click();
  await expect(page.getByRole('heading', { name: 'Cycle one expense' })).toBeVisible();

  for (const route of [
    '/app',
    '/app/transactions',
    '/app/budgets',
    '/app/recurring',
    '/app/groups',
    '/app/account',
  ]) {
    await page.goto(route);
    await expect(page.locator('#main-content').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#main-content [aria-busy="true"]')).toHaveCount(0);
    await expect(page.locator('#main-content .dashboard-skeleton')).toHaveCount(0);
    await expect(page.getByText('Loading current records…', { exact: true })).toHaveCount(0);
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
    }
    await screenshot(page, `page-${route.split('/').at(-1)}-320`);
  }
  for (const [route, button, title] of [
    ['/app/budgets', 'Add budget', 'Add budget'],
    ['/app/recurring', 'Add schedule', 'Add recurring schedule'],
  ]) {
    await page.goto(route);
    await page.getByRole('button', { name: button, exact: true }).click();
    await centered(page, page.getByRole('dialog', { name: title }));
    await screenshot(page, `form-${route.split('/').at(-1)}-320`);
    await page.keyboard.press('Escape');
  }
  await page.goto('/app/transactions');
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
    const trigger = page.getByRole('button', { name: 'Add transaction', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Add transaction' });
    await centered(page, dialog);
    await expect(dialog.locator('input').first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect
      .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
    for (let i = 0; i < 14; i++) await page.keyboard.press('Tab');
    await expect
      .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
    if (width === 1440 || width === 390)
      await screenshot(page, width === 1440 ? 'transaction-dialog' : 'mobile-dialog');
    await dialog
      .getByRole('button', { name: 'Add transaction', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole('button', { name: 'Add transaction', exact: true }),
    ).toBeInViewport();
    await centered(page, dialog);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const draft = page.getByRole('dialog');
  await draft.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await expect(draft.locator('[aria-invalid="true"]').first()).toBeVisible();
  await centered(page, draft);
  await draft
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Long description with punctuation, periods. '.repeat(4));
  await page.keyboard.press('Escape');
  await expect(draft.getByRole('heading', { name: 'Discard unsaved changes?' })).toBeVisible();
  await centered(page, draft);
  await screenshot(page, 'validation-and-draft-320');
  await draft.getByRole('button', { name: 'Keep editing' }).click();
  await expect(draft.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
    /Long description/,
  );
  await page.keyboard.press('Escape');
  await draft.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Escape');
  // A 1440px viewport at 200% browser zoom has a 720px CSS layout viewport.
  await page.setViewportSize({ width: 720, height: 450 });
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await centered(page, page.getByRole('dialog'));
  await page.keyboard.press('Escape');
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
  }
  await nativeZoomForm(page);
});

async function nativeZoomForm(sourcePage) {
  const root = await mkdtemp(join(tmpdir(), 'tallynest-native-zoom-'));
  const extension = join(root, 'extension');
  let context;
  try {
    await mkdir(extension);
    await writeFile(
      join(extension, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Disposable TallyNest zoom verification',
        version: '1.0',
        permissions: ['tabs'],
        background: { service_worker: 'worker.js' },
      }),
    );
    await writeFile(
      join(extension, 'worker.js'),
      'chrome.runtime.onInstalled.addListener(() => {});',
    );
    context = await chromium.launchPersistentContext(join(root, 'profile'), {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
    await context.addCookies(await sourcePage.context().cookies());
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    const page = context.pages()[0];
    await page.goto('http://localhost:5173/app/transactions');
    const factor = await worker.evaluate(async () => {
      const tabs = await globalThis.chrome.tabs.query({});
      const tab = tabs.find((row) => row.url.startsWith('http://localhost:5173/'));
      await globalThis.chrome.tabs.setZoom(tab.id, 2);
      return globalThis.chrome.tabs.getZoom(tab.id);
    });
    expect(factor).toBe(2);
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2);
    expect(await page.evaluate(() => innerWidth)).toBe(720);
    await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add transaction' });
    await centered(page, dialog);
    await dialog
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('Native 200% zoom transaction');
    await dialog.getByRole('textbox', { name: 'Amount (INR)', exact: true }).fill('12.34');
    const submit = dialog.getByRole('button', { name: 'Add transaction', exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await screenshot(page, 'native-200-percent-transaction');
    await submit.click();
    await expect(dialog).toHaveCount(0);
    const saved = (await api(page, '/transactions')).body.data.transactions;
    expect(saved.find((row) => row.title === 'Native 200% zoom transaction')).toMatchObject({
      amountMinor: 1234,
    });
    for (const [route, button, title] of [
      ['/app/budgets', 'Add budget', 'Add budget'],
      ['/app/recurring', 'Add schedule', 'Add recurring schedule'],
      ['/app/groups', 'Create group', 'Create group'],
    ]) {
      await page.goto('http://localhost:5173' + route);
      expect(await page.evaluate(() => innerWidth)).toBe(720);
      await page.getByRole('button', { name: button, exact: true }).click();
      const form = page.getByRole('dialog', { name: title });
      await centered(page, form);
      await form.locator('button[type="submit"]').scrollIntoViewIfNeeded();
      await expect(form.locator('button[type="submit"]')).toBeInViewport();
      await screenshot(page, `native-200-percent-${route.split('/').at(-1)}`);
      await page.keyboard.press('Escape');
      await expect(form).toHaveCount(0);
    }
  } finally {
    await context?.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function api(page, path, method = 'GET', data, headers = {}) {
  const response = await page.context().request.fetch('http://localhost:5500/api' + path, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { Origin: 'http://localhost:5173', 'X-CSRF-Protection': '1', ...headers },
  });
  return { status: response.status(), body: await response.json(), headers: response.headers() };
}
async function register(page, name, email) {
  await page.goto('/register');
  await page.getByRole('textbox', { name: 'Full name' }).fill(name);
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app/);
  const cookies = await page.context().cookies('http://localhost:5500');
  expect(cookies.find((row) => row.name === 'sfm_access')).toMatchObject({
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
  });
  expect(await page.evaluate(() => document.cookie)).not.toContain('sfm_access');
  await page.goto('/app/groups');
}
async function signIn(page, email) {
  expect((await api(page, '/auth/logout', 'POST', {})).status).toBe(200);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
  await page.goto('/app/groups');
}
async function lifecycle(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
  const dialog = page.getByRole('dialog', { name });
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function invite(page) {
  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'invitations' })
    .click();
  await page.getByRole('button', { name: 'Generate invitation' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  return page.getByRole('textbox', { name: 'One-time invitation link' }).inputValue();
}
async function recordBalance(label, value) {
  await mkdir(evidence, { recursive: true });
  await appendFile(
    `${evidence}/normal-financial-balances.jsonl`,
    JSON.stringify({ label, balances: value }) + '\n',
  );
}
async function balances(page, path, cycleId, ownerId, memberId, paid, ownerShare) {
  const result = await api(page, path + '/balances?cycleId=' + cycleId);
  expect(result.status).toBe(200);
  expect(result.headers['cache-control']).toBe('no-store');
  const value = result.body.data.balances;
  await recordBalance(`split-total-${paid}`, value);
  expect(value.netTotalMinor).toBe(0);
  expect(value.members.find((row) => row.user === ownerId)).toMatchObject({
    paidMinor: paid,
    assignedMinor: ownerShare,
    netMinor: paid - ownerShare,
  });
  expect(value.members.find((row) => row.user === memberId)).toMatchObject({
    paidMinor: 0,
    assignedMinor: paid - ownerShare,
    netMinor: ownerShare - paid,
  });
}
async function interruptedOperation(page, member, joiner, path, groupId) {
  const uri = process.env.TALLYNEST_NORMAL_E2E_MONGO_URI;
  if (
    !/^mongodb:\/\/127\.0\.0\.1:27017\/tallynest_fresh_v2_test_\d{13}_[a-f0-9]{12}$/.test(uri || '')
  )
    throw new Error('Disposable DB required for fault drill');
  const client = new MongoClient(uri, { maxPoolSize: 2 });
  await client.connect();
  const db = client.db();
  const original = (await db.listCollections({ name: 'groups' }).next()).options;
  try {
    // External storage fault: refuse only release of this group's reservation.
    // Normal server.js and production repositories remain completely unchanged.
    await db.command({
      collMod: 'groups',
      validator: {
        $and: [
          original.validator,
          {
            $or: [
              { _id: { $ne: new ObjectId(groupId) } },
              { financialOperation: { $exists: true } },
            ],
          },
        ],
      },
    });
    await member.goto('/app' + path);
    await member
      .getByRole('navigation', { name: 'Cycle sections' })
      .getByRole('button', { name: 'expenses' })
      .click();
    await member.getByRole('button', { name: 'Add shared expense' }).click();
    const form = member.getByRole('dialog', { name: 'Add shared expense' });
    await form.getByRole('textbox', { name: 'Expense title' }).fill('Normal interrupted operation');
    await form.getByRole('textbox', { name: 'Total amount (INR)' }).fill('3.00');
    await form.locator('#shared-date').fill('2026-10-20');
    const failed = member.waitForResponse(
      (row) => row.url().endsWith('/expenses') && row.request().method() === 'POST',
    );
    await form.getByRole('button', { name: 'Save' }).click();
    expect((await failed).status()).toBe(500);
    await expect(form).toContainText('may already exist');
    const reserved = await db.collection('groups').findOne({ _id: new ObjectId(groupId) });
    expect(reserved.financialOperation.phase).toBe('applying');
    expect(
      await db
        .collection('groupexpenses')
        .countDocuments({ group: new ObjectId(groupId), title: 'Normal interrupted operation' }),
    ).toBe(1);
    expect((await api(page, path + '/balances?cycleId=' + reserved.currentCycleId)).body.code).toBe(
      'FINANCIAL_BUSY',
    );
    expect((await api(joiner, path + '/financial-recovery', 'POST', {})).status).toBe(403);
    expect(
      (
        await api(
          page,
          path + '/expenses',
          'POST',
          {
            cycleId: String(reserved.currentCycleId),
            payer: String(reserved.creator),
            title: 'Blocked during recovery',
            amountMinor: 300,
            currency: 'INR',
            category: 'other',
            expenseDate: '2026-10-20T00:00:00.000Z',
            split: {
              method: 'equal',
              participants: reserved.members.map((row) => String(row.user)).sort(),
            },
          },
          { 'Idempotency-Key': randomUUID() },
        )
      ).body.code,
    ).toBe('FINANCIAL_BUSY');
  } finally {
    await db.command({
      collMod: 'groups',
      validator: original.validator,
      validationLevel: original.validationLevel,
      validationAction: original.validationAction,
    });
    await client.close();
  }
  await page.goto('/app' + path);
  await page.getByRole('button', { name: 'Recover pending operation' }).click();
  await expect(
    page.getByText('The original operation was reconciled. Records are reloading.'),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'expenses' })
    .click();
  await expect(page.getByRole('heading', { name: 'Normal interrupted operation' })).toHaveCount(1);
  await screenshot(page, 'normal-authorized-recovery', true);
  const cycle = (await api(page, path + '/cycles')).body.data.group.currentCycleId;
  const recovered = await api(page, path + '/expenses?cycleId=' + cycle);
  expect(
    recovered.body.data.expenses.filter((row) => row.title === 'Normal interrupted operation'),
  ).toHaveLength(1);
  const result = await api(page, path + '/balances?cycleId=' + cycle);
  expect(result.status).toBe(200);
  const identities = await Promise.all(
    [page, member, joiner].map(
      async (userPage) => (await api(userPage, '/auth/me')).body.data.user.id,
    ),
  );
  const sorted = [...identities].sort();
  for (const [i, user] of identities.entries()) {
    const share = sorted.indexOf(user) === 0 ? 3 : 2;
    expect(result.body.data.balances.members.find((row) => row.user === user)).toMatchObject({
      paidMinor: i === 0 ? 7 : i === 1 ? 300 : 0,
      assignedMinor: share + 100,
      netMinor: (i === 0 ? 7 : i === 1 ? 300 : 0) - share - 100,
    });
  }
  await recordBalance('after-authorized-recovery', result.body.data.balances);
  expect(result.body.data.balances.members.reduce((sum, row) => sum + row.netMinor, 0)).toBe(0);
  for (const headers of [
    { Origin: 'https://untrusted.invalid', 'X-CSRF-Protection': '1' },
    { Origin: 'http://localhost:5173' },
  ]) {
    const response = await page
      .context()
      .request.post('http://localhost:5500/api' + path + '/financial-recovery', {
        data: {},
        headers,
      });
    expect(response.status()).toBe(403);
  }
  const legacyAttempt = await api(
    page,
    path + '/expenses',
    'POST',
    {
      payer: identities[0],
      title: 'Legacy fallback attempt',
      amountMinor: 300,
      currency: 'INR',
      category: 'other',
      expenseDate: '2026-10-20T00:00:00.000Z',
      split: { method: 'equal', participants: sorted },
    },
    { 'Idempotency-Key': randomUUID() },
  );
  expect(legacyAttempt.status).toBe(409);
  expect(legacyAttempt.body.code).toBe('CYCLE_SELECTION_REQUIRED');
  expect(
    (await api(page, path + '/expenses?cycleId=' + cycle)).body.data.expenses.some(
      (row) => row.title === 'Legacy fallback attempt',
    ),
  ).toBe(false);
}

test('normal server full registered multi-user financial and security workflow', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  await writeFile(`${evidence}/normal-financial-balances.jsonl`, '');
  const emails = Object.fromEntries(
    ['owner', 'member', 'joiner'].map((role) => [role, `${role}-${randomUUID()}@test.invalid`]),
  );
  await register(page, 'Cycle owner', emails.owner);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Shared costs/ })).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.desktop-sidebar .brand-mark').evaluate((image) => image.naturalWidth),
    )
    .toBeGreaterThan(0);

  await page.goto('/app/groups');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toHaveCSS('clip-path', 'inset(50%)');
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Group name' })
    .fill('Disposable cycle group');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Disposable cycle group' })).toBeVisible();
  const groupId = new URL(page.url()).pathname.split('/')[3];
  const groupPath = `/groups/${groupId}`;
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await register(memberPage, 'Cycle member', emails.member);
  await expect(page.getByRole('button', { name: 'Open first cycle' })).toBeVisible();
  await lifecycle(page, 'Open first cycle');
  await expect(page.getByRole('heading', { name: 'Cycle 1', exact: true })).toBeVisible();
  const firstLink = await invite(page);
  await memberPage.goto(firstLink);
  await memberPage.getByRole('button', { name: 'Join group' }).click();
  await expect(memberPage.getByRole('alert')).toContainText('only after a cycle closes');
  await lifecycle(page, 'Freeze cycle');
  await lifecycle(page, 'Close cycle');
  await memberPage.reload();
  await memberPage.getByRole('button', { name: 'Join group' }).click();
  await expect(memberPage).toHaveURL(new RegExp(`/app/groups/${groupId}$`));
  await page.getByRole('button', { name: 'Refresh records' }).click();

  await lifecycle(page, 'Open next cycle');
  await expect(page.getByRole('heading', { name: 'Cycle 2', exact: true })).toBeVisible();
  const cycleId = (await api(page, groupPath + '/cycles')).body.data.group.currentCycleId;
  await expect(page.locator('.cycle-current time')).toContainText('UTC');
  await expect(page.locator('.cycle-current')).not.toContainText(/\d{4}-\d\d-\d\dT\d\d:/);

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `../output/playwright/ui-polish/normal-multiuser-${width}.png`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'expenses' })
    .click();
  await page.getByRole('button', { name: 'Add shared expense' }).click();
  const form = page.getByRole('dialog', { name: 'Add shared expense' });
  await form.getByRole('textbox', { name: 'Expense title' }).fill('Browser equal split');
  await form.getByRole('textbox', { name: 'Total amount (INR)' }).fill('100.01');
  await form.locator('#shared-date').fill('2026-10-17');
  await expect(form.getByRole('region', { name: 'Exact split preview' })).toContainText('₹50.01');
  await expect(form.getByRole('region', { name: 'Exact split preview' })).toContainText('₹50.00');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Browser equal split' })).toBeVisible();
  const initial = (await api(page, groupPath + '/expenses?cycleId=' + cycleId)).body.data.expenses;
  const equalRecord = initial.find((row) => row.title === 'Browser equal split');
  const ownerId = (await api(page, '/auth/me')).body.data.user.id;
  const memberId = (await api(memberPage, '/auth/me')).body.data.user.id;
  const remainderForOwner = ownerId < memberId;
  await balances(
    page,
    groupPath,
    cycleId,
    ownerId,
    memberId,
    10001,
    remainderForOwner ? 5001 : 5000,
  );
  const staleExpense = await api(page, groupPath + '/expenses/' + equalRecord.id);
  const changed = await api(
    page,
    groupPath + '/expenses/' + equalRecord.id,
    'PATCH',
    { title: equalRecord.title },
    { 'If-Match': staleExpense.headers.etag },
  );
  expect(changed.status).toBe(200);
  const stale = await api(
    page,
    groupPath + '/expenses/' + equalRecord.id,
    'PATCH',
    { title: 'Must never persist' },
    { 'If-Match': staleExpense.headers.etag },
  );
  expect(stale.status).toBe(412);
  expect(
    (
      await api(memberPage, groupPath + '/expenses/' + equalRecord.id, 'DELETE', undefined, {
        'If-Match': changed.headers.etag,
      })
    ).status,
  ).toBe(403);
  await page.getByRole('button', { name: 'Refresh records' }).click();

  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'balances' })
    .click();
  await expect(page.getByText('₹100.01').first()).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'expenses' })
    .click();
  await page.getByRole('button', { name: 'Add shared expense' }).click();
  const exact = page.getByRole('dialog', { name: 'Add shared expense' });
  await exact.getByRole('textbox', { name: 'Expense title' }).fill('Browser exact split');
  await exact.getByRole('textbox', { name: 'Total amount (INR)' }).fill('0.03');
  await exact.locator('#shared-date').fill('2026-10-17');
  await exact.getByLabel('Split method').selectOption('exact');
  await exact.getByRole('textbox', { name: 'Cycle owner amount (INR)' }).fill('0.01');
  await exact.getByRole('textbox', { name: 'Cycle member amount (INR)' }).fill('0.02');
  await expect(exact.getByRole('region', { name: 'Exact split preview' })).toContainText('₹0.02');
  await exact.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Browser exact split' })).toBeVisible();
  await balances(
    page,
    groupPath,
    cycleId,
    ownerId,
    memberId,
    10004,
    (remainderForOwner ? 5001 : 5000) + 1,
  );

  await page.getByRole('button', { name: 'Add shared expense' }).click();
  const percentage = page.getByRole('dialog', { name: 'Add shared expense' });
  await percentage.getByRole('textbox', { name: 'Expense title' }).fill('Browser percentage split');
  await percentage.getByRole('textbox', { name: 'Total amount (INR)' }).fill('0.03');
  await percentage.locator('#shared-date').fill('2026-10-17');
  await percentage.getByLabel('Split method').selectOption('percentage');
  await percentage.getByRole('textbox', { name: 'Cycle owner percentage' }).fill('50');
  await percentage.getByRole('textbox', { name: 'Cycle member percentage' }).fill('50');
  await expect(percentage.getByRole('region', { name: 'Exact split preview' })).toContainText(
    '₹0.02',
  );
  await percentage.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Browser percentage split' })).toBeVisible();
  await balances(
    page,
    groupPath,
    cycleId,
    ownerId,
    memberId,
    10007,
    (remainderForOwner ? 5001 : 5000) + (remainderForOwner ? 3 : 2),
  );

  const exactRow = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Browser exact split' }) });
  await exactRow.getByRole('button', { name: 'Edit expense' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit shared expense' });
  await edit.getByRole('textbox', { name: 'Expense title' }).fill('Browser exact split updated');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Browser exact split updated' })).toBeVisible();
  await balances(
    page,
    groupPath,
    cycleId,
    ownerId,
    memberId,
    10007,
    (remainderForOwner ? 5001 : 5000) + (remainderForOwner ? 3 : 2),
  );

  const updatedRow = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Browser exact split updated' }) });
  await updatedRow.getByRole('button', { name: 'Delete expense' }).click();
  await page
    .getByRole('dialog', { name: 'Delete expense' })
    .getByRole('button', { name: 'Delete expense' })
    .click();
  await expect(page.getByRole('heading', { name: 'Browser exact split updated' })).toHaveCount(0);
  await balances(
    page,
    groupPath,
    cycleId,
    ownerId,
    memberId,
    10004,
    (remainderForOwner ? 5001 : 5000) + (remainderForOwner ? 2 : 1),
  );

  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'invitations' })
    .click();
  await page.getByRole('button', { name: 'Generate invitation' }).click();
  await page
    .getByRole('dialog', { name: 'Generate invitation' })
    .getByRole('button', { name: 'Save' })
    .click();
  const link = await page.getByRole('textbox', { name: 'One-time invitation link' }).inputValue();
  expect(link).toMatch(/\/app\/join\/[A-Za-z0-9_-]+$/);

  const joinerContext = await browser.newContext();
  const joiner = await joinerContext.newPage();
  await register(joiner, 'Cycle joiner', emails.joiner);
  expect((await api(joiner, groupPath + '/expenses?cycleId=' + cycleId)).status).toBe(404);
  expect((await api(joiner, groupPath + '/financial-recovery', 'POST', {})).status).toBe(404);
  await joiner.goto(link);
  await joiner.getByRole('button', { name: 'Join group' }).click();
  await expect(joiner.getByRole('alert')).toContainText('only after a cycle closes');

  await signIn(memberPage, emails.member);
  await memberPage.getByRole('link').filter({ hasText: 'Disposable cycle group' }).click();
  await memberPage
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'balances' })
    .click();
  await memberPage.getByRole('button', { name: 'Review proposal' }).click();
  const proposal = memberPage.getByRole('dialog', { name: 'Propose settlement' });
  await expect(proposal).toContainText('permanently freezes');
  await proposal.getByRole('checkbox').check();
  await proposal.getByRole('button', { name: 'Save' }).click();
  await expect(memberPage.locator('.cycle-current')).toContainText('frozen');
  await expect(memberPage.getByRole('button', { name: 'Propose settlement' })).toBeDisabled();
  const pending = (
    await api(page, groupPath + '/settlements?cycleId=' + cycleId)
  ).body.data.settlements.find((row) => row.status === 'pending');
  expect(
    (
      await api(
        memberPage,
        groupPath + '/settlements/' + pending.id + '/confirm',
        'POST',
        {},
        { 'If-Match': `"tn-${pending.id}-v${pending.version}"` },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await api(
        memberPage,
        groupPath + '/settlements',
        'POST',
        { cycleId, recipient: ownerId, amountMinor: 1 },
        { 'Idempotency-Key': randomUUID() },
      )
    ).body.code,
  ).toBe('SETTLEMENT_EXCESS');
  const pendingBalances = (await api(page, groupPath + '/balances?cycleId=' + cycleId)).body.data
    .balances;
  expect(pendingBalances.members.find((row) => row.user === memberId).pendingSentMinor).toBe(
    pending.amountMinor,
  );
  expect(pendingBalances.members.find((row) => row.user === ownerId).pendingReceivedMinor).toBe(
    pending.amountMinor,
  );
  expect(
    (
      await api(
        page,
        groupPath + '/expenses/' + equalRecord.id,
        'PATCH',
        { title: 'Frozen edit' },
        { 'If-Match': changed.headers.etag },
      )
    ).body.code,
  ).toBe('EXPENSES_FROZEN');

  await page.getByRole('button', { name: 'Refresh records' }).click();
  await expect(page.locator('.cycle-current')).toContainText('frozen');
  const pendingClose = page.waitForResponse(
    (row) => row.url().endsWith('/close') && row.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Close cycle' }).click();
  await page
    .getByRole('dialog', { name: 'Close cycle' })
    .getByRole('button', { name: 'Close cycle' })
    .click();
  expect((await (await pendingClose).json()).code).toBe('CYCLE_PENDING_SETTLEMENTS');
  await expect(page.getByRole('dialog', { name: 'Close cycle' })).toContainText(
    /pending|zero|reconciled/i,
  );
  await page
    .getByRole('dialog', { name: 'Close cycle' })
    .getByRole('button', { name: 'Cancel' })
    .click();

  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'settlements' })
    .click();
  await page.getByRole('button', { name: 'Reject settlement' }).click();
  await page
    .getByRole('dialog', { name: 'Reject settlement' })
    .getByRole('button', { name: 'Reject settlement' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Reject settlement' })).toHaveCount(0);
  const unsettledClose = page.waitForResponse(
    (row) => row.url().endsWith('/close') && row.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Close cycle' }).click();
  await page
    .getByRole('dialog', { name: 'Close cycle' })
    .getByRole('button', { name: 'Close cycle' })
    .click();
  expect((await (await unsettledClose).json()).code).toBe('CYCLE_NOT_SETTLED');
  await expect(page.getByRole('dialog', { name: 'Close cycle' })).toContainText(/zero|balance/i);
  await page
    .getByRole('dialog', { name: 'Close cycle' })
    .getByRole('button', { name: 'Cancel' })
    .click();

  await memberPage.getByRole('button', { name: 'Refresh records' }).click();
  await memberPage.getByRole('button', { name: 'Review proposal' }).click();
  await memberPage
    .getByRole('dialog', { name: 'Propose settlement' })
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(memberPage.getByRole('dialog', { name: 'Propose settlement' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh records' }).click();
  await expect(page.getByRole('button', { name: 'Confirm settlement' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recover pending operation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm settlement' }).click();
  await page
    .getByRole('dialog', { name: 'Confirm settlement' })
    .getByRole('button', { name: 'Confirm settlement' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Confirm settlement' })).toHaveCount(0);
  const zero = (await api(page, groupPath + '/balances?cycleId=' + cycleId)).body.data.balances;
  expect(zero.netTotalMinor).toBe(0);
  expect(zero.members.map((row) => row.netMinor)).toEqual([0, 0]);
  const historicalExpenses = (await api(page, groupPath + '/expenses?cycleId=' + cycleId)).body.data
    .expenses;
  const historicalSettlements = (await api(page, groupPath + '/settlements?cycleId=' + cycleId))
    .body.data.settlements;
  await recordBalance('confirmed-zero', zero);
  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'balances' })
    .click();
  await screenshot(page, 'normal-multiuser-zero-balances', true);

  await page.getByRole('button', { name: 'Close cycle' }).click();
  await page
    .getByRole('dialog', { name: 'Close cycle' })
    .getByRole('button', { name: 'Close cycle' })
    .click();
  await expect(page.locator('.cycle-current')).toContainText('closed');

  await joiner.reload();
  await joiner.getByRole('button', { name: 'Join group' }).click();
  await expect(joiner).toHaveURL(/\/app\/groups\/[a-f0-9]{24}$/);
  await page.getByRole('button', { name: 'Open next cycle' }).click();
  await page
    .getByRole('dialog', { name: 'Open next cycle' })
    .getByRole('button', { name: 'Open next cycle' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Open next cycle' })).toContainText(
    'versions are stale',
  );
  await page
    .getByRole('dialog', { name: 'Open next cycle' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await page.getByRole('button', { name: 'Refresh records' }).click();
  await page.getByRole('button', { name: 'Open next cycle' }).click();
  await page
    .getByRole('dialog', { name: 'Open next cycle' })
    .getByRole('button', { name: 'Open next cycle' })
    .click();
  await expect(page.getByRole('heading', { name: 'Cycle 3', exact: true })).toBeVisible();
  const nextCycleId = (await api(page, groupPath + '/cycles')).body.data.group.currentCycleId;
  const freshBalances = (await api(page, groupPath + '/balances?cycleId=' + nextCycleId)).body.data
    .balances;
  expect(freshBalances.members).toHaveLength(3);
  expect(freshBalances.members.map((row) => row.netMinor)).toEqual([0, 0, 0]);
  await recordBalance('next-cycle-initial-zero', freshBalances);

  await page.getByRole('button', { name: /Cycle 2 closed/ }).click();
  await expect(page.getByText('This is read-only history.')).toBeVisible();
  expect((await api(page, groupPath + '/cycles')).body.data.group.currentCycleId).toBe(nextCycleId);
  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'expenses' })
    .click();
  await expect(page.getByRole('button', { name: 'Add shared expense' })).toBeDisabled();

  await page
    .getByRole('region', { name: 'Cycle history' })
    .getByRole('button', { name: /Cycle 3 open/ })
    .click();
  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'expenses' })
    .click();
  await page.getByRole('button', { name: 'Add shared expense' }).click();
  const nextExpense = page.getByRole('dialog', { name: 'Add shared expense' });
  await nextExpense
    .getByRole('textbox', { name: 'Expense title' })
    .fill('Cycle 3 persisted intent');
  await nextExpense.getByRole('textbox', { name: 'Total amount (INR)' }).fill('0.07');
  await nextExpense.locator('#shared-date').fill('2026-10-17');
  let originalKey;
  const dropAck = async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    originalKey = route.request().headers()['idempotency-key'];
    expect(route.request().headers()['x-csrf-protection']).toBe('1');
    expect(route.request().postDataJSON().cycleId).toMatch(/^[a-f0-9]{24}$/);
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort('failed');
    await page.unroute('**/api/groups/*/expenses', dropAck);
  };
  await page.route('**/api/groups/*/expenses', dropAck);
  await nextExpense.getByRole('button', { name: 'Save' }).click();
  await expect(nextExpense).toContainText('may already exist');
  const replayKey = [];
  const inspectReplay = async (route) => {
    if (route.request().method() === 'POST')
      replayKey.push(route.request().headers()['idempotency-key']);
    await route.continue();
  };
  await page.route('**/api/groups/*/expenses', inspectReplay);
  await nextExpense.getByRole('button', { name: 'Retry same submission' }).click();
  await expect(
    page.getByText('Original intent reconciled without creating a duplicate.'),
  ).toBeVisible();
  expect(replayKey).toEqual([originalKey]);
  await page.unroute('**/api/groups/*/expenses', inspectReplay);
  await expect(page.getByRole('heading', { name: 'Cycle 3 persisted intent' })).toHaveCount(1);
  const activeId = (await api(page, groupPath + '/cycles')).body.data.group.currentCycleId;
  expect(
    (await api(page, groupPath + '/expenses?cycleId=' + activeId)).body.data.expenses.filter(
      (row) => row.title === 'Cycle 3 persisted intent',
    ),
  ).toHaveLength(1);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cycle 3', exact: true })).toBeVisible();

  await joiner.reload();
  await joiner
    .getByRole('region', { name: 'Cycle history' })
    .getByRole('button', { name: /Cycle 2 closed/ })
    .click();
  await joiner
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'balances' })
    .click();
  await expect(joiner.getByText(/joined after this cycle.*snapshot/i)).toBeVisible();
  await expect(joiner.getByText(/The record needs a current version/)).toHaveCount(0);
  await expect(joiner.getByRole('button', { name: 'Reload records' })).toHaveCount(0);
  expect((await api(joiner, groupPath + '/balances?cycleId=' + cycleId)).status).toBe(409);
  expect(
    (await api(joiner, groupPath + '/expenses?cycleId=' + cycleId)).body.data.expenses,
  ).toEqual(historicalExpenses);
  expect((await api(joiner, groupPath + '/expenses/' + equalRecord.id)).status).toBe(200);
  expect((await api(page, groupPath + '/expenses?cycleId=' + cycleId)).body.data.expenses).toEqual(
    historicalExpenses,
  );
  expect(
    (await api(page, groupPath + '/settlements?cycleId=' + cycleId)).body.data.settlements,
  ).toEqual(historicalSettlements);
  expect(
    (
      await api(page, groupPath + '/expenses/' + equalRecord.id, 'DELETE', undefined, {
        'If-Match': changed.headers.etag,
      })
    ).status,
  ).toBe(409);
  await screenshot(joiner, 'normal-late-joiner-history', true);
  await interruptedOperation(page, memberPage, joiner, groupPath, groupId);
  for (const route of [
    '/app',
    '/app/transactions',
    '/app/budgets',
    '/app/recurring',
    '/app/groups',
    groupPath.replace('/groups/', '/app/groups/'),
  ]) {
    await page.goto(route);
    await expect(page.locator('#main-content').getByRole('heading', { level: 1 })).toBeVisible();
  }
  // Exhaust only the joiner's authenticated bucket; another user must still work.
  let limited;
  for (let i = 0; i < 301; i++) {
    limited = await api(joiner, groupPath + '/cycles');
    if (limited.status === 429) break;
  }
  expect(limited.status).toBe(429);
  expect(limited.body.code).toBe('RATE_LIMITED');
  expect((await api(page, groupPath + '/cycles')).status).toBe(200);
  for (const path of [
    '/transactions',
    '/budgets?month=2026-10',
    '/recurring',
    groupPath + '/cycles',
  ]) {
    const response = await api(page, path);
    expect(response.status, path).toBe(200);
    expect(response.headers['cache-control'], path).toBe('no-store');
  }

  await memberContext.clearCookies();
  await memberPage.reload();
  await expect(memberPage).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Cycle 3', exact: true })).toBeVisible();

  await memberContext.close();
  await joinerContext.close();
});
