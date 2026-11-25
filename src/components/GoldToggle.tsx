import React from 'react';

interface GoldToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}

export const GoldToggle: React.FC<GoldToggleProps> = ({
  checked,
  onChange,
  label,
  description,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className="w-full min-h-[44px] py-1.5 flex items-center justify-between gap-4 text-left group"
  >
    <div className="min-w-0 flex-1">
      <span className="block text-sm text-[var(--text)]">{label}</span>
      {description && (
        <span className="block text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
          {description}
        </span>
      )}
    </div>
    <span
      aria-hidden="true"
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 ${
        checked
          ? 'bg-[var(--gold-500)] border-[var(--gold-300)]'
          : 'bg-[#2E2A22] border-[var(--border)]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full transition-transform duration-150 ${
          checked
            ? 'translate-x-5.5 bg-[#0A0A0A]'
            : 'translate-x-1 bg-[var(--text-muted)]'
        }`}
      />
    </span>
  </button>
);
