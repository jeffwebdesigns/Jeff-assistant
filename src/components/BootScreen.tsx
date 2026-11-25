import React, { useEffect } from 'react';
import { BrandEyeIcon } from './BrandMark';

interface BootScreenProps {
  tagline: string;
  onComplete: () => void;
}

export const BootScreen: React.FC<BootScreenProps> = ({ tagline, onComplete }) => {
  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timeout = window.setTimeout(onComplete, reduced ? 450 : 1750);
    return () => window.clearTimeout(timeout);
  }, [onComplete]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Skip boot animation"
      onClick={onComplete}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          onComplete();
        }
      }}
      className="fixed inset-0 z-[100] bg-[var(--bg)] flex flex-col items-center justify-center p-6 select-none cursor-pointer"
    >
      <div className="flex flex-col items-center text-center max-w-xs">
        <div className="mb-5">
          <BrandEyeIcon size={76} animateDraw />
        </div>

        <div className="relative overflow-hidden boot-wordmark-in px-2 py-1">
          <h1 className="font-cinzel text-2xl sm:text-3xl font-semibold gold-text-gradient tracking-[0.16em]">
            THE MACHINE
          </h1>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#F7E7A9]/45 to-transparent boot-shimmer-sweep"
          />
        </div>

        <p className="boot-wordmark-in text-xs sm:text-sm text-[var(--text-muted)] tracking-[0.14em] mt-2">
          {tagline}
        </p>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onComplete();
          }}
          className="mt-8 min-h-[44px] px-4 rounded-xl text-xs font-mono text-[var(--text-muted)] hover:text-[var(--gold-300)] transition"
        >
          Tap anywhere to enter
        </button>
      </div>
    </div>
  );
};
