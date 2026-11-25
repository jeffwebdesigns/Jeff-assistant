import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Check,
  CheckSquare,
  FileText,
  Mic,
  MicOff,
  Newspaper,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import type {
  BriefingItem,
  CatchUpItem,
  MachineSettings,
  NoteItem,
  ReminderItem,
  ScreenId,
  TaskItem,
} from '../types/machine';
import { getTranslations } from '../i18n/translations';
import { formatNairobiDateTime, formatShortDateTime } from '../utils/datetime';
import { useSpeech } from '../hooks/useSpeech';

interface CommandCenterProps {
  settings: MachineSettings;
  tasks: TaskItem[];
  reminders: ReminderItem[];
  notes: NoteItem[];
  briefings: BriefingItem[];
  catchUpItems: CatchUpItem[];
  isThinking: boolean;
  onNavigate: (screen: ScreenId) => void;
  onQuickChat: (prompt: string) => void;
  onQuickParse: (text: string) => void;
  onToggleTaskStatus: (task: TaskItem) => void;
  onRunCatchUp: () => void;
}

export const CommandCenter: React.FC<CommandCenterProps> = ({
  settings,
  tasks,
  reminders,
  notes,
  briefings,
  catchUpItems,
  isThinking,
  onNavigate,
  onQuickChat,
  onQuickParse,
  onToggleTaskStatus,
  onRunCatchUp,
}) => {
  const t = getTranslations(settings.language);
  const [now, setNow] = useState(() => new Date());
  const [commandInput, setCommandInput] = useState('');
  const [sparkleTaskId, setSparkleTaskId] = useState<string | null>(null);
  const { hasSpeechRecognition, isListening, startListening, stopListening, unlockAudio } = useSpeech();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { dateStr, timeStr, isoDate } = formatNairobiDateTime(now, settings.timezone);

  const pendingTasks = tasks.filter((tk) => tk.status !== 'done');
  const todaysTasks = pendingTasks
    .filter((tk) => !tk.dueDate || tk.dueDate <= isoDate)
    .slice(0, 5);
  const displayTasks = todaysTasks.length > 0 ? todaysTasks : pendingTasks.slice(0, 5);

  const upcomingReminders = reminders
    .filter((r) => !r.completed)
    .slice(0, 5);

  const recentNotes = notes.slice(0, 4);
  const latestBriefing = briefings[0];

  const hasCritical = catchUpItems.some(
    (item) => item.kind === 'calendar_clash' || item.kind === 'missed_reminder'
  );
  const hasElevated = !hasCritical && catchUpItems.length > 0;

  const statusText = isThinking
    ? t.statusThinking
    : hasCritical
    ? t.statusCritical
    : hasElevated
    ? t.statusElevated
    : t.statusNominal;

  const statusDotClass = isThinking
    ? 'bg-[var(--gold-300)] machine-dot-pulse-fast'
    : hasCritical
    ? 'bg-[var(--status-critical)] machine-dot-pulse-fast'
    : hasElevated
    ? 'bg-[var(--status-elevated)] machine-dot-pulse-fast'
    : 'bg-[var(--status-nominal)] machine-dot-pulse';

  const statusTextClass = hasCritical
    ? 'text-[var(--status-critical)]'
    : hasElevated
    ? 'text-[var(--status-elevated)]'
    : 'gold-text-gradient';

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commandInput.trim();
    if (!trimmed) return;
    setCommandInput('');
    onQuickChat(trimmed);
  };

  const handleParseClick = () => {
    const trimmed = commandInput.trim();
    if (!trimmed) return;
    setCommandInput('');
    onQuickParse(trimmed);
  };

  const kindLabel = (kind: CatchUpItem['kind']) => {
    if (kind === 'missed_reminder') return 'MISSED ALERT';
    if (kind === 'overdue_task') return 'OVERDUE TASK';
    if (kind === 'urgent_email') return 'URGENT EMAIL';
    return 'CALENDAR CLASH';
  };

  const handleTaskToggle = (task: TaskItem) => {
    if (task.status !== 'done') {
      setSparkleTaskId(task.id);
      window.setTimeout(() => {
        setSparkleTaskId((cur) => (cur === task.id ? null : cur));
      }, 600);
    }
    onToggleTaskStatus(task);
  };

  return (
    <div className="space-y-6">
      {/* Status Header + Pill Command Bar */}
      <section className="machine-card p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDotClass}`}
                aria-hidden="true"
              />
              <h1 className={`font-cinzel text-lg sm:text-xl font-semibold ${statusTextClass}`}>
                {statusText}
              </h1>
            </div>
            <p className="text-sm text-[var(--text-muted)] mt-1.5">
              {settings.displayName} <span aria-hidden="true">·</span> {t.command.greeting}
            </p>
          </div>

          <div className="sm:text-right font-mono tabular-nums">
            <div className="text-xl sm:text-2xl font-semibold text-[var(--text)] tracking-tight">
              {timeStr}
            </div>
            <div className="text-xs text-[var(--gold-500)] mt-0.5">
              {dateStr} <span aria-hidden="true">·</span> {settings.timezone} <span aria-hidden="true">·</span> {settings.currency}
            </div>
          </div>
        </div>

        {/* Pill Command Bar with gold border and small gold send icon */}
        <form onSubmit={handleChatSubmit} className="mt-5 space-y-3">
          <div className="flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] border border-[var(--gold-700)] focus-within:border-[var(--gold-500)] focus-within:ring-2 focus-within:ring-[var(--gold-500)]/30 px-2 py-1 transition">
            {hasSpeechRecognition && (
              <button
                type="button"
                onClick={() => {
                  unlockAudio();
                  if (isListening) {
                    stopListening();
                  } else {
                    startListening(settings.voiceInputLang, (transcript) => {
                      setCommandInput(transcript);
                    });
                  }
                }}
                aria-label={isListening ? t.chat.micStop : t.chat.micStart}
                className={`min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center transition shrink-0 ${
                  isListening
                    ? 'bg-[var(--gold-500)] text-[var(--text-on-gold)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--gold-300)]'
                }`}
              >
                {isListening ? (
                  <MicOff strokeWidth={1.5} className="w-5 h-5" />
                ) : (
                  <Mic strokeWidth={1.5} className="w-5 h-5" />
                )}
              </button>
            )}
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder={isListening ? t.chat.micStop : t.command.quickPlaceholder}
              aria-label={t.command.quickPlaceholder}
              className="flex-1 min-h-[44px] bg-transparent border-0 focus:outline-none px-3 text-sm text-[var(--text)] placeholder-[var(--text-muted)]/75"
            />
            <button
              type="submit"
              disabled={!commandInput.trim()}
              onClick={() => unlockAudio()}
              aria-label={t.command.sendToChat}
              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-[var(--gold-500)] hover:bg-[var(--gold-500)]/15 hover:text-[var(--gold-300)] disabled:opacity-35 disabled:cursor-not-allowed transition shrink-0"
            >
              <Send strokeWidth={1.5} className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={!commandInput.trim()}
              onClick={() => unlockAudio()}
              className="flex-1 sm:flex-initial min-h-[44px] px-4 machine-btn-primary text-sm flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
            >
              <Send strokeWidth={1.5} className="w-4 h-4" />
              <span>{t.command.sendToChat}</span>
            </button>
            <button
              type="button"
              onClick={handleParseClick}
              disabled={!commandInput.trim()}
              className="flex-1 sm:flex-initial min-h-[44px] px-4 machine-btn-secondary text-sm flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
            >
              <Sparkles strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
              <span>{t.command.parseAction}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Priority Catch-Up Feed */}
      <section className="machine-card p-5">
        <div className="flex items-center justify-between gap-3 pb-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle
              strokeWidth={1.5}
              className={`w-4 h-4 ${
                hasCritical
                  ? 'text-[var(--status-critical)]'
                  : hasElevated
                  ? 'text-[var(--status-elevated)]'
                  : 'text-[var(--gold-500)]'
              }`}
            />
            <h2 className="section-title-gold text-sm font-semibold">
              {t.command.priorityFeed} ({catchUpItems.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={onRunCatchUp}
            className="min-h-[44px] px-3 text-xs font-mono text-[var(--gold-300)] hover:text-[var(--gold-100)] flex items-center gap-1.5 transition whitespace-nowrap shrink-0"
          >
            <RefreshCw strokeWidth={1.5} className="w-3.5 h-3.5" />
            <span>{t.command.runCatchUp}</span>
          </button>
        </div>
        <hr className="machine-divider" />

        {catchUpItems.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-4">{t.command.priorityEmpty}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] mt-1">
            {catchUpItems.slice(0, 8).map((item) => {
              const isCrit = item.kind === 'calendar_clash' || item.kind === 'missed_reminder';
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.targetScreen)}
                    className="w-full py-3 flex items-center justify-between gap-3 text-left hover:bg-[var(--surface-2)] px-2.5 -mx-2.5 rounded-xl transition min-h-[52px]"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-xs font-mono flex items-center gap-1.5 ${
                          isCrit ? 'text-[var(--status-critical)]' : 'text-[var(--status-elevated)]'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isCrit ? 'bg-[var(--status-critical)]' : 'bg-[var(--status-elevated)]'
                          }`}
                        />
                        {kindLabel(item.kind)}
                      </p>
                      <p className="text-sm font-medium text-[var(--text)] truncate mt-0.5">
                        {item.title}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                        {item.detail}
                      </p>
                    </div>
                    <ArrowRight strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-700)] shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 4 Summary Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Today's Tasks */}
        <section className="machine-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-3 pb-3">
              <div className="flex items-center gap-2.5">
                <CheckSquare strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
                <h2 className="section-title-gold text-sm font-semibold">
                  {t.command.todaysTasks}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('notes_tasks')}
                className="min-h-[44px] px-2.5 text-xs font-mono text-[var(--gold-300)] hover:text-[var(--gold-100)] flex items-center gap-1 transition whitespace-nowrap shrink-0"
              >
                <span>{t.command.openTasks}</span>
                <ArrowRight strokeWidth={1.5} className="w-3.5 h-3.5" />
              </button>
            </div>
            <hr className="machine-divider" />

            {displayTasks.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-6">{t.command.noTasksToday}</p>
            ) : (
              <ul className="divide-y divide-[var(--border)] mt-1">
                {displayTasks.map((task) => (
                  <li key={task.id} className="py-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleTaskToggle(task)}
                      aria-label={`Toggle ${task.title}`}
                      className="relative min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center shrink-0"
                    >
                      <span
                        className={`w-5 h-5 rounded border flex items-center justify-center transition ${
                          task.status === 'done'
                            ? 'bg-[var(--gold-500)] border-[var(--gold-500)] text-[#0A0A0A]'
                            : 'border-[var(--gold-700)] hover:border-[var(--gold-300)]'
                        }`}
                      >
                        {task.status === 'done' && <Check strokeWidth={2} className="w-3.5 h-3.5" />}
                      </span>
                      {sparkleTaskId === task.id && (
                        <Sparkles
                          strokeWidth={1.5}
                          className="w-5 h-5 text-[var(--gold-100)] absolute pointer-events-none machine-sparkle"
                        />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm truncate ${
                          task.status === 'done'
                            ? 'line-through text-[var(--text-muted)]'
                            : 'text-[var(--text)]'
                        }`}
                      >
                        {task.title}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5 tabular-nums font-mono">
                        {t.notesTasks.priorities[task.priority]}
                        {task.dueDate ? ` · ${task.dueDate}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Upcoming Reminders */}
        <section className="machine-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-3 pb-3">
              <div className="flex items-center gap-2.5">
                <Bell strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
                <h2 className="section-title-gold text-sm font-semibold">
                  {t.command.upcomingReminders}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reminders')}
                className="min-h-[44px] px-2.5 text-xs font-mono text-[var(--gold-300)] hover:text-[var(--gold-100)] flex items-center gap-1 transition whitespace-nowrap shrink-0"
              >
                <span>{t.command.openAlerts}</span>
                <ArrowRight strokeWidth={1.5} className="w-3.5 h-3.5" />
              </button>
            </div>
            <hr className="machine-divider" />

            {upcomingReminders.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-6">{t.command.noReminders}</p>
            ) : (
              <ul className="divide-y divide-[var(--border)] mt-1">
                {upcomingReminders.map((rem) => (
                  <li key={rem.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text)] truncate">{rem.title}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5 tabular-nums">
                        {t.reminders.categories[rem.category]}
                        {rem.isMeeting ? ' · 1d, 1h & 10m alerts' : ''}
                      </p>
                    </div>
                    <span className="text-xs font-mono text-[var(--gold-300)] tabular-nums whitespace-nowrap shrink-0">
                      {formatShortDateTime(rem.dueAt, settings.timezone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Recent Notes */}
        <section className="machine-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-3 pb-3">
              <div className="flex items-center gap-2.5">
                <FileText strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
                <h2 className="section-title-gold text-sm font-semibold">
                  {t.command.recentNotes}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('notes_tasks')}
                className="min-h-[44px] px-2.5 text-xs font-mono text-[var(--gold-300)] hover:text-[var(--gold-100)] flex items-center gap-1 transition whitespace-nowrap shrink-0"
              >
                <span>{t.command.viewAll}</span>
                <ArrowRight strokeWidth={1.5} className="w-3.5 h-3.5" />
              </button>
            </div>
            <hr className="machine-divider" />

            {recentNotes.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-6">{t.command.noNotes}</p>
            ) : (
              <ul className="divide-y divide-[var(--border)] mt-1">
                {recentNotes.map((note) => (
                  <li key={note.id} className="py-3">
                    <p className="text-sm font-medium text-[var(--text)] truncate">{note.title}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">{note.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Latest Briefing */}
        <section className="machine-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-3 pb-3">
              <div className="flex items-center gap-2.5">
                <Newspaper strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
                <h2 className="section-title-gold text-sm font-semibold">
                  {t.command.latestBriefing}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('briefing')}
                className="min-h-[44px] px-2.5 text-xs font-mono text-[var(--gold-300)] hover:text-[var(--gold-100)] flex items-center gap-1 transition whitespace-nowrap shrink-0"
              >
                <span>{latestBriefing ? t.command.viewAll : t.command.generateNow}</span>
                <ArrowRight strokeWidth={1.5} className="w-3.5 h-3.5" />
              </button>
            </div>
            <hr className="machine-divider" />

            {!latestBriefing ? (
              <div className="py-6">
                <p className="text-sm text-[var(--text-muted)] mb-3">{t.command.noBriefing}</p>
                <button
                  type="button"
                  onClick={() => onNavigate('briefing')}
                  className="min-h-[44px] px-4 machine-btn-secondary text-sm"
                >
                  {t.command.generateNow}
                </button>
              </div>
            ) : (
              <div className="pt-3">
                <p className="text-xs font-mono text-[var(--gold-500)] tabular-nums mb-2">
                  {formatShortDateTime(latestBriefing.createdAt, settings.timezone)}
                </p>
                <p className="text-sm text-[var(--text)] whitespace-pre-line line-clamp-6 leading-relaxed">
                  {latestBriefing.content}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
