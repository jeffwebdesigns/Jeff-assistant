import type { CalendarEventItem, ReminderItem } from '../types/machine';
import { createId } from '../db/storage';
import { getValidAccessToken, markGoogleTokenExpired } from './googleAuth';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

interface GoogleEventRaw {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

async function calendarFetch(path: string, init: RequestInit, settingsClientId?: string): Promise<Response> {
  const token = getValidAccessToken(settingsClientId);
  const res = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    markGoogleTokenExpired();
    throw new Error('Google session expired. Please reconnect.');
  }
  return res;
}

export async function fetchUpcomingCalendarEvents(
  settingsClientId?: string,
  daysAhead = 14
): Promise<CalendarEventItem[]> {
  const startOfWindow = new Date();
  startOfWindow.setHours(0, 0, 0, 0);
  const endOfWindow = new Date(startOfWindow.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const qs = new URLSearchParams({
    timeMin: startOfWindow.toISOString(),
    timeMax: endOfWindow.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });

  const res = await calendarFetch(`?${qs.toString()}`, { method: 'GET' }, settingsClientId);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Failed to fetch Google Calendar events.');
  }

  const data = (await res.json()) as { items?: GoogleEventRaw[] };
  return (data.items ?? [])
    .filter((ev) => ev.status !== 'cancelled')
    .map((ev) => {
      const startIso = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T09:00:00+03:00` : '');
      const endIso = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T10:00:00+03:00` : startIso);
      return {
        id: ev.id,
        summary: ev.summary || '(Untitled Event)',
        description: ev.description,
        location: ev.location,
        startIso,
        endIso,
        allDay: Boolean(ev.start?.date && !ev.start?.dateTime),
        htmlLink: ev.htmlLink,
        status: ev.status,
      };
    })
    .filter((ev) => Boolean(ev.startIso));
}

export async function createCalendarEvent(params: {
  summary: string;
  startIso: string;
  endIso: string;
  description?: string;
  location?: string;
  timeZone?: string;
  settingsClientId?: string;
}): Promise<CalendarEventItem> {
  const res = await calendarFetch(
    '',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: params.summary,
        description: params.description,
        location: params.location,
        start: { dateTime: params.startIso, timeZone: params.timeZone ?? 'Africa/Nairobi' },
        end: { dateTime: params.endIso, timeZone: params.timeZone ?? 'Africa/Nairobi' },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 60 },
            { method: 'popup', minutes: 10 },
          ],
        },
      }),
    },
    params.settingsClientId
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Failed to create Google Calendar event.');
  }
  const ev = (await res.json()) as GoogleEventRaw;
  return {
    id: ev.id,
    summary: ev.summary || params.summary,
    description: ev.description,
    location: ev.location,
    startIso: ev.start?.dateTime ?? params.startIso,
    endIso: ev.end?.dateTime ?? params.endIso,
    allDay: false,
    htmlLink: ev.htmlLink,
    status: ev.status,
  };
}

export async function updateCalendarEvent(params: {
  eventId: string;
  summary: string;
  startIso: string;
  endIso: string;
  description?: string;
  location?: string;
  timeZone?: string;
  settingsClientId?: string;
}): Promise<void> {
  const res = await calendarFetch(
    `/${encodeURIComponent(params.eventId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: params.summary,
        description: params.description,
        location: params.location,
        start: { dateTime: params.startIso, timeZone: params.timeZone ?? 'Africa/Nairobi' },
        end: { dateTime: params.endIso, timeZone: params.timeZone ?? 'Africa/Nairobi' },
      }),
    },
    params.settingsClientId
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Failed to update Google Calendar event.');
  }
}

export async function deleteCalendarEvent(eventId: string, settingsClientId?: string): Promise<void> {
  const res = await calendarFetch(
    `/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' },
    settingsClientId
  );
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Failed to cancel Google Calendar event.');
  }
}

export function detectCalendarClashes(
  events: CalendarEventItem[]
): Array<{ a: CalendarEventItem; b: CalendarEventItem }> {
  const timed = events
    .filter((e) => !e.allDay)
    .slice()
    .sort((x, y) => Date.parse(x.startIso) - Date.parse(y.startIso));

  const clashes: Array<{ a: CalendarEventItem; b: CalendarEventItem }> = [];
  for (let i = 0; i < timed.length - 1; i += 1) {
    const current = timed[i];
    const next = timed[i + 1];
    const curEnd = Date.parse(current.endIso);
    const nextStart = Date.parse(next.startIso);
    if (!Number.isNaN(curEnd) && !Number.isNaN(nextStart) && curEnd > nextStart) {
      clashes.push({ a: current, b: next });
    }
  }
  return clashes;
}

export function buildMirroredReminders(
  events: CalendarEventItem[],
  existingReminders: ReminderItem[]
): ReminderItem[] {
  const nowMs = Date.now();
  const byExternalId = new Map<string, ReminderItem>();
  for (const r of existingReminders) {
    if (r.externalEventId) byExternalId.set(r.externalEventId, r);
  }

  const localOnly = existingReminders.filter((r) => r.source !== 'google_calendar');
  const mirrored: ReminderItem[] = [];

  for (const ev of events) {
    if (ev.allDay) continue;
    const startMs = Date.parse(ev.startIso);
    if (Number.isNaN(startMs) || startMs < nowMs - 2 * 60 * 60 * 1000) continue;

    const prev = byExternalId.get(ev.id);
    mirrored.push({
      id: prev?.id ?? createId('gcal_rem'),
      title: ev.summary,
      dueAt: new Date(startMs).toISOString(),
      category: 'meeting',
      isMeeting: true,
      completed: prev?.completed ?? false,
      firedKeys: prev && prev.dueAt === new Date(startMs).toISOString() ? prev.firedKeys : [],
      createdAt: prev?.createdAt ?? new Date().toISOString(),
      source: 'google_calendar',
      externalEventId: ev.id,
    });
  }

  return [...localOnly, ...mirrored].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
