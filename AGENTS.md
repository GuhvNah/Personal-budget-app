# Budget PWA – notes for coding agents

- React 19 + Vite + TypeScript, no router (tabs are state in `App.tsx`). Vitest for tests.
- All data lives in IndexedDB on the device (`src/lib/db.ts`). There is no backend; never add network calls that send user data anywhere.
- Money is integer cents (negative = debit). Dates are stored as ISO `YYYY-MM-DD` and shown as DD/MM/YYYY.
- Bank statement parsers live in `src/parsers/`. Each implements `StatementParser` (`types.ts`) and is registered in `registry.ts`. They take plain text lines per page, so they can be tested without PDFs — see `commbank.test.ts` and `__fixtures__/`.
- Test fixtures must not contain real personal data (names, addresses, account numbers).
- The service worker (`src/sw.js`) is generated at build time by the plugin in `vite.config.ts` with the list of built files.
- Before committing: `npm test` and `npm run build` must pass.
- Categorising lives in `src/lib/suggest.ts` (rules → own-account transfers → learned history → built-in merchants in `merchants.ts`). Confident suggestions are applied with `categorySource` 'rule' | 'transfer' | 'auto'; others are shown for approval. Only 'user' (or legacy unset) categories feed the learning, so auto guesses can't reinforce themselves.
- Outgoings (dashboard donut) live in `src/lib/outgoings.ts`: per-category `necessity` (defaults by builtin key via `categoryNecessity`) with an optional per-transaction override, and calendar periods (month/quarter/half/year).
