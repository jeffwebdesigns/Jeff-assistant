import React, { useState } from 'react';
import {
  Activity,
  Bell,
  BellRing,
  CalendarPlus,
  Check,
  Info,
  Plus,
  Smartphone,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  AlertCategoryPrefs,
  AlertLogItem,
  HourlyReportItem,
  MachineSettings,
  ReminderCategory,
  ReminderItem,
  ScreenId,
} from '../types/machine';
import { getTranslations } from '../i18n/translations';
import { createId } from '../db/storage';
import { formatShortDateTime, toLocalDateTimeInputValue } from '../utils/datetime';
import {
  dispatchSystemNotification,
  getNotificationPermission,
  requestNotificationPermission,
  type NotificationPermissionState,
} from '../services/notificationScheduler';
import { createCalendarEvent } from '../services/calendarService';
import type { GoogleConnectionStatus } from '../services/googleAuth';
import { formatTelemetryLine, type DeviceTelemetry } from '../services/hourlyUpdateService';
import { useSpeech } from '../hooks/useSpeech';
import { PWAInstallButton } from './PWAInstallButton';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { GoldToggle } from './GoldToggle';

interface RemindersScreenProps {
  settings: MachineSettings;
  reminders: ReminderItem[];
  alertLogs: AlertLogItem[];
  hourlyReports: HourlyReportItem[];
  deviceTelemetry: DeviceTelemetry | null;
  googleStatus: GoogleConnectionStatus;
  onSaveReminder: (reminder: ReminderItem) => Promise<void>;
  onDeleteReminder: (id: string) => Promise<void>;
  onUpdateSettings: (next: MachineSettings) => Promise<void>;
  onAddAlertLog: (log: AlertLogItem) => Promise<void>;
  onNavigate: (screen: ScreenId) => void;
  onCalendarEventAdded: () => Promise<void>;
  onRunHourlyUpdate: () => void;
}

