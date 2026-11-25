import React, { useState } from 'react';
import { Download, Smartphone, WifiOff } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import type { UILanguage } from '../types/machine';
import { getTranslations } from '../i18n/translations';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`flex items-center justify-center gap-2 machine-btn-primary whitespace-nowrap shrink-0 ${
          compact ? 'min-h-[44px] px-3 text-xs' : 'w-full min-h-[44px] px-4 text-sm'
        }`}
      >
        <Download strokeWidth={1.5} className="w-4 h-4" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center justify-center gap-1.5 machine-btn-secondary min-h-[44px] px-3 text-xs whitespace-nowrap shrink-0"
        >
          <Smartphone strokeWidth={1.5} className="w-3.5 h-3.5" />
          <span>Install</span>
        </button>
        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="w-full max-w-sm machine-card p-6">
              <h3 className="font-cinzel text-base font-semibold gold-text-gradient">
                Install on iPhone / iPad
              </h3>
              <p className="mt-2.5 text-sm text-[var(--text-muted)] leading-relaxed">
                1. Tap the <strong className="text-[var(--text)]">Share</strong> icon in Safari.<br />
                2. Scroll down and tap <strong className="text-[var(--text)]">Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] machine-btn-secondary text-sm"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineBanner: React.FC<{ language: UILanguage }> = ({ language }) => {
  const isOnline = useOnlineStatus();
  const t = getTranslations(language);

  if (isOnline) return null;

  return (
    <div className="bg-[var(--surface)] border-b border-[var(--border)] px-4 py-2 flex items-center justify-center gap-2 text-xs font-mono text-[var(--gold-300)]">
      <WifiOff strokeWidth={1.5} className="w-3.5 h-3.5 text-[var(--gold-500)] shrink-0" />
      <span>{t.statusOffline} — Local IndexedDB active</span>
    </div>
  );
};
