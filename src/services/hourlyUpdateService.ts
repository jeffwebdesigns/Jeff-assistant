import type {
  ActivityEventItem,
  CalendarEventItem,
  EmailSummaryItem,
  HourlyReportItem,
  MachineSettings,
  NoteItem,
  ReminderItem,
  TaskItem,
} from '../types/machine';
import { createId } from '../db/storage';
import { formatNairobiDateTime, formatShortDateTime } from '../utils/datetime';
import type { GoogleConnectionStatus } from './googleAuth';
import { getNotificationPermission } from './notificationScheduler';

export interface DeviceTelemetry {
  deviceLabel: string;
  displayMode: 'Installed App' | 'Browser Tab';
  online: boolean;
  networkLabel: string;
  batteryLabel: string;
  storageLabel: string;
  notificationsLabel: string;
  googleLabel: string;
  activeState: string;
}

interface BatteryManagerLike {
  level: number;
  charging: boolean;
}

interface NavigatorWithExtras extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
  connection?: { effectiveType?: string; downlink?: number; saveData?: boolean };
}

export function detectDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'This Device';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Android Device';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS Device';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Mac OS X/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux Device';
  return 'Web Device';
}

export async function collectDeviceTelemetry(params: {
  googleStatus: GoogleConnectionStatus;
  remainingSeconds: number;
}): Promise<DeviceTelemetry> {
  const nav = typeof navigator !== 'undefined' ? (navigator as NavigatorWithExtras) : null;
  const deviceLabel = detectDeviceLabel();

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (nav as unknown as { standalone?: boolean })?.standalone === true);
  const displayMode = isStandalone ? 'Installed App' : 'Browser Tab';

  const online = nav ? nav.onLine !== false : true;
  const conn = nav?.connection;
  const networkLabel = online
    ? conn?.effectiveType
      ? `Online (${conn.effectiveType.toUpperCase()})`
      : 'Online'
    : 'Offline';

  let batteryLabel = 'Unavailable';
  try {
    if (nav?.getBattery) {
      const bat = await Promise.race([
        nav.getBattery(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 600)),
      ]);
      if (bat && typeof bat.level === 'number') {
        const pct = Math.round(bat.level * 100);
        batteryLabel = `${pct}%${bat.charging ? ' (charging)' : ''}`;
      }
    }
  } catch {
    batteryLabel = 'Unavailable';
  }

  let storageLabel = 'Local DB active';
  try {
    if (nav?.storage?.estimate) {
      const est = await Promise.race([
        nav.storage.estimate(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 600)),
      ]);
      if (est && typeof est.usage === 'number') {
        const mb = (est.usage / (1024 * 1024)).toFixed(1);
        storageLabel = `${mb} MB stored`;
      }
    }
  } catch {
    // keep fallback
  }

  const perm = getNotificationPermission();
  const notificationsLabel =
    perm === 'granted' ? 'Enabled' : perm === 'denied' ? 'Blocked' : 'Not Enabled';

  const googleLabel =
    params.googleStatus === 'connected'
      ? `Connected (${Math.max(1, Math.ceil(params.remainingSeconds / 60))}m left)`
      : params.googleStatus === 'expired'
      ? 'Session Expired'
      : 'Not Connected';

  const activeState =
    typeof document !== 'undefined' && document.visibilityState === 'hidden'
      ? 'Background'
      : 'Active on screen';

  return {
    deviceLabel,
    displayMode,
    online,
    networkLabel,
    batteryLabel,
    storageLabel,
    notificationsLabel,
    googleLabel,
    activeState,
  };
}

