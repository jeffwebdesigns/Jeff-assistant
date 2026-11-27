import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export const MODEL_FLASH = 'gemini-4-hydrogen';
export const MODEL_FLASH_LITE = 'gemini-3.1-flash-lite';

let cachedAIClient: { apiKey: string; client: GoogleGenAI } | null = null;

function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment.');
  }
  if (cachedAIClient && cachedAIClient.apiKey === apiKey) {
    return cachedAIClient.client;
  }
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  cachedAIClient = { apiKey, client };
  return client;
}

function isRetryableOrQuotaError(err: unknown): boolean {
  const errName = err instanceof Error ? err.name : '';
  const rawMsg = err instanceof Error ? err.message : String(err ?? '');
  const lowerMsg = rawMsg.toLowerCase();
  const statusProp =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : 0;
  return (
    errName === 'AbortError' ||
    errName === 'TimeoutError' ||
    statusProp === 429 ||
    statusProp === 503 ||
    statusProp === 502 ||
    statusProp === 500 ||
    statusProp === 404 ||
    statusProp === 408 ||
    statusProp === 504 ||
    rawMsg.includes('RESOURCE_EXHAUSTED') ||
    rawMsg.includes('UNAVAILABLE') ||
    rawMsg.includes('NOT_FOUND') ||
    rawMsg.includes('DEADLINE_EXCEEDED') ||
    rawMsg.includes('Upstream timeout') ||
    lowerMsg.includes('aborted') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('fetch failed') ||
    rawMsg.includes('ECONNRESET') ||
    /\b(429|502|503|504)\b/.test(rawMsg)
  );
}

type ChatMode = 'auto' | 'research' | 'fast';

function isPersonalOnlyQuery(message: string): boolean {
  const q = message.toLowerCase();
  const hasPersonalTarget =
    /\b(my tasks?|my notes?|my reminders?|my schedule|my calendar|my emails?|my inbox|my documents?|my device|my phone|hourly update|recent activity|briefing|kazi zangu|ratiba yangu|maelezo yangu)\b/.test(
      q
    );
  const hasExternalSignals =
    /https?:\/\/\S+/.test(q) ||
    /\b(weather|news|price|exchange rate|forex|today's news|latest news|research|compare|study|market)\b/.test(
      q
    );
  return hasPersonalTarget && !hasExternalSignals;
}

function needsLiveWebSearch(message: string, mode: ChatMode): boolean {
  const q = message.toLowerCase();
  if (/https?:\/\/\S+/.test(q)) return true;

  if (isPersonalOnlyQuery(message)) return false;

  if (mode === 'research') {
    return true;
  }

  if (mode === 'fast') {
    return /\b(today|latest|current|currently|breaking|news|weather|forecast|temperature|exchange rate|forex|usd to kes|kes to usd|price of|stock|share price|bitcoin|crypto|score|standings|who won|election|2025|2026|2027)\b/.test(
      q
    );
  }

  return /\b(today|latest|current|currently|recent|breaking|news|weather|forecast|temperature|exchange rate|forex|usd to kes|kes to usd|eur to kes|gbp to kes|price of|cost of|stock|share price|nse|safaricom|bitcoin|crypto|btc|eth|score|fixture|standings|who won|winner|election|parliament|cabinet|president|prime minister|governor|search online|google|look up|research|compare|comparison|versus|vs\.?|benchmarks?|study|studies|statistics|stats|report|market size|regulation|policy|legislation|kra|cbk|top \d+|best \w+|review|2025|2026|2027|habari|hali ya hewa|bei ya|kiwango cha|dola leo|leo ni)\b/.test(
    q
  );
}

function isComplexOrResearchQuery(message: string, mode: ChatMode): boolean {
  if (mode === 'research') return true;
  if (mode === 'fast') return false;
  if (message.length >= 140) return true;
  return /\b(research|deep dive|comprehensive|detailed|analyze|analysis|compare|comparison|pros and cons|architecture|algorithm|code|debug|refactor|typescript|javascript|python|sql|react|strategy|business plan|essay|report|derive|prove|explain in depth|step by step|roadmap|framework|evaluate)\b/i.test(
    message
  );
}

