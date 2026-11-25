import type {
  CalendarEventItem,
  CatchUpItem,
  EmailSummaryItem,
  ReminderItem,
  TaskItem,
} from '../types/machine';
import { formatNairobiDateTime, formatShortDateTime } from '../utils/datetime';
import { detectCalendarClashes } from './calendarService';

export function runCatchUpScan(params: {
  reminders: ReminderItem[];
  tasks: TaskItem[];
  emailSummaries: EmailSummaryItem[];
  calendarEvents: CalendarEventItem[];
  timezone: string;
}): CatchUpItem[] {
  const now = new Date();
  const nowMs = now.getTime();
  const { isoDate: todayIso } = formatNairobiDateTime(now, params.timezone);
  const feed: CatchUpItem[] = [];

  // 1. Missed or due reminders while closed
  for (const r of params.reminders) {
    if (r.completed) continue;
    const dueMs = Date.parse(r.dueAt);
    if (!Number.isNaN(dueMs) && dueMs <= nowMs) {
      feed.push({
        id: `missed_${r.id}`,
        kind: 'missed_reminder',
        title: r.title,
        detail: `Missed / due since ${formatShortDateTime(r.dueAt, params.timezone)}`,
        timestamp: r.dueAt,
        targetScreen: 'reminders',
      });
    }
  }

  // 2. Overdue tasks
  for (const tk of params.tasks) {
    if (tk.status === 'done' || !tk.dueDate) continue;
    if (tk.dueDate < todayIso) {
      feed.push({
        id: `overdue_${tk.id}`,
        kind: 'overdue_task',
        title: tk.title,
        detail: `Overdue · Due ${tk.dueDate} · Priority: ${tk.priority}`,
        targetScreen: 'notes_tasks',
      });
    }
  }

  // 3. Urgent Gmail summaries
  for (const em of params.emailSummaries) {
    if (em.urgency === 'high') {
      feed.push({
        id: `email_${em.id}`,
        kind: 'urgent_email',
        title: em.subject,
        detail: `Urgent email from ${em.from} — ${em.aiSummary}`,
        timestamp: em.cachedAt,
        targetScreen: 'google',
      });
    }
  }

  // 4. Calendar clashes
  const clashes = detectCalendarClashes(params.calendarEvents);
  for (const clash of clashes) {
    feed.push({
      id: `clash_${clash.a.id}_${clash.b.id}`,
      kind: 'calendar_clash',
      title: `Clash: ${clash.a.summary} & ${clash.b.summary}`,
      detail: `${formatShortDateTime(clash.a.startIso, params.timezone)} overlaps ${formatShortDateTime(clash.b.startIso, params.timezone)}`,
      timestamp: clash.a.startIso,
      targetScreen: 'google',
    });
  }

  return feed;
}
