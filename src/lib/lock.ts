/*
 * Optional app lock: a PIN and/or the phone's fingerprint (or face/screen
 * lock) via WebAuthn. This keeps someone who picks up your unlocked phone
 * out of the app; it does not encrypt the stored data.
 *
 * The lock settings live in localStorage, not the database, so they are
 * known before any data loads, stay on this device, and are never part of a
 * backup (a fingerprint credential only works on the phone that made it).
 */

const KEY = 'budget-lock';

export interface LockConfig {
  /** PBKDF2 hash of the PIN (hex) and its salt. */
  pinHash?: string;
  salt?: string;
  /** WebAuthn credential id (base64url) when fingerprint unlock is on. */
  credentialId?: string;
  /** Lock again after the app has been in the background this long. */
  timeoutMinutes: number;
}

export const DEFAULT_LOCK: LockConfig = { timeoutMinutes: 1 };

export function loadLock(storage: Pick<Storage, 'getItem'> = localStorage): LockConfig {
  try {
    return { ...DEFAULT_LOCK, ...JSON.parse(storage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_LOCK };
  }
}

export function saveLock(cfg: LockConfig, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(KEY, JSON.stringify(cfg));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCK_CHANGED));
}

/** Fired on window when the lock settings change. */
export const LOCK_CHANGED = 'budget-lock-changed';

export function lockEnabled(cfg: LockConfig): boolean {
  return !!cfg.pinHash || !!cfg.credentialId;
}

const hex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

export function validPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: 150_000 },
    key,
    256,
  );
  return hex(bits);
}

/** New salt + hash for a PIN. */
export async function makePin(pin: string): Promise<{ pinHash: string; salt: string }> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { pinHash: await hashPin(pin, salt), salt };
}

export async function checkPin(pin: string, cfg: LockConfig): Promise<boolean> {
  if (!cfg.pinHash || !cfg.salt) return false;
  return (await hashPin(pin, cfg.salt)) === cfg.pinHash;
}

/** Should the app lock again after being hidden from `hiddenAt` until `now`? */
export function shouldRelock(cfg: LockConfig, hiddenAt: number | null, now: number): boolean {
  return lockEnabled(cfg) && hiddenAt !== null && now - hiddenAt >= cfg.timeoutMinutes * 60_000;
}

/* ---- Fingerprint / device unlock (WebAuthn) ---- */

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Can this phone/browser unlock with fingerprint, face or screen lock? */
export async function fingerprintAvailable(): Promise<boolean> {
  try {
    return (
      typeof PublicKeyCredential !== 'undefined' &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

/** Set up fingerprint unlock. Returns the credential id to store, or throws if cancelled. */
export async function registerFingerprint(): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Budget' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'budget', displayName: 'Budget app lock' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Fingerprint setup was cancelled.');
  return b64url(cred.rawId);
}

/** Ask for the fingerprint. Resolves true when the phone confirms it's you. */
export async function verifyFingerprint(credentialId: string): Promise<boolean> {
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64url(credentialId), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return !!res;
  } catch {
    return false;
  }
}
