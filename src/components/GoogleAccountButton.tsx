import React from 'react';
import type { User } from 'firebase/auth';
import { LogOut, RefreshCw } from 'lucide-react';
import type { SyncStatus } from '../services/realtimeSync';

interface GoogleAccountControlProps {
  user: User | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  busy: boolean;
  compact?: boolean;
  onChooseAccount: () => void;
  onSignOut: () => void;
}

const GoogleGIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
    />
  </svg>
);

export const GoogleAccountControl: React.FC<GoogleAccountControlProps> = ({
  user,
  syncStatus,
  syncError,
  busy,
  compact = false,
  onChooseAccount,
  onSignOut,
}) => {
  const statusLabel =
    syncStatus === 'synced'
      ? 'Real-time sync active'
      : syncStatus === 'syncing'
      ? 'Syncing across devices...'
      : syncStatus === 'error'
      ? 'Sync paused'
      : 'Local only';

  const dotClass =
    syncStatus === 'synced'
      ? 'bg-[var(--success)]'
      : syncStatus === 'syncing'
      ? 'bg-[var(--gold-300)] machine-dot-pulse-fast'
      : syncStatus === 'error'
      ? 'bg-[var(--error)]'
      : 'bg-[var(--text-muted)]';

  if (compact) {
    if (!user) {
      return (
        <button
          type="button"
          disabled={busy}
          onClick={onChooseAccount}
          className="w-full min-h-[44px] px-3 rounded-xl bg-[#FFFFFF] text-[#1F1F1F] hover:bg-[#F3F3F3] font-medium text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
        >
          <GoogleGIcon />
          <span className="truncate">{busy ? 'Opening...' : 'Choose Google Account'}</span>
        </button>
      );
    }

    return (
      <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-2.5 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName ?? 'Google account'}
              referrerPolicy="no-referrer"
              className="w-7 h-7 rounded-full border border-[var(--gold-700)] shrink-0 object-cover"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[var(--surface-2)] border border-[var(--gold-700)] flex items-center justify-center text-xs font-mono text-[var(--gold-300)] shrink-0">
              {(user.displayName || user.email || 'G')[0]?.toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[var(--text)] truncate">
              {user.displayName || 'Google User'}
            </p>
            <p className="text-[11px] font-mono text-[var(--text-muted)] truncate">
              {user.email}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-1 text-[10px] font-mono text-[var(--text-muted)]">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${dotClass}`} />
            {statusLabel}
          </span>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onChooseAccount}
            className="flex-1 min-h-[44px] px-2.5 machine-btn-secondary text-[11px] font-mono flex items-center justify-center gap-1 whitespace-nowrap"
          >
            <RefreshCw strokeWidth={1.5} className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
            <span>Switch</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSignOut}
            aria-label="Sign out Google account"
            className="min-h-[44px] min-w-[44px] machine-btn-ghost flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--error)]"
          >
            <LogOut strokeWidth={1.5} className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="machine-card p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName ?? 'Google account'}
              referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-full border border-[var(--gold-500)] shrink-0 object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[var(--surface-2)] border border-[var(--gold-700)] flex items-center justify-center shrink-0">
              <GoogleGIcon />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
              <h2 className="section-title-gold text-xs sm:text-sm font-semibold">
                {user ? 'CROSS-DEVICE REAL-TIME SYNC' : 'CHOOSE GOOGLE ACCOUNT FOR LIVE SYNC'}
              </h2>
            </div>
            {user ? (
              <p className="text-xs font-mono text-[var(--text)] truncate mt-1">
                {user.displayName || 'Google Account'} ·{' '}
                <span className="text-[var(--gold-300)]">{user.email}</span> · {statusLabel}
              </p>
            ) : (
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Sign in with your Google account to pick which account to use and refresh changes in real time on every logged-in device.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!user ? (
            <button
              type="button"
              disabled={busy}
              onClick={onChooseAccount}
              className="min-h-[44px] px-4 rounded-xl bg-[#FFFFFF] text-[#1F1F1F] hover:bg-[#F3F3F3] font-medium text-sm flex items-center gap-2.5 transition disabled:opacity-50"
            >
              <GoogleGIcon />
              <span>{busy ? 'Opening Google...' : 'Choose Google Account'}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onChooseAccount}
                className="min-h-[44px] px-3.5 machine-btn-secondary text-xs font-mono flex items-center gap-1.5 whitespace-nowrap"
              >
                <RefreshCw strokeWidth={1.5} className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                <span>{busy ? 'Switching...' : 'Switch Google Account'}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onSignOut}
                className="min-h-[44px] px-3.5 machine-btn-ghost text-xs font-mono flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--error)] whitespace-nowrap"
              >
                <LogOut strokeWidth={1.5} className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </>
          )}
        </div>
      </div>

      {syncError && (
        <p className="text-xs font-mono text-[var(--error)] bg-[var(--bg)] border border-[var(--error)]/40 rounded-xl px-3 py-2 break-words">
          {syncError}
        </p>
      )}
    </div>
  );
};
