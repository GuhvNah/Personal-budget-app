import { useEffect, useState } from 'react';
import { captureLink, newCaptureKey, parseNotification } from '../lib/capture';
import * as db from '../lib/db';
import { formatAUD } from '../lib/money';
import { CAPTURE_ACCOUNT_ID } from '../lib/useCapture';
import { useStore } from '../store';

/** Settings → Real-time capture: link, setup steps for MacroDroid, and a tester. */
export function CaptureSettings() {
  const store = useStore();
  const { settings, accounts } = store;
  const [title, setTitle] = useState('ALDI Midland');
  const [body, setBody] = useState('$12.50 with Visa •• 1234');
  const [copied, setCopied] = useState(false);

  // Create the secret key the first time this section is shown.
  useEffect(() => {
    if (!settings.captureKey) {
      void db.saveSettings({ ...settings, captureKey: newCaptureKey() }).then(() => store.reload());
    }
  }, [settings, store]);

  const base = window.location.origin + window.location.pathname;
  const link = settings.captureKey ? captureLink(base, settings.captureKey) : '';
  const parsed = parseNotification(title, body);
  const pendingCount = store.transactions.filter((t) => t.pending).length;

  async function save(patch: Partial<typeof settings>) {
    await db.saveSettings({ ...settings, ...patch });
    await store.reload();
  }

  return (
    <section className="card capture">
      <h3>Real-time capture</h3>
      <p className="hint">
        Record card purchases the moment you pay. A free automation app (MacroDroid) spots each Google Wallet payment
        notification and opens this app with the amount and shop. The purchase is added straight away as{' '}
        <b>pending</b>, then replaced by the bank's version (keeping your category) when you import a statement. The
        details never leave your phone.
        {pendingCount > 0 && (
          <>
            {' '}
            <b>{pendingCount}</b> pending purchase{pendingCount === 1 ? '' : 's'} at the moment.
          </>
        )}
      </p>

      <label className="field">
        <span>Record captured purchases in</span>
        <select
          value={settings.captureAccountId && accounts.some((a) => a.id === settings.captureAccountId) ? settings.captureAccountId : ''}
          onChange={(e) => void save({ captureAccountId: e.target.value || undefined })}
        >
          <option value="">{accounts.some((a) => a.id === CAPTURE_ACCOUNT_ID) ? 'Card (captured)' : 'A new “Card (captured)” account'}</option>
          {accounts
            .filter((a) => a.id !== CAPTURE_ACCOUNT_ID)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <small className="hint">Pick the account your Google Wallet card pays from (e.g. your Everyday Offset).</small>
      </label>

      <div className="field">
        <span>Your capture link (keep it private)</span>
        <code className="capture-link">{link || 'Creating…'}</code>
        <div className="button-row">
          <button
            className="btn primary grow"
            disabled={!link}
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <button
            className="btn"
            onClick={() =>
              confirm('Make a new link? The old one will stop working until you update MacroDroid.') &&
              void save({ captureKey: newCaptureKey() })
            }
          >
            New link
          </button>
        </div>
      </div>

      <details className="steps">
        <summary>Set up MacroDroid (about 5 minutes)</summary>
        <ol>
          <li>Install <b>MacroDroid</b> from the Play Store (free) and open it.</li>
          <li>
            Tap <b>Add Macro</b>. Under <b>Triggers</b> tap +, choose <b>Notification → Notification Received</b>, select
            the app <b>Google Wallet</b>, and leave the text as <b>Any</b>. Allow MacroDroid notification access when
            asked.
          </li>
          <li>
            Under <b>Actions</b> tap +, choose <b>Applications → Open Website / HTTP GET</b> (use “open website”, not
            HTTP GET) and paste your capture link. The bits in square brackets are MacroDroid's “magic text” for the
            notification title and text – if your MacroDroid names them differently, insert them with its <b>…</b> /
            magic text button instead.
          </li>
          <li>
            Optional, so you don't see the app pop up: add <b>Wait before next action → 3 seconds</b>, then{' '}
            <b>Device Actions → Home screen</b>.
          </li>
          <li>
            Name the macro (e.g. “Budget capture”) and save. Optionally add a second trigger for the <b>CommBank</b> app –
            duplicates of the same purchase are ignored.
          </li>
          <li>
            Make sure this app is installed (Home screen icon), so Android opens it rather than a browser tab. Then pay
            for something small with your phone – you should see “Captured $…”.
          </li>
        </ol>
        <p className="hint">Menu names can vary a little between MacroDroid versions.</p>
      </details>

      <details className="steps">
        <summary>Test with a notification</summary>
        <p className="hint">Type what a payment notification says to check it's read correctly.</p>
        <label className="field">
          <span>Notification title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Notification text</span>
          <input value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <p className="capture-result">
          {parsed ? (
            <>
              Reads as <b>{formatAUD(Math.abs(parsed.amount))}</b> {parsed.amount > 0 ? 'refund from' : 'at'}{' '}
              <b>{parsed.merchant}</b>
            </>
          ) : (
            "Doesn't look like a completed purchase – nothing would be added."
          )}
        </p>
        <button
          className="btn wide"
          disabled={!parsed || !settings.captureKey}
          onClick={() => {
            window.location.hash = captureLink('', settings.captureKey!, encodeURIComponent(title), encodeURIComponent(body)).replace(/^#/, '');
          }}
        >
          Add as a test purchase
        </button>
      </details>
    </section>
  );
}
