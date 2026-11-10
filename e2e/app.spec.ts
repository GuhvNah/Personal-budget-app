import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { importCsv, isoDate, openApp, pickCategory, rows, statementCsv, tab } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('imports a statement, categorises it and skips duplicates on re-import', async ({ page }, info) => {
  const file = info.outputPath('statement.csv');
  const { rows: count } = statementCsv(file);

  await importCsv(page, file, { save: false });
  await expect(page.locator('.review-summary')).toContainText(`${count} to save`);
  await page.locator('.action-bar .btn.primary').click();
  await expect(page.locator('.result-summary')).toContainText(`${count} transactions`);

  const list = await rows(page);
  expect(list.find((r) => r.startsWith('Direct Debit 123456 BUDGET DIRECT'))).toContain('Insurance');
  expect(list.find((r) => r.startsWith('NETFLIX'))).toContain('Entertainment');
  expect(list.find((r) => r.startsWith('ACME PTY LTD SALARY'))).toContain('Income');
  expect(list.find((r) => r.startsWith('LOCAL SPORTS CLUB'))).toContain('Uncategorised');

  await importCsv(page, file, { save: false });
  await expect(page.locator('.review-summary')).toContainText(`0 to save · ${count} duplicates skipped`);
});

test('home shows budget pace and the outgoings chart', async ({ page }, info) => {
  const file = info.outputPath('statement.csv');
  statementCsv(file);
  await importCsv(page, file);

  await tab(page, 'Settings');
  const groceries = page.locator('.budget-edit', { hasText: 'Groceries' }).locator('input');
  await groceries.fill('600');
  await groceries.press('Enter');
  await expect(page.locator('.toast')).toContainText('Groceries budget saved');

  await tab(page, 'Home');
  await expect(page.locator('.pace-summary')).toContainText(/of your budgets left|over your budgets/);
  await expect(page.locator('.budget-row', { hasText: 'Groceries' })).toContainText(/to go|Over by/);
  await expect(page.locator('.outgoings .donut svg')).toBeVisible();
});

test('insights: balances, regular payments, trends and a savings goal', async ({ page }, info) => {
  const file = info.outputPath('statement.csv');
  const { closing } = statementCsv(file);
  await importCsv(page, file);
  await tab(page, 'Insights');

  const money = closing.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
  const balances = page.locator('.card', { hasText: 'Account balances' });
  await expect(balances.locator('.row-btn').first()).toContainText(money);
  await expect(balances.locator('.balance-chart svg')).toBeVisible();

  const regular = page.locator('.card', { hasText: 'Regular payments' });
  const insurer = regular.locator('.recurring-row', { hasText: 'BUDGET DIRECT' });
  await expect(insurer).toContainText('Monthly');
  await expect(insurer).toContainText('$108.84');
  await expect(insurer).toContainText('Went up from $102.95');
  await expect(regular.locator('.recurring-row', { hasText: 'NETFLIX' })).toContainText('Monthly');
  await expect(regular.locator('.recurring-row', { hasText: 'WOOLWORTHS' })).toHaveCount(0);

  await expect(page.locator('.card', { hasText: 'Trends by category' }).locator('.row-btn').first()).toBeVisible();

  await page.getByText('Add a goal').click();
  await page.locator('.sheet .field', { hasText: 'Name' }).locator('input').fill('Emergency buffer');
  await page.locator('.sheet .field', { hasText: 'Target balance' }).locator('input').fill('50000');
  await page.locator('.sheet-foot').getByText('Save').click();
  const goal = page.locator('.goal-row', { hasText: 'Emergency buffer' });
  await expect(goal).toContainText('/ $50,000');
  await expect(goal).toContainText('to go');
});

