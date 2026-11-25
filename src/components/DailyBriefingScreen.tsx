import React, { useState } from 'react';
import { Newspaper, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import type {
  BriefingItem,
  CalendarEventItem,
  EmailSummaryItem,
  MachineSettings,
  NoteItem,
  ReminderItem,
  TaskItem,
} from '../types/machine';
import { getTranslations } from '../i18n/translations';
import { createId } from '../db/storage';
import { aiProvider } from '../services/aiProvider';
import { formatNairobiDateTime, formatShortDateTime } from '../utils/datetime';
import { useSpeech } from '../hooks/useSpeech';
import type { GoogleConnectionStatus } from '../services/googleAuth';

interface DailyBriefingScreenProps {
  settings: MachineSettings;
  briefings: BriefingItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  notes: NoteItem[];
  calendarEvents: CalendarEventItem[];
  emailSummaries: EmailSummaryItem[];
  googleStatus: GoogleConnectionStatus;
  onSaveBriefing: (briefing: BriefingItem) => Promise<void>;
}

export const DailyBriefingScreen: React.FC<DailyBriefingScreenProps> = ({
  settings,
  briefings,
  tasks,
  reminders,
  notes,
  calendarEvents,
  emailSummaries,
  googleStatus,
  onSaveBriefing,
}) => {
  const t = getTranslations(settings.language);
  const { hasSpeechSynthesis, isSpeaking, speak, stopSpeaking, unlockAudio } = useSpeech();

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(briefings[0]?.id ?? null);

  const activeBriefing = briefings.find((b) => b.id === selectedId) ?? briefings[0] ?? null;

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const content = await aiProvider.generateDailyBriefing({
        settings,
        tasks,
        reminders,
        notes,
        calendarEvents,
        emailSummaries,
        googleConnected: googleStatus === 'connected',
      });
      const { dateStr } = formatNairobiDateTime(new Date(), settings.timezone);
      const item: BriefingItem = {
        id: createId('brief'),
        dateStr,
        content,
        createdAt: new Date().toISOString(),
        taskCount: tasks.filter((x) => x.status !== 'done').length,
        reminderCount: reminders.filter((x) => !x.completed).length,
        noteCount: notes.length,
      };
      await onSaveBriefing(item);
      setSelectedId(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate briefing.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="machine-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="section-title-gold text-base font-semibold">{t.briefing.title}</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1 tabular-nums font-mono">
            {tasks.filter((x) => x.status !== 'done').length} tasks ·{' '}
            {calendarEvents.length} calendar events ·{' '}
            {emailSummaries.filter((e) => e.urgency === 'high').length} urgent emails ·{' '}
            {reminders.filter((x) => !x.completed).length} alerts
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeBriefing && hasSpeechSynthesis && (
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                if (isSpeaking) {
                  stopSpeaking();
                } else {
                  speak(activeBriefing.content, {
                    rate: settings.voiceRate,
                    voiceURI: settings.voiceURI,
                    langHint: settings.language === 'sw' ? 'sw' : 'en',
                  });
                }
              }}
              className="min-h-[48px] px-4 machine-btn-secondary text-sm flex items-center gap-2 whitespace-nowrap"
            >
              {isSpeaking ? (
                <VolumeX strokeWidth={1.5} className="w-4 h-4 text-[var(--error)]" />
              ) : (
                <Volume2 strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
              )}
              <span>{isSpeaking ? t.briefing.stopReading : t.briefing.readAloud}</span>
            </button>
          )}
          <button
            type="button"
            disabled={generating}
            onClick={() => void handleGenerate()}
            className="min-h-[48px] px-5 machine-btn-primary text-sm flex items-center gap-2 whitespace-nowrap"
          >
            {generating ? (
              <span className="w-2.5 h-2.5 rounded-full bg-[#0A0A0A] machine-dot-pulse-fast" />
            ) : (
              <RefreshCw strokeWidth={1.5} className="w-4 h-4" />
            )}
            <span>{generating ? t.briefing.generating : t.briefing.generateBtn}</span>
          </button>
        </div>
      </section>

      {error && (
        <div className="machine-card border-[var(--error)]/70 p-3.5 flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--error)]">{error}</p>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            className="min-h-[44px] px-4 machine-btn-secondary text-xs"
          >
            {t.chat.retry}
          </button>
        </div>
      )}

      {briefings.length === 0 ? (
        <div className="machine-card p-10 text-center">
          <Newspaper strokeWidth={1.5} className="w-8 h-8 text-[var(--gold-500)] mx-auto mb-3" />
          <h2 className="section-title-gold text-sm font-semibold">{t.briefing.emptyTitle}</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-md mx-auto">{t.briefing.emptyBody}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {activeBriefing && (
            <article className="lg:col-span-8 machine-card machine-bubble-ai p-5 sm:p-6">
              <div className="pb-3 mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-[var(--gold-300)] tabular-nums">
                  {activeBriefing.dateStr} · {formatShortDateTime(activeBriefing.createdAt, settings.timezone)}
                </span>
                <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
                  {activeBriefing.taskCount} tasks · {activeBriefing.reminderCount} alerts · {activeBriefing.noteCount} notes
                </span>
              </div>
              <hr className="machine-divider mb-4" />
              <div className="text-sm sm:text-[15px] text-[var(--text)] whitespace-pre-wrap leading-relaxed font-sans">
                {activeBriefing.content}
              </div>
            </article>
          )}

          <aside className="lg:col-span-4 machine-card p-4">
            <h2 className="section-title-gold text-xs mb-3">{t.briefing.historyTitle}</h2>
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {briefings.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedId(b.id)}
                  className={`w-full text-left p-3 rounded-xl border transition min-h-[52px] ${
                    activeBriefing?.id === b.id
                      ? 'bg-[var(--surface-2)] border-[var(--gold-500)] text-[var(--gold-100)]'
                      : 'bg-transparent border-transparent hover:bg-[var(--surface-2)] text-[var(--text)]'
                  }`}
                >
                  <p className="font-mono text-xs font-medium text-[var(--gold-300)] tabular-nums">
                    {formatShortDateTime(b.createdAt, settings.timezone)}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] truncate mt-1">
                    {b.content.split('\n')[0]}
                  </p>
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};
