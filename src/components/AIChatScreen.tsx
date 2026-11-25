import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, RotateCcw, Send, Trash2, Volume2, VolumeX } from 'lucide-react';
import type {
  ChatMessage,
  MachineSettings,
  NoteItem,
  ReminderItem,
  TaskItem,
} from '../types/machine';
import { getTranslations } from '../i18n/translations';
import { formatTimeOnly } from '../utils/datetime';
import { useSpeech } from '../hooks/useSpeech';
import { BrandEyeIcon } from './BrandMark';

interface AIChatScreenProps {
  settings: MachineSettings;
  chats: ChatMessage[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  notes: NoteItem[];
  isThinking: boolean;
  streamingText: string;
  rateLimitMessage: string | null;
  lastError: string | null;
  pendingPrompt: string | null;
  onConsumePendingPrompt: () => void;
  onSendMessage: (text: string) => Promise<void>;
  onRetryLast: () => Promise<void>;
  onClearChats: () => Promise<void>;
  onChangeVoiceLang: (lang: 'en-KE' | 'en-US' | 'sw-KE') => void;
  onToggleAutoSpeak: (enabled: boolean) => void;
}

export const AIChatScreen: React.FC<AIChatScreenProps> = ({
  settings,
  chats,
  tasks,
  reminders,
  notes,
  isThinking,
  streamingText,
  rateLimitMessage,
  lastError,
  pendingPrompt,
  onConsumePendingPrompt,
  onSendMessage,
  onRetryLast,
  onClearChats,
  onChangeVoiceLang,
  onToggleAutoSpeak,
}) => {
  const t = getTranslations(settings.language);
  const [input, setInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);

  const {
    hasSpeechRecognition,
    hasSpeechSynthesis,
    isListening,
    isSpeaking,
    speechError,
    unlockAudio,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  } = useSpeech();

  useEffect(() => {
    if (pendingPrompt) {
      onConsumePendingPrompt();
      void onSendMessage(pendingPrompt);
    }
  }, [pendingPrompt, onConsumePendingPrompt, onSendMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chats.length, streamingText, isThinking]);

  // Auto-read newest assistant reply when enabled
  useEffect(() => {
    if (!settings.voiceOutputEnabled || !hasSpeechSynthesis || isThinking) return;
    const lastMsg = chats[chats.length - 1];
    if (
      lastMsg &&
      lastMsg.role === 'assistant' &&
      !lastMsg.error &&
      lastMsg.id !== lastSpokenIdRef.current
    ) {
      lastSpokenIdRef.current = lastMsg.id;
      speak(lastMsg.content, {
        rate: settings.voiceRate,
        voiceURI: settings.voiceURI,
        langHint: settings.language === 'sw' ? 'sw' : 'en',
      });
    }
  }, [chats, isThinking, settings.voiceOutputEnabled, settings.voiceRate, settings.voiceURI, settings.language, hasSpeechSynthesis, speak]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;
    unlockAudio();
    setInput('');
    if (isListening) stopListening();
    await onSendMessage(trimmed);
  };

  const handleMicToggle = () => {
    if (isListening) {
      stopListening();
      return;
    }
    startListening(settings.voiceInputLang, (transcript) => {
      setInput(transcript);
    });
  };

  const activeTasksCount = tasks.filter((x) => x.status !== 'done').length;
  const activeRemindersCount = reminders.filter((x) => !x.completed).length;

  return (
    <div className="flex flex-col h-[calc(100dvh-146px)] lg:h-[calc(100dvh-96px)] machine-card-flat overflow-hidden">
      {/* Chat Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--surface-2)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isThinking
                  ? 'bg-[var(--gold-300)] machine-dot-pulse-fast'
                  : 'bg-[var(--gold-500)]'
              }`}
              aria-hidden="true"
            />
            <h1 className="section-title-gold text-sm font-semibold truncate">
              {t.chat.title}
            </h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] truncate tabular-nums mt-0.5">
            {t.chat.contextInfo} <span aria-hidden="true">·</span> {activeTasksCount} {t.chat.tasksLabel}{' '}
            <span aria-hidden="true">·</span> {activeRemindersCount} {t.chat.remindersLabel}{' '}
            <span aria-hidden="true">·</span> {notes.length} {t.chat.notesLabel}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {hasSpeechSynthesis && (
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                if (isSpeaking) stopSpeaking();
                onToggleAutoSpeak(!settings.voiceOutputEnabled);
              }}
              aria-pressed={settings.voiceOutputEnabled}
              className={`min-h-[44px] px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition whitespace-nowrap shrink-0 ${
                settings.voiceOutputEnabled
                  ? 'border-[var(--gold-500)] bg-[var(--surface)] text-[var(--gold-300)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {settings.voiceOutputEnabled ? (
                <Volume2 strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
              ) : (
                <VolumeX strokeWidth={1.5} className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">{t.chat.autoSpeak}</span>
            </button>
          )}

          {chats.length > 0 && (
            confirmClear ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    await onClearChats();
                    setConfirmClear(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl bg-[var(--status-critical)] text-[var(--text)] text-xs font-medium whitespace-nowrap"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-[44px] px-3 machine-btn-ghost text-xs text-[var(--text-muted)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                aria-label={t.chat.clearChat}
                className="min-h-[44px] min-w-[44px] px-2.5 machine-btn-ghost text-[var(--text-muted)] hover:text-[var(--gold-300)] flex items-center justify-center"
              >
                <Trash2 strokeWidth={1.5} className="w-4 h-4" />
              </button>
            )
          )}
        </div>
      </div>

      {/* Thinking state: slow gold shimmer line sweeping across the top of the chat area */}
      {isThinking && <div className="h-[2px] w-full machine-thinking-shimmer shrink-0" aria-hidden="true" />}

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[var(--bg)]">
        {chats.length === 0 && !isThinking && (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto py-8">
            <div className="w-12 h-12 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mb-3">
              <BrandEyeIcon size={28} />
            </div>
            <h2 className="section-title-gold text-sm font-semibold">{t.chat.emptyTitle}</h2>
            <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">{t.chat.emptyBody}</p>
          </div>
        )}

        {chats.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[90%] sm:max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  isUser
                    ? 'machine-bubble-user'
                    : msg.error
                    ? 'bg-[var(--surface)] border border-[var(--error)]/60 text-[var(--error)]'
                    : 'machine-bubble-ai'
                }`}
              >
                {msg.content}
                {!isUser && msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-[var(--border)] flex flex-wrap gap-1.5">
                    {msg.sources.map((src) => (
                      <a
                        key={src.uri}
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-mono text-[var(--gold-300)] hover:text-[var(--gold-100)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--gold-700)] rounded-md px-2 py-0.5 truncate max-w-[220px]"
                      >
                        {src.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 mt-1.5 px-1 text-[11px] text-[var(--text-muted)] font-mono tabular-nums">
                <span>
                  {isUser ? settings.displayName : 'THE MACHINE'} · {formatTimeOnly(msg.timestamp, settings.timezone)}
                </span>
                {!isUser && !msg.error && hasSpeechSynthesis && (
                  <button
                    type="button"
                    onClick={() => {
                      unlockAudio();
                      if (isSpeaking) {
                        stopSpeaking();
                      } else {
                        speak(msg.content, {
                          rate: settings.voiceRate,
                          voiceURI: settings.voiceURI,
                          langHint: settings.language === 'sw' ? 'sw' : 'en',
                        });
                      }
                    }}
                    className="text-[var(--gold-300)] hover:text-[var(--gold-100)] flex items-center gap-1 min-h-[32px] px-1.5"
                  >
                    <Volume2 strokeWidth={1.5} className="w-3.5 h-3.5 text-[var(--gold-500)]" />
                    <span>{isSpeaking ? t.chat.stopSpeaking : t.chat.speak}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {isThinking && (
          <div className="flex flex-col items-start">
            <div className="max-w-[90%] sm:max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap machine-bubble-ai">
              {streamingText || (
                <div className="inline-flex items-center gap-2.5 font-mono text-xs text-[var(--gold-300)]">
                  <span className="inline-flex items-center gap-1" aria-hidden="true">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold-500)] machine-typing-dot" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold-500)] machine-typing-dot" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold-500)] machine-typing-dot" />
                  </span>
                  <span>{t.chat.thinking}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {(rateLimitMessage || lastError) && !isThinking && (
          <div className="rounded-xl bg-[var(--surface)] border border-[var(--error)]/70 p-3.5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--error)]">
              {rateLimitMessage || lastError}
            </p>
            <button
              type="button"
              onClick={() => void onRetryLast()}
              className="min-h-[44px] px-4 machine-btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap"
            >
              <RotateCcw strokeWidth={1.5} className="w-3.5 h-3.5" />
              <span>{t.chat.retry}</span>
            </button>
          </div>
        )}

        {speechError && (
          <p className="text-xs text-[var(--error)] font-mono">{speechError}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Pill Command Composer Bar */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-[var(--border)] bg-[var(--surface-2)]">
        <div className="flex items-end gap-2">
          {hasSpeechRecognition && (
            <div className="flex items-center gap-1.5 shrink-0">
              <select
                value={settings.voiceInputLang}
                onChange={(e) => onChangeVoiceLang(e.target.value as 'en-KE' | 'en-US' | 'sw-KE')}
                aria-label={t.settings.voiceInputLang}
                className="min-h-[48px] machine-input px-2.5 text-xs font-mono text-[var(--text-muted)]"
              >
                <option value="en-KE">EN-KE</option>
                <option value="en-US">EN-US</option>
                <option value="sw-KE">SW-KE</option>
              </select>
              <button
                type="button"
                onClick={handleMicToggle}
                aria-label={isListening ? t.chat.micStop : t.chat.micStart}
                className={`min-h-[48px] min-w-[48px] rounded-full border flex items-center justify-center transition ${
                  isListening
                    ? 'bg-[var(--gold-500)] border-[var(--gold-300)] text-[var(--text-on-gold)]'
                    : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text)] hover:border-[var(--gold-500)] hover:text-[var(--gold-300)]'
                }`}
              >
                {isListening ? (
                  <MicOff strokeWidth={1.5} className="w-5 h-5" />
                ) : (
                  <Mic strokeWidth={1.5} className="w-5 h-5" />
                )}
              </button>
            </div>
          )}

          <div className="flex-1 flex items-end gap-1.5 rounded-full bg-[var(--surface)] border border-[var(--gold-700)] focus-within:border-[var(--gold-500)] focus-within:ring-2 focus-within:ring-[var(--gold-500)]/30 pl-4 pr-1.5 py-1 transition">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit(e);
                }
              }}
              placeholder={isListening ? t.chat.micStop : t.chat.placeholder}
              className="flex-1 min-h-[40px] max-h-28 resize-none bg-transparent border-0 focus:outline-none py-2 text-sm text-[var(--text)] placeholder-[var(--text-muted)]/75"
            />

            <button
              type="submit"
              disabled={!input.trim() || isThinking}
              aria-label={t.chat.send}
              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-[var(--gold-500)] hover:bg-[var(--gold-500)]/15 hover:text-[var(--gold-300)] disabled:opacity-35 disabled:cursor-not-allowed transition shrink-0"
            >
              <Send strokeWidth={1.5} className="w-4 h-4" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
