import type { EmailSummaryItem } from '../types/machine';
import { getValidAccessToken, markGoogleTokenExpired } from './googleAuth';
import { aiProvider } from './aiProvider';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessageResponse {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: GmailMessagePart & {
    headers?: Array<{ name?: string; value?: string }>;
  };
}

function decodeBase64Url(input: string): string {
  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLen);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function encodeBase64UrlUtf8(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function extractPlainTextBody(part?: GmailMessagePart): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (Array.isArray(part.parts)) {
    for (const sub of part.parts) {
      const found = extractPlainTextBody(sub);
      if (found) return found;
    }
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    const html = decodeBase64Url(part.body.data);
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function getHeader(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string
): string {
  if (!headers) return '';
  const target = name.toLowerCase();
  return headers.find((h) => h.name?.toLowerCase() === target)?.value ?? '';
}

async function gmailFetch(path: string, init: RequestInit, settingsClientId?: string): Promise<Response> {
  const token = getValidAccessToken(settingsClientId);
  const res = await fetch(`${GMAIL_API}${path}`, {
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

export async function fetchAndTriageRecentInbox(params: {
  displayName: string;
  settingsClientId?: string;
  maxResults?: number;
}): Promise<{ inboxOverview: string; emails: EmailSummaryItem[] }> {
  const max = params.maxResults ?? 10;
  const listRes = await gmailFetch(
    `/messages?maxResults=${max}&q=${encodeURIComponent('in:inbox')}`,
    { method: 'GET' },
    params.settingsClientId
  );

  if (!listRes.ok) {
    const err = await listRes.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Failed to list Gmail messages.');
  }

  const listData = (await listRes.json()) as { messages?: Array<{ id: string }> };
  const messageIds = (listData.messages ?? []).map((m) => m.id).slice(0, max);
  if (messageIds.length === 0) {
    return { inboxOverview: 'Inbox has no recent messages.', emails: [] };
  }

  const rawEmails = await Promise.all(
    messageIds.map(async (id) => {
      const msgRes = await gmailFetch(
        `/messages/${encodeURIComponent(id)}?format=full`,
        { method: 'GET' },
        params.settingsClientId
      );
      if (!msgRes.ok) return null;
      const msg = (await msgRes.json()) as GmailMessageResponse;
      const headers = msg.payload?.headers;
      const from = getHeader(headers, 'From') || 'Unknown sender';
      const subject = getHeader(headers, 'Subject') || '(No Subject)';
      const date = getHeader(headers, 'Date') || '';
      const snippet = msg.snippet ?? '';
      const bodyText = extractPlainTextBody(msg.payload) || snippet;

      return {
        id: msg.id,
        threadId: msg.threadId,
        from,
        subject,
        date,
        snippet,
        bodyText: bodyText.slice(0, 2500),
      };
    })
  );

  const validEmails = rawEmails.filter((x): x is NonNullable<typeof x> => Boolean(x));
  if (validEmails.length === 0) {
    return { inboxOverview: 'No readable messages found.', emails: [] };
  }

  const triage = await aiProvider.triageEmails({
    emails: validEmails,
    displayName: params.displayName,
  });

  const nowIso = new Date().toISOString();
  const summaries: EmailSummaryItem[] = validEmails.map((e) => {
    const t = triage.triaged[e.id];
    return {
      ...e,
      urgency: t?.urgency ?? 'medium',
      aiSummary: t?.aiSummary || e.snippet,
      urgencyReason: t?.urgencyReason || '',
      suggestedReply: t?.suggestedReply || '',
      detectedLanguage: t?.detectedLanguage ?? 'en',
      cachedAt: nowIso,
    };
  });

  const rank = { high: 0, medium: 1, low: 2 };
  summaries.sort((a, b) => rank[a.urgency] - rank[b.urgency]);

  return {
    inboxOverview: triage.inboxOverview,
    emails: summaries,
  };
}

function buildMimeMessage(params: {
  to: string;
  subject: string;
  body: string;
}): string {
  const cleanTo = params.to.replace(/[\r\n]/g, '').trim();
  const cleanSubj = params.subject.replace(/[\r\n]/g, '').trim();
  const lines = [
    `To: ${cleanTo}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(cleanSubj)))}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    params.body,
  ];
  return encodeBase64UrlUtf8(lines.join('\r\n'));
}

export async function createGmailDraft(params: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  settingsClientId?: string;
}): Promise<string> {
  const raw = buildMimeMessage(params);
  const res = await gmailFetch(
    '/drafts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          raw,
          ...(params.threadId ? { threadId: params.threadId } : {}),
        },
      }),
    },
    params.settingsClientId
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Failed to save Gmail draft.');
  }
  const data = (await res.json()) as { id?: string };
  return data.id ?? '';
}

export async function sendApprovedGmail(params: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  settingsClientId?: string;
}): Promise<string> {
  const raw = buildMimeMessage(params);
  const res = await gmailFetch(
    '/messages/send',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw,
        ...(params.threadId ? { threadId: params.threadId } : {}),
      }),
    },
    params.settingsClientId
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Failed to send email via Gmail.');
  }
  const data = (await res.json()) as { id?: string };
  return data.id ?? '';
}
