# Budget PWA – notes for coding agents

- React 19 + Vite + TypeScript, no router (tabs are state in `App.tsx`). Vitest for tests.
- All data lives in IndexedDB on the device (`src/lib/db.ts`). There is no backend; never add network calls that send user data anywhere.
- Money is integer cents (negative = debit). Dates are stored as ISO `YYYY-MM-DD` and shown as DD/MM/YYYY.
- Bank statement parsers live in `src/parsers/`. Each implements `StatementParser` (`types.ts`) and is registered in `registry.ts`. They take plain text lines per page, so they can be tested without PDFs — see `commbank.test.ts` and `__fixtures__/`.
- Test fixtures must not contain real personal data (names, addresses, account numbers).
- The service worker (`src/sw.js`) is generated at build time by the plugin in `vite.config.ts` with the list of built files.
- Before committing: `npm test`, `npm run build` and `npm run e2e` must pass.
- Categorising lives in `src/lib/suggest.ts` (rules → own-account transfers → learned history → built-in merchants in `merchants.ts`). Confident suggestions are applied with `categorySource` 'rule' | 'transfer' | 'auto'; others are shown for approval. 'user' = picked from the list, 'approved' = approved suggestion; both (and legacy unset) feed the learning, 'auto' doesn't, so auto guesses can't reinforce themselves. Bulk/retroactive updates (`src/lib/retro.ts`) protect only 'user' unless the user opts in.
- Outgoings (dashboard donut) live in `src/lib/outgoings.ts`: per-category `necessity` (defaults by builtin key via `categoryNecessity`) with an optional per-transaction override, and calendar periods (month/quarter/half/year).
- Real-time capture: `src/lib/capture.ts` (fragment link parsing, notification parser, repeat detection, statement matching) and `src/lib/useCapture.ts` (handles `#capture=` on load/hashchange). Captured transactions have `source: 'capture'`, `pending: true`; `attachCaptures` in `importer.ts` links statement lines to them and the review save deletes the replaced captures. Keep purchase data in the URL fragment only (never query string).
- Insights logic (budget pace, recurring payments, balances, goals, trends) is in `src/lib/insights.ts`; CSV export in `exportCsv.ts`. Savings goals are their own IndexedDB store (`goals`, DB version 2) and part of backups.
- Undo: call `store.undoPoint()` before any change that touches several records and pass the result to `store.toast(message, undo)`. It snapshots the whole database and restores it.
- App lock (`src/lib/lock.ts`, `LockScreen.tsx`) is a soft lock stored in localStorage, never in backups. Don't describe it as encryption.
- Browser tests live in `e2e/` (Playwright, phone viewport, made-up data dated relative to today). `npm run e2e` locally; CI runs them on pull requests and before every deploy. Add or update one when you change a user-facing flow.