test('bulk changes can be undone', async ({ page }, info) => {
  const file = info.outputPath('statement.csv');
  statementCsv(file);
  await importCsv(page, file);

  // Picking a category for one sports club payment also categorises the other one.
  await page.locator('input[type=search]').fill('sports');
  await pickCategory(page, 'LOCAL SPORTS CLUB 001', 'Entertainment');
  await expect(page.locator('.toast')).toContainText('1 similar categorised too');
  await expect(page.getByText('Apply to other transactions?')).toBeVisible();
  await page.locator('.sheet-foot').getByText('Skip').click();
  expect(await rows(page)).toEqual([
    'LOCAL SPORTS CLUB 002 -> Entertainmentauto',
    'LOCAL SPORTS CLUB 001 -> Entertainment',
  ]);

  // Undo puts both back as they were.
  await page.locator('.toast-action').click();
  await expect(page.locator('.toast')).toContainText('Undone');
  expect(await rows(page)).toEqual([
    'LOCAL SPORTS CLUB 002 -> Uncategorised',
    'LOCAL SPORTS CLUB 001 -> Uncategorised',
  ]);

  // A rule applied to existing transactions can be undone as well.
  await tab(page, 'Settings');
  await page.locator('.add-rule input').fill('sports club');
  await page.locator('.add-rule select').selectOption({ label: 'Entertainment' });
  await page.locator('.add-rule').getByText('Add rule').click();
  await expect(page.locator('.toast')).toContainText('Updated 2 transactions');
  await page.locator('.toast-action').click();
  await expect(page.locator('.toast')).toContainText('Undone');
  await expect(page.locator('.rule-row', { hasText: 'sports club' })).toHaveCount(0);
  await tab(page, 'Transactions');
  await page.locator('input[type=search]').fill('sports');
  expect(await rows(page)).toEqual([
    'LOCAL SPORTS CLUB 002 -> Uncategorised',
    'LOCAL SPORTS CLUB 001 -> Uncategorised',
  ]);

  // Deleting a transaction can be undone too.
  await page.locator('.tx-row', { hasText: 'LOCAL SPORTS CLUB 002' }).click();
  await page.locator('.sheet-foot').getByText('Delete').click();
  await expect(page.locator('.tx-row')).toHaveCount(1);
  await page.locator('.toast-action').click();
  await expect(page.locator('.tx-row')).toHaveCount(2);
});

test('captured purchases: pending, replaced by a statement, and stale ones flagged', async ({ page }, info) => {
  await tab(page, 'Settings');
  const link = page.locator('.capture-link');
  await expect(link).toContainText('#capture=');
  const key = /capture=(\w+)/.exec((await link.textContent())!)![1];

  await page.goto(`./#capture=${key}&t=ALDI Midland&b=$12.50 with Visa •• 1234`);
  await expect(page.locator('.toast')).toContainText('Captured $12.50 at ALDI Midland');
  await page.evaluate((k) => {
    location.hash = `capture=${k}&t=Bunnings&b=$45.00 with Visa •• 1234`;
  }, key);
  await expect(page.locator('.toast')).toContainText('Captured $45.00 at Bunnings');

  // A statement containing the ALDI purchase replaces the pending one.
  const file = info.outputPath('stmt.csv');
  const d = new Date();
  const today = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  writeFileSync(file, `${today},"-12.50","ALDI STORES MIDLAND AU","+987.50"\n`);
  await importCsv(page, file, { save: false });
  await expect(page.locator('.review-row')).toContainText('Replaces pending “ALDI Midland”');
  await page.locator('.action-bar .btn.primary').click();
  await expect(page.locator('.tx-list')).toBeVisible();
  expect((await rows(page)).filter((r) => /aldi/i.test(r))).toEqual(['ALDI STORES MIDLAND AU -> Groceries']);

  // Make the Bunnings capture 20 days old: it should be flagged as stale.
  await page.locator('.tx-row', { hasText: 'Bunnings' }).click();
  await page.locator('.sheet input[type=date]').fill(isoDate(20));
  await page.locator('.sheet-foot').getByText('Save').click();
  const banner = page.locator('.review-banner.stale');
  await expect(banner).toContainText('1 old pending purchase to check');
  await banner.click();
  await page.locator('.sheet').getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Kept 1 purchase');
  await expect(banner).toHaveCount(0);
  await expect(page.locator('.tx-row', { hasText: 'Bunnings' })).not.toContainText('pending');
});

test('exports transactions as CSV', async ({ page }, info) => {
  const file = info.outputPath('statement.csv');
  const { rows: count } = statementCsv(file);
  await importCsv(page, file);

  await page.locator('input[type=search]').fill('netflix');
  const download = page.waitForEvent('download');
  await page.getByText('Export CSV').click();
  const saved = info.outputPath('export.csv');
  await (await download).saveAs(saved);
  const lines = readFileSync(saved, 'utf8').replace(/^﻿/, '').trim().split('\r\n');
  expect(lines[0]).toBe('Date,Description,Amount,Category,Type,Necessary,Account,Balance,Status,Notes');
  expect(lines).toHaveLength(1 + 6);
  expect(lines[1]).toContain('NETFLIX.COM SYDNEY,-19.99,Entertainment,Spending,unnecessary');
  expect(count).toBeGreaterThan(6);
});

