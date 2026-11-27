import { useCallback, useEffect, useState } from 'react';
import {
  connectGoogle,
  disconnectGoogle,
  getGoogleAuthSnapshot,
  subscribeGoogleAuth,
  type GoogleAuthSnapshot,
} from '../services/googleAuth';

function formatGoogleConnectError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : fallback;
  const lower = msg.toLowerCase();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (lower.includes('origin_mismatch') || lower.includes('redirect_uri_mismatch')) {
    return `Google OAuth blocked this domain (${origin}). Add ${origin} under Google Cloud Console → Credentials → OAuth 2.0 Client ID → Authorized JavaScript origins.`;
  }
  if (lower.includes('popup') || lower.includes('blocked')) {
    return `${msg} If deployed on a custom/Vercel URL, verify ${origin} is listed in Google Cloud OAuth Authorized JavaScript origins and allow popups.`;
  }
  return msg;
}

export function useGoogleAuth(settingsClientId?: string) {
  const [snapshot, setSnapshot] = useState<GoogleAuthSnapshot>(() =>
    getGoogleAuthSnapshot(settingsClientId)
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setSnapshot(getGoogleAuthSnapshot(settingsClientId));
    refresh();
    const unsubscribe = subscribeGoogleAuth(refresh);
    const timer = window.setInterval(refresh, 5000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [settingsClientId]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setAuthError(null);
    try {
      await connectGoogle(settingsClientId, 'select_account consent');
    } catch (err) {
      setAuthError(formatGoogleConnectError(err, 'Unable to connect Google.'));
    } finally {
      setIsConnecting(false);
    }
  }, [settingsClientId]);

  const reconnect = useCallback(async () => {
    setIsConnecting(true);
    setAuthError(null);
    try {
      await connectGoogle(settingsClientId, 'select_account');
    } catch (err) {
      setAuthError(formatGoogleConnectError(err, 'Unable to reconnect Google.'));
    } finally {
      setIsConnecting(false);
    }
  }, [settingsClientId]);

  const switchAccount = useCallback(async () => {
    setIsConnecting(true);
    setAuthError(null);
    try {
      await connectGoogle(settingsClientId, 'select_account consent');
    } catch (err) {
      setAuthError(formatGoogleConnectError(err, 'Unable to switch Google account.'));
    } finally {
      setIsConnecting(false);
    }
  }, [settingsClientId]);

  const disconnect = useCallback(async () => {
    setAuthError(null);
    await disconnectGoogle();
  }, []);

  return {
    ...snapshot,
    isConnecting,
    authError,
    clearAuthError: () => setAuthError(null),
    connect,
    reconnect,
    switchAccount,
    disconnect,
  };
}
