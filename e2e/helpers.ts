import { expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const pad = (n: number) => String(n).padStart(2, '0');

/** DD/MM/YYYY for a date `daysAgo` days before today. */
export function auDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** YYYY-MM-DD for a date `daysAgo` days before today. */
export function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A made-up statement in CommBank's CSV layout (date, amount, description,
 * balance), dated relative to today so "this month" always has data.
 */
export function statementCsv(path: string): { rows: number; closing: number } {
  const items: [number, number, string][] = [
    // [days ago, amount, description]
    ...[185, 155, 125].map((d): [number, number, string] => [d, -102.95, 'Direct Debit 123456 BUDGET DIRECT']),
    ...[95, 65, 35, 5].map((d): [number, number, string] => [d, -108.84, 'Direct Debit 123456 BUDGET DIRECT']),
    ...[170, 140, 110, 80, 50, 20].map((d): [number, number, string] => [d, -19.99, 'NETFLIX.COM SYDNEY']),
    ...[160, 130, 100, 70, 40, 10].map((d): [number, number, string] => [d, 3000, 'ACME PTY LTD SALARY']),
    ...([[38, -41.2], [31, -150.75], [24, -88.1], [17, -62.4], [10, -131.05], [3, -57.3]] as [number, number][]).map(
      ([d, a]): [number, number, string] => [d, a, `WOOLWORTHS ${4000 + d} PERTH AU`],
    ),
    [13, -12, 'LOCAL SPORTS CLUB 001'],
    [6, -12, 'LOCAL SPORTS CLUB 002'],
    [4, -6.5, 'THE CORNER CAFE PERTH'],
  ];
  items.sort((a, b) => b[0] - a[0]); // oldest first
  let balance = 5000;
  const lines = items.map(([d, amount, desc]) => {
    balance = Math.round((balance + amount) * 100) / 100;
    return `${auDate(d)},"${amount.toFixed(2)}","${desc}","+${balance.toFixed(2)}"`;
  });
  writeFileSync(path, lines.join('\n') + '\n');
  return { rows: items.length, closing: balance };
}

export async function openApp(page: Page) {
  page.on('dialog', (d) => void d.accept());
  await page.goto('./');
  await expect(page.getByText('Welcome')).toBeVisible();
}

export async function tab(page: Page, name: 'Home' | 'Transactions' | 'Insights' | 'Import' | 'Settings') {
  await page.locator('.bottom-nav').getByText(name, { exact: true }).click();
}

/** Import a CSV file through the mapping and review screens and save it. */
export async function importCsv(page: Page, file: string, { save = true } = {}) {
  await tab(page, 'Import');
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('CSV file').click();
  await (await chooser).setFiles(file);
  await expect(page.getByText('Map CSV columns')).toBeVisible();
  await page.locator('.action-bar .btn.primary').click();
  await expect(page.getByText('Review import')).toBeVisible();
  if (save) {
    await page.locator('.action-bar .btn.primary').click();
    await expect(page.locator('.tx-list')).toBeVisible();
  }
}

/** "Description -> Category" for each visible transaction row. */
export function rows(page: Page): Promise<string[]> {
  return page
    .locator('.tx-row')
    .evaluateAll((els) =>
      els.map((e) => `${e.querySelector('.tx-desc')!.textContent} -> ${e.querySelector('.tx-cat')!.textContent}`),
    );
}

/** Open a transaction, pick a category from the list and save (the apply sheet then opens). */
export async function pickCategory(page: Page, description: string, category: string) {
  await page.locator('.tx-row', { hasText: description }).first().click();
  await page.locator('.sheet .field', { hasText: 'Category' }).locator('select').selectOption({ label: category });
  await page.locator('.sheet-foot').getByText('Save').click();
}