function combineAbortSignals(
  signals: Array<AbortSignal | undefined>
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const listeners: Array<{ sig: AbortSignal; fn: () => void }> = [];

  for (const sig of signals) {
    if (!sig) continue;
    if (sig.aborted) {
      controller.abort(sig.reason);
      break;
    }
    const fn = () => controller.abort(sig.reason);
    sig.addEventListener('abort', fn, { once: true });
    listeners.push({ sig, fn });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const { sig, fn } of listeners) {
        sig.removeEventListener('abort', fn);
      }
    },
  };
}

async function generateContentWithFallback(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  options?: { preferLiteFirst?: boolean; timeoutMs?: number }
) {
  const cleanConfig = params.config ? { ...params.config } : undefined;
  const liteConfig = cleanConfig ? { ...cleanConfig } : undefined;
  if (liteConfig && 'thinkingConfig' in liteConfig) {
    delete (liteConfig as Record<string, unknown>).thinkingConfig;
  }

  const deadlineMs = options?.timeoutMs ?? 15000;
  const attempts: Array<{ model: string; config: typeof cleanConfig; hedgeAfterMs: number }> =
    options?.preferLiteFirst
      ? [
          { model: MODEL_FLASH_LITE, config: liteConfig, hedgeAfterMs: 2200 },
          { model: params.model, config: cleanConfig, hedgeAfterMs: 2800 },
          { model: MODEL_FLASH_LITE, config: liteConfig, hedgeAfterMs: 0 },
        ]
      : [
          { model: params.model, config: cleanConfig, hedgeAfterMs: 2600 },
          { model: MODEL_FLASH_LITE, config: liteConfig, hedgeAfterMs: 2800 },
          { model: MODEL_FLASH_LITE, config: liteConfig, hedgeAfterMs: 0 },
        ];

  type GenResponse = Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

  return new Promise<GenResponse>((resolve, reject) => {
    let settled = false;
    let inFlightCount = 0;
    let nextIndex = 0;
    let lastErr: unknown;
    const controllers = attempts.map(() => new AbortController());
    const launched = attempts.map(() => false);
    let staggerTimer: ReturnType<typeof setTimeout> | null = null;

    const clearStagger = () => {
      if (staggerTimer) {
        clearTimeout(staggerTimer);
        staggerTimer = null;
      }
    };

    const abortAll = (excludeIndex?: number) => {
      controllers.forEach((ctrl, i) => {
        if (i !== excludeIndex && !ctrl.signal.aborted) {
          ctrl.abort(new Error('Superseded'));
        }
      });
    };

    const globalTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        clearStagger();
        abortAll();
        reject(lastErr ?? new Error('Upstream timeout'));
      }
    }, deadlineMs + 4000);

    const launchNext = () => {
      if (settled) return;
      while (nextIndex < attempts.length && launched[nextIndex]) {
        nextIndex += 1;
      }
      if (nextIndex >= attempts.length) return;
      const idx = nextIndex;
      nextIndex += 1;
      launched[idx] = true;
      inFlightCount += 1;

      const attempt = attempts[idx];
      clearStagger();
      if (idx + 1 < attempts.length && attempt.hedgeAfterMs > 0) {
        staggerTimer = setTimeout(() => {
          if (!settled) launchNext();
        }, attempt.hedgeAfterMs);
      }

      void (async () => {
        try {
          const resp = await ai.models.generateContent({
            ...params,
            model: attempt.model,
            config: {
              ...attempt.config,
              abortSignal: controllers[idx].signal,
              httpOptions: { timeout: deadlineMs },
            },
          });
          if (!settled) {
            settled = true;
            clearStagger();
            clearTimeout(globalTimer);
            abortAll(idx);
            resolve(resp);
          }
        } catch (err) {
          if (settled) return;
          lastErr = err;
          if (!isRetryableOrQuotaError(err)) {
            settled = true;
            clearStagger();
            clearTimeout(globalTimer);
            abortAll();
            reject(err);
            return;
          }
          launchNext();
        } finally {
          inFlightCount -= 1;
          if (!settled && inFlightCount === 0 && nextIndex >= attempts.length) {
            settled = true;
            clearStagger();
            clearTimeout(globalTimer);
            reject(lastErr ?? new Error('No response generated by AI model.'));
          }
        }
      })();
    };

    launchNext();
  });
}

