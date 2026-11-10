import { useCallback, useEffect, useRef, useState } from 'react';
import { checkPin, loadLock, lockEnabled, LOCK_CHANGED, shouldRelock, verifyFingerprint, type LockConfig } from '../lib/lock';

/**
 * Tracks whether the app is locked: locked on open when a lock is set, and
 * again after the app has been in the background for the chosen time.
 */
export function useAppLock() {
  const [cfg, setCfg] = useState<LockConfig>(() => loadLock());
  const [locked, setLocked] = useState(() => lockEnabled(loadLock()));
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const onChange = () => setCfg(loadLock());
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else {
        if (shouldRelock(loadLock(), hiddenAt.current, Date.now())) setLocked(true);
        hiddenAt.current = null;
      }
    };
    window.addEventListener(LOCK_CHANGED, onChange);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener(LOCK_CHANGED, onChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return { cfg, locked: locked && lockEnabled(cfg), unlock: useCallback(() => setLocked(false), []) };
}

export function LockScreen({ cfg, onUnlock }: { cfg: LockConfig; onUnlock(): void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const asked = useRef(false);

  const fingerprint = useCallback(async () => {
    if (!cfg.credentialId) return;
    setBusy(true);
    setError('');
    const ok = await verifyFingerprint(cfg.credentialId);
    setBusy(false);
    if (ok) onUnlock();
    else setError(cfg.pinHash ? "Fingerprint didn't work. Try again or use your PIN." : "Fingerprint didn't work. Try again.");
  }, [cfg, onUnlock]);

  // Ask for the fingerprint straight away, once.
  useEffect(() => {
    if (cfg.credentialId && !asked.current) {
      asked.current = true;
      void fingerprint();
    }
  }, [cfg.credentialId, fingerprint]);

  async function submit() {
    if (!pin) return;
    setBusy(true);
    const ok = await checkPin(pin, cfg);
    setBusy(false);
    if (ok) onUnlock();
    else {
      setPin('');
      setError('Wrong PIN. Try again.');
    }
  }

  async function eraseEverything() {
    if (!confirm('Erase ALL budget data on this phone and remove the lock? This cannot be undone.')) return;
    if (!confirm('Really erase everything? You can only get it back from a backup file.')) return;
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('guhvnah-budget');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    window.location.reload();
  }

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="App locked">
      <div className="lock-box">
        <h1>Budget</h1>
        <p>Locked</p>
        {cfg.pinHash && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              placeholder="PIN"
              aria-label="PIN"
              value={pin}
              autoFocus={!cfg.credentialId}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
            <button className="btn primary wide" disabled={busy || pin.length < 4}>
              Unlock
            </button>
          </form>
        )}
        {cfg.credentialId && (
          <button className="btn wide" disabled={busy} onClick={() => void fingerprint()}>
            Unlock with fingerprint
          </button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="link" onClick={() => setForgot(!forgot)}>
          Can't unlock?
        </button>
        {forgot && (
          <div className="lock-forgot">
            <p className="hint">
              There's no way to recover a forgotten PIN. You can erase the app's data on this phone, which also removes
              the lock, then restore your latest backup file in Settings.
            </p>
            <button className="btn danger wide" onClick={() => void eraseEverything()}>
              Erase all data and remove lock
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