test('app lock: PIN', async ({ page }) => {
  await tab(page, 'Settings');
  await page.getByLabel('PIN lock').click();
  await page.locator('.sheet .field', { hasText: 'New PIN (4' }).locator('input').fill('2580');
  await page.locator('.sheet .field', { hasText: 'New PIN again' }).locator('input').fill('2580');
  await page.locator('.sheet-foot').getByText('Save PIN').click();
  await expect(page.locator('.toast')).toContainText('PIN lock turned on');

  await page.reload();
  const lock = page.locator('.lock-screen');
  await expect(lock).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('inert', '');

  await lock.getByLabel('PIN').fill('1111');
  await lock.getByText('Unlock', { exact: true }).click();
  await expect(lock).toContainText('Wrong PIN');

  await lock.getByLabel('PIN').fill('2580');
  await lock.getByText('Unlock', { exact: true }).click();
  await expect(lock).toHaveCount(0);
  await expect(page.locator('.bottom-nav')).toBeVisible();

  // Removing the PIN needs the current PIN, and turns the lock off.
  await tab(page, 'Settings');
  await page.getByLabel('PIN lock').click();
  await page.locator('.sheet .field', { hasText: 'Current PIN' }).locator('input').fill('2580');
  await page.locator('.sheet-foot').getByText('Remove PIN').click();
  await expect(page.locator('.toast')).toContainText('PIN removed');
  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect(page.locator('.lock-screen')).toHaveCount(0);
});

test('app lock: fingerprint (simulated authenticator)', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.reload();
  await tab(page, 'Settings');
  await page.getByLabel('Fingerprint unlock').click();
  await expect(page.locator('.toast')).toContainText('Fingerprint unlock turned on');

  // On reopening, the fingerprint is asked for straight away and unlocks the app.
  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect(page.locator('.lock-screen')).toHaveCount(0);
  expect(await page.evaluate(() => !!JSON.parse(localStorage.getItem('budget-lock')!).credentialId)).toBe(true);
});

test.describe('upgrading from an earlier version', () => {
  test('keeps existing data when the database layout is upgraded', async ({ page }) => {
    // The shared beforeEach has created a fresh database: replace it with one in the
    // previous layout (version 1, no "goals" store), as an existing install would have.
    await page.goto('./manifest.webmanifest');
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const del = indexedDB.deleteDatabase('guhvnah-budget');
          del.onerror = () => reject(del.error);
          del.onsuccess = () => {
            const open = indexedDB.open('guhvnah-budget', 1);
            open.onupgradeneeded = () => {
              const db = open.result;
              db.createObjectStore('accounts', { keyPath: 'id' });
              const t = db.createObjectStore('transactions', { keyPath: 'id' });
              t.createIndex('byDate', 'date');
              t.createIndex('byDedupe', 'dedupeKey');
              t.createIndex('byCategory', 'categoryId');
              db.createObjectStore('categories', { keyPath: 'id' });
              db.createObjectStore('rules', { keyPath: 'id' });
              db.createObjectStore('budgets', { keyPath: 'categoryId' });
              db.createObjectStore('settings', { keyPath: 'key' });
              const tx = open.transaction!;
              tx.objectStore('accounts').put({ id: 'acc', name: 'Old Offset', createdAt: 1 });
              tx.objectStore('categories').put({ id: 'groc', name: 'Groceries', kind: 'expense', order: 0 });
              tx.objectStore('budgets').put({ categoryId: 'groc', amount: 45000 });
              tx.objectStore('rules').put({ id: 'r1', pattern: 'ALDI', categoryId: 'groc', createdAt: 1 });
              tx.objectStore('transactions').put({
                id: 't1',
                accountId: 'acc',
                date: '2026-01-02',
                description: 'ALDI STORES OLD DATA',
                amount: -4321,
                balance: 500000,
                categoryId: 'groc',
                dedupeKey: 'k1',
                source: 'pdf',
                createdAt: 1,
              });
            };
            open.onsuccess = () => {
              open.result.close();
              resolve();
            };
            open.onerror = () => reject(open.error);
          };
        }),
    );

    await page.goto('./');
    await tab(page, 'Transactions');
    expect(await rows(page)).toEqual(['ALDI STORES OLD DATA -> Groceries']);
    await tab(page, 'Settings');
    await expect(page.locator('.rule-row', { hasText: 'ALDI' })).toBeVisible();
    await expect(page.locator('.budget-edit', { hasText: 'Groceries' }).locator('input')).toHaveValue('450.00');

    // The new savings goals store exists and works alongside the old data.
    await tab(page, 'Insights');
    await expect(page.locator('.card', { hasText: 'Account balances' })).toContainText('$5,000.00');
    await page.getByText('Add a goal').click();
    await page.locator('.sheet .field', { hasText: 'Name' }).locator('input').fill('Buffer');
    await page.locator('.sheet .field', { hasText: 'Target balance' }).locator('input').fill('10000');
    await page.locator('.sheet-foot').getByText('Save').click();
    await expect(page.locator('.goal-row', { hasText: 'Buffer' })).toContainText('50%');
  });
});