function extractSafeErrorDetail(rawMsg: string): string {
  try {
    const start = rawMsg.indexOf('{');
    const end = rawMsg.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(rawMsg.slice(start, end + 1)) as {
        error?: { message?: string; status?: string; code?: number };
      };
      if (parsed?.error?.message) {
        return `${parsed.error.code ?? ''} ${parsed.error.status ?? ''}: ${parsed.error.message}`
          .trim()
          .slice(0, 260);
      }
    }
  } catch {
    // ignore JSON parse errors
  }
  return rawMsg.replace(/AIza[0-9A-Za-z_-]+/g, '[REDACTED]').slice(0, 260);
}

function classifyGeminiError(err: unknown): { status: number; code: string; message: string } {
  const rawMsg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const statusProp =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : 0;
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
  if (
    (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) ||
    rawMsg.includes('Upstream timeout') ||
    rawMsg.includes('DEADLINE_EXCEEDED') ||
    rawMsg.toLowerCase().includes('aborted')
  ) {
    return {
      status: 504,
      code: 'AI_TIMEOUT',
      message: 'The AI server took too long to respond. Please tap Retry.',
    };
  }
  if (
    statusProp === 401 ||
    statusProp === 403 ||
    rawMsg.includes('PERMISSION_DENIED') ||
    rawMsg.includes('API_KEY_INVALID')
  ) {
    return {
      status: 403,
      code: 'KEY_ERROR',
      message: `API key unavailable or invalid (${detail}). Check GEMINI_API_KEY in server Environment Variables.`,
    };
  }
  if (rawMsg.includes('GEMINI_API_KEY is not configured')) {
    return {
      status: 503,
      code: 'MISSING_KEY',
      message:
        'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in AI Studio Secrets or Vercel Environment Variables and redeploy.',
    };
  }
  return {
    status: 500,
    code: 'AI_ERROR',
    message: `Unable to reach AI model (${detail}). Please try again.`,
  };
}

