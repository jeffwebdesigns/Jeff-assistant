import type {
  ActivityEventItem,
  BusinessChannel,
  BusinessMessageItem,
  CalendarEventItem,
  CalendarIntentProposal,
  ChatMessage,
  ChatMode,
  DocumentItem,
  EmailSummaryItem,
  MachineSettings,
  NoteItem,
  ParsedIntentResult,
  ProposedStructuredItem,
  ReminderItem,
  TaskItem,
  UrgencyLevel,
} from '../types/machine';
import { createId } from '../db/storage';
import { formatNairobiDateTime, formatShortDateTime } from '../utils/datetime';
import { formatTelemetryLine, type DeviceTelemetry } from './hourlyUpdateService';

export class AIProviderError extends Error {
  code: string;
  isRateLimit: boolean;

  constructor(message: string, code = 'AI_ERROR') {
    super(message);
    this.code = code;
    this.isRateLimit = code === 'RATE_LIMIT';
  }
}

function relevanceScore(haystack: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const lower = haystack.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score += 1;
  }
  return score;
}

function buildLocalContextSummary(params: {
  query: string;
  tasks: TaskItem[];
  reminders: ReminderItem[];
  notes: NoteItem[];
  documents: DocumentItem[];
  calendarEvents: CalendarEventItem[];
  emailSummaries: EmailSummaryItem[];
  businessMessages: BusinessMessageItem[];
  activityLogs: ActivityEventItem[];
  deviceTelemetry?: DeviceTelemetry | null;
  timezone: string;
}): string {
  const keywords = params.query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 3)
    .slice(0, 10);

  const activeTasks = params.tasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => relevanceScore(`${b.title} ${b.notes ?? ''}`, keywords) - relevanceScore(`${a.title} ${a.notes ?? ''}`, keywords))
    .slice(0, 10)
    .map((t) => `- [${t.status}/${t.priority}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ''}`);

  const activeReminders = params.reminders
    .filter((r) => !r.completed)
    .slice(0, 10)
    .map((r) => `- [${r.category}${r.isMeeting ? '/meeting' : ''}] ${r.title} at ${formatShortDateTime(r.dueAt, params.timezone)}`);

  const upcomingEvents = params.calendarEvents
    .slice(0, 8)
    .map((ev) => `- [Calendar] ${ev.summary} (${formatShortDateTime(ev.startIso, params.timezone)})`);

  const recentEmails = [...params.emailSummaries]
    .sort((a, b) => {
      const sA = relevanceScore(`${a.from} ${a.subject} ${a.aiSummary}`, keywords) + (a.urgency === 'high' ? 2 : 0);
      const sB = relevanceScore(`${b.from} ${b.subject} ${b.aiSummary}`, keywords) + (b.urgency === 'high' ? 2 : 0);
      return sB - sA;
    })
    .slice(0, 6)
    .map((e) => `- [${e.urgency.toUpperCase()} Email] From ${e.from}: ${e.subject} — ${e.aiSummary}`);

  const matchedNotes = [...params.notes]
    .sort((a, b) => relevanceScore(`${b.title} ${b.content} ${b.tags.join(' ')}`, keywords) - relevanceScore(`${a.title} ${a.content} ${a.tags.join(' ')}`, keywords))
    .slice(0, 6)
    .map((n) => `- ${n.title}: ${n.content.slice(0, 220).replace(/\s+/g, ' ')}`);

  const matchedDocs = [...params.documents]
    .sort((a, b) => relevanceScore(`${b.name} ${b.summary ?? ''} ${b.extractedText}`, keywords) - relevanceScore(`${a.name} ${a.summary ?? ''} ${a.extractedText}`, keywords))
    .slice(0, 3)
    .map((d) => {
      const bodySnippet = (d.summary || d.extractedText).slice(0, 450).replace(/\s+/g, ' ');
      return `- [Document: ${d.name}] ${bodySnippet}`;
    });

  const recentBiz = params.businessMessages
    .slice(0, 4)
    .map((m) => `- [${m.channel}/${m.urgency}] ${m.senderLabel}: ${m.summary || m.rawText.slice(0, 160)}`);

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentActivity = params.activityLogs
    .filter((ev) => {
      const ms = Date.parse(ev.timestamp);
      return !Number.isNaN(ms) && ms >= oneHourAgo;
    })
    .slice(0, 10)
    .map((ev) => `- ${formatShortDateTime(ev.timestamp, params.timezone)}: ${ev.action}${ev.detail ? ` (${ev.detail})` : ''}`);

  const deviceLine = params.deviceTelemetry
    ? `Logged-In Device Status: ${formatTelemetryLine(params.deviceTelemetry)} (${params.deviceTelemetry.activeState})`
    : '';

  return [
    deviceLine,
    recentActivity.length ? `Recent Activity in THE MACHINE (Last 1 Hour):\n${recentActivity.join('\n')}` : '',
    activeTasks.length ? `Active Tasks:\n${activeTasks.join('\n')}` : 'Active Tasks: None',
    activeReminders.length ? `Upcoming Reminders:\n${activeReminders.join('\n')}` : 'Upcoming Reminders: None',
    upcomingEvents.length ? `Google Calendar:\n${upcomingEvents.join('\n')}` : 'Google Calendar: Not connected or empty',
    recentEmails.length ? `Gmail Summaries:\n${recentEmails.join('\n')}` : 'Gmail: None cached',
    recentBiz.length ? `Business Inbox:\n${recentBiz.join('\n')}` : '',
    matchedNotes.length ? `Notes:\n${matchedNotes.join('\n')}` : 'Notes: None',
    matchedDocs.length ? `Uploaded Documents:\n${matchedDocs.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 28000): Promise<Response> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.reject(new AIProviderError('You appear to be offline. Reconnect and tap Retry.', 'OFFLINE'));
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  const callerSignal = init.signal;
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) {
      window.clearTimeout(timer);
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    window.clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  });
}

async function readApiJsonOrThrow(response: Response, fallbackMsg: string): Promise<Record<string, unknown>> {
  const ct = (response.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) {
    if (response.status === 404) {
      throw new AIProviderError(
        'AI backend route (/api/*) returned 404. Ensure Vercel deploys the /api serverless functions (vercel.json + api/[...path].ts) and redeploy.',
        'API_ROUTE_MISSING'
      );
    }
    throw new AIProviderError(
      `AI server returned an unexpected response (HTTP ${response.status}). Check Vercel logs and GEMINI_API_KEY in Environment Variables.`,
      'API_ROUTE_ERROR'
    );
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new AIProviderError(
      typeof data.error === 'string' && data.error ? data.error : fallbackMsg,
      typeof data.code === 'string' && data.code ? data.code : response.status === 429 ? 'RATE_LIMIT' : 'AI_ERROR'
    );
  }
  return data;
}

export const aiProvider = {
  async streamChat(params: {
    message: string;
    mode?: ChatMode;
    history: ChatMessage[];
    settings: MachineSettings;
    tasks: TaskItem[];
    reminders: ReminderItem[];
    notes: NoteItem[];
    documents?: DocumentItem[];
    calendarEvents?: CalendarEventItem[];
    emailSummaries?: EmailSummaryItem[];
    businessMessages?: BusinessMessageItem[];
    activityLogs?: ActivityEventItem[];
    deviceTelemetry?: DeviceTelemetry | null;
    onChunk: (partial: string) => void;
    signal?: AbortSignal;
  }): Promise<{ text: string; sources?: Array<{ uri: string; title: string }> }> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new AIProviderError('You appear to be offline. Reconnect and tap Retry.', 'OFFLINE');
    }

    const mode: ChatMode = params.mode ?? 'auto';
    const { dateStr, timeStr } = formatNairobiDateTime(new Date(), params.settings.timezone);
    const localContext = buildLocalContextSummary({
      query: params.message,
      tasks: params.tasks,
      reminders: params.reminders,
      notes: params.notes,
      documents: params.documents ?? [],
      calendarEvents: params.calendarEvents ?? [],
      emailSummaries: params.emailSummaries ?? [],
      businessMessages: params.businessMessages ?? [],
      activityLogs: params.activityLogs ?? [],
      deviceTelemetry: params.deviceTelemetry ?? null,
      timezone: params.settings.timezone,
    });

    const streamController = new AbortController();
    let timedOutReason: string | null = null;
    let receivedFirstContent = false;

    const onCallerAbort = () => streamController.abort(params.signal?.reason);
    if (params.signal) {
      if (params.signal.aborted) {
        streamController.abort(params.signal.reason);
      } else {
        params.signal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    const firstChunkTimeoutMs = mode === 'research' ? 46000 : mode === 'fast' ? 22000 : 34000;
    const overallTimeoutMs = mode === 'research' ? 115000 : mode === 'fast' ? 45000 : 80000;

    // Never allow a stalled request to trap the UI in Thinking state indefinitely
    const firstChunkTimer = window.setTimeout(() => {
      if (!receivedFirstContent) {
        timedOutReason = 'THE MACHINE took too long to respond. Tap Retry.';
        streamController.abort(new DOMException(timedOutReason, 'TimeoutError'));
      }
    }, firstChunkTimeoutMs);

    const overallTimer = window.setTimeout(() => {
      timedOutReason = 'Response timed out. Tap Retry.';
      streamController.abort(new DOMException(timedOutReason, 'TimeoutError'));
    }, overallTimeoutMs);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: streamController.signal,
        body: JSON.stringify({
          message: params.message,
          mode,
          history: params.history.slice(-16).map((h) => ({ role: h.role, content: h.content })),
          systemPrompt: params.settings.systemPrompt,
          displayName: params.settings.displayName,
          nowNairobi: `${dateStr} ${timeStr}`,
          localContext,
        }),
      });

      if (!response.ok) {
        const ct = (response.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('application/json')) {
          if (response.status === 404) {
            throw new AIProviderError(
              'AI Chat endpoint (/api/ai/chat) returned 404. Ensure Vercel deploys /api/[...path].ts and redeploy.',
              'API_ROUTE_MISSING'
            );
          }
          throw new AIProviderError(
            `AI Chat server error (HTTP ${response.status}). Check GEMINI_API_KEY in Vercel Environment Variables.`,
            'AI_ERROR'
          );
        }
        const errJson = await response.json().catch(() => ({}));
        throw new AIProviderError(
          errJson.error || 'Unable to reach THE MACHINE.',
          errJson.code || (response.status === 429 ? 'RATE_LIMIT' : 'AI_ERROR')
        );
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/event-stream')) {
        throw new AIProviderError(
          'AI Chat endpoint did not return a live stream. Check that Vercel /api functions are deployed and GEMINI_API_KEY is configured.',
          'API_ROUTE_MISSING'
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new AIProviderError('Streaming response unavailable.');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let sources: Array<{ uri: string; title: string }> | undefined;
      let doneReceived = false;

      const processLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line || line.startsWith(':') || !line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          doneReceived = true;
          return;
        }
        try {
          const parsed = JSON.parse(payload) as {
            chunk?: string;
            sources?: Array<{ uri: string; title: string }>;
            error?: string;
            code?: string;
          };
          if (parsed.error) {
            throw new AIProviderError(parsed.error, parsed.code || 'AI_ERROR');
          }
          if (parsed.chunk) {
            if (!receivedFirstContent) {
              receivedFirstContent = true;
              window.clearTimeout(firstChunkTimer);
            }
            accumulated += parsed.chunk;
            params.onChunk(accumulated);
          }
          if (Array.isArray(parsed.sources) && parsed.sources.length > 0) {
            sources = parsed.sources;
          }
        } catch (e) {
          if (e instanceof AIProviderError) throw e;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          processLine(rawLine);
          if (doneReceived) {
            return { text: accumulated, sources };
          }
        }
      }

      // Flush any trailing line left without a newline before EOF
      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const rawLine of buffer.split('\n')) {
          processLine(rawLine);
        }
      }

      if (!accumulated.trim()) {
        throw new AIProviderError('No response received from THE MACHINE. Tap Retry.', 'AI_ERROR');
      }

      return { text: accumulated, sources };
    } catch (err) {
      if (timedOutReason) {
        throw new AIProviderError(timedOutReason, 'AI_TIMEOUT');
      }
      throw err;
    } finally {
      window.clearTimeout(firstChunkTimer);
      window.clearTimeout(overallTimer);
      params.signal?.removeEventListener('abort', onCallerAbort);
    }
  },

  async parseNaturalLanguageItems(
    text: string,
    timezone = 'Africa/Nairobi'
  ): Promise<ParsedIntentResult> {
    const now = new Date();
    const { isoDate, timeStr } = formatNairobiDateTime(now, timezone);

    const response = await fetchWithTimeout('/api/ai/parse-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        nowNairobiIso: `${isoDate}T${timeStr}+03:00`,
        timezone,
      }),
    });

    const data = await readApiJsonOrThrow(response, 'Failed to parse input.');

    const validKinds = new Set(['task', 'note', 'reminder']);
    const validPriorities = new Set(['low', 'medium', 'high']);
    const validCategories = new Set(['meeting', 'errand', 'finance', 'health', 'general']);

    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items: ProposedStructuredItem[] = rawItems
      .filter((item: unknown) => item && typeof item === 'object')
      .map((raw: Record<string, unknown>) => {
        const kind = validKinds.has(String(raw.kind)) ? (String(raw.kind) as ProposedStructuredItem['kind']) : 'task';
        const title = String(raw.title ?? '').trim().slice(0, 160);
        const content = typeof raw.content === 'string' ? raw.content.trim().slice(0, 2000) : undefined;
        let dueAt = typeof raw.dueAt === 'string' ? raw.dueAt.trim() : undefined;
        if (dueAt && Number.isNaN(Date.parse(dueAt))) {
          dueAt = undefined;
        }
        const priority = validPriorities.has(String(raw.priority))
          ? (String(raw.priority) as ProposedStructuredItem['priority'])
          : 'medium';
        const category = validCategories.has(String(raw.category))
          ? (String(raw.category) as ProposedStructuredItem['category'])
          : 'general';
        const isMeeting = Boolean(raw.isMeeting) || category === 'meeting';
        const tags = Array.isArray(raw.tags)
          ? raw.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6)
          : [];

        return {
          tempId: createId('prop'),
          kind,
          title,
          content,
          dueAt,
          priority,
          category,
          isMeeting,
          tags,
        };
      })
      .filter((item: ProposedStructuredItem) => item.title.length > 0);

    return {
      explanation: typeof data.explanation === 'string' ? data.explanation : '',
      items,
    };
  },

  async analyzeDocument(params: {
    title: string;
    text: string;
    settings: MachineSettings;
  }): Promise<{ summary: string; keyPoints: string[] }> {
    const response = await fetchWithTimeout('/api/ai/document-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        text: params.text,
        language: 'en',
        systemPrompt: params.settings.systemPrompt,
      }),
    });

    const data = await readApiJsonOrThrow(response, 'Document analysis failed.');

    return {
      summary: typeof data.summary === 'string' ? data.summary : 'No summary generated.',
      keyPoints: Array.isArray(data.keyPoints)
        ? data.keyPoints.map((k: unknown) => String(k)).filter(Boolean)
        : [],
    };
  },

  async askDocumentQuestion(params: {
    title: string;
    text: string;
    question: string;
    settings: MachineSettings;
  }): Promise<string> {
    const response = await fetchWithTimeout('/api/ai/document-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        text: params.text,
        question: params.question,
        systemPrompt: params.settings.systemPrompt,
      }),
    });

    const data = await readApiJsonOrThrow(response, 'Document Q&A failed.');

    return typeof data.answer === 'string' ? data.answer : 'No answer returned.';
  },

  async generateDailyBriefing(params: {
    settings: MachineSettings;
    tasks: TaskItem[];
    reminders: ReminderItem[];
    notes: NoteItem[];
    calendarEvents?: CalendarEventItem[];
    emailSummaries?: EmailSummaryItem[];
    googleConnected?: boolean;
  }): Promise<string> {
    const { dateStr, timeStr } = formatNairobiDateTime(new Date(), params.settings.timezone);

    const tasksText = params.tasks
      .filter((t) => t.status !== 'done')
      .slice(0, 15)
      .map((t) => `- [${t.priority.toUpperCase()} / ${t.status}] ${t.title}${t.dueDate ? ` (Due: ${t.dueDate})` : ''}`)
      .join('\n');

    const remindersText = params.reminders
      .filter((r) => !r.completed)
      .slice(0, 15)
      .map((r) => `- [${r.category}${r.isMeeting ? ' / meeting' : ''}] ${r.title} (${formatShortDateTime(r.dueAt, params.settings.timezone)})`)
      .join('\n');

    const notesText = params.notes
      .slice(0, 10)
      .map((n) => `- ${n.title}: ${n.content.slice(0, 220).replace(/\s+/g, ' ')}`)
      .join('\n');

    const calendarText = params.calendarEvents && params.calendarEvents.length > 0
      ? params.calendarEvents
          .slice(0, 12)
          .map((ev) => `- ${ev.summary} (${formatShortDateTime(ev.startIso, params.settings.timezone)} to ${formatShortDateTime(ev.endIso, params.settings.timezone)})${ev.location ? ` @ ${ev.location}` : ''}`)
          .join('\n')
      : params.googleConnected
      ? 'Connected, no upcoming events in next 14 days.'
      : 'Google Calendar not connected.';

    const emailsText = params.emailSummaries && params.emailSummaries.length > 0
      ? params.emailSummaries
          .slice(0, 8)
          .map((e) => `- [${e.urgency.toUpperCase()}] From ${e.from} | ${e.subject}: ${e.aiSummary}`)
          .join('\n')
      : params.googleConnected
      ? 'Connected, no cached inbox messages yet.'
      : 'Gmail not connected.';

    const response = await fetchWithTimeout('/api/ai/briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: params.settings.systemPrompt,
        displayName: params.settings.displayName,
        nowNairobi: `${dateStr} ${timeStr}`,
        language: 'en',
        tasksText,
        remindersText,
        notesText,
        calendarText,
        emailsText,
      }),
    });

    const data = await readApiJsonOrThrow(response, 'Failed to generate daily briefing.');

    return typeof data.content === 'string' ? data.content : '';
  },

  async triageEmails(params: {
    emails: Array<{ id: string; from: string; subject: string; date: string; snippet: string; bodyText: string }>;
    displayName: string;
  }): Promise<{
    inboxOverview: string;
    triaged: Record<
      string,
      {
        urgency: UrgencyLevel;
        aiSummary: string;
        urgencyReason: string;
        detectedLanguage: 'en' | 'sw';
        suggestedReply: string;
      }
    >;
  }> {
    const response = await fetchWithTimeout('/api/ai/gmail-triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await readApiJsonOrThrow(response, 'Failed to triage inbox.');

    const triaged: Record<
      string,
      {
        urgency: UrgencyLevel;
        aiSummary: string;
        urgencyReason: string;
        detectedLanguage: 'en' | 'sw';
        suggestedReply: string;
      }
    > = {};

    const validUrgency = new Set(['high', 'medium', 'low']);
    for (const item of Array.isArray(data.items) ? data.items : []) {
      if (!item || typeof item.id !== 'string') continue;
      triaged[item.id] = {
        urgency: validUrgency.has(item.urgency) ? item.urgency : 'medium',
        aiSummary: String(item.aiSummary ?? ''),
        urgencyReason: String(item.urgencyReason ?? ''),
        detectedLanguage: item.detectedLanguage === 'sw' ? 'sw' : 'en',
        suggestedReply: String(item.suggestedReply ?? ''),
      };
    }

    return {
      inboxOverview: typeof data.inboxOverview === 'string' ? data.inboxOverview : '',
      triaged,
    };
  },

  async parseCalendarIntent(params: {
    text: string;
    timezone: string;
    existingEvents: CalendarEventItem[];
  }): Promise<CalendarIntentProposal> {
    const now = new Date();
    const { isoDate, timeStr } = formatNairobiDateTime(now, params.timezone);

    const response = await fetchWithTimeout('/api/ai/calendar-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: params.text,
        nowNairobiIso: `${isoDate}T${timeStr}+03:00`,
        timezone: params.timezone,
        existingEvents: params.existingEvents.map((e) => ({
          id: e.id,
          summary: e.summary,
          startIso: e.startIso,
          endIso: e.endIso,
        })),
      }),
    });

    const data = await readApiJsonOrThrow(response, 'Unable to parse calendar request.');

    const validActions = new Set(['create', 'update', 'cancel']);
    const action = validActions.has(String(data.action)) ? (String(data.action) as 'create' | 'update' | 'cancel') : 'create';
    const rawStartIso = typeof data.startIso === 'string' ? data.startIso : '';
    const rawEndIso = typeof data.endIso === 'string' ? data.endIso : '';
    const startIso = !Number.isNaN(Date.parse(rawStartIso))
      ? rawStartIso
      : new Date(Date.now() + 3600000).toISOString();
    const endIso = !Number.isNaN(Date.parse(rawEndIso))
      ? rawEndIso
      : new Date(Date.parse(startIso) + 3600000).toISOString();

    return {
      action,
      targetEventId: typeof data.targetEventId === 'string' ? data.targetEventId : undefined,
      summary: String(data.summary ?? '').trim() || 'Scheduled Event',
      description: typeof data.description === 'string' ? data.description : undefined,
      location: typeof data.location === 'string' ? data.location : undefined,
      startIso,
      endIso,
      hasConflict: Boolean(data.hasConflict),
      conflictDetails: typeof data.conflictDetails === 'string' ? data.conflictDetails : undefined,
      explanation: typeof data.explanation === 'string' ? data.explanation : '',
      suggestedAlternatives: Array.isArray(data.suggestedAlternatives)
        ? data.suggestedAlternatives
            .filter((s: unknown) => s && typeof s === 'object')
            .map((s: Record<string, unknown>) => ({
              startIso: String(s.startIso ?? ''),
              endIso: String(s.endIso ?? ''),
              label: String(s.label ?? ''),
            }))
            .filter((s: { startIso: string; endIso: string }) => !Number.isNaN(Date.parse(s.startIso)) && !Number.isNaN(Date.parse(s.endIso)))
        : [],
    };
  },

  async analyzeBusinessMessage(params: {
    channel: BusinessChannel;
    senderLabel: string;
    messageText: string;
    displayName: string;
  }): Promise<{
    summary: string;
    urgency: UrgencyLevel;
    detectedLanguage: string;
    draftReply: string;
  }> {
    const response = await fetchWithTimeout('/api/ai/business-inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await readApiJsonOrThrow(response, 'Failed to analyze business message.');

    const validUrgency = new Set<UrgencyLevel>(['high', 'medium', 'low']);
    const rawUrgency = String(data.urgency ?? 'medium') as UrgencyLevel;
    return {
      summary: String(data.summary ?? ''),
      urgency: validUrgency.has(rawUrgency) ? rawUrgency : 'medium',
      detectedLanguage: String(data.detectedLanguage ?? 'English'),
      draftReply: String(data.draftReply ?? ''),
    };
  },
};
