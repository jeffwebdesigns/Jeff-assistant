import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_FLASH = 'gemini-4-hydrogen';
const MODEL_FLASH_LITE = 'gemini-3.1-flash-lite';

function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isRetryableOrQuotaError(err: unknown): boolean {
  const rawMsg = err instanceof Error ? err.message : String(err ?? '');
  const statusProp = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status?: unknown }).status) : 0;
  return (
    statusProp === 429 ||
    statusProp === 503 ||
    statusProp === 500 ||
    statusProp === 404 ||
    rawMsg.includes('RESOURCE_EXHAUSTED') ||
    rawMsg.includes('UNAVAILABLE') ||
    rawMsg.includes('NOT_FOUND') ||
    /\b(429|503)\b/.test(rawMsg)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateContentWithFallback(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0]
) {
  const cleanConfig = params.config ? { ...params.config } : undefined;
  const liteConfig = cleanConfig ? { ...cleanConfig } : undefined;
  if (liteConfig && 'thinkingConfig' in liteConfig) {
    delete (liteConfig as Record<string, unknown>).thinkingConfig;
  }

  const attempts: Array<{ model: string; config: typeof cleanConfig; waitMs: number }> = [
    { model: params.model, config: cleanConfig, waitMs: 0 },
    { model: MODEL_FLASH_LITE, config: liteConfig, waitMs: 350 },
    { model: params.model, config: cleanConfig, waitMs: 900 },
    { model: MODEL_FLASH_LITE, config: liteConfig, waitMs: 1600 },
  ];

  let lastErr: unknown;
  for (const attempt of attempts) {
    if (attempt.waitMs > 0) await sleep(attempt.waitMs);
    try {
      return await ai.models.generateContent({
        ...params,
        model: attempt.model,
        config: attempt.config,
      });
    } catch (err) {
      lastErr = err;
      if (!isRetryableOrQuotaError(err)) throw err;
    }
  }
  throw lastErr;
}

function extractSafeErrorDetail(rawMsg: string): string {
  try {
    const start = rawMsg.indexOf('{');
    const end = rawMsg.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(rawMsg.slice(start, end + 1)) as { error?: { message?: string; status?: string; code?: number } };
      if (parsed?.error?.message) {
        return `${parsed.error.code ?? ''} ${parsed.error.status ?? ''}: ${parsed.error.message}`.trim().slice(0, 260);
      }
    }
  } catch {
    // ignore JSON parse errors
  }
  return rawMsg.replace(/AIza[0-9A-Za-z_-]+/g, '[REDACTED]').slice(0, 260);
}