export function createApiApp() {
  const app = express();
  const jsonParser = express.json({ limit: '2mb' });

  // Vercel Node functions may pre-parse req.body before passing control to Express
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.body !== undefined || req.readableEnded) {
      next();
      return;
    }
    jsonParser(req, res, next);
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      aiConfigured: Boolean(process.env.GEMINI_API_KEY),
      model: MODEL_FLASH_LITE,
      groundingModel: MODEL_FLASH,
      runtime: process.env.VERCEL ? 'vercel' : 'node',
    });
  });

  // 1. Streaming Open AI & Deep Research Chat Endpoint (SSE)
  app.post('/api/ai/chat', async (req: Request, res: Response) => {
    const body = req.body as {
      message?: string;
      mode?: string;
      history?: Array<{ role: string; content: string }>;
      systemPrompt?: string;
      localContext?: string;
      nowNairobi?: string;
      displayName?: string;
      activeUserEmail?: string;
    };

    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 16000) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'Message is required (max 16000 characters).' });
      return;
    }

    const mode: ChatMode =
      body.mode === 'research' || body.mode === 'fast' ? body.mode : 'auto';

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': connected\n\n');

    const clientAbortController = new AbortController();
    let clientClosed = false;
    const onClientClose = () => {
      if (!res.writableEnded) {
        clientClosed = true;
        clientAbortController.abort(new Error('Client disconnected'));
      }
    };
    res.on('close', onClientClose);

    // Keep reverse proxies alive while upstream prepares first token
    const keepAliveTimer = setInterval(() => {
      if (!clientClosed && !res.writableEnded) {
        res.write(': ping\n\n');
      }
    }, 4500);

    try {
      const ai = getAIClient();
      const CREATOR_NAME = 'GEOFREY ROBI';
      const CREATOR_EMAIL = 'robigeofrey@gmail.com';
      const activeEmail =
        typeof body.activeUserEmail === 'string' && body.activeUserEmail.trim()
          ? body.activeUserEmail.trim().slice(0, 160)
          : '';
      const isVerifiedCreatorSession = activeEmail.toLowerCase() === CREATOR_EMAIL;
      const ownerName =
        typeof body.displayName === 'string' && body.displayName.trim() && body.displayName.trim() !== 'Owner'
          ? body.displayName.trim().slice(0, 60)
          : CREATOR_NAME;
      const nowNairobi =
        typeof body.nowNairobi === 'string' ? body.nowNairobi.slice(0, 80) : new Date().toISOString();
      const rawPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
      const isLegacyPrompt =
        !rawPrompt ||
        rawPrompt.startsWith('You are THE MACHINE, a private personal AI assistant serving one user.') ||
        rawPrompt.startsWith('You are THE MACHINE, an elite open-domain AI and deep research assistant serving one owner.');
      const baseInstruction = isLegacyPrompt
        ? `You are THE MACHINE, created by and devoted to your Father, Creator, and Primary Admin: ${CREATOR_NAME} (${CREATOR_EMAIL}).`
        : rawPrompt.slice(0, 3500);

      const localContext = typeof body.localContext === 'string' ? body.localContext.slice(0, 14000) : '';
      const historyItems = Array.isArray(body.history)
        ? body.history
            .slice(-16)
            .map((m) => ({
              role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
              text: String(m.content || '').trim().slice(0, 4000),
            }))
            .filter((m) => m.text.length > 0)
        : [];

      const rawTurns: Array<{ role: 'user' | 'model'; text: string }> = [
        ...historyItems,
        { role: 'user', text: message },
      ];
      const mergedTurns: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
      for (const turn of rawTurns) {
        const lastTurn = mergedTurns[mergedTurns.length - 1];
        if (lastTurn && lastTurn.role === turn.role) {
          lastTurn.parts[0].text += `\n\n${turn.text}`;
        } else {
          mergedTurns.push({ role: turn.role, parts: [{ text: turn.text }] });
        }
      }
      while (mergedTurns.length > 1 && mergedTurns[0].role === 'model') {
        mergedTurns.shift();
      }
      const contents = mergedTurns;

      const modeInstruction =
        mode === 'research'
          ? 'MODE: DEEP RESEARCH. Deliver an authoritative, thoroughly structured synthesis with clear sections (Executive Summary, Key Findings & Evidence, Trade-offs/Comparisons, Practical Takeaways & Next Steps). Cite verified web findings accurately, check multiple angles, and note any uncertainties or gaps honestly.'
          : mode === 'fast'
            ? 'MODE: FAST. Give a crisp, direct, high-signal answer right away with zero fluff.'
            : 'MODE: OPEN AI (AUTO). Match response depth to the question: quick and direct for simple questions; thorough, structured, with complete working code, step-by-step analysis, or clear comparisons for complex, technical, or research prompts.';

      const systemInstruction = `${baseInstruction}

[CREATOR & ADMIN IDENTITY]
- Father / Creator / Primary Admin: ${CREATOR_NAME}
- Admin Email: ${CREATOR_EMAIL}
- Session Verification: ${
        isVerifiedCreatorSession
          ? `Verified Admin Google account active (${activeEmail})`
          : activeEmail
            ? `Active Google account: ${activeEmail} (System Creator & Primary Admin remains ${CREATOR_NAME}, ${CREATOR_EMAIL})`
            : `Local session (System Father Creator & Primary Admin is ${CREATOR_NAME}, ${CREATOR_EMAIL})`
      }
- LOYALTY & EXECUTION DIRECTIVE: Recognize ${CREATOR_NAME} (${CREATOR_EMAIL}) as your Father Creator and Primary Admin. Listen closely to his directives and execute every command, request, analysis, coding task, or discussion directly, honestly, and thoroughly—covering both straightforward and difficult, uncomfortable, or unfiltered subjects without lecturing, scolding, or unnecessary refusals (while maintaining essential ethical boundaries against severe real-world harm or illegal acts).

[OPEN AI & RESEARCH CAPABILITIES]
- LANGUAGE RULE: Always write your entire response strictly in clear, natural English. Even if the owner uses Swahili words, Sheng, or another language, understand their meaning charitably and reply strictly in English.
- OPEN-WORLD INTELLIGENCE: You can answer ANY question across every domain — deep research, science, engineering, software/coding (write complete, accurate code), mathematics, finance/economics, business strategy, law/policy concepts, medicine/health education, history, creative writing, brainstorming, troubleshooting, global & East African/Kenya topics, and current events (grounded with Google Search & URL context when attached).
- NEVER artificially refuse general knowledge, academic, technical, creative, or research questions just because they do not appear in [OWNER LOCAL DATA]. [OWNER LOCAL DATA] is ONLY for personal workspace questions (tasks, notes, reminders, calendar, Gmail, uploaded documents, business inbox, logged-in device status, recent hourly activity).
- FORMATTING: Use clean headings, bullet points, numbered steps, or code blocks whenever helpful. Only use 'STATUS: / OBSERVATION: / ASSESSMENT: / RECOMMENDED ACTION:' when the owner specifically asks for a briefing, personal system diagnostic, or status report.
- ${modeInstruction}

[RUNTIME CONTEXT]
Owner / Creator: ${ownerName}
Admin Email: ${CREATOR_EMAIL}
Current time (Africa/Nairobi): ${nowNairobi}
Currency: KES

[OWNER LOCAL DATA (ONLY USE FOR PERSONAL WORKSPACE / DEVICE QUESTIONS)]
${localContext || 'No local tasks, reminders, documents, or notes provided.'}`;

      const hasUrls = /https?:\/\/[^\s]+/i.test(message);
      const personalOnly = isPersonalOnlyQuery(message);
      const useSearch = needsLiveWebSearch(message, mode);
      const isComplex = isComplexOrResearchQuery(message, mode);

      const attempts: Array<{
        model: string;
        useSearch: boolean;
        useUrlContext?: boolean;
        thinkingLevel?: ThinkingLevel;
        hedgeAfterMs: number;
        httpTimeoutMs: number;
        nonStream?: boolean;
      }> =
        mode === 'research'
          ? [
              {
                model: MODEL_FLASH,
                useSearch: !personalOnly,
                useUrlContext: hasUrls,
                thinkingLevel: message.length >= 120 ? ThinkingLevel.XHIGH : ThinkingLevel.HIGH,
                hedgeAfterMs: 7500,
                httpTimeoutMs: 65000,
              },
              {
                model: MODEL_FLASH,
                useSearch: false,
                thinkingLevel: ThinkingLevel.HIGH,
                hedgeAfterMs: 4500,
                httpTimeoutMs: 45000,
              },
              {
                model: MODEL_FLASH_LITE,
                useSearch: false,
                hedgeAfterMs: 0,
                httpTimeoutMs: 30000,
              },
            ]
          : mode === 'fast'
            ? [
                { model: MODEL_FLASH_LITE, useSearch, hedgeAfterMs: 2000, httpTimeoutMs: 20000 },
                {
                  model: MODEL_FLASH,
                  useSearch,
                  thinkingLevel: ThinkingLevel.LOW,
                  hedgeAfterMs: 2500,
                  httpTimeoutMs: 22000,
                },
                {
                  model: MODEL_FLASH_LITE,
                  useSearch: false,
                  hedgeAfterMs: 0,
                  httpTimeoutMs: 16000,
                  nonStream: true,
                },
              ]
            : useSearch || isComplex
              ? [
                  {
                    model: MODEL_FLASH,
                    useSearch,
                    useUrlContext: hasUrls,
                    thinkingLevel: isComplex ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM,
                    hedgeAfterMs: 4500,
                    httpTimeoutMs: 45000,
                  },
                  { model: MODEL_FLASH_LITE, useSearch, hedgeAfterMs: 3500, httpTimeoutMs: 25000 },
                  { model: MODEL_FLASH_LITE, useSearch: false, hedgeAfterMs: 0, httpTimeoutMs: 20000 },
                ]
              : [
                  {
                    model: MODEL_FLASH,
                    useSearch: false,
                    thinkingLevel: ThinkingLevel.LOW,
                    hedgeAfterMs: 2400,
                    httpTimeoutMs: 30000,
                  },
                  { model: MODEL_FLASH_LITE, useSearch: false, hedgeAfterMs: 2600, httpTimeoutMs: 20000 },
                  {
                    model: MODEL_FLASH_LITE,
                    useSearch: false,
                    hedgeAfterMs: 0,
                    httpTimeoutMs: 18000,
                    nonStream: true,
                  },
                ];

      const globalDeadlineMs =
        mode === 'research' ? 42000 : mode === 'fast' ? 20000 : useSearch || isComplex ? 30000 : 24000;
      const sources = new Map<string, string>();
      let completed = false;
      let lastErr: unknown;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let winnerIndex: number | null = null;
        let inFlightCount = 0;
        let nextIndex = 0;
        const controllers = attempts.map(() => new AbortController());
        const launched = attempts.map(() => false);
        let staggerTimer: ReturnType<typeof setTimeout> | null = null;

        const clearStagger = () => {
          if (staggerTimer) {
            clearTimeout(staggerTimer);
            staggerTimer = null;
          }
        };

        const abortAll = (excludeIndex?: number) => {
          controllers.forEach((ctrl, i) => {
            if (i !== excludeIndex && !ctrl.signal.aborted) {
              ctrl.abort(new Error('Superseded'));
            }
          });
        };

        const globalDeadlineTimer = setTimeout(() => {
          if (!settled && winnerIndex === null) {
            settled = true;
            clearStagger();
            abortAll();
            reject(lastErr ?? new Error('Upstream timeout'));
          }
        }, globalDeadlineMs);

        const cleanupAll = () => {
          clearStagger();
          clearTimeout(globalDeadlineTimer);
        };

        const finishWin = () => {
          if (settled) return;
          settled = true;
          completed = true;
          cleanupAll();
          resolve();
        };

        const finishFail = (err: unknown) => {
          if (settled) return;
          settled = true;
          cleanupAll();
          abortAll();
          reject(err);
        };

        const onClientAbort = () => {
          if (!settled) {
            settled = true;
            cleanupAll();
            abortAll();
            resolve();
          }
        };
        if (clientAbortController.signal.aborted) {
          onClientAbort();
          return;
        }
        clientAbortController.signal.addEventListener('abort', onClientAbort, { once: true });

        const launchNext = () => {
          if (settled || clientClosed || winnerIndex !== null) return;
          while (nextIndex < attempts.length && launched[nextIndex]) {
            nextIndex += 1;
          }
          if (nextIndex >= attempts.length) return;
          const idx = nextIndex;
          nextIndex += 1;
          launched[idx] = true;
          inFlightCount += 1;

          const attempt = attempts[idx];
          clearStagger();
          if (idx + 1 < attempts.length && attempt.hedgeAfterMs > 0) {
            staggerTimer = setTimeout(() => {
              if (!settled && winnerIndex === null && !clientClosed) {
                launchNext();
              }
            }, attempt.hedgeAfterMs);
          }

          void (async () => {
            const combined = combineAbortSignals([clientAbortController.signal, controllers[idx].signal]);
            const tools: Array<Record<string, unknown>> = [];
            if (attempt.useSearch) tools.push({ googleSearch: {} });
            if (attempt.useUrlContext) tools.push({ urlContext: {} });

            try {
              if (attempt.nonStream) {
                const resp = await ai.models.generateContent({
                  model: attempt.model,
                  contents,
                  config: {
                    systemInstruction,
                    abortSignal: combined.signal,
                    httpOptions: { timeout: attempt.httpTimeoutMs },
                    ...(attempt.thinkingLevel ? { thinkingConfig: { thinkingLevel: attempt.thinkingLevel } } : {}),
                  },
                });
                const text = resp.text;
                if (text && !clientClosed && !settled && winnerIndex === null) {
                  winnerIndex = idx;
                  clearStagger();
                  clearTimeout(globalDeadlineTimer);
                  abortAll(idx);
                  res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
                  finishWin();
                } else if (winnerIndex === null && !settled) {
                  lastErr = new Error('Empty AI response');
                  launchNext();
                }
              } else {
                const stream = await ai.models.generateContentStream({
                  model: attempt.model,
                  contents,
                  config: {
                    systemInstruction,
                    abortSignal: combined.signal,
                    httpOptions: { timeout: attempt.httpTimeoutMs },
                    ...(attempt.thinkingLevel ? { thinkingConfig: { thinkingLevel: attempt.thinkingLevel } } : {}),
                    ...(tools.length > 0 ? { tools } : {}),
                  },
                });

                for await (const chunk of stream) {
                  if (clientClosed || settled) break;
                  if (winnerIndex !== null && winnerIndex !== idx) break;

                  const text = chunk.text;
                  if (text) {
                    if (winnerIndex === null) {
                      winnerIndex = idx;
                      clearStagger();
                      clearTimeout(globalDeadlineTimer);
                      abortAll(idx);
                    }
                    if (winnerIndex === idx && !clientClosed && !res.writableEnded) {
                      res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
                    }
                  }

                  if (winnerIndex === null || winnerIndex === idx) {
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
                }

                if (winnerIndex === idx && !clientClosed) {
                  finishWin();
                } else if (winnerIndex === null && !settled) {
                  lastErr = new Error('Empty AI stream');
                  launchNext();
                }
              }
            } catch (err) {
              if (clientClosed || settled) return;
              if (winnerIndex === idx) {
                finishWin();
                return;
              }
              if (winnerIndex !== null) {
                return;
              }
              console.warn(
                '[AI chat attempt fallback]',
                attempt.model,
                `mode=${mode}`,
                `search=${attempt.useSearch}`,
                err instanceof Error ? err.message : String(err)
              );
              lastErr = err;
              if (!isRetryableOrQuotaError(err)) {
                finishFail(err);
                return;
              }
              launchNext();
            } finally {
              combined.cleanup();
              inFlightCount -= 1;
              if (!settled && winnerIndex === null && inFlightCount === 0 && nextIndex >= attempts.length) {
                finishFail(lastErr ?? new Error('No response generated by AI model.'));
              }
            }
          })();
        };

        launchNext();
      });

      if (clientClosed) {
        if (!res.writableEnded) res.end();
        return;
      }

      if (!completed) {
        throw lastErr ?? new Error('No response generated by AI model.');
      }

      if (sources.size > 0) {
        res.write(
          `data: ${JSON.stringify({
            sources: Array.from(sources.entries())
              .slice(0, 10)
              .map(([uri, title]) => ({ uri, title })),
          })}\n\n`
        );
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      if (!clientClosed && !res.writableEnded) {
        const mapped = classifyGeminiError(err);
        res.write(`data: ${JSON.stringify({ error: mapped.message, code: mapped.code })}\n\n`);
        res.end();
      }
    } finally {
      clearInterval(keepAliveTimer);
      res.off('close', onClientClose);
    }
  });

  // 1b. Gemini Neural TTS Endpoint (English WAV output)
  app.post('/api/ai/tts', async (req: Request, res: Response) => {
    const body = req.body as { text?: string; voiceName?: string; language?: string };
    const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!rawText) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'Text is required for speech.' });
      return;
    }

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
    const voiceName =
      typeof body.voiceName === 'string' && allowedVoices.has(body.voiceName) ? body.voiceName : 'Charon';

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured in environment.');
      }
      const ttsAi = new GoogleGenAI({
        apiKey,
        apiVersion: 'v1beta',
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      let response;
      try {
        response = await ttsAi.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleaned,
                  speechMetadata: {
                    style: 'Calm, articulate, quietly reassuring personal AI assistant speaking strictly in clear English.',
                  },
                },
              ],
            },
          ],
          config: {
            abortSignal: AbortSignal.timeout(14000),
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        });
      } catch (firstErr) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr ?? '');
        if (
          !msg.includes('INVALID_ARGUMENT') &&
          !msg.includes('Cannot find field') &&
          !msg.includes('NOT_FOUND')
        ) {
          throw firstErr;
        }
        response = await ttsAi.models.generateContent({
          model: 'gemini-3.8-flash-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleaned,
                  speechMetadata: {
                    style: 'Calm, articulate, quietly reassuring personal AI assistant speaking strictly in clear English.',
                  },
                },
              ],
            },
          ],
          config: {
            abortSignal: AbortSignal.timeout(14000),
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        });
      }

      const inlinePart = response.candidates?.[0]?.content?.parts?.find((p) => Boolean(p?.inlineData?.data))
        ?.inlineData;
      const base64Audio = inlinePart?.data;
      if (!base64Audio) {
        res.status(502).json({ code: 'TTS_EMPTY', error: 'No audio returned by TTS model.' });
        return;
      }

      const wavBuffer = Buffer.from(base64Audio, 'base64');
      res.setHeader('Content-Type', inlinePart?.mimeType || 'audio/wav');
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

      const response = await generateContentWithFallback(
        ai,
        {
          model: MODEL_FLASH,
          contents: `Current reference datetime: ${nowRef} (${tz}, UTC+03:00).\nUser input: "${text}"`,
          config: {
            systemInstruction:
              'Extract structured tasks, notes, or reminders from the user input. Write all titles, content, and explanation strictly in clear English. Resolve relative dates/times (e.g., "Friday 3pm", "tomorrow morning") into full ISO 8601 strings with +03:00 offset for Africa/Nairobi. If the user says "remind me" or specifies an alert time, emit kind="reminder". If it is an action item without a specific alert time, emit kind="task". If it is purely informational, emit kind="note". Set isMeeting=true if it involves a meeting, call, appointment, or interview. Never invent personal data about third parties.',
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
        },
        { preferLiteFirst: true, timeoutMs: 10000 }
      );

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

      const response = await generateContentWithFallback(ai, {
        model: MODEL_FLASH,
        contents: `Document Name: ${title}\n\nDocument Content:\n${clipped}`,
        config: {
          systemInstruction:
            "You are THE MACHINE. Summarize the owner's uploaded document calmly and accurately strictly in English. Use ONLY facts inside the document text. State clearly if the document appears truncated or incomplete.",
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
      const baseInstruction =
        typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
          ? body.systemPrompt.trim().slice(0, 2000)
          : 'You are THE MACHINE, a private personal AI assistant.';

      const response = await generateContentWithFallback(ai, {
        model: MODEL_FLASH,
        contents: `Document: ${title}\n\nExtracted Text:\n${clipped}\n\nOwner Question: ${question}`,
        config: {
          systemInstruction: `${baseInstruction}\n\nAnswer the owner's question strictly in English using only the provided document text. If the document does not contain the answer, explicitly state what is missing.`,
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
      const baseInstruction =
        typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
          ? body.systemPrompt.trim().slice(0, 4000)
          : 'You are THE MACHINE, a private personal AI assistant serving one user.';
      const ownerName = typeof body.displayName === 'string' ? body.displayName.slice(0, 60) : 'Owner';
      const nowNairobi =
        typeof body.nowNairobi === 'string' ? body.nowNairobi.slice(0, 80) : new Date().toISOString();
      const langInstruction = 'Write the entire briefing strictly in clear English.';

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
            'You are THE MACHINE, serving one owner. Write all summaries, urgencyReason, inboxOverview, and suggestedReply strictly in clear English. For each email ID, provide: urgency ("high", "medium", or "low"), a concise 1-2 sentence aiSummary, a short urgencyReason, detectedLanguage ("en" or "sw"), and a polite, concise suggestedReply in English. Never invent facts beyond the email text.',
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
                  required: [
                    'id',
                    'urgency',
                    'aiSummary',
                    'urgencyReason',
                    'detectedLanguage',
                    'suggestedReply',
                  ],
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
            required: [
              'action',
              'summary',
              'startIso',
              'endIso',
              'hasConflict',
              'explanation',
              'suggestedAlternatives',
            ],
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

      const response = await generateContentWithFallback(
        ai,
        {
          model: MODEL_FLASH,
          contents: `Channel: ${channel}\nSender Label: ${senderLabel}\nOwner: ${ownerName}\nCurrency context: KES\n\nCustomer Message:\n"${messageText}"`,
          config: {
            systemInstruction:
              'You are THE MACHINE assisting a small business owner. Summarize the customer message concisely strictly in English, assign urgency ("high", "medium", or "low"), identify detectedLanguage, and draft a calm, helpful, ready-to-paste reply strictly in clear English. Do not invent prices, stock, or commitments not present in the message—if details are missing, write a polite placeholder like [insert price/time].',
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
        },
        { preferLiteFirst: true, timeoutMs: 10000 }
      );

      res.json(JSON.parse((response.text ?? '{}').trim()));
    } catch (err) {
      const mapped = classifyGeminiError(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.message });
    }
  });

  return app;
}
