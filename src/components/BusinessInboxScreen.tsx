import React, { useEffect, useState } from 'react';
import { Check, Copy, Info, MessageCircle, Sparkles, Trash2 } from 'lucide-react';
import type {
  BusinessChannel,
  BusinessMessageItem,
  MachineSettings,
} from '../types/machine';
import { getTranslations } from '../i18n/translations';
import { createId } from '../db/storage';
import { aiProvider } from '../services/aiProvider';
import { formatShortDateTime } from '../utils/datetime';

interface BusinessInboxScreenProps {
  settings: MachineSettings;
  messages: BusinessMessageItem[];
  sharedIncomingText: string | null;
  onConsumeSharedText: () => void;
  onSaveMessage: (msg: BusinessMessageItem) => Promise<void>;
  onDeleteMessage: (id: string) => Promise<void>;
}

export const BusinessInboxScreen: React.FC<BusinessInboxScreenProps> = ({
  settings,
  messages,
  sharedIncomingText,
  onConsumeSharedText,
  onSaveMessage,
  onDeleteMessage,
}) => {
  const t = getTranslations(settings.language);
  const [channel, setChannel] = useState<BusinessChannel>('whatsapp');
  const [senderLabel, setSenderLabel] = useState('');
  const [rawText, setRawText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (sharedIncomingText) {
      setRawText(sharedIncomingText);
      onConsumeSharedText();
    }
  }, [sharedIncomingText, onConsumeSharedText]);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim() || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await aiProvider.analyzeBusinessMessage({
        channel,
        senderLabel: senderLabel.trim() || 'Customer',
        messageText: rawText.trim(),
        displayName: settings.displayName,
      });

      const item: BusinessMessageItem = {
        id: createId('biz'),
        channel,
        senderLabel: senderLabel.trim() || 'Customer',
        rawText: rawText.trim(),
        summary: result.summary,
        urgency: result.urgency,
        detectedLanguage: result.detectedLanguage,
        draftReply: result.draftReply,
        status: 'new',
        createdAt: new Date().toISOString(),
      };
      await onSaveMessage(item);
      setRawText('');
      setSenderLabel('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to analyze message.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCopyReply = async (item: BusinessMessageItem) => {
    try {
      await navigator.clipboard.writeText(item.draftReply);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setError('Clipboard permission unavailable; select and copy the draft text manually.');
    }
  };

  const channelLabel = (ch: BusinessChannel) => {
    if (ch === 'whatsapp') return 'WhatsApp Business';
    if (ch === 'facebook') return 'Facebook';
    return 'Instagram';
  };

  return (
    <div className="space-y-5">
      {/* Honest Manual Mode Notice */}
      <section className="machine-card p-4 sm:p-5 space-y-3">
        <h1 className="section-title-gold text-base font-semibold">{t.business.title}</h1>
        <div className="flex items-start gap-2.5 text-xs text-[var(--text-muted)] leading-relaxed">
          <Info strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)] shrink-0 mt-0.5" />
          <p>{t.business.honestNote}</p>
        </div>
      </section>

      {/* Paste / Shared Message Form */}
      <section className="machine-card p-5">
        <form onSubmit={handleAnalyze} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">{t.business.channelLabel}</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as BusinessChannel)}
                className="w-full min-h-[44px] machine-input px-3.5 text-sm"
              >
                <option value="whatsapp">WhatsApp Business</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">{t.business.senderLabel}</label>
              <input
                type="text"
                value={senderLabel}
                onChange={(e) => setSenderLabel(e.target.value)}
                placeholder="e.g. Client inquiry"
                className="w-full min-h-[44px] machine-input px-3.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">{t.business.messageLabel}</label>
            <textarea
              rows={4}
              required
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={t.business.messagePlaceholder}
              className="w-full machine-input p-3.5 text-sm"
            />
          </div>

          {error && <p className="text-sm text-[var(--error)]">{error}</p>}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!rawText.trim() || analyzing}
              className="w-full sm:w-auto min-h-[48px] px-5 machine-btn-primary text-sm flex items-center justify-center gap-2"
            >
              <Sparkles strokeWidth={1.5} className="w-4 h-4" />
              <span>{analyzing ? t.business.analyzing : t.business.analyzeBtn}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Saved Business Messages */}
      {messages.length === 0 ? (
        <div className="machine-card p-8 text-center">
          <MessageCircle strokeWidth={1.5} className="w-8 h-8 text-[var(--gold-500)] mx-auto mb-3" />
          <h2 className="section-title-gold text-sm font-semibold">{t.business.emptyTitle}</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-md mx-auto">{t.business.emptyBody}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((item) => (
            <article key={item.id} className="machine-card p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-mono text-[var(--text-muted)] tabular-nums">
                    <span
                      className={
                        item.urgency === 'high'
                          ? 'text-[var(--status-critical)] font-semibold'
                          : item.urgency === 'medium'
                          ? 'text-[var(--status-elevated)]'
                          : 'text-[var(--gold-300)]'
                      }
                    >
                      {item.urgency.toUpperCase()}
                    </span>{' '}
                    · {channelLabel(item.channel)} · {item.senderLabel} · {item.detectedLanguage} ·{' '}
                    {formatShortDateTime(item.createdAt, settings.timezone)}
                  </p>
                  <p className="text-sm font-medium text-[var(--text)] mt-1">{item.summary}</p>
                </div>

                <button
                  type="button"
                  onClick={() => void onDeleteMessage(item.id)}
                  aria-label="Delete message"
                  className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--error)] flex items-center justify-center"
                >
                  <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                </button>
              </div>

              <div className="rounded-xl bg-[var(--bg)] border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
                {item.rawText}
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-mono text-[var(--gold-500)]">
                  Draft Reply ({item.detectedLanguage})
                </label>
                <textarea
                  rows={3}
                  value={item.draftReply}
                  onChange={(e) =>
                    void onSaveMessage({ ...item, draftReply: e.target.value })
                  }
                  className="w-full machine-input p-3 text-sm"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void onSaveMessage({
                        ...item,
                        status: item.status === 'replied' ? 'new' : 'replied',
                      })
                    }
                    className={`min-h-[44px] px-3.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition ${
                      item.status === 'replied'
                        ? 'bg-[var(--surface-2)] border-[var(--success)] text-[var(--success)]'
                        : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    <Check strokeWidth={1.5} className="w-3.5 h-3.5" />
                    <span>{item.status === 'replied' ? 'Replied' : t.business.markReplied}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCopyReply(item)}
                    className="min-h-[44px] px-4 machine-btn-primary text-xs flex items-center gap-1.5"
                  >
                    <Copy strokeWidth={1.5} className="w-3.5 h-3.5" />
                    <span>{copiedId === item.id ? t.business.copied : t.business.copyReply}</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