export const RemindersScreen: React.FC<RemindersScreenProps> = ({
  settings,
  reminders,
  alertLogs,
  hourlyReports,
  deviceTelemetry,
  googleStatus,
  onSaveReminder,
  onDeleteReminder,
  onUpdateSettings,
  onAddAlertLog,
  onNavigate,
  onCalendarEventAdded,
  onRunHourlyUpdate,
}) => {
  const t = getTranslations(settings.language);
  const { isInstalled } = usePWAInstall();
  const { isSpeaking, speak, stopSpeaking, unlockAudio } = useSpeech();

  const [permState, setPermState] = useState<NotificationPermissionState>(() =>
    getNotificationPermission()
  );
  const [title, setTitle] = useState('');
  const [dueLocal, setDueLocal] = useState(() => toLocalDateTimeInputValue(undefined, settings.timezone));
  const [category, setCategory] = useState<ReminderCategory>('general');
  const [isMeeting, setIsMeeting] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [sparkleReminderId, setSparkleReminderId] = useState<string | null>(null);

  // Add to Google Calendar confirmation modal
  const [gcalDraftReminder, setGcalDraftReminder] = useState<ReminderItem | null>(null);
  const [gcalAdding, setGcalAdding] = useState(false);
  const [gcalMessage, setGcalMessage] = useState<string | null>(null);

  const handleRequestPerm = async () => {
    const res = await requestNotificationPermission();
    setPermState(res);
  };

  const handleSendTest = async () => {
    setTestStatus(null);
    const channel = await dispatchSystemNotification(
      'THE MACHINE — Test Alert',
      'Local alert pipeline is operational on this device.',
      `test_${Date.now()}`
    );
    const log: AlertLogItem = {
      id: createId('alog'),
      reminderId: 'test',
      title: 'Manual Test Alert',
      triggerType: 'test',
      firedAt: new Date().toISOString(),
      channel,
    };
    await onAddAlertLog(log);
    setTestStatus(
      channel === 'in_app'
        ? 'Notification permission is not granted; logged as in-app alert.'
        : `Test alert sent via ${channel === 'sw' ? 'Service Worker' : 'Browser Notification'}.`
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !dueLocal) return;
    const dueIso = new Date(`${dueLocal}:00+03:00`).toISOString();
    await onSaveReminder({
      id: createId('rem'),
      title: title.trim(),
      dueAt: dueIso,
      category,
      isMeeting: isMeeting || category === 'meeting',
      completed: false,
      firedKeys: [],
      createdAt: new Date().toISOString(),
      source: 'local',
    });
    setTitle('');
    setIsMeeting(false);
  };

  const handleConfirmAddToGoogleCalendar = async () => {
    if (!gcalDraftReminder || gcalAdding) return;
    setGcalAdding(true);
    setGcalMessage(null);
    try {
      const startMs = Date.parse(gcalDraftReminder.dueAt);
      const startIso = new Date(startMs).toISOString();
      const endIso = new Date(startMs + 60 * 60 * 1000).toISOString();
      const created = await createCalendarEvent({
        summary: gcalDraftReminder.title,
        startIso,
        endIso,
        timeZone: settings.timezone,
        settingsClientId: settings.googleClientId,
      });
      await onSaveReminder({
        ...gcalDraftReminder,
        externalEventId: created.id,
      });
      await onCalendarEventAdded();
      setGcalMessage(`Added "${gcalDraftReminder.title}" to Google Calendar with phone notifications.`);
      setGcalDraftReminder(null);
    } catch (err) {
      setGcalMessage(err instanceof Error ? err.message : 'Unable to add to Google Calendar.');
    } finally {
      setGcalAdding(false);
    }
  };

  const toggleCategory = async (cat: keyof AlertCategoryPrefs) => {
    await onUpdateSettings({
      ...settings,
      alertCategories: {
        ...settings.alertCategories,
        [cat]: !settings.alertCategories[cat],
      },
    });
  };

  const scheduled = reminders.filter((r) => !r.completed);
  const completed = reminders.filter((r) => r.completed);

  return (
    <div className="space-y-5">
      {/* Honest Reliability Banner */}
      <div className="machine-card px-4 py-3 flex items-start gap-2.5 text-xs text-[var(--text-muted)]">
        <Info strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)] shrink-0 mt-0.5" />
        <p className="leading-relaxed">{t.reminders.honestNote}</p>
      </div>

      {/* Top Grid: Create Reminder + Notification Permission */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="machine-card p-5">
          <h1 className="section-title-gold text-sm font-semibold mb-4">
            {t.reminders.addReminder}
          </h1>
          <form onSubmit={handleCreate} className="space-y-3.5">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">{t.reminders.fieldTitle}</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Call KCB branch manager..."
                className="w-full min-h-[44px] machine-input px-3.5 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">{t.reminders.fieldDueAt}</label>
                <input
                  type="datetime-local"
                  required
                  value={dueLocal}
                  onChange={(e) => setDueLocal(e.target.value)}
                  className="w-full min-h-[44px] machine-input px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">{t.reminders.fieldCategory}</label>
                <select
                  value={category}
                  onChange={(e) => {
                    const next = e.target.value as ReminderCategory;
                    setCategory(next);
                    if (next === 'meeting') setIsMeeting(true);
                  }}
                  className="w-full min-h-[44px] machine-input px-3 text-sm"
                >
                  <option value="general">{t.reminders.categories.general}</option>
                  <option value="meeting">{t.reminders.categories.meeting}</option>
                  <option value="finance">{t.reminders.categories.finance}</option>
                  <option value="errand">{t.reminders.categories.errand}</option>
                  <option value="health">{t.reminders.categories.health}</option>
                </select>
              </div>
            </div>

            <GoldToggle
              checked={isMeeting || category === 'meeting'}
              onChange={(next) => setIsMeeting(next)}
              label={t.reminders.fieldIsMeeting}
            />

            <button
              type="submit"
              className="w-full min-h-[48px] machine-btn-primary text-sm flex items-center justify-center gap-2"
            >
              <Plus strokeWidth={1.5} className="w-4 h-4" />
              <span>{t.reminders.save}</span>
            </button>
          </form>
        </section>

        {/* Permission & Install Card */}
        <section className="space-y-4">
          <div className="machine-card p-5 space-y-3">
            <div className="flex items-center gap-2.5">
              <BellRing strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
              <h2 className="section-title-gold text-sm font-semibold">
                {t.reminders.permissionTitle}
              </h2>
            </div>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">{t.reminders.permissionDesc}</p>

            {permState === 'default' && (
              <button
                type="button"
                onClick={handleRequestPerm}
                className="min-h-[44px] px-4 machine-btn-primary text-sm"
              >
                {t.reminders.permissionBtn}
              </button>
            )}
            {permState === 'granted' && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-mono text-[var(--success)]">
                  {t.reminders.permissionGranted}
                </span>
                <button
                  type="button"
                  onClick={() => void handleSendTest()}
                  className="min-h-[44px] px-3.5 machine-btn-secondary text-xs"
                >
                  {t.reminders.testAlert}
                </button>
              </div>
            )}
            {permState === 'denied' && (
              <p className="text-xs text-[var(--error)]">{t.reminders.permissionDenied}</p>
            )}
            {permState === 'unsupported' && (
              <p className="text-xs text-[var(--text-muted)]">{t.reminders.permissionUnsupported}</p>
            )}

            {testStatus && <p className="text-xs font-mono text-[var(--gold-300)]">{testStatus}</p>}
          </div>

          <div className="machine-card p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Smartphone strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
                <h2 className="section-title-gold text-sm font-semibold">
                  {t.reminders.installTitle}
                </h2>
              </div>
              <PWAInstallButton compact />
            </div>
            {isInstalled ? (
              <p className="text-xs font-mono text-[var(--success)]">{t.reminders.installedBadge}</p>
            ) : (
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t.reminders.installSteps}</p>
            )}
          </div>
        </section>
      </div>

      {gcalMessage && (
        <div className="machine-card border-[var(--gold-500)] px-4 py-3 text-sm text-[var(--gold-300)]">
          {gcalMessage}
        </div>
      )}

      {/* Scheduled Reminders */}
      <section className="machine-card p-5">
        <h2 className="section-title-gold text-sm font-semibold mb-3">
          {t.reminders.upcoming} ({scheduled.length})
        </h2>
        <hr className="machine-divider mb-2" />
        {scheduled.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-4">{t.reminders.noReminders}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {scheduled.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSparkleReminderId(r.id);
                      window.setTimeout(() => {
                        setSparkleReminderId((cur) => (cur === r.id ? null : cur));
                      }, 550);
                      void onSaveReminder({ ...r, completed: true });
                    }}
                    aria-label={`Complete ${r.title}`}
                    className="relative min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center shrink-0"
                  >
                    <span className="w-5 h-5 rounded border border-[var(--gold-700)] hover:border-[var(--gold-300)] transition" />
                    {sparkleReminderId === r.id && (
                      <Sparkles
                        strokeWidth={1.5}
                        className="w-5 h-5 text-[var(--gold-100)] absolute pointer-events-none machine-sparkle"
                      />
                    )}
                  </button>
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text)] truncate">{r.title}</p>
                    <p className="text-xs font-mono text-[var(--text-muted)] mt-0.5 tabular-nums">
                      {formatShortDateTime(r.dueAt, settings.timezone)} · {t.reminders.categories[r.category]}
                      {r.isMeeting ? ' · 1d, 1h & 10m alerts' : ''}
                      {r.externalEventId ? ' · Google Calendar' : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!r.externalEventId && (
                    <button
                      type="button"
                      onClick={() => {
                        if (googleStatus !== 'connected') {
                          onNavigate('google');
                        } else {
                          setGcalDraftReminder(r);
                        }
                      }}
                      className="min-h-[44px] px-3 machine-btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <CalendarPlus strokeWidth={1.5} className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{t.reminders.addToGCal}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void onDeleteReminder(r.id)}
                    aria-label="Delete reminder"
                    className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--error)] flex items-center justify-center shrink-0 transition"
                  >
                    <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {completed.length > 0 && (
          <div className="mt-5 pt-4">
            <hr className="machine-divider mb-3" />
            <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">
              {t.reminders.completed} ({completed.length})
            </h3>
            <ul className="divide-y divide-[var(--border)]">
              {completed.slice(0, 6).map((r) => (
                <li key={r.id} className="py-2 flex items-center justify-between gap-3 text-sm text-[var(--text-muted)]">
                  <button
                    type="button"
                    onClick={() => void onSaveReminder({ ...r, completed: false })}
                    className="flex items-center gap-2 min-h-[44px] text-left truncate"
                  >
                    <Check strokeWidth={1.75} className="w-4 h-4 text-[var(--gold-500)] shrink-0" />
                    <span className="line-through truncate">{r.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteReminder(r.id)}
                    aria-label="Delete completed reminder"
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--error)]"
                  >
                    <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Hourly Device & Activity Updates */}
      <section className="machine-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Activity strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
            <h2 className="section-title-gold text-sm font-semibold">
              HOURLY DEVICE &amp; ACTIVITY UPDATES
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              onRunHourlyUpdate();
            }}
            className="min-h-[44px] px-4 machine-btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap"
          >
            <Volume2 strokeWidth={1.5} className="w-4 h-4" />
            <span>Update &amp; Speak Now</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="px-3.5 py-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
            <GoldToggle
              checked={settings.hourlyUpdatesEnabled !== false}
              onChange={(next) => void onUpdateSettings({ ...settings, hourlyUpdatesEnabled: next })}
              label="Auto-update every 1 hour"
            />
          </div>
          <div className="px-3.5 py-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
            <GoldToggle
              checked={settings.hourlySpeakEnabled !== false}
              onChange={(next) => void onUpdateSettings({ ...settings, hourlySpeakEnabled: next })}
              label="Speak hourly report in English"
            />
          </div>
        </div>

        {deviceTelemetry && (
          <p className="text-xs font-mono text-[var(--gold-300)]">
            Live device: {formatTelemetryLine(deviceTelemetry)}
          </p>
        )}

        <hr className="machine-divider" />
        {hourlyReports.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-2">
            No hourly updates logged yet. Tap Update &amp; Speak Now to run your first device and activity summary.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)] max-h-72 overflow-y-auto">
            {hourlyReports.slice(0, 8).map((rep) => (
              <li key={rep.id} className="py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-[var(--gold-300)] tabular-nums">
                    {formatShortDateTime(rep.timestamp, settings.timezone)} · {rep.activityCount} actions
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      unlockAudio();
                      if (isSpeaking) {
                        stopSpeaking();
                      } else {
                        speak(rep.spokenSummary, {
                          rate: settings.voiceRate,
                          voiceURI: settings.voiceURI,
                          langHint: 'en',
                        });
                      }
                    }}
                    className="min-h-[36px] px-2.5 machine-btn-secondary text-xs flex items-center gap-1"
                  >
                    {isSpeaking ? (
                      <VolumeX strokeWidth={1.5} className="w-3.5 h-3.5" />
                    ) : (
                      <Volume2 strokeWidth={1.5} className="w-3.5 h-3.5" />
                    )}
                    <span>{isSpeaking ? 'Stop' : 'Speak'}</span>
                  </button>
                </div>
                <p className="text-sm text-[var(--text)] leading-relaxed">{rep.spokenSummary}</p>
                <p className="text-xs text-[var(--text-muted)] whitespace-pre-line">{rep.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Quiet Hours + Category Toggles + Alert History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="machine-card p-5 space-y-5">
          <div>
            <h2 className="section-title-gold text-sm font-semibold mb-3">
              {t.reminders.quietHours}
            </h2>
            <GoldToggle
              checked={settings.quietHoursEnabled}
              onChange={(next) =>
                void onUpdateSettings({ ...settings, quietHoursEnabled: next })
              }
              label={t.reminders.quietEnable}
            />
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">{t.reminders.quietStart}</label>
                <input
                  type="time"
                  value={settings.quietHoursStart}
                  onChange={(e) =>
                    void onUpdateSettings({ ...settings, quietHoursStart: e.target.value })
                  }
                  className="w-full min-h-[44px] machine-input px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">{t.reminders.quietEnd}</label>
                <input
                  type="time"
                  value={settings.quietHoursEnd}
                  onChange={(e) =>
                    void onUpdateSettings({ ...settings, quietHoursEnd: e.target.value })
                  }
                  className="w-full min-h-[44px] machine-input px-3 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="pt-2">
            <hr className="machine-divider mb-4" />
            <h2 className="section-title-gold text-sm font-semibold mb-2.5">
              {t.reminders.categoryToggles}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(['meeting', 'finance', 'errand', 'health', 'general'] as const).map((cat) => (
                <div
                  key={cat}
                  className="px-3 py-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]"
                >
                  <GoldToggle
                    checked={settings.alertCategories[cat]}
                    onChange={() => void toggleCategory(cat)}
                    label={t.reminders.categories[cat]}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="machine-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Bell strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
            <h2 className="section-title-gold text-sm font-semibold">
              {t.reminders.alertHistory}
            </h2>
          </div>
          <hr className="machine-divider mb-2" />
          {alertLogs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-6">{t.reminders.noHistory}</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] max-h-72 overflow-y-auto">
              {alertLogs.slice(0, 25).map((log) => (
                <li key={log.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text)] truncate">{log.title}</p>
                    <p className="text-xs font-mono text-[var(--text-muted)]">
                      {log.triggerType} · {log.channel}
                    </p>
                  </div>
                  <span className="text-xs font-mono text-[var(--gold-300)] tabular-nums shrink-0">
                    {formatShortDateTime(log.firedAt, settings.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Add to Google Calendar Confirmation Modal */}
      {gcalDraftReminder && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md machine-card border-[var(--gold-500)] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="section-title-gold text-base font-semibold">
                {t.reminders.addToGCal}
              </h2>
              <button
                type="button"
                onClick={() => setGcalDraftReminder(null)}
                aria-label="Close"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--gold-300)]"
              >
                <X strokeWidth={1.5} className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Google Calendar provides native phone notifications even when THE MACHINE is closed.
            </p>
            <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--border)] p-3.5 text-sm space-y-1">
              <p className="font-medium text-[var(--text)]">{gcalDraftReminder.title}</p>
              <p className="text-xs font-mono text-[var(--gold-300)] tabular-nums">
                {formatShortDateTime(gcalDraftReminder.dueAt, settings.timezone)} (1 hour duration)
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setGcalDraftReminder(null)}
                className="min-h-[44px] px-4 machine-btn-ghost text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={gcalAdding}
                onClick={() => void handleConfirmAddToGoogleCalendar()}
                className="min-h-[44px] px-4 machine-btn-primary text-xs"
              >
                {gcalAdding ? 'Adding...' : 'Confirm & Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
