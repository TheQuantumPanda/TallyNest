import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

const evidence = '../output/playwright/ui-polish';
async function screenshot(page, name) {
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
  await page.screenshot({ path: `${evidence}/${name}.png` });
}
async function centered(page, dialog) {
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox();
      const view = page.viewportSize();
      return Math.max(
        Math.abs(box.x + box.width / 2 - view.width / 2),
        Math.abs(box.y + box.height / 2 - view.height / 2),
      );
    })
    .toBeLessThan(2);
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(box.height).toBeLessThanOrEqual(page.viewportSize().height);
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
});
