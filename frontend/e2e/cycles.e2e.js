import { test, expect } from '@playwright/test';

const password = process.env.TALLYNEST_CYCLE_E2E_PASSWORD;
if (!password) throw new Error('Disposable browser password is required');

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/groups/);
}

test('a group created in the disposable cycle workspace opens its cycle history', async ({
  page,
}) => {
  await signIn(page, 'cycle-owner@test.invalid');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Create group' });
  await form.getByRole('textbox', { name: 'Group name' }).fill('Browser-created cycle group');
  const responsePromise = page.waitForResponse((row) =>
    /\/api\/groups\/[a-f0-9]{24}\/cycles\?limit=20$/.test(row.url()),
  );
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Browser-created cycle group' })).toBeVisible();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    status: 'ok',
    apiVersion: 2,
    data: { cycles: [], group: { currentCycleId: null, currentCycleState: null, epoch: 0 } },
    pagination: { limit: 20, hasMore: false, nextAfter: null },
  });
  await expect(page.getByRole('button', { name: 'Open first cycle' })).toBeVisible();
});

test('disposable cycle UI restores a session, keeps keyboard access, and renders at four widths', async ({
  page,
  browser,
}) => {
  await signIn(page, 'cycle-owner@test.invalid');
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

  await page.getByRole('link').filter({ hasText: 'Disposable cycle group' }).click();
  await expect(page.getByRole('button', { name: 'Open first cycle' })).toBeVisible();
  await page.getByRole('button', { name: 'Open first cycle' }).click();
  await expect(page.getByRole('dialog')).toContainText('zero recorded positions');
  await page.getByRole('dialog').getByRole('button', { name: 'Open first cycle' }).click();
  await expect(page.getByRole('heading', { name: 'Cycle 1', exact: true })).toBeVisible();
  await expect(page.locator('.cycle-current time')).toContainText('UTC');
  await expect(page.locator('.cycle-current')).not.toContainText(/\d{4}-\d\d-\d\dT\d\d:/);

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `../output/playwright/cycle-step3h-${width}.png`,
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

  const exactRow = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Browser exact split' }) });
  await exactRow.getByRole('button', { name: 'Edit expense' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit shared expense' });
  await edit.getByRole('textbox', { name: 'Expense title' }).fill('Browser exact split updated');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Browser exact split updated' })).toBeVisible();
  const updatedRow = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Browser exact split updated' }) });
  await updatedRow.getByRole('button', { name: 'Delete expense' }).click();
  await page
    .getByRole('dialog', { name: 'Delete expense' })
    .getByRole('button', { name: 'Delete expense' })
    .click();
  await expect(page.getByRole('heading', { name: 'Browser exact split updated' })).toHaveCount(0);

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
  await signIn(joiner, 'cycle-joiner@test.invalid');
  await joiner.goto(link);
  await joiner.getByRole('button', { name: 'Join group' }).click();
  await expect(joiner.getByRole('alert')).toContainText('only after a cycle closes');

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await signIn(memberPage, 'cycle-member@test.invalid');
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

  await page.getByRole('button', { name: 'Refresh records' }).click();
  await expect(page.locator('.cycle-current')).toContainText('frozen');
  await page.getByRole('button', { name: 'Close cycle' }).click();
  await page
    .getByRole('dialog', { name: 'Close cycle' })
    .getByRole('button', { name: 'Close cycle' })
    .click();
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
  await page.getByRole('button', { name: 'Close cycle' }).click();
  await page
    .getByRole('dialog', { name: 'Close cycle' })
    .getByRole('button', { name: 'Close cycle' })
    .click();
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
  await page.getByRole('button', { name: 'Refresh records' }).click();
  await page.getByRole('button', { name: 'Confirm settlement' }).click();
  await page
    .getByRole('dialog', { name: 'Confirm settlement' })
    .getByRole('button', { name: 'Confirm settlement' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Confirm settlement' })).toHaveCount(0);
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
  await expect(page.getByRole('heading', { name: 'Cycle 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Cycle 1 closed/ }).click();
  await expect(page.getByText('This is read-only history.')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'expenses' })
    .click();
  await expect(page.getByRole('button', { name: 'Add shared expense' })).toBeDisabled();

  await page
    .getByRole('region', { name: 'Cycle history' })
    .getByRole('button', { name: /Cycle 2 open/ })
    .click();
  await page
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'expenses' })
    .click();
  await page.getByRole('button', { name: 'Add shared expense' }).click();
  const nextExpense = page.getByRole('dialog', { name: 'Add shared expense' });
  await nextExpense
    .getByRole('textbox', { name: 'Expense title' })
    .fill('Cycle 2 persisted intent');
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
  await expect(page.getByRole('heading', { name: 'Cycle 2 persisted intent' })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cycle 2', exact: true })).toBeVisible();

  await joiner.reload();
  await joiner
    .getByRole('region', { name: 'Cycle history' })
    .getByRole('button', { name: /Cycle 1 closed/ })
    .click();
  await joiner
    .getByRole('navigation', { name: 'Cycle sections' })
    .getByRole('button', { name: 'balances' })
    .click();
  await expect(joiner.getByText(/joined after this cycle.*snapshot/i)).toBeVisible();

  await memberContext.clearCookies();
  await memberPage.reload();
  await expect(memberPage).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Cycle 2', exact: true })).toBeVisible();

  await memberContext.close();
  await joinerContext.close();
});
