import React from 'react';

interface BrandEyeProps {
  className?: string;
  size?: number;
  animateDraw?: boolean;
}

export const BrandEyeIcon: React.FC<BrandEyeProps> = ({
  className = '',
  size = 28,
  animateDraw = false,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={className}
  >
    <defs>
      <linearGradient id="brandGoldStroke" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8A6A1E" />
        <stop offset="35%" stopColor="#D4AF37" />
        <stop offset="50%" stopColor="#F5D77A" />
        <stop offset="68%" stopColor="#D4AF37" />
        <stop offset="100%" stopColor="#8A6A1E" />
      </linearGradient>
    </defs>
    <circle
      cx="32"
      cy="32"
      r="27"
      stroke="url(#brandGoldStroke)"
      strokeWidth="1.75"
      className={animateDraw ? 'boot-eye-draw' : undefined}
    />
    <path
      d="M13 32 Q32 18 51 32 Q32 46 13 32 Z"
      stroke="url(#brandGoldStroke)"
      strokeWidth="2"
      strokeLinejoin="round"
      className={animateDraw ? 'boot-eye-draw' : undefined}
    />
    <circle
      cx="32"
      cy="32"
      r="7.5"
      stroke="#F5D77A"
      strokeWidth="1.75"
      className={animateDraw ? 'boot-eye-draw' : undefined}
    />
    <circle cx="32" cy="32" r="2.75" fill="#F7E7A9" />
  </svg>
);

interface BrandLogoProps {
  compact?: boolean;
  showTagline?: boolean;
  tagline?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  compact = false,
  showTagline = false,
  tagline = 'Observe. Understand. Protect.',
}) => (
  <div className="flex items-center gap-2.5 min-w-0">
    <BrandEyeIcon size={compact ? 24 : 30} className="shrink-0" />
    <div className="min-w-0">
      <span
        className={`block font-cinzel font-semibold gold-text-gradient whitespace-nowrap truncate ${
          compact ? 'text-sm tracking-[0.14em]' : 'text-base tracking-[0.14em]'
        }`}
      >
        THE MACHINE
      </span>
      {showTagline && (
        <span className="block text-[11px] text-[var(--text-muted)] tracking-wider mt-0.5 truncate">
          {tagline}
        </span>
      )}
    </div>
  </div>
);
