# Budget

A private, offline personal budgeting app. It's a Progressive Web App you install on your Android phone from Chrome.

- **No accounts, no login, no server.** Everything is stored on the phone in IndexedDB. Nothing you import is ever uploaded.
- **AUD** amounts, **DD/MM/YYYY** dates.
- Works fully offline once installed.

## Features

- **PDF import (CommBank "Transaction Summary")**, parsed on the phone with pdf.js. You can pick several PDFs at once.
  - The account (BSB and number) is read from the statement, so each account's transactions stay separate.
  - The running balance on every line is checked (previous balance + amount = balance). Lines that don't add up are flagged on the review screen.
  - Overlapping statements are fine: duplicates are detected and skipped. Two genuine identical payments on the same day are both kept, because their running balances differ.
  - Clear error messages for files that aren't PDFs, password-protected PDFs, scanned (image-only) PDFs and unrecognised formats.
- **CSV import** for any bank, with a column-mapping step. It auto-detects the CommBank CSV layout and supports one signed amount column or separate debit/credit columns.
- **Review before saving:** fix the date, description or amount, change categories, remove lines, or cancel the whole import.
- **Categories:** Groceries, Rent/Mortgage, Fuel, Bills, Insurance, Eating Out, Entertainment, Childcare, Other, Income and Transfers. Add, rename and delete them in Settings. Deleting asks where to move the transactions.
- **Rules:** "description contains X → category". When you change a transaction's category, the app offers to make it a rule and apply it to matching uncategorised transactions.
- **Transfers between your own accounts:** "Transfer to/from xxNNNN" to an account you've marked as yours goes in **Transfers**. That category isn't counted as spending or income. The review screen asks about account numbers it hasn't seen before.
- **Monthly budgets per category**, plus a dashboard showing:
  - spending vs budget for the month
  - income, spending and net
  - a 6-month spending chart (tap a bar to jump to that month)
- **Transactions list:** search, filter by date range, category, account, money in/out and amount range, and add transactions manually.
- **Backup and restore** of all data as a JSON file (download it, or share it straight to Google Drive).

### Mortgage paid from the offset account

Mortgage repayments usually show up as a transfer to the loan account, e.g. `Transfer to xx1234`. When the review screen asks about that account number, tap **Not mine**. Then set the transaction's category to **Rent/Mortgage** and accept the "make this a rule" offer. Rules always beat transfer detection, so future repayments count as Rent/Mortgage spending.

## Run it locally

Needs Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173 (the service worker is only active in production builds)
npm test           # parser and logic tests
npm run build      # production build into dist/
npm run preview    # serve the production build at http://localhost:4173
```

To try it on your phone over Wi-Fi, run `npm run dev -- --host` and open the "Network" URL in Chrome. You can't install the app from a plain-HTTP LAN address, but you can use it there.

## Deploy for free on GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs the tests, builds the app and publishes it whenever `main` changes.

1. Merge this branch into `main`.
2. On GitHub, open the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**. You only do this once.
3. On a free GitHub plan, Pages needs the repository to be **public**. That's safe: the repo only contains code, and your data never leaves your phone.
4. Watch the **Actions** tab. When the run goes green, the site URL appears under **Settings → Pages**. For this repo it is `https://guhvnah.github.io/Personal-budget-app/` (the path is case-sensitive).

**Netlify instead:** "Add new site → Import from Git", choose the repo, build command `npm run build`, publish directory `dist`. The app uses relative paths, so it works at any URL.

## Install on your Android phone

1. Open the site URL in **Chrome** on your phone.
2. Tap **⋮ → Add to Home screen → Install** (or accept the "Install app" prompt).
3. Launch **Budget** from the home screen. It opens full-screen and works offline.

Updates: when you push changes, the installed app picks them up the next time it's opened online. Close it fully and reopen it if you don't see the update.

## Back up your data

Your data lives only in Chrome's storage on the phone. **Clearing Chrome's site data, uninstalling the app or changing phones will delete it.** Use **Settings → Backup & restore** regularly. "Share / save to Drive" is the easiest option. To move to a new phone, install the app there and choose **Restore from backup…**.

## Project layout

```
src/
  parsers/            bank statement parsing (no UI)
    types.ts          StatementParser interface
    registry.ts       list of parsers, format detection, friendly errors
    commbank.ts       CommBank Transaction Summary parser
    pdfText.ts        pdf.js → text lines (positioned text grouped into rows)
    csv.ts            CSV parsing and column mapping
    *.test.ts         tests using sample statement text (__fixtures__/)
  lib/                data model, IndexedDB, categorising, dedupe, stats, backup
  components/         React screens (Dashboard, Transactions, Import, Review, Settings…)
  sw.js               service worker template (file list injected at build time)
public/               manifest and icons (regenerate icons with scripts/generate-icons.mjs)
```

## Adding another bank

1. Create `src/parsers/<bank>.ts` that exports a `StatementParser`:
   - `detect(pages)` returns `true` only for that bank's layout.
   - `parse(pages)` returns `{ account, transactions, warnings }`. Amounts are in cents, negative for debits, and dates are `YYYY-MM-DD`. Include `balance` if the statement has a running balance; that enables the balance check and exact duplicate detection.
   - Throw `ParseError` with a helpful message if it can't be read.
2. Add it to `PARSERS` in `src/parsers/registry.ts`.
3. Add a test with sample text. Copy the layout of a real statement as text lines, but **use made-up names and account numbers**, since the repo is public.

The input is `pages: string[][]`, the text lines of each page. You can see what pdf.js produces by temporarily logging the result of `pdfToPages()` in `Import.tsx`.
