import React, { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  Copy,
  ExternalLink,
  Mail,
  Mic,
  MicOff,
  RefreshCw,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CalendarEventItem,
  CalendarIntentProposal,
  EmailSummaryItem,
  MachineSettings,
  ScreenId,
} from '../types/machine';
import { getTranslations } from '../i18n/translations';
import { aiProvider } from '../services/aiProvider';
import {
  createGmailDraft,
  fetchAndTriageRecentInbox,
  sendApprovedGmail,
} from '../services/gmailService';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  detectCalendarClashes,
  fetchUpcomingCalendarEvents,
  updateCalendarEvent,
} from '../services/calendarService';
import { formatShortDateTime, toLocalDateTimeInputValue } from '../utils/datetime';
import { useSpeech } from '../hooks/useSpeech';
import type { GoogleConnectionStatus } from '../services/googleAuth';

interface GoogleWorkspaceScreenProps {
  settings: MachineSettings;
  googleStatus: GoogleConnectionStatus;
  remainingSeconds: number;
  isConnecting: boolean;
  authError: string | null;
  hasClientId: boolean;
  emailSummaries: EmailSummaryItem[];
  calendarEvents: CalendarEventItem[];
  onConnectGoogle: () => Promise<void>;
  onReconnectGoogle: () => Promise<void>;
  onSwitchGoogleAccount: () => Promise<void>;
  onDisconnectGoogle: () => Promise<void>;
  onNavigate: (screen: ScreenId) => void;
  onReplaceEmails: (items: EmailSummaryItem[]) => Promise<void>;
  onReplaceCalendarEvents: (items: CalendarEventItem[]) => Promise<void>;
}

