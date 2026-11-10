import { useEffect, useState } from 'react';
import {
  checkPin,
  fingerprintAvailable,
  loadLock,
  LOCK_CHANGED,
  makePin,
  registerFingerprint,
  saveLock,
  validPin,
  type LockConfig,
} from '../lib/lock';
import { useStore } from '../store';
import { Sheet } from './ui';

/** Settings → App lock: optional PIN and/or fingerprint. Off by default. */
export function LockSettings() {
  const store = useStore();
  const [cfg, setCfg] = useState<LockConfig>(() => loadLock());
  const [canFingerprint, setCanFingerprint] = useState(false);
  const [pinSheet, setPinSheet] = useState<'set' | 'change' | 'remove' | null>(null);

  useEffect(() => {
    void fingerprintAvailable().then(setCanFingerprint);
    const onChange = () => setCfg(loadLock());
    window.addEventListener(LOCK_CHANGED, onChange);
    return () => window.removeEventListener(LOCK_CHANGED, onChange);
  }, []);

  const hasPin = !!cfg.pinHash;
  const hasFingerprint = !!cfg.credentialId;

  async function toggleFingerprint(on: boolean) {
    if (!on) {
      saveLock({ ...cfg, credentialId: undefined });
      return store.toast('Fingerprint unlock turned off');
    }
    try {
      saveLock({ ...cfg, credentialId: await registerFingerprint() });
      store.toast('Fingerprint unlock turned on');
    } catch {
      store.toast("Fingerprint wasn't set up");
    }
  }

  return (
    <section className="card">
      <h3>App lock</h3>
      <p className="hint">
        Optional. Ask for a PIN, your fingerprint, or either, when the app opens. This keeps other people out of the app
        on your unlocked phone. It doesn't encrypt the data, and a forgotten PIN can't be recovered, so keep a backup.
        Currently: <b>{hasPin && hasFingerprint ? 'PIN or fingerprint' : hasPin ? 'PIN' : hasFingerprint ? 'fingerprint' : 'off'}</b>.
      </p>

      <label className="switch-row">
        <input
          type="checkbox"
          role="switch"
          checked={hasPin}
          aria-label="PIN lock"
          onChange={(e) => setPinSheet(e.target.checked ? 'set' : 'remove')}
        />
        <span>
          <b>PIN</b>
          <small>{hasPin ? 'A PIN is set.' : '4 to 8 digits.'}</small>
        </span>
      </label>
      {hasPin && (
        <button className="btn wide" onClick={() => setPinSheet('change')}>
          Change PIN
        </button>
      )}

      <label className="switch-row">
        <input
          type="checkbox"
          role="switch"
          checked={hasFingerprint}
          disabled={!canFingerprint && !hasFingerprint}
          aria-label="Fingerprint unlock"
          onChange={(e) => void toggleFingerprint(e.target.checked)}
        />
        <span>
          <b>Fingerprint</b>
          <small>
            {canFingerprint || hasFingerprint
              ? "Uses your phone's fingerprint, face or screen lock."
              : "Not available in this browser or on this device."}
          </small>
        </span>
      </label>

      {(hasPin || hasFingerprint) && (
        <label className="field">
          <span>Lock again after the app has been in the background for</span>
          <select
            value={cfg.timeoutMinutes}
            onChange={(e) => saveLock({ ...cfg, timeoutMinutes: Number(e.target.value) })}
          >
            <option value={0}>Straight away</option>
            <option value={1}>1 minute</option>
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
          </select>
        </label>
      )}

      {pinSheet && <PinSheet mode={pinSheet} cfg={cfg} onClose={() => setPinSheet(null)} />}
    </section>
  );
}

function PinSheet({ mode, cfg, onClose }: { mode: 'set' | 'change' | 'remove'; cfg: LockConfig; onClose(): void }) {
  const store = useStore();
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);

  async function save() {
    if (mode !== 'set' && !(await checkPin(current, cfg))) return setError('Current PIN is wrong.');
    if (mode === 'remove') {
      saveLock({ ...cfg, pinHash: undefined, salt: undefined });
      store.toast('PIN removed');
      return onClose();
    }
    if (!validPin(pin)) return setError('Use 4 to 8 digits.');
    if (pin !== again) return setError("The two PINs don't match.");
    saveLock({ ...cfg, ...(await makePin(pin)) });
    store.toast(mode === 'set' ? 'PIN lock turned on' : 'PIN changed');
    onClose();
  }

  const pinInput = (label: string, value: string, set: (v: string) => void, auto = false) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        value={value}
        autoFocus={auto}
        onChange={(e) => set(digits(e.target.value))}
      />
    </label>
  );

  return (
    <Sheet
      title={mode === 'set' ? 'Set a PIN' : mode === 'change' ? 'Change PIN' : 'Remove PIN'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn grow ${mode === 'remove' ? 'danger' : 'primary'}`} onClick={() => void save()}>
            {mode === 'remove' ? 'Remove PIN' : 'Save PIN'}
          </button>
        </>
      }
    >
      {mode !== 'set' && pinInput('Current PIN', current, setCurrent, true)}
      {mode !== 'remove' && pinInput('New PIN (4 to 8 digits)', pin, setPin, mode === 'set')}
      {mode !== 'remove' && pinInput('New PIN again', again, setAgain)}
      {mode === 'set' && (
        <p className="hint">
          If you forget it, the only way back in is to erase the app's data and restore a backup file. Make a backup first.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}
