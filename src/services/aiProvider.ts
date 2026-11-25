import type {
  BusinessChannel,
  BusinessMessageItem,
  CalendarEventItem,
  CalendarIntentProposal,
  ChatMessage,
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
  timezone: string;
}): string {
  const keywords = params.query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 3)
    .slice(0, 12);

  const activeTasks = params.tasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => relevanceScore(`${b.title} ${b.notes ?? ''}`, keywords) - relevanceScore(`${a.title} ${a.notes ?? ''}`, keywords))
    .slice(0, 16)
    .map((t) => `- [${t.status}/${t.priority}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ''}`);

  const activeReminders = params.reminders
    .filter((r) => !r.completed)
    .slice(0, 14)
    .map((r) => `- [${r.category}${r.isMeeting ? '/meeting' : ''}] ${r.title} at ${formatShortDateTime(r.dueAt, params.timezone)}`);

  const upcomingEvents = params.calendarEvents
    .slice(0, 12)
    .map((ev) => `- [Calendar] ${ev.summary} (${formatShortDateTime(ev.startIso, params.timezone)})`);

  const recentEmails = [...params.emailSummaries]
    .sort((a, b) => {
      const sA = relevanceScore(`${a.from} ${a.subject} ${a.aiSummary}`, keywords) + (a.urgency === 'high' ? 2 : 0);
      const sB = relevanceScore(`${b.from} ${b.subject} ${b.aiSummary}`, keywords) + (b.urgency === 'high' ? 2 : 0);
      return sB - sA;
    })
    .slice(0, 8)
    .map((e) => `- [${e.urgency.toUpperCase()} Email] From ${e.from}: ${e.subject} — ${e.aiSummary}`);

  const matchedNotes = [...params.notes]
    .sort((a, b) => relevanceScore(`${b.title} ${b.content} ${b.tags.join(' ')}`, keywords) - relevanceScore(`${a.title} ${a.content} ${a.tags.join(' ')}`, keywords))
    .slice(0, 10)
    .map((n) => `- ${n.title}: ${n.content.slice(0, 320).replace(/\s+/g, ' ')}`);

  const matchedDocs = [...params.documents]
    .sort((a, b) => relevanceScore(`${b.name} ${b.summary ?? ''} ${b.extractedText}`, keywords) - relevanceScore(`${a.name} ${a.summary ?? ''} ${a.extractedText}`, keywords))
    .slice(0, 4)
    .map((d) => {
      const bodySnippet = (d.summary || d.extractedText).slice(0, 650).replace(/\s+/g, ' ');
      return `- [Document: ${d.name}] ${bodySnippet}`;
    });

  const recentBiz = params.businessMessages
    .slice(0, 6)
    .map((m) => `- [${m.channel}/${m.urgency}] ${m.senderLabel}: ${m.summary || m.rawText.slice(0, 180)}`);

  return [
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

export const aiProvider = {
  async streamChat(params: {
    message: string;
    history: ChatMessage[];
    settings: MachineSettings;
    tasks: TaskItem[];
    reminders: ReminderItem[];
    notes: NoteItem[];
    documents?: DocumentItem[];
    calendarEvents?: CalendarEventItem[];
    emailSummaries?: EmailSummaryItem[];
    businessMessages?: BusinessMessageItem[];
    onChunk: (partial: string) => void;
    signal?: AbortSignal;
  }): Promise<{ text: string; sources?: Array<{ uri: string; title: string }> }> {
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
      timezone: params.settings.timezone,
    });

    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: params.signal,
      body: JSON.stringify({
        message: params.message,
        history: params.history.slice(-14).map((h) => ({ role: h.role, content: h.content })),
        systemPrompt: params.settings.systemPrompt,
        displayName: params.settings.displayName,
        nowNairobi: `${dateStr} ${timeStr}`,
        localContext,
      }),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new AIProviderError(
        errJson.error || 'Unable to reach THE MACHINE.',
        errJson.code || (response.status === 429 ? 'RATE_LIMIT' : 'AI_ERROR')
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

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          return { text: accumulated, sources };
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
            accumulated += parsed.chunk;
            params.onChunk(accumulated);
          }
          if (Array.isArray(parsed.sources) && parsed.sources.length > 0) {
            sources = parsed.sources;
          }
        } catch (e) {
          if (e instanceof AIProviderError) throw e;
        }
      }
    }

    return { text: accumulated, sources };
  },

  async parseNaturalLanguageItems(
    text: string,
    timezone = 'Africa/Nairobi'
  ): Promise<ParsedIntentResult> {
    const now = new Date();
    const { isoDate, timeStr } = formatNairobiDateTime(now, timezone);

    const response = await fetch('/api/ai/parse-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        nowNairobiIso: `${isoDate}T${timeStr}+03:00`,
        timezone,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AIProviderError(
        data.error || 'Failed to parse input.',
        data.code || (response.status === 429 ? 'RATE_LIMIT' : 'AI_ERROR')
      );
    }

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
    const response = await fetch('/api/ai/document-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        text: params.text,
        language: params.settings.language,
        systemPrompt: params.settings.systemPrompt,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AIProviderError(
        data.error || 'Document analysis failed.',
        data.code || (response.status === 429 ? 'RATE_LIMIT' : 'AI_ERROR')
      );
    }

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
    const response = await fetch('/api/ai/document-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        text: params.text,
        question: params.question,
        systemPrompt: params.settings.systemPrompt,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AIProviderError(
        data.error || 'Document Q&A failed.',
        data.code || (response.status === 429 ? 'RATE_LIMIT' : 'AI_ERROR')
      );
    }

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

    const response = await fetch('/api/ai/briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: params.settings.systemPrompt,
        displayName: params.settings.displayName,
        nowNairobi: `${dateStr} ${timeStr}`,
        language: params.settings.language,
        tasksText,
        remindersText,
        notesText,
        calendarText,
        emailsText,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AIProviderError(
        data.error || 'Failed to generate daily briefing.',
        data.code || (response.status === 429 ? 'RATE_LIMIT' : 'AI_ERROR')
      );
    }

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
    const response = await fetch('/api/ai/gmail-triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AIProviderError(
        data.error || 'Failed to triage inbox.',
        data.code || (response.status === 429 ? 'RATE_LIMIT' : 'AI_ERROR')
      );
    }

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

    const response = await fetch('/api/ai/calendar-intent', {
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

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AIProviderError(
        data.error || 'Unable to parse calendar request.',
        data.code || (response.status === 429 ? 'RATE_LIMIT' : 'AI_ERROR')
      );
    }

    const validActions = new Set(['create', 'update', 'cancel']);
    const action = validActions.has(data.action) ? data.action : 'create';
    const startIso = !Number.isNaN(Date.parse(data.startIso))
      ? data.startIso
      : new Date(Date.now() + 3600000).toISOString();
    const endIso = !Number.isNaN(Date.parse(data.endIso))
      ? data.endIso
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
    const response = await fetch('/api/ai/business-inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AIProviderError(
        data.error || 'Failed to analyze business message.',
        data.code || (response.status === 429 ? 'RATE_LIMIT' : 'AI_ERROR')
      );
    }

    const validUrgency = new Set(['high', 'medium', 'low']);
    return {
      summary: String(data.summary ?? ''),
      urgency: validUrgency.has(data.urgency) ? data.urgency : 'medium',
      detectedLanguage: String(data.detectedLanguage ?? 'English'),
      draftReply: String(data.draftReply ?? ''),
    };
  },
};
