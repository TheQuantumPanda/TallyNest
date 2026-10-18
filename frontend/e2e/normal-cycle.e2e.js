import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const password = process.env.TALLYNEST_NORMAL_E2E_PASSWORD;
if (!password) throw new Error('Disposable normal-app browser password is required');

test('normal app registers, creates a v2 group, opens and closes cycles, and keeps personal pages available', async ({
  page,
}) => {
  const email = `normal-${randomUUID()}@test.invalid`;
  await page.goto('/register');
  await page.getByRole('textbox', { name: 'Full name' }).fill('Normal Browser Owner');
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app/);

  await page.goto('/app/groups');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Create group' });
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

  await page.getByRole('button', { name: 'Freeze cycle' }).click();
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

  for (const route of ['/app', '/app/transactions', '/app/budgets', '/app/recurring']) {
    await page.goto(route);
    await expect(page.locator('#main-content')).toBeVisible();
  }
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
  }
});
