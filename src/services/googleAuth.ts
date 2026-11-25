import firebaseConfig from '../../firebase-applet-config.json';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.appdata',
] as const;

export type GoogleConnectionStatus = 'disconnected' | 'connected' | 'expired';

export interface GoogleAuthSnapshot {
  status: GoogleConnectionStatus;
  expiresAt: number | null;
  remainingSeconds: number;
  hasClientId: boolean;
}

export class GoogleAuthError extends Error {
  reason: 'NOT_CONNECTED' | 'EXPIRED' | 'NO_CLIENT_ID' | 'GIS_UNAVAILABLE' | 'USER_CANCELLED';

  constructor(
    message: string,
    reason: 'NOT_CONNECTED' | 'EXPIRED' | 'NO_CLIENT_ID' | 'GIS_UNAVAILABLE' | 'USER_CANCELLED'
  ) {
    super(message);
    this.reason = reason;
  }
}

interface TokenClientResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  scope?: string;
}

interface GoogleAccountsNamespace {
  accounts?: {
    oauth2?: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (resp: TokenClientResponse) => void;
        error_callback?: (err: { type?: string; message?: string }) => void;
      }) => {
        requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
      };
      revoke: (token: string, done?: () => void) => void;
    };
  };
}

// Strictly in-memory token storage (never localStorage, sessionStorage, or IndexedDB)
let memoryAccessToken: string | null = null;
let memoryExpiresAt: number | null = null;
let memoryEverConnected = false;

const listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of listeners) fn();
}

export function subscribeGoogleAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resolveGoogleClientId(settingsClientId?: string): string {
  const custom = settingsClientId?.trim();
  if (custom) return custom;
  const envId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
  if (envId) return envId;
  return (firebaseConfig as { oAuthClientId?: string }).oAuthClientId ?? '';
}

export function getGoogleAuthSnapshot(settingsClientId?: string): GoogleAuthSnapshot {
  const clientId = resolveGoogleClientId(settingsClientId);
  const now = Date.now();

  if (!memoryAccessToken || !memoryExpiresAt) {
    return {
      status: memoryEverConnected ? 'expired' : 'disconnected',
      expiresAt: null,
      remainingSeconds: 0,
      hasClientId: Boolean(clientId),
    };
  }

  const remainingMs = memoryExpiresAt - now;
  if (remainingMs <= 0) {
    memoryAccessToken = null;
    memoryExpiresAt = null;
    return {
      status: 'expired',
      expiresAt: null,
      remainingSeconds: 0,
      hasClientId: Boolean(clientId),
    };
  }

  return {
    status: 'connected',
    expiresAt: memoryExpiresAt,
    remainingSeconds: Math.floor(remainingMs / 1000),
    hasClientId: Boolean(clientId),
  };
}

export function markGoogleTokenExpired() {
  memoryAccessToken = null;
  memoryExpiresAt = null;
  memoryEverConnected = true;
  notifyListeners();
}

export function getValidAccessToken(settingsClientId?: string): string {
  const snap = getGoogleAuthSnapshot(settingsClientId);
  if (snap.status === 'expired') {
    throw new GoogleAuthError('Google session expired. Please reconnect.', 'EXPIRED');
  }
  if (snap.status === 'disconnected' || !memoryAccessToken) {
    throw new GoogleAuthError('Google account is not connected.', 'NOT_CONNECTED');
  }
  return memoryAccessToken;
}

async function ensureGisLoaded(): Promise<GoogleAccountsNamespace> {
  const w = window as unknown as { google?: GoogleAccountsNamespace };
  if (w.google?.accounts?.oauth2) {
    return w.google;
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      const checkInterval = window.setInterval(() => {
        if ((window as unknown as { google?: GoogleAccountsNamespace }).google?.accounts?.oauth2) {
          window.clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      window.setTimeout(() => {
        window.clearInterval(checkInterval);
        reject(new GoogleAuthError('Google Identity Services failed to initialize.', 'GIS_UNAVAILABLE'));
      }, 6000);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new GoogleAuthError('Unable to load Google Identity Services (check internet connection).', 'GIS_UNAVAILABLE'));
    document.head.appendChild(script);
  });

  const loaded = (window as unknown as { google?: GoogleAccountsNamespace }).google;
  if (!loaded?.accounts?.oauth2) {
    throw new GoogleAuthError('Google Identity Services unavailable.', 'GIS_UNAVAILABLE');
  }
  return loaded;
}

export async function connectGoogle(
  settingsClientId?: string,
  promptMode: 'select_account consent' | 'select_account' | 'consent' | '' = 'select_account consent'
): Promise<void> {
  const clientId = resolveGoogleClientId(settingsClientId);
  if (!clientId) {
    throw new GoogleAuthError(
      'No Google OAuth Client ID configured. Open Settings > Google & Drive to set it up.',
      'NO_CLIENT_ID'
    );
  }

  const googleNs = await ensureGisLoaded();

  await new Promise<void>((resolve, reject) => {
    const tokenClient = googleNs.accounts!.oauth2!.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES.join(' '),
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(
            new GoogleAuthError(
              resp.error_description || resp.error || 'Google sign-in did not return an access token.',
              'USER_CANCELLED'
            )
          );
          return;
        }
        const ttlSec = Number(resp.expires_in ?? 3599);
        memoryAccessToken = resp.access_token;
        // Subtract 30s safety buffer so we warn before hard server rejection
        memoryExpiresAt = Date.now() + Math.max(60, ttlSec - 30) * 1000;
        memoryEverConnected = true;
        notifyListeners();
        resolve();
      },
      error_callback: (err) => {
        reject(
          new GoogleAuthError(
            err.message || 'Google sign-in popup was closed or blocked.',
            'USER_CANCELLED'
          )
        );
      },
    });

    tokenClient.requestAccessToken({ prompt: promptMode });
  });
}

export async function disconnectGoogle(): Promise<void> {
  const token = memoryAccessToken;
  memoryAccessToken = null;
  memoryExpiresAt = null;
  memoryEverConnected = false;
  notifyListeners();

  if (token) {
    try {
      const w = window as unknown as { google?: GoogleAccountsNamespace };
      w.google?.accounts?.oauth2?.revoke(token, () => {
        // Revoked cleanly
      });
    } catch {
      // Token already cleared from memory
    }
  }
}
