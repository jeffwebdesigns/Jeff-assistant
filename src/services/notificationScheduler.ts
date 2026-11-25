import { createId, dbStorage } from '../db/storage';
import type { AlertLogItem, MachineSettings, ReminderItem, TaskItem } from '../types/machine';
import { formatNairobiDateTime, formatShortDateTime, isWithinQuietHours } from '../utils/datetime';

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.requestPermission();
}

export async function dispatchSystemNotification(
  title: string,
  body: string,
  tag: string
): Promise<'sw' | 'notification' | 'in_app'> {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
    return 'in_app';
  }

  try {
    if ('serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          tag,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
        });
        return 'sw';
      }
    }
  } catch {
    // Fallback to browser Notification below
  }

  try {
    new Notification(title, {
      body,
      tag,
      icon: '/pwa-192x192.png',
    });
    return 'notification';
  } catch {
    return 'in_app';
  }
}

export async function evaluateDueReminders(
  reminders: ReminderItem[],
  tasks: TaskItem[],
  settings: MachineSettings
): Promise<{
  updatedReminders: ReminderItem[];
  updatedSettings: MachineSettings;
  newLogs: AlertLogItem[];
  inAppBanner?: string;
}> {
  const now = new Date();
  const nowMs = now.getTime();
  const quiet = isWithinQuietHours(
    now,
    settings.quietHoursEnabled,
    settings.quietHoursStart,
    settings.quietHoursEnd,
    settings.timezone
  );

  const updatedReminders: ReminderItem[] = [];
  const newLogs: AlertLogItem[] = [];
  let inAppBanner: string | undefined;

  for (const r of reminders) {
    if (r.completed) {
      updatedReminders.push(r);
      continue;
    }

    const categoryAllowed = settings.alertCategories[r.category] ?? true;
    if (!categoryAllowed) {
      updatedReminders.push(r);
      continue;
    }

    const dueMs = Date.parse(r.dueAt);
    if (Number.isNaN(dueMs)) {
      updatedReminders.push(r);
      continue;
    }

    const firedKeys = [...(r.firedKeys ?? [])];
    let changed = false;

    const triggers: Array<{
      key: '1d_before' | '1h_before' | '10m_before' | 'due';
      atMs: number;
      label: string;
    }> = [];

    if (r.isMeeting || r.category === 'meeting') {
      triggers.push({
        key: '1d_before',
        atMs: dueMs - 24 * 60 * 60 * 1000,
        label: 'Meeting tomorrow (1 day)',
      });
      triggers.push({
        key: '1h_before',
        atMs: dueMs - 60 * 60 * 1000,
        label: 'Meeting in 1 hour',
      });
      triggers.push({
        key: '10m_before',
        atMs: dueMs - 10 * 60 * 1000,
        label: 'Meeting in 10 minutes',
      });
    }

    triggers.push({
      key: 'due',
      atMs: dueMs,
      label: 'Due now',
    });

    for (const trig of triggers) {
      if (firedKeys.includes(trig.key)) continue;
      const delta = nowMs - trig.atMs;
      if (delta >= 0 && delta <= 24 * 60 * 60 * 1000) {
        // Avoid firing an earlier pre-alert once a closer stage or due time has arrived
        if (trig.key === '1d_before' && nowMs >= dueMs - 60 * 60 * 1000) {
          firedKeys.push(trig.key);
          changed = true;
          continue;
        }
        if ((trig.key === '1h_before' || trig.key === '10m_before') && nowMs >= dueMs) {
          firedKeys.push(trig.key);
          changed = true;
          continue;
        }
        if (quiet) continue;

        const channel = await dispatchSystemNotification(
          `THE MACHINE — ${trig.label}`,
          `${r.title} (${formatShortDateTime(r.dueAt, settings.timezone)})`,
          `${r.id}_${trig.key}`
        );

        const log: AlertLogItem = {
          id: createId('alog'),
          reminderId: r.id,
          title: r.title,
          triggerType: trig.key,
          firedAt: now.toISOString(),
          channel,
        };
        await dbStorage.saveAlertLog(log);
        newLogs.push(log);
        firedKeys.push(trig.key);
        changed = true;
        inAppBanner = `${trig.label}: ${r.title}`;
      }
    }

    if (changed) {
      const updated = { ...r, firedKeys };
      await dbStorage.saveReminder(updated);
      updatedReminders.push(updated);
    } else {
      updatedReminders.push(r);
    }
  }

  // Overdue-task nudge (once per Nairobi calendar day)
  let updatedSettings = settings;
  const { isoDate: todayNairobi } = formatNairobiDateTime(now, settings.timezone);
  if (!quiet && settings.lastOverdueNudgeDate !== todayNairobi) {
    const overdueTasks = tasks.filter(
      (tk) => tk.status !== 'done' && Boolean(tk.dueDate) && tk.dueDate! < todayNairobi
    );
    if (overdueTasks.length > 0) {
      const summaryLine =
        overdueTasks.length === 1
          ? overdueTasks[0].title
          : `${overdueTasks.length} overdue tasks (e.g. ${overdueTasks[0].title})`;

      const channel = await dispatchSystemNotification(
        'THE MACHINE — Overdue Task Nudge',
        summaryLine,
        `overdue_${todayNairobi}`
      );

      const log: AlertLogItem = {
        id: createId('alog'),
        reminderId: 'overdue_tasks',
        title: summaryLine,
        triggerType: 'overdue_task',
        firedAt: now.toISOString(),
        channel,
      };
      await dbStorage.saveAlertLog(log);
      newLogs.push(log);
      updatedSettings = { ...settings, lastOverdueNudgeDate: todayNairobi };
      await dbStorage.saveSettings(updatedSettings);
      if (!inAppBanner) {
        inAppBanner = `Overdue task nudge: ${summaryLine}`;
      }
    }
  }

  return { updatedReminders, updatedSettings, newLogs, inAppBanner };
}
