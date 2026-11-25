import React, { useState } from 'react';
import { Delete } from 'lucide-react';
import { verifyPin } from '../db/storage';
import type { UILanguage } from '../types/machine';
import { getTranslations } from '../i18n/translations';
import { BrandEyeIcon } from './BrandMark';

interface PinLockScreenProps {
  salt: string;
  hash: string;
  language: UILanguage;
  onUnlock: () => void;
}

export const PinLockScreen: React.FC<PinLockScreenProps> = ({
  salt,
  hash,
  language,
  onUnlock,
}) => {
  const t = getTranslations(language);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const appendDigit = (digit: string) => {
    if (pin.length >= 6 || checking) return;
    setError('');
    setPin((prev) => prev + digit);
  };

  const handleBackspace = () => {
    setError('');
    setPin((prev) => prev.slice(0, -1));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (pin.length < 4 || checking) return;
    setChecking(true);
    try {
      const ok = await verifyPin(pin, salt, hash);
      if (ok) {
        onUnlock();
      } else {
        setError(t.pin.wrongPin);
        setPin('');
      }
    } finally {
      setChecking(false);
    }
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm machine-card p-6">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center mb-4">
            <BrandEyeIcon size={34} />
          </div>
          <h1 className="font-cinzel text-lg font-semibold gold-text-gradient tracking-[0.14em]">
            {t.pin.title}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{t.pin.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex justify-center gap-3 mb-4 min-h-[32px] items-center" aria-live="polite">
            {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
              <span
                key={i}
                className={`w-3.5 h-3.5 rounded-full border transition-colors ${
                  i < pin.length
                    ? 'bg-[var(--gold-500)] border-[var(--gold-300)] shadow-[0_0_8px_rgba(212,175,55,0.4)]'
                    : 'bg-transparent border-[var(--border)]'
                }`}
              />
            ))}
          </div>

          {error && (
            <p className="text-xs text-[var(--error)] text-center mb-4 font-mono">{error}</p>
          )}

          <div className="grid grid-cols-3 gap-2.5 mb-4">
            {digits.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => appendDigit(d)}
                className="min-h-[52px] machine-btn-ghost font-mono text-lg font-medium active:scale-[0.98]"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setPin('');
                setError('');
              }}
              className="min-h-[52px] machine-btn-ghost text-xs font-mono text-[var(--text-muted)]"
            >
              {t.pin.clear}
            </button>
            <button
              type="button"
              onClick={() => appendDigit('0')}
              className="min-h-[52px] machine-btn-ghost font-mono text-lg font-medium active:scale-[0.98]"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              aria-label="Backspace"
              className="min-h-[52px] machine-btn-ghost flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--gold-300)]"
            >
              <Delete strokeWidth={1.5} className="w-5 h-5" />
            </button>
          </div>

          <button
            type="submit"
            disabled={pin.length < 4 || checking}
            className="w-full min-h-[48px] machine-btn-primary text-sm"
          >
            {t.pin.unlock}
          </button>
        </form>
      </div>
    </div>
  );
};
