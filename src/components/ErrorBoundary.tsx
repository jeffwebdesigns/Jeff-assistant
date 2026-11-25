import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('THE MACHINE ErrorBoundary caught error:', error, info);
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let readableMessage = this.state.message;
    try {
      const parsed = JSON.parse(this.state.message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed?.error) {
        readableMessage = `${parsed.error}${parsed.path ? ` (${parsed.operationType ?? 'sync'} at ${parsed.path})` : ''}`;
      }
    } catch {
      // keep raw message
    }

    return (
      <div className="min-h-screen bg-[#0A0A0A] text-[#F5F0E1] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#121212] border border-[#D4AF37]/60 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3 text-[#E05A4F]">
            <AlertTriangle strokeWidth={1.5} className="w-5 h-5 shrink-0" />
            <h1 className="font-cinzel text-base font-semibold tracking-wider text-[#F5D77A]">
              SYSTEM INTERRUPT
            </h1>
          </div>
          <p className="text-sm text-[#F5F0E1]/90 leading-relaxed">
            THE MACHINE encountered an error while synchronizing your session.
          </p>
          <p className="text-xs font-mono text-[#A89F8A] bg-[#1A1A1A] border border-[#2A2415] rounded-xl p-3 break-words">
            {readableMessage}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full min-h-[48px] px-4 rounded-xl bg-[#D4AF37] text-[#0A0A0A] font-semibold text-sm flex items-center justify-center gap-2"
          >
            <RotateCcw strokeWidth={1.5} className="w-4 h-4" />
            <span>Reload Application</span>
          </button>
        </div>
      </div>
    );
  }
}
