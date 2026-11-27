import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEventLike extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function splitSpeechChunks(text: string): string[] {
  const cleaned = text
    .replace(/[*_`#[\]()>]/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  // Split by sentence boundaries into manageable chunks (~180 chars) so browser TTS never stalls
  const rawSentences = cleaned.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const s of rawSentences) {
    if (!s.trim()) continue;
    if ((current + ' ' + s).trim().length > 200 && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function useSpeech() {
  const recognitionCtor = getSpeechRecognitionCtor();
  const hasSpeechRecognition = Boolean(recognitionCtor);
  const hasNativeSpeechSynthesis =
    typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  // Gemini neural TTS + Web Audio fallback means speech output is always available
  const hasSpeechSynthesis = true;

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const playbackRunIdRef = useRef(0);

  useEffect(() => {
    if (!hasNativeSpeechSynthesis) return;
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length > 0) setVoices(list);
    };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, [hasNativeSpeechSynthesis]);

  // Call synchronously inside click/submit handlers so mobile Chrome unlocks audio before async streaming ends
  const unlockAudio = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          void ctx.resume();
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
        window.setTimeout(() => {
          void ctx.close().catch(() => {});
        }, 120);
      }
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
    } catch {
      // Ignore unlock failures
    }
  }, []);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(
    (lang: 'en-KE' | 'en-US' | 'sw-KE', onTranscript: (text: string, isFinal: boolean) => void) => {
      if (!recognitionCtor) return;
      unlockAudio();
      setSpeechError(null);
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }

      const instance = new recognitionCtor();
      instance.lang = lang === 'sw-KE' ? 'en-KE' : lang;
      instance.interimResults = true;
      instance.continuous = false;
      instance.maxAlternatives = 1;

      instance.onresult = (event) => {
        let combined = '';
        let final = false;
        for (let i = 0; i < event.results.length; i += 1) {
          combined += event.results[i][0]?.transcript ?? '';
          if (event.results[i].isFinal) final = true;
        }
        if (combined.trim()) {
          onTranscript(combined.trim(), final);
        }
      };

      instance.onerror = (ev) => {
        if (ev.error && ev.error !== 'aborted' && ev.error !== 'no-speech') {
          setSpeechError(`Microphone error: ${ev.error}`);
        }
        setIsListening(false);
      };

      instance.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = instance;
      try {
        instance.start();
        setIsListening(true);
      } catch {
        setSpeechError('Could not start microphone.');
        setIsListening(false);
      }
    },
    [recognitionCtor, unlockAudio]
  );

  const stopSpeaking = useCallback(() => {
    playbackRunIdRef.current += 1;
    try {
      abortControllerRef.current?.abort();
    } catch {
      // ignore
    }
    abortControllerRef.current = null;

    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
      } catch {
        // ignore
      }
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if (hasNativeSpeechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, [hasNativeSpeechSynthesis]);

  const speakWithBrowserFallback = useCallback(
    (text: string, runId: number, options?: { rate?: number; voiceURI?: string; langHint?: string }) => {
      if (!hasNativeSpeechSynthesis) {
        setIsSpeaking(false);
        return;
      }
      const chunks = splitSpeechChunks(text);
      if (chunks.length === 0) {
        setIsSpeaking(false);
        return;
      }

      window.speechSynthesis.cancel();
      const available = window.speechSynthesis.getVoices();

      // Small delay avoids Chrome swallowing speak() right after cancel()
      window.setTimeout(() => {
        if (playbackRunIdRef.current !== runId) return;

        let idx = 0;
        const speakNext = () => {
          if (playbackRunIdRef.current !== runId || idx >= chunks.length) {
            setIsSpeaking(false);
            return;
          }
          const utterance = new SpeechSynthesisUtterance(chunks[idx]);
          utterance.rate = options?.rate ?? 1.0;

          const englishVoices = available.filter((v) => v.lang.toLowerCase().startsWith('en'));
          if (options?.voiceURI) {
            const matched = englishVoices.find((v) => v.voiceURI === options.voiceURI);
            if (matched) {
              utterance.voice = matched;
              utterance.lang = matched.lang;
            } else if (englishVoices[0]) {
              utterance.voice = englishVoices[0];
              utterance.lang = englishVoices[0].lang;
            } else {
              utterance.lang = 'en-US';
            }
          } else if (englishVoices[0]) {
            utterance.voice = englishVoices[0];
            utterance.lang = englishVoices[0].lang;
          } else {
            utterance.lang = 'en-US';
          }

          utterance.onstart = () => {
            if (playbackRunIdRef.current === runId) setIsSpeaking(true);
          };
          utterance.onend = () => {
            idx += 1;
            speakNext();
          };
          utterance.onerror = () => {
            if (playbackRunIdRef.current === runId) setIsSpeaking(false);
          };

          window.speechSynthesis.speak(utterance);
        };

        setIsSpeaking(true);
        speakNext();
      }, 45);
    },
    [hasNativeSpeechSynthesis]
  );

  const speak = useCallback(
    (text: string, options?: { rate?: number; voiceURI?: string; langHint?: string; preferBrowserOnly?: boolean }) => {
      const cleaned = text.replace(/[*_`#]/g, '').trim();
      if (!cleaned) return;

      stopSpeaking();
      const runId = playbackRunIdRef.current;
      setSpeechError(null);

      // If caller selected a specific OS voice or is offline, use chunked browser TTS; otherwise use Gemini Neural TTS
      const useBrowserOnly =
        Boolean(options?.preferBrowserOnly) ||
        Boolean(options?.voiceURI) ||
        (typeof navigator !== 'undefined' && !navigator.onLine);
      if (useBrowserOnly) {
        speakWithBrowserFallback(cleaned, runId, options);
        return;
      }

      // Use Gemini Neural TTS (/api/ai/tts) for reliable English & Swahili pronunciation, with browser fallback
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsSpeaking(true);

      const ttsTimer = window.setTimeout(() => controller.abort(new DOMException('TTS timed out', 'TimeoutError')), 12000);

      void (async () => {
        try {
          const resp = await fetch('/api/ai/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              text: cleaned,
              voiceName: 'Charon',
              language: 'en',
            }),
          });
          window.clearTimeout(ttsTimer);

          const ct = (resp.headers.get('content-type') || '').toLowerCase();
          if (!resp.ok || (!ct.includes('audio') && !ct.includes('octet-stream'))) {
            throw new Error(`TTS HTTP ${resp.status}`);
          }

          const blob = await resp.blob();
          if (playbackRunIdRef.current !== runId) return;

          const url = URL.createObjectURL(blob);
          audioUrlRef.current = url;

          const audio = audioRef.current ?? new Audio();
          audioRef.current = audio;
          audio.src = url;
          audio.playbackRate = Math.min(1.8, Math.max(0.65, options?.rate ?? 1.0));

          audio.onended = () => {
            if (playbackRunIdRef.current === runId) {
              setIsSpeaking(false);
            }
          };
          audio.onerror = () => {
            if (playbackRunIdRef.current === runId) {
              speakWithBrowserFallback(cleaned, runId, options);
            }
          };

          await audio.play();
        } catch (err) {
          window.clearTimeout(ttsTimer);
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (playbackRunIdRef.current === runId) {
            speakWithBrowserFallback(cleaned, runId, options);
          }
        }
      })();
    },
    [speakWithBrowserFallback, stopSpeaking]
  );

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
      stopSpeaking();
    };
  }, [stopSpeaking]);

  return {
    hasSpeechRecognition,
    hasSpeechSynthesis,
    isListening,
    isSpeaking,
    voices,
    speechError,
    unlockAudio,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
