import { useCallback, useEffect, useState } from 'react';
import {
  connectGoogle,
  disconnectGoogle,
  getGoogleAuthSnapshot,
  subscribeGoogleAuth,
  type GoogleAuthSnapshot,
} from '../services/googleAuth';

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
      await connectGoogle(settingsClientId, 'consent');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to connect Google.');
    } finally {
      setIsConnecting(false);
    }
  }, [settingsClientId]);

  const reconnect = useCallback(async () => {
    setIsConnecting(true);
    setAuthError(null);
    try {
      await connectGoogle(settingsClientId, '');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to reconnect Google.');
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
    disconnect,
  };
}