function classifyGeminiError(err: unknown): { status: number; code: string; message: string } {
  const rawMsg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const statusProp = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status?: unknown }).status) : 0;
  const detail = extractSafeErrorDetail(rawMsg);

  console.error('[Gemini API error]', statusProp || 'ERR', detail);

  if (statusProp === 429 || rawMsg.includes('RESOURCE_EXHAUSTED') || /\b429\b/.test(rawMsg)) {
    return {
      status: 429,
      code: 'RATE_LIMIT',
      message: `AI rate limit/quota reached (${detail}). Wait a few seconds and tap Retry, or check Settings > Secrets.`,
    };
  }
  if (statusProp === 503 || rawMsg.includes('UNAVAILABLE') || /\b503\b/.test(rawMsg)) {
    return {
      status: 503,
      code: 'AI_BUSY',
      message: 'Gemini servers are experiencing temporary high demand. Wait a few seconds and tap Retry.',
    };
  }
  if (statusProp === 401 || statusProp === 403 || rawMsg.includes('PERMISSION_DENIED') || rawMsg.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      code: 'KEY_ERROR',
      message: `API key unavailable or invalid (${detail}). Check Settings > Secrets.`,
    };
  }
  if (rawMsg.includes('GEMINI_API_KEY is not configured')) {
    return {
      status: 503,
      code: 'MISSING_KEY',
      message: 'GEMINI_API_KEY is not configured in Secrets.',
    };
  }
  return {
    status: 500,
    code: 'AI_ERROR',
    message: `Unable to reach AI model (${detail}). Please try again.`,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, model: MODEL_FLASH });
  });

  // 1. Streaming Chat Endpoint (SSE) — universal Q&A + local owner context + Search grounding
  app.post('/api/ai/chat', async (req: Request, res: Response) => {
    const body = req.body as {
      message?: string;
      history?: Array<{ role: string; content: string }>;
      systemPrompt?: string;
      localContext?: string;
      nowNairobi?: string;
      displayName?: string;
    };

    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 8000) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'Message is required (max 8000 characters).' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const ai = getAIClient();
      const ownerName = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim().slice(0, 60) : 'Owner';
      const nowNairobi = typeof body.nowNairobi === 'string' ? body.nowNairobi.slice(0, 80) : new Date().toISOString();
      const baseInstruction = typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
        ? body.systemPrompt.trim().slice(0, 4000)
        : 'You are THE MACHINE, a private personal AI assistant serving one user.';

      const localContext = typeof body.localContext === 'string' ? body.localContext.slice(0, 28000) : '';
      const historyLines = Array.isArray(body.history)
        ? body.history
            .slice(-14)
            .map((m) => `${m.role === 'assistant' ? 'THE MACHINE' : ownerName}: ${String(m.content || '').slice(0, 2500)}`)
            .join('\n')
        : '';

      const systemInstruction = `${baseInstruction}

[CAPABILITY & COMPREHENSION GUIDELINES]
- Answer ANY legitimate question thoroughly and accurately: general knowledge, current events (via Google Search grounding when helpful), science, math, coding, Kenya/East Africa topics, KES finance calculations, translations, writing, troubleshooting, or questions about the owner's local data.
- Understand imperfect typing, voice-recognition errors, casual phrasing, English, Kiswahili, and Kenyan code-switching (Swahili-English/Sheng). Infer the owner's intended meaning charitably and answer directly first.
- Write cleanly for both reading and spoken playback: avoid excessive markdown clutter when giving spoken/direct answers, keep explanations clear and well-structured, and use 'STATUS: / OBSERVATION: / ASSESSMENT: / RECOMMENDED ACTION:' specifically for analytical, diagnostic, or briefing requests.
- For private personal questions (tasks, notes, reminders, uploaded documents, calendar, emails, business messages), rely strictly on [OWNER LOCAL DATA]. If specific personal info is absent from [OWNER LOCAL DATA], say clearly what is missing without inventing it.

[RUNTIME CONTEXT]
Owner: ${ownerName}
Current time (Africa/Nairobi): ${nowNairobi}
Currency: KES

[OWNER LOCAL DATA]
${localContext || 'No local tasks, reminders, documents, or notes provided.'}`;

      const fullPrompt = historyLines
        ? `Recent conversation:\n${historyLines}\n\nLatest user question:\n${message}`
        : message;

      const attempts: Array<{ model: string; useSearch: boolean; thinkingLevel?: ThinkingLevel; delayMs: number; nonStream?: boolean }> = [
        { model: MODEL_FLASH, useSearch: true, thinkingLevel: ThinkingLevel.LOW, delayMs: 0 },
        { model: MODEL_FLASH_LITE, useSearch: false, delayMs: 250 },
        { model: MODEL_FLASH, useSearch: false, thinkingLevel: ThinkingLevel.LOW, delayMs: 700 },
        { model: MODEL_FLASH_LITE, useSearch: false, delayMs: 1200, nonStream: true },
        { model: MODEL_FLASH, useSearch: false, thinkingLevel: ThinkingLevel.LOW, delayMs: 1800, nonStream: true },
      ];

      const sources = new Map<string, string>();
      let completed = false;
      let lastErr: unknown;

      for (const attempt of attempts) {
        if (attempt.delayMs > 0) await sleep(attempt.delayMs);
        let emittedChunk = false;
        try {
          if (attempt.nonStream) {
            const resp = await ai.models.generateContent({
              model: attempt.model,
              contents: fullPrompt,
              config: {
                systemInstruction,
                ...(attempt.thinkingLevel ? { thinkingConfig: { thinkingLevel: attempt.thinkingLevel } } : {}),
              },
            });
            const text = resp.text;
            if (text) {
              emittedChunk = true;
              res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
              completed = true;
              break;
            }
          } else {
            const stream = await ai.models.generateContentStream({
              model: attempt.model,
              contents: fullPrompt,
              config: {
                systemInstruction,
                ...(attempt.thinkingLevel ? { thinkingConfig: { thinkingLevel: attempt.thinkingLevel } } : {}),
                ...(attempt.useSearch ? { tools: [{ googleSearch: {} }] } : {}),
              },
            });

            for await (const chunk of stream) {
              const text = chunk.text;
              if (text) {
                emittedChunk = true;
                res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
              }
              const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
              if (Array.isArray(groundingChunks)) {
                for (const g of groundingChunks) {
                  const uri = g?.web?.uri;
                  const title = g?.web?.title;
                  if (typeof uri === 'string' && uri.startsWith('http')) {
                    sources.set(uri, typeof title === 'string' && title.trim() ? title.trim() : uri);
                  }
                }
              }
            }

            if (emittedChunk) {
              completed = true;
              break;
            }
          }
        } catch (err) {
          lastErr = err;
          if (emittedChunk) {
            completed = true;
            break;
          }
        }
      }

      if (!completed) {
        throw lastErr ?? new Error('No response generated by AI model.');
      }

      if (sources.size > 0) {
        res.write(`data: ${JSON.stringify({ sources: Array.from(sources.entries()).slice(0, 4).map(([uri, title]) => ({ uri, title })) })}\n\n`);
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      const mapped = classifyGeminiError(err);
      res.write(`data: ${JSON.stringify({ error: mapped.message, code: mapped.code })}\n\n`);
      res.end();
    }
  });

  // 1b. Gemini Neural TTS Endpoint (English & Swahili WAV output)
  app.post('/api/ai/tts', async (req: Request, res: Response) => {
    const body = req.body as { text?: string; voiceName?: string; language?: string };
    const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!rawText) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'Text is required for speech.' });
      return;
    }

    // Keep TTS clip crisp and fast to avoid latency on mobile networks
    const cleaned = rawText
      .replace(/[*_`#[\]()>]/g, ' ')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1400);

    if (!cleaned) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'No speakable text provided.' });
      return;
    }

    const allowedVoices = new Set(['Charon', 'Kore', 'Puck', 'Fenrir', 'Zephyr']);
    const voiceName = typeof body.voiceName === 'string' && allowedVoices.has(body.voiceName) ? body.voiceName : 'Charon';

    try {
      const ai = getAIClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleaned,
                speechMetadata: {
                  style: 'Calm, articulate, quietly reassuring personal AI assistant. Pronounce English and Swahili naturally.',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.status(502).json({ code: 'TTS_EMPTY', error: 'No audio returned by TTS model.' });
        return;
      }

      const wavBuffer = Buffer.from(base64Audio, 'base64');
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store');
      res.send(wavBuffer);
    } catch (err) {
      const mapped = classifyGeminiError(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.message });
    }
  });

  // 2. Natural Language Intent Extraction (Tasks, Notes, Reminders)
  app.post('/api/ai/parse-intent', async (req: Request, res: Response) => {
    const body = req.body as { text?: string; nowNairobiIso?: string; timezone?: string };
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 2000) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'Input text is required (max 2000 characters).' });
      return;
    }

    try {
      const ai = getAIClient();
      const nowRef = typeof body.nowNairobiIso === 'string' ? body.nowNairobiIso : new Date().toISOString();
      const tz = typeof body.timezone === 'string' ? body.timezone : 'Africa/Nairobi';

      const response = await generateContentWithFallback(ai, {
        model: MODEL_FLASH,
        contents: `Current reference datetime: ${nowRef} (${tz}, UTC+03:00).\nUser input: "${text}"`,
        config: {
          systemInstruction:
            'Extract structured tasks, notes, or reminders from the user input (English or Swahili). Resolve relative dates/times (e.g., "Friday 3pm", "tomorrow morning", "kesho saa mbili asubuhi") into full ISO 8601 strings with +03:00 offset for Africa/Nairobi. If the user says "remind me" or specifies an alert time, emit kind="reminder". If it is an action item without a specific alert time, emit kind="task". If it is purely informational, emit kind="note". Set isMeeting=true if it involves a meeting, call, appointment, or interview. Never invent personal data about third parties.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              explanation: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    kind: { type: Type.STRING },
                    title: { type: Type.STRING },
                    content: { type: Type.STRING },
                    dueAt: { type: Type.STRING },
                    priority: { type: Type.STRING },
                    category: { type: Type.STRING },
                    isMeeting: { type: Type.BOOLEAN },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ['kind', 'title'],
                },
              },
            },
            required: ['explanation', 'items'],
          },
        },
      });

      res.json(JSON.parse((response.text ?? '{}').trim()));
    } catch (err) {
      const mapped = classifyGeminiError(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.message });
    }
  });

  // 3. Document Analysis (Summary + Key Points)
  app.post('/api/ai/document-analyze', async (req: Request, res: Response) => {
    const body = req.body as { title?: string; text?: string; language?: string };
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : 'Document';

    if (!text) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'Document text is empty.' });
      return;
    }

    try {
      const ai = getAIClient();
      const clipped = text.slice(0, 60000);
      const langHint = body.language === 'sw' ? 'Kiswahili' : 'English';

      const response = await generateContentWithFallback(ai, {
        model: MODEL_FLASH,
        contents: `Document Name: ${title}\n\nDocument Content:\n${clipped}`,
        config: {
          systemInstruction: `You are THE MACHINE. Summarize the owner's uploaded document calmly and accurately in ${langHint} (or match the document's primary language). Use ONLY facts inside the document text. State clearly if the document appears truncated or incomplete.`,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['summary', 'keyPoints'],
          },
        },
      });

      res.json(JSON.parse((response.text ?? '{}').trim()));
    } catch (err) {
      const mapped = classifyGeminiError(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.message });
    }
  });

  // 4. Document Q&A
  app.post('/api/ai/document-qa', async (req: Request, res: Response) => {
    const body = req.body as { title?: string; text?: string; question?: string; systemPrompt?: string };
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : 'Document';

    if (!text || !question) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'Document text and question are required.' });
      return;
    }

    try {
      const ai = getAIClient();
      const clipped = text.slice(0, 60000);
      const baseInstruction = typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
        ? body.systemPrompt.trim().slice(0, 2000)
        : 'You are THE MACHINE, a private personal AI assistant.';

      const response = await generateContentWithFallback(ai, {
        model: MODEL_FLASH,
        contents: `Document: ${title}\n\nExtracted Text:\n${clipped}\n\nOwner Question: ${question}`,
        config: {
          systemInstruction: `${baseInstruction}\n\nAnswer the owner's question strictly using the provided document text. If the document does not contain the answer, explicitly state what is missing. Match the language of the question (English or Swahili).`,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      res.json({ answer: response.text ?? 'No response generated.' });
    } catch (err) {
      const mapped = classifyGeminiError(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.message });
    }
  });

  // 5. Unified Morning Briefing Generator
  app.post('/api/ai/briefing', async (req: Request, res: Response) => {
    const body = req.body as {
      systemPrompt?: string;
      displayName?: string;
      nowNairobi?: string;
      language?: string;
      tasksText?: string;
      remindersText?: string;
      notesText?: string;
      calendarText?: string;
      emailsText?: string;
    };

    try {
      const ai = getAIClient();
      const baseInstruction = typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
        ? body.systemPrompt.trim().slice(0, 4000)
        : 'You are THE MACHINE, a private personal AI assistant serving one user.';
      const ownerName = typeof body.displayName === 'string' ? body.displayName.slice(0, 60) : 'Owner';
      const nowNairobi = typeof body.nowNairobi === 'string' ? body.nowNairobi.slice(0, 80) : new Date().toISOString();
      const langInstruction = body.language === 'sw' ? 'Write the briefing in Kiswahili.' : 'Write the briefing in English.';

      const prompt = `Compile today's Unified Morning Briefing for ${ownerName}.\nCurrent Nairobi Time: ${nowNairobi}\nCurrency: KES\n${langInstruction}\n\nFollow the exact analytical structure: begin with 'STATUS: [NOMINAL | ELEVATED | CRITICAL]', then 'OBSERVATION:', 'ASSESSMENT:', and 'RECOMMENDED ACTION:'. Be calm, concise, and factual. Only reference items below; never invent data and explicitly state if Google Calendar or Gmail is not connected.\n\n[GOOGLE CALENDAR]\n${body.calendarText || 'Not connected or no upcoming events'}\n\n[URGENT & RECENT GMAIL]\n${body.emailsText || 'Not connected or no cached emails'}\n\n[TASKS]\n${body.tasksText || 'None'}\n\n[REMINDERS]\n${body.remindersText || 'None'}\n\n[RECENT NOTES]\n${body.notesText || 'None'}`;

      const response = await generateContentWithFallback(ai, {
        model: MODEL_FLASH,
        contents: prompt,
        config: {
          systemInstruction: baseInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        },
      });

      res.json({ content: response.text ?? 'STATUS: NOMINAL\nOBSERVATION: No briefing output returned.' });
    } catch (err) {
      const mapped = classifyGeminiError(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.message });
    }
  });

  // 6. Gmail Inbox Triage & Reply Suggestions
  app.post('/api/ai/gmail-triage', async (req: Request, res: Response) => {
    const body = req.body as {
      emails?: Array<{ id: string; from: string; subject: string; date: string; snippet: string; bodyText: string }>;
      displayName?: string;
    };
    const emails = Array.isArray(body?.emails) ? body.emails.slice(0, 12) : [];
    if (emails.length === 0) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'No emails provided to triage.' });
      return;
    }

    try {
      const ai = getAIClient();
      const ownerName = typeof body.displayName === 'string' ? body.displayName.slice(0, 60) : 'Owner';
      const serialized = emails
        .map(
          (e) =>
            `ID: ${e.id}\nFrom: ${String(e.from).slice(0, 160)}\nSubject: ${String(e.subject).slice(0, 200)}\nDate: ${String(e.date).slice(0, 80)}\nBody: ${String(e.bodyText || e.snippet).slice(0, 1600)}`
        )
        .join('\n---\n');

      const response = await generateContentWithFallback(ai, {
        model: MODEL_FLASH,
        contents: `Owner: ${ownerName}\n\nAnalyze these recent inbox emails addressed to the owner:\n\n${serialized}`,
        config: {
          systemInstruction:
            'You are THE MACHINE, serving one owner. For each email ID, provide: urgency ("high", "medium", or "low"), a concise 1-2 sentence aiSummary, a short urgencyReason, detectedLanguage ("en" or "sw"), and a polite, concise suggestedReply in the same language as the email (English or Swahili). Never invent facts beyond the email text.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              inboxOverview: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    urgency: { type: Type.STRING },
                    aiSummary: { type: Type.STRING },
                    urgencyReason: { type: Type.STRING },
                    detectedLanguage: { type: Type.STRING },
                    suggestedReply: { type: Type.STRING },
                  },
                  required: ['id', 'urgency', 'aiSummary', 'urgencyReason', 'detectedLanguage', 'suggestedReply'],
                },
              },
            },
            required: ['inboxOverview', 'items'],
          },
        },
      });

      res.json(JSON.parse((response.text ?? '{}').trim()));
    } catch (err) {
      const mapped = classifyGeminiError(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.message });
    }
  });

  // 7. Google Calendar Natural Language Intent + Conflict Detection
  app.post('/api/ai/calendar-intent', async (req: Request, res: Response) => {
    const body = req.body as {
      text?: string;
      nowNairobiIso?: string;
      timezone?: string;
      existingEvents?: Array<{ id: string; summary: string; startIso: string; endIso: string }>;
    };

    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 2000) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'Calendar request text is required.' });
      return;
    }

    try {
      const ai = getAIClient();
      const nowRef = typeof body.nowNairobiIso === 'string' ? body.nowNairobiIso : new Date().toISOString();
      const tz = typeof body.timezone === 'string' ? body.timezone : 'Africa/Nairobi';
      const eventsList = Array.isArray(body.existingEvents)
        ? body.existingEvents
            .slice(0, 40)
            .map((e) => `- ID:${e.id} | "${e.summary}" | ${e.startIso} to ${e.endIso}`)
            .join('\n')
        : 'None';

      const response = await generateContentWithFallback(ai, {
        model: MODEL_FLASH,
        contents: `Current reference time: ${nowRef} (${tz}, UTC+03:00).\nExisting Calendar Events:\n${eventsList}\n\nOwner Request: "${text}"`,
        config: {
          systemInstruction:
            'Parse the owner\'s calendar request (English or Swahili) into action="create", "update", or "cancel". For "update" or "cancel", match the most relevant existing event ID into targetEventId. Resolve startIso and endIso in full ISO 8601 with +03:00 offset (default duration 1 hour if unspecified). Check if the proposed [startIso, endIso] overlaps any existing event (excluding targetEventId if updating). If there is a conflict, set hasConflict=true, explain the conflict in conflictDetails, and provide 2-3 conflict-free suggestedAlternatives on the same day or next day.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING },
              targetEventId: { type: Type.STRING },
              summary: { type: Type.STRING },
              description: { type: Type.STRING },
              location: { type: Type.STRING },
              startIso: { type: Type.STRING },
              endIso: { type: Type.STRING },
              hasConflict: { type: Type.BOOLEAN },
              conflictDetails: { type: Type.STRING },
              explanation: { type: Type.STRING },
              suggestedAlternatives: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    startIso: { type: Type.STRING },
                    endIso: { type: Type.STRING },
                    label: { type: Type.STRING },
                  },
                  required: ['startIso', 'endIso', 'label'],
                },
              },
            },
            required: ['action', 'summary', 'startIso', 'endIso', 'hasConflict', 'explanation', 'suggestedAlternatives'],
          },
        },
      });

      res.json(JSON.parse((response.text ?? '{}').trim()));
    } catch (err) {
      const mapped = classifyGeminiError(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.message });
    }
  });

  // 8. Manual Business Inbox Triage & Draft Reply
  app.post('/api/ai/business-inbox', async (req: Request, res: Response) => {
    const body = req.body as {
      channel?: string;
      senderLabel?: string;
      messageText?: string;
      displayName?: string;
    };
    const messageText = typeof body?.messageText === 'string' ? body.messageText.trim() : '';
    if (!messageText || messageText.length > 6000) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'Message text is required (max 6000 characters).' });
      return;
    }

    try {
      const ai = getAIClient();
      const channel = typeof body.channel === 'string' ? body.channel : 'whatsapp';
      const senderLabel = typeof body.senderLabel === 'string' ? body.senderLabel.slice(0, 80) : 'Customer';
      const ownerName = typeof body.displayName === 'string' ? body.displayName.slice(0, 60) : 'Owner';

      const response = await generateContentWithFallback(ai, {
        model: MODEL_FLASH,
        contents: `Channel: ${channel}\nSender Label: ${senderLabel}\nOwner: ${ownerName}\nCurrency context: KES\n\nCustomer Message:\n"${messageText}"`,
        config: {
          systemInstruction:
            'You are THE MACHINE assisting a small business owner. Summarize the customer message concisely, assign urgency ("high", "medium", or "low"), identify detectedLanguage (e.g. "English", "Kiswahili", or "English / Swahili"), and draft a calm, helpful, ready-to-paste reply in the exact language the customer used. Do not invent prices, stock, or commitments not present in the message—if details are missing, write a polite placeholder like [insert price/time].',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              urgency: { type: Type.STRING },
              detectedLanguage: { type: Type.STRING },
              draftReply: { type: Type.STRING },
            },
            required: ['summary', 'urgency', 'detectedLanguage', 'draftReply'],
          },
        },
      });

      res.json(JSON.parse((response.text ?? '{}').trim()));
    } catch (err) {
      const mapped = classifyGeminiError(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.message });
    }
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
      plugins: [
        {
          name: 'disable-vite-hmr-ws-client',
          transform(code, id) {
            if (id.replace(/\\/g, '/').endsWith('/vite/dist/client/client.mjs')) {
              return {
                code: code
                  .replace('console.debug("[vite] connecting...");', '')
                  .replace(
                    /const transport = normalizeModuleRunnerTransport\(\(\(\) => \{[\s\S]*?\}\)\(\)\);/,
                    'const transport = normalizeModuleRunnerTransport({ async connect() {}, async disconnect() {}, async send() {} });'
                  ),
                map: null,
              };
            }
          },
        },
      ],
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`THE MACHINE server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