export const GoogleWorkspaceScreen: React.FC<GoogleWorkspaceScreenProps> = ({
  settings,
  googleStatus,
  remainingSeconds,
  isConnecting,
  authError,
  hasClientId,
  emailSummaries,
  calendarEvents,
  onConnectGoogle,
  onReconnectGoogle,
  onSwitchGoogleAccount,
  onDisconnectGoogle,
  onNavigate,
  onReplaceEmails,
  onReplaceCalendarEvents,
}) => {
  const t = getTranslations(settings.language);
  const { hasSpeechRecognition, isListening, startListening, stopListening } = useSpeech();

  const [activeTab, setActiveTab] = useState<'gmail' | 'calendar'>('gmail');
  const [inboxOverview, setInboxOverview] = useState('');
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [gmailNotice, setGmailNotice] = useState<string | null>(null);

  // Reply composer & approval modal
  const [composingEmail, setComposingEmail] = useState<EmailSummaryItem | null>(null);
  const [replyTo, setReplyTo] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [sendApprovalOpen, setSendApprovalOpen] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  // Calendar state
  const [syncingCal, setSyncingCal] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);
  const [calNotice, setCalNotice] = useState<string | null>(null);
  const [nlCalInput, setNlCalInput] = useState('');
  const [parsingCal, setParsingCal] = useState(false);
  const [proposal, setProposal] = useState<CalendarIntentProposal | null>(null);
  const [applyingCal, setApplyingCal] = useState(false);
  const [originCopied, setOriginCopied] = useState(false);

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const isConnected = googleStatus === 'connected';
  const remainingMins = Math.max(1, Math.ceil(remainingSeconds / 60));

  const handleSyncGmail = async () => {
    if (!isConnected || syncingGmail) return;
    setSyncingGmail(true);
    setGmailError(null);
    setGmailNotice(null);
    try {
      const res = await fetchAndTriageRecentInbox({
        displayName: settings.displayName,
        settingsClientId: settings.googleClientId,
        maxResults: 10,
      });
      setInboxOverview(res.inboxOverview);
      await onReplaceEmails(res.emails);
    } catch (err) {
      setGmailError(err instanceof Error ? err.message : 'Unable to fetch Gmail inbox.');
    } finally {
      setSyncingGmail(false);
    }
  };

  const openReplyComposer = (em: EmailSummaryItem) => {
    setComposingEmail(em);
    setReplyTo(em.from);
    setReplySubject(em.subject.toLowerCase().startsWith('re:') ? em.subject : `Re: ${em.subject}`);
    setReplyBody(em.suggestedReply);
    setGmailError(null);
    setGmailNotice(null);
  };

  const handleSaveDraft = async () => {
    if (!composingEmail || !replyTo.trim() || !replyBody.trim()) return;
    setSendingEmail(true);
    setGmailError(null);
    try {
      await createGmailDraft({
        to: replyTo.trim(),
        subject: replySubject.trim(),
        body: replyBody,
        threadId: composingEmail.threadId,
        settingsClientId: settings.googleClientId,
      });
      setGmailNotice(`Draft saved to Gmail for ${replyTo.trim()}.`);
      setComposingEmail(null);
    } catch (err) {
      setGmailError(err instanceof Error ? err.message : 'Failed to save draft.');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleConfirmSend = async () => {
    if (!composingEmail || !replyTo.trim() || !replyBody.trim()) return;
    setSendingEmail(true);
    setGmailError(null);
    try {
      await sendApprovedGmail({
        to: replyTo.trim(),
        subject: replySubject.trim(),
        body: replyBody,
        threadId: composingEmail.threadId,
        settingsClientId: settings.googleClientId,
      });
      setSendApprovalOpen(false);
      setComposingEmail(null);
      setGmailNotice(`Email sent to ${replyTo.trim()}.`);
    } catch (err) {
      setGmailError(err instanceof Error ? err.message : 'Failed to send email.');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSyncCalendar = async () => {
    if (!isConnected || syncingCal) return;
    setSyncingCal(true);
    setCalError(null);
    setCalNotice(null);
    try {
      const events = await fetchUpcomingCalendarEvents(settings.googleClientId, 14);
      await onReplaceCalendarEvents(events);
    } catch (err) {
      setCalError(err instanceof Error ? err.message : 'Failed to fetch Calendar events.');
    } finally {
      setSyncingCal(false);
    }
  };

  const handleParseCalendar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nlCalInput.trim() || parsingCal) return;
    setParsingCal(true);
    setCalError(null);
    setCalNotice(null);
    if (isListening) stopListening();
    try {
      const prop = await aiProvider.parseCalendarIntent({
        text: nlCalInput.trim(),
        timezone: settings.timezone,
        existingEvents: calendarEvents,
      });
      setProposal(prop);
    } catch (err) {
      setCalError(err instanceof Error ? err.message : 'Unable to parse calendar request.');
    } finally {
      setParsingCal(false);
    }
  };

  const handleConfirmCalendarChange = async () => {
    if (!proposal || applyingCal) return;
    setApplyingCal(true);
    setCalError(null);
    try {
      if (proposal.action === 'cancel') {
        if (!proposal.targetEventId) {
          throw new Error('No matching event ID found to cancel.');
        }
        await deleteCalendarEvent(proposal.targetEventId, settings.googleClientId);
        setCalNotice(`Cancelled "${proposal.summary}".`);
      } else if (proposal.action === 'update' && proposal.targetEventId) {
        await updateCalendarEvent({
          eventId: proposal.targetEventId,
          summary: proposal.summary,
          startIso: proposal.startIso,
          endIso: proposal.endIso,
          description: proposal.description,
          location: proposal.location,
          timeZone: settings.timezone,
          settingsClientId: settings.googleClientId,
        });
        setCalNotice(`Updated "${proposal.summary}".`);
      } else {
        await createCalendarEvent({
          summary: proposal.summary,
          startIso: proposal.startIso,
          endIso: proposal.endIso,
          description: proposal.description,
          location: proposal.location,
          timeZone: settings.timezone,
          settingsClientId: settings.googleClientId,
        });
        setCalNotice(`Created "${proposal.summary}".`);
      }
      setProposal(null);
      setNlCalInput('');
      const refreshed = await fetchUpcomingCalendarEvents(settings.googleClientId, 14);
      await onReplaceCalendarEvents(refreshed);
    } catch (err) {
      setCalError(err instanceof Error ? err.message : 'Calendar update failed.');
    } finally {
      setApplyingCal(false);
    }
  };

  const clashes = detectCalendarClashes(calendarEvents);
  const clashingIds = new Set(clashes.flatMap((c) => [c.a.id, c.b.id]));

  return (
    <div className="space-y-5">
      {/* Google Connection Banner */}
      <section className="machine-card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="section-title-gold text-base font-semibold">{t.google.title}</h1>
            <p className="text-xs font-mono text-[var(--text-muted)] mt-1 tabular-nums flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  googleStatus === 'connected'
                    ? 'bg-[var(--success)]'
                    : googleStatus === 'expired'
                    ? 'bg-[var(--status-elevated)] machine-dot-pulse-fast'
                    : 'bg-[var(--text-muted)]'
                }`}
              />
              {googleStatus === 'connected'
                ? `${t.google.statusConnected} · ${t.google.expiresIn} ~${remainingMins}m`
                : googleStatus === 'expired'
                ? t.google.statusExpired
                : t.google.statusDisconnected}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {googleStatus === 'disconnected' && (
              <button
                type="button"
                disabled={isConnecting || !hasClientId}
                onClick={() => void onConnectGoogle()}
                className="min-h-[44px] px-4 machine-btn-primary text-sm whitespace-nowrap"
              >
                {isConnecting ? 'Connecting...' : t.google.connectBtn}
              </button>
            )}
            {googleStatus === 'expired' && (
              <button
                type="button"
                disabled={isConnecting}
                onClick={() => void onReconnectGoogle()}
                className="min-h-[44px] px-4 machine-btn-primary text-sm whitespace-nowrap"
              >
                {isConnecting ? 'Reconnecting...' : t.google.reconnectBtn}
              </button>
            )}
            {googleStatus === 'connected' && (
              <>
                <button
                  type="button"
                  disabled={isConnecting}
                  onClick={() => void onSwitchGoogleAccount()}
                  className="min-h-[44px] px-3.5 machine-btn-secondary text-xs whitespace-nowrap"
                >
                  {isConnecting ? 'Switching...' : 'Switch Account'}
                </button>
                <button
                  type="button"
                  onClick={() => void onDisconnectGoogle()}
                  className="min-h-[44px] px-4 machine-btn-ghost text-xs whitespace-nowrap"
                >
                  {t.google.disconnectBtn}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="min-h-[44px] px-3.5 machine-btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap"
            >
              <Settings strokeWidth={1.5} className="w-4 h-4" />
              <span>{t.google.openSetup}</span>
            </button>
          </div>
        </div>

        {authError && (
          <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--error)]/60 p-3 space-y-2">
            <p className="text-xs text-[var(--error)] font-mono break-words">{authError}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(currentOrigin);
                  setOriginCopied(true);
                  window.setTimeout(() => setOriginCopied(false), 2000);
                }}
                className="min-h-[44px] px-3 machine-btn-secondary text-xs font-mono flex items-center gap-1.5"
              >
                <Copy strokeWidth={1.5} className="w-3.5 h-3.5" />
                <span>{originCopied ? 'Copied Origin' : `Copy ${currentOrigin}`}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="min-h-[44px] px-3 machine-btn-ghost text-xs font-mono text-[var(--gold-300)]"
              >
                Open Deployment Check
              </button>
            </div>
          </div>
        )}

        {googleStatus !== 'connected' && (
          <div className="pt-2 border-t border-[var(--border)] text-sm text-[var(--text-muted)]">
            {googleStatus === 'expired' ? t.google.expiredDesc : t.google.notConnectedDesc}
          </div>
        )}
      </section>

      {/* Gmail | Calendar Switcher */}
      <div className="flex items-center gap-1 p-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl w-full sm:w-auto sm:inline-flex">
        <button
          type="button"
          onClick={() => setActiveTab('gmail')}
          className={`flex-1 sm:flex-initial min-h-[44px] px-5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition ${
            activeTab === 'gmail'
              ? 'machine-btn-primary'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          <Mail strokeWidth={1.5} className="w-4 h-4" />
          <span>{t.google.tabGmail} ({emailSummaries.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('calendar')}
          className={`flex-1 sm:flex-initial min-h-[44px] px-5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition ${
            activeTab === 'calendar'
              ? 'machine-btn-primary'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          <Calendar strokeWidth={1.5} className="w-4 h-4" />
          <span>{t.google.tabCalendar} ({calendarEvents.length})</span>
        </button>
      </div>

      {/* GMAIL TAB */}
      {activeTab === 'gmail' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--text-muted)]">
              {inboxOverview || 'Recent inbox messages are summarized and ranked locally.'}
            </p>
            <button
              type="button"
              disabled={!isConnected || syncingGmail}
              onClick={() => void handleSyncGmail()}
              className="min-h-[44px] px-4 machine-btn-primary text-sm flex items-center gap-2 whitespace-nowrap"
            >
              <RefreshCw strokeWidth={1.5} className={`w-4 h-4 ${syncingGmail ? 'animate-spin' : ''}`} />
              <span>{syncingGmail ? t.google.syncingGmail : t.google.syncGmail}</span>
            </button>
          </div>

          {gmailError && (
            <div className="machine-card border-[var(--error)]/70 p-3.5 text-sm text-[var(--error)]">
              {gmailError}
            </div>
          )}
          {gmailNotice && (
            <div className="machine-card border-[var(--gold-500)] p-3.5 text-sm text-[var(--gold-300)]">
              {gmailNotice}
            </div>
          )}

          {emailSummaries.length === 0 ? (
            <div className="machine-card p-8 text-center text-sm text-[var(--text-muted)]">
              {t.google.emptyGmail}
            </div>
          ) : (
            <div className="space-y-3">
              {emailSummaries.map((em) => (
                <article key={em.id} className="machine-card p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono text-[var(--text-muted)] truncate">
                        <span
                          className={
                            em.urgency === 'high'
                              ? 'text-[var(--status-critical)] font-semibold'
                              : em.urgency === 'medium'
                              ? 'text-[var(--status-elevated)]'
                              : 'text-[var(--gold-300)]'
                          }
                        >
                          {em.urgency.toUpperCase()}
                        </span>{' '}
                        · {em.from} · {em.detectedLanguage.toUpperCase()}
                      </p>
                      <h2 className="text-sm sm:text-base font-semibold text-[var(--text)] mt-1">
                        {em.subject}
                      </h2>
                    </div>

                    <button
                      type="button"
                      disabled={!isConnected}
                      onClick={() => openReplyComposer(em)}
                      className="min-h-[44px] px-4 machine-btn-secondary text-xs whitespace-nowrap shrink-0"
                    >
                      {t.google.draftReply}
                    </button>
                  </div>

                  <p className="text-sm text-[var(--text)]/90 leading-relaxed">{em.aiSummary}</p>
                  {em.urgencyReason && (
                    <p className="text-xs text-[var(--text-muted)]">Priority note: {em.urgencyReason}</p>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CALENDAR TAB */}
      {activeTab === 'calendar' && (
        <div className="space-y-4">
          {/* Natural Language Event Scheduler */}
          <section className="machine-card p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="nl-cal-input" className="section-title-gold text-xs">
                {t.google.nlCalendarLabel}
              </label>
              <button
                type="button"
                disabled={!isConnected || syncingCal}
                onClick={() => void handleSyncCalendar()}
                className="min-h-[44px] px-3.5 machine-btn-secondary text-xs flex items-center gap-1.5"
              >
                <RefreshCw strokeWidth={1.5} className={`w-3.5 h-3.5 ${syncingCal ? 'animate-spin' : ''}`} />
                <span>{syncingCal ? t.google.syncingCalendar : t.google.syncCalendar}</span>
              </button>
            </div>

            <form onSubmit={handleParseCalendar} className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 flex gap-2">
                {hasSpeechRecognition && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isListening) {
                        stopListening();
                      } else {
                        startListening(settings.voiceInputLang, (txt) => setNlCalInput(txt));
                      }
                    }}
                    aria-label="Speak calendar command"
                    className={`min-h-[48px] min-w-[48px] rounded-xl border flex items-center justify-center shrink-0 transition ${
                      isListening
                        ? 'bg-[var(--gold-500)] border-[var(--gold-300)] text-[var(--text-on-gold)]'
                        : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text)] hover:border-[var(--gold-500)]'
                    }`}
                  >
                    {isListening ? (
                      <MicOff strokeWidth={1.5} className="w-5 h-5" />
                    ) : (
                      <Mic strokeWidth={1.5} className="w-5 h-5" />
                    )}
                  </button>
                )}
                <input
                  id="nl-cal-input"
                  type="text"
                  value={nlCalInput}
                  onChange={(e) => setNlCalInput(e.target.value)}
                  placeholder={t.google.nlCalendarPlaceholder}
                  className="flex-1 min-h-[48px] machine-input px-4 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={!isConnected || !nlCalInput.trim() || parsingCal}
                className="min-h-[48px] px-5 machine-btn-primary text-sm whitespace-nowrap"
              >
                {parsingCal ? 'Checking...' : t.google.nlCalendarBtn}
              </button>
            </form>

            {calError && <p className="text-sm text-[var(--error)]">{calError}</p>}
            {calNotice && <p className="text-sm text-[var(--gold-300)]">{calNotice}</p>}

            {/* Mandatory Confirmation Card */}
            {proposal && (
              <div className="mt-3 p-4 rounded-xl bg-[var(--bg)] border border-[var(--gold-500)] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="section-title-gold text-sm font-semibold">
                    {t.google.confirmCalTitle} · {proposal.action.toUpperCase()}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setProposal(null)}
                    aria-label="Close"
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--gold-300)]"
                  >
                    <X strokeWidth={1.5} className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-[var(--text-muted)]">{proposal.explanation}</p>

                {proposal.hasConflict && (
                  <div className="rounded-xl bg-[var(--surface)] border border-[var(--status-critical)]/70 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-mono text-[var(--status-critical)]">
                      <AlertTriangle strokeWidth={1.5} className="w-4 h-4 shrink-0" />
                      <span>{t.google.conflictWarning}: {proposal.conflictDetails}</span>
                    </div>
                    {proposal.suggestedAlternatives.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-[var(--text-muted)]">{t.google.suggestedSlots}:</p>
                        <div className="flex flex-wrap gap-2">
                          {proposal.suggestedAlternatives.map((slot, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() =>
                                setProposal({
                                  ...proposal,
                                  startIso: slot.startIso,
                                  endIso: slot.endIso,
                                  hasConflict: false,
                                })
                              }
                              className="min-h-[44px] px-3 machine-btn-secondary text-xs font-mono"
                            >
                              {slot.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {proposal.action !== 'cancel' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-3">
                      <label className="block text-xs text-[var(--text-muted)] mb-1">Event Title</label>
                      <input
                        type="text"
                        value={proposal.summary}
                        onChange={(e) => setProposal({ ...proposal, summary: e.target.value })}
                        className="w-full min-h-[44px] machine-input px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">Start (Nairobi)</label>
                      <input
                        type="datetime-local"
                        value={toLocalDateTimeInputValue(proposal.startIso, settings.timezone)}
                        onChange={(e) => {
                          if (e.target.value) {
                            setProposal({
                              ...proposal,
                              startIso: new Date(`${e.target.value}:00+03:00`).toISOString(),
                            });
                          }
                        }}
                        className="w-full min-h-[44px] machine-input px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">End (Nairobi)</label>
                      <input
                        type="datetime-local"
                        value={toLocalDateTimeInputValue(proposal.endIso, settings.timezone)}
                        onChange={(e) => {
                          if (e.target.value) {
                            setProposal({
                              ...proposal,
                              endIso: new Date(`${e.target.value}:00+03:00`).toISOString(),
                            });
                          }
                        }}
                        className="w-full min-h-[44px] machine-input px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">Location</label>
                      <input
                        type="text"
                        value={proposal.location ?? ''}
                        onChange={(e) => setProposal({ ...proposal, location: e.target.value })}
                        className="w-full min-h-[44px] machine-input px-3 text-sm"
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setProposal(null)}
                    className="min-h-[44px] px-4 machine-btn-ghost text-xs text-[var(--text-muted)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={applyingCal}
                    onClick={() => void handleConfirmCalendarChange()}
                    className="min-h-[44px] px-4 machine-btn-primary text-xs flex items-center gap-1.5"
                  >
                    <Check strokeWidth={1.5} className="w-4 h-4" />
                    <span>{applyingCal ? 'Applying...' : t.google.confirmCalBtn}</span>
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Upcoming Events List */}
          <section className="machine-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="section-title-gold text-sm font-semibold">
                Upcoming Events ({calendarEvents.length})
              </h2>
              <span className="text-xs font-mono text-[var(--gold-300)]">{t.google.mirroredBadge}</span>
            </div>
            <hr className="machine-divider mb-2" />

            {calendarEvents.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-6">{t.google.emptyCalendar}</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {calendarEvents.map((ev) => {
                  const hasClash = clashingIds.has(ev.id);
                  return (
                    <li key={ev.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
                          <span className="truncate">{ev.summary}</span>
                          {hasClash && (
                            <span className="text-xs font-mono text-[var(--status-critical)]">· CLASH</span>
                          )}
                        </p>
                        <p className="text-xs font-mono text-[var(--text-muted)] mt-0.5 tabular-nums">
                          {formatShortDateTime(ev.startIso, settings.timezone)} –{' '}
                          {formatShortDateTime(ev.endIso, settings.timezone)}
                          {ev.location ? ` · ${ev.location}` : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {ev.htmlLink && (
                          <a
                            href={ev.htmlLink}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open in Google Calendar"
                            className="min-w-[44px] min-h-[44px] machine-btn-ghost text-[var(--text-muted)] hover:text-[var(--gold-300)] flex items-center justify-center"
                          >
                            <ExternalLink strokeWidth={1.5} className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          type="button"
                          disabled={!isConnected}
                          onClick={() =>
                            setProposal({
                              action: 'cancel',
                              targetEventId: ev.id,
                              summary: ev.summary,
                              startIso: ev.startIso,
                              endIso: ev.endIso,
                              hasConflict: false,
                              suggestedAlternatives: [],
                              explanation: `Confirm cancellation of "${ev.summary}" (${formatShortDateTime(ev.startIso, settings.timezone)}).`,
                            })
                          }
                          aria-label={`Cancel ${ev.summary}`}
                          className="min-w-[44px] min-h-[44px] machine-btn-ghost text-[var(--text-muted)] hover:text-[var(--error)] flex items-center justify-center"
                        >
                          <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* Email Reply Composer Modal */}
      {composingEmail && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-lg machine-card rounded-t-3xl sm:rounded-2xl p-5 max-h-[92dvh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="section-title-gold text-base font-semibold">{t.google.draftReply}</h2>
              <button
                type="button"
                onClick={() => setComposingEmail(null)}
                aria-label="Close"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--gold-300)]"
              >
                <X strokeWidth={1.5} className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">To</label>
                <input
                  type="text"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  className="w-full min-h-[44px] machine-input px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Subject</label>
                <input
                  type="text"
                  value={replySubject}
                  onChange={(e) => setReplySubject(e.target.value)}
                  className="w-full min-h-[44px] machine-input px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Message</label>
                <textarea
                  rows={6}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  className="w-full machine-input p-3.5 text-sm leading-relaxed"
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={sendingEmail || !replyBody.trim()}
                onClick={() => void handleSaveDraft()}
                className="min-h-[44px] px-4 machine-btn-secondary text-xs"
              >
                {t.google.saveDraft}
              </button>
              <button
                type="button"
                disabled={sendingEmail || !replyTo.trim() || !replyBody.trim()}
                onClick={() => setSendApprovalOpen(true)}
                className="min-h-[44px] px-4 machine-btn-primary text-xs flex items-center gap-1.5"
              >
                <Send strokeWidth={1.5} className="w-4 h-4" />
                <span>{t.google.reviewAndSend}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mandatory Outbound Email Approval Dialog */}
      {sendApprovalOpen && composingEmail && (
        <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4">
          <div className="w-full max-w-md machine-card border-[var(--gold-500)] p-6 space-y-4">
            <h3 className="section-title-gold text-base font-semibold">
              {t.google.approveSendTitle}
            </h3>
            <p className="text-xs text-[var(--text-muted)]">{t.google.approveSendDesc}</p>

            <div className="rounded-xl bg-[var(--bg)] border border-[var(--border)] p-3.5 space-y-2 text-xs">
              <p className="text-[var(--text-muted)]">
                To: <span className="text-[var(--gold-300)] font-mono">{replyTo}</span>
              </p>
              <p className="text-[var(--text-muted)]">
                Subject: <span className="text-[var(--text)]">{replySubject}</span>
              </p>
              <p className="text-[var(--text)]/90 pt-2 border-t border-[var(--border)] whitespace-pre-wrap max-h-40 overflow-y-auto">
                {replyBody}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={sendingEmail}
                onClick={() => setSendApprovalOpen(false)}
                className="min-h-[44px] px-4 machine-btn-ghost text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sendingEmail}
                onClick={() => void handleConfirmSend()}
                className="min-h-[44px] px-4 machine-btn-primary text-xs"
              >
                {sendingEmail ? 'Sending...' : t.google.approveSendBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
