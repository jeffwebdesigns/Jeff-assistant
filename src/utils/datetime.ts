export function formatNairobiDateTime(date: Date = new Date(), timeZone = 'Africa/Nairobi'): {
  dateStr: string;
  timeStr: string;
  isoDate: string;
} {
  try {
    const dateStr = new Intl.DateTimeFormat('en-KE', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(date);

    const timeStr = new Intl.DateTimeFormat('en-KE', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);

    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';

    return { dateStr, timeStr, isoDate: `${y}-${m}-${d}` };
  } catch {
    return {
      dateStr: date.toDateString(),
      timeStr: date.toTimeString().slice(0, 8),
      isoDate: date.toISOString().slice(0, 10),
    };
  }
}

export function formatShortDateTime(iso: string, timeZone = 'Africa/Nairobi'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('en-KE', {
      timeZone,
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

export function formatTimeOnly(iso: string, timeZone = 'Africa/Nairobi'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-KE', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return d.toTimeString().slice(0, 5);
  }
}

export function toLocalDateTimeInputValue(iso?: string, timeZone = 'Africa/Nairobi'): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    const hr = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')}T${hr}:${get('minute')}`;
  } catch {
    return d.toISOString().slice(0, 16);
  }
}

export function isWithinQuietHours(
  now: Date,
  enabled: boolean,
  startHHMM: string,
  endHHMM: string,
  timeZone = 'Africa/Nairobi'
): boolean {
  if (!enabled) return false;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    const currentMin = h * 60 + m;

    const [sh, sm] = startHHMM.split(':').map(Number);
    const [eh, em] = endHHMM.split(':').map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return false;

    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    if (startMin === endMin) return false;
    if (startMin < endMin) {
      return currentMin >= startMin && currentMin < endMin;
    }
    // Overnight quiet hours e.g. 22:00 to 07:00
    return currentMin >= startMin || currentMin < endMin;
  } catch {
    return false;
  }
}

export function formatKES(amount: number): string {
  return `KES ${amount.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