export function formatTelemetryLine(t: DeviceTelemetry): string {
  const parts = [
    `${t.deviceLabel} (${t.displayMode})`,
    t.networkLabel,
    t.batteryLabel !== 'Unavailable' ? `Battery ${t.batteryLabel}` : '',
    t.storageLabel,
    `Alerts: ${t.notificationsLabel}`,
    `Google: ${t.googleLabel}`,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function buildHourlyUpdateReport(params: {
  telemetry: DeviceTelemetry;
  settings: MachineSettings;
  activityLogs: ActivityEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  notes: NoteItem[];
  calendarEvents: CalendarEventItem[];
  emailSummaries: EmailSummaryItem[];
}): HourlyReportItem {
  const now = new Date();
  const nowMs = now.getTime();
  const oneHourAgoMs = nowMs - 60 * 60 * 1000;
  const oneHourAheadMs = nowMs + 60 * 60 * 1000;
  const { timeStr, isoDate } = formatNairobiDateTime(now, params.settings.timezone);

  const recentActivity = params.activityLogs.filter((ev) => {
    const ts = Date.parse(ev.timestamp);
    return !Number.isNaN(ts) && ts >= oneHourAgoMs;
  });

  const completedThisHour = params.tasks.filter((tk) => {
    const ts = Date.parse(tk.updatedAt);
    return tk.status === 'done' && !Number.isNaN(ts) && ts >= oneHourAgoMs;
  });

  const openTasks = params.tasks.filter((tk) => tk.status !== 'done');
  const overdueTasks = openTasks.filter((tk) => tk.dueDate && tk.dueDate < isoDate);
  const dueSoonReminders = params.reminders.filter((r) => {
    if (r.completed) return false;
    const ms = Date.parse(r.dueAt);
    return !Number.isNaN(ms) && ms >= nowMs && ms <= oneHourAheadMs;
  });
  const missedReminders = params.reminders.filter((r) => {
    if (r.completed) return false;
    const ms = Date.parse(r.dueAt);
    return !Number.isNaN(ms) && ms < nowMs;
  });
  const upcomingEvents = params.calendarEvents.filter((ev) => {
    const ms = Date.parse(ev.startIso);
    return !Number.isNaN(ms) && ms >= nowMs && ms <= nowMs + 2 * 60 * 60 * 1000;
  });
  const urgentEmails = params.emailSummaries.filter((em) => em.urgency === 'high');

  const deviceSnapshot = formatTelemetryLine(params.telemetry);

  // Deduplicate/summarize recent actions cleanly
  const topActions = recentActivity
    .slice(0, 5)
    .map((a) => `- ${a.action}${a.detail ? `: ${a.detail}` : ''}`);

  const lines: string[] = [
    `HOURLY DEVICE & ACTIVITY REPORT (${timeStr})`,
    `Device: ${deviceSnapshot}`,
    recentActivity.length > 0
      ? `Your Activity (Last 1 Hour · ${recentActivity.length} actions):\n${topActions.join('\n')}`
      : 'Your Activity (Last 1 Hour): App idle or no new actions recorded inside THE MACHINE.',
    `Pending Workload: ${openTasks.length} open tasks (${overdueTasks.length} overdue), ${missedReminders.length} missed reminders, ${dueSoonReminders.length} reminders due within 1 hour, ${params.notes.length} saved notes.`,
  ];

  if (completedThisHour.length > 0) {
    lines.push(
      `Completed Last Hour: ${completedThisHour.map((t) => t.title).slice(0, 3).join(', ')}`
    );
  }
  if (dueSoonReminders.length > 0) {
    lines.push(
      `Coming Up Next Hour: ${dueSoonReminders
        .slice(0, 3)
        .map((r) => `${r.title} (${formatShortDateTime(r.dueAt, params.settings.timezone)})`)
        .join('; ')}`
    );
  }
  if (upcomingEvents.length > 0) {
    lines.push(
      `Calendar (Next 2 Hours): ${upcomingEvents
        .slice(0, 2)
        .map((e) => `${e.summary} (${formatShortDateTime(e.startIso, params.settings.timezone)})`)
        .join('; ')}`
    );
  }
  if (urgentEmails.length > 0) {
    lines.push(`Urgent Gmail: ${urgentEmails.length} high-priority email(s) flagged.`);
  }

  // Concise spoken English script
  const speechParts: string[] = [
    `Hourly update at ${timeStr.slice(0, 5)}.`,
    `This ${params.telemetry.deviceLabel.toLowerCase()} is ${params.telemetry.networkLabel.toLowerCase()}${
      params.telemetry.batteryLabel !== 'Unavailable'
        ? ` with battery at ${params.telemetry.batteryLabel}`
        : ''
    }.`,
  ];

  if (recentActivity.length > 0) {
    const latest = recentActivity[0];
    speechParts.push(
      `In the past hour, you recorded ${recentActivity.length} action${recentActivity.length === 1 ? '' : 's'}, most recently ${latest.action.toLowerCase()}${
        latest.detail ? ` (${latest.detail})` : ''
      }.`
    );
  } else {
    speechParts.push('No new activity was recorded in THE MACHINE over the past hour.');
  }

  speechParts.push(
    `You have ${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}${
      overdueTasks.length > 0 ? `, including ${overdueTasks.length} overdue` : ''
    }.`
  );

  if (dueSoonReminders.length > 0) {
    speechParts.push(
      `Coming up within the hour: ${dueSoonReminders.map((r) => r.title).slice(0, 2).join(' and ')}.`
    );
  } else if (missedReminders.length > 0) {
    speechParts.push(`You have ${missedReminders.length} missed reminder waiting.`);
  }

  if (urgentEmails.length > 0) {
    speechParts.push(`${urgentEmails.length} urgent email requires attention.`);
  }

  return {
    id: createId('hourly'),
    timestamp: now.toISOString(),
    summary: lines.join('\n\n'),
    spokenSummary: speechParts.join(' '),
    deviceSnapshot,
    activityCount: recentActivity.length,
  };
}
