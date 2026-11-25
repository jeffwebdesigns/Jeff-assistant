import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CheckSquare,
  FileText,
  Globe,
  Home,
  Menu,
  MessageCircle,
  MessageSquare,
  Newspaper,
  Settings,
  X,
} from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';
import { createId, dbStorage } from './db/storage';
import { getTranslations } from './i18n/translations';
import { aiProvider, AIProviderError } from './services/aiProvider';
import { evaluateDueReminders } from './services/notificationScheduler';
import { runCatchUpScan } from './services/catchUpScan';
import {
  buildMirroredReminders,
  fetchUpcomingCalendarEvents,
} from './services/calendarService';
import { useGoogleAuth } from './hooks/useGoogleAuth';
import {
  DEFAULT_SETTINGS,
  type AlertLogItem,
  type BriefingItem,
  type BusinessMessageItem,
  type CalendarEventItem,
  type ChatMessage,
  type DocumentItem,
  type EmailSummaryItem,
  type MachineSettings,
  type NoteItem,
  type ReminderItem,
  type ScreenId,
  type TaskItem,
  type TaskStatus,
} from './types/machine';
import { PinLockScreen } from './components/PinLockScreen';
import { OfflineBanner, PWAInstallButton } from './components/PWAInstallButton';
import { BrandLogo } from './components/BrandMark';
import { BootScreen } from './components/BootScreen';
import { CommandCenter } from './components/CommandCenter';
import { AIChatScreen } from './components/AIChatScreen';
import { NotesTasksScreen } from './components/NotesTasksScreen';
import { RemindersScreen } from './components/RemindersScreen';
import { GoogleWorkspaceScreen } from './components/GoogleWorkspaceScreen';
import { BusinessInboxScreen } from './components/BusinessInboxScreen';
import { DocumentsScreen } from './components/DocumentsScreen';
import { DailyBriefingScreen } from './components/DailyBriefingScreen';
import { SettingsScreen } from './components/SettingsScreen';

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [bootDone, setBootDone] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [screen, setScreen] = useState<ScreenId>('command');
  const [moreOpen, setMoreOpen] = useState(false);

  const [settings, setSettings] = useState<MachineSettings>(DEFAULT_SETTINGS);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [briefings, setBriefings] = useState<BriefingItem[]>([]);
  const [alertLogs, setAlertLogs] = useState<AlertLogItem[]>([]);
  const [emailSummaries, setEmailSummaries] = useState<EmailSummaryItem[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventItem[]>([]);
  const [businessMessages, setBusinessMessages] = useState<BusinessMessageItem[]>([]);

  // Chat streaming state
  const [isThinking, setIsThinking] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const lastUserMessageRef = useRef<string | null>(null);

  // Cross-screen handoffs & Web Share Target
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null);
  const [pendingParseText, setPendingParseText] = useState<string | null>(null);
  const [sharedIncomingText, setSharedIncomingText] = useState<string | null>(null);

  // In-app alert toast & manual catch-up trigger
  const [alertToast, setAlertToast] = useState<string | null>(null);
  const [catchUpTick, setCatchUpTick] = useState(0);

  const googleAuth = useGoogleAuth(settings.googleClientId);

  const loadAllFromIndexedDB = useCallback(async () => {
    const [s, n, tk, r, c, d, b, al, em, cal, biz] = await Promise.all([
      dbStorage.getSettings(),
      dbStorage.listNotes(),
      dbStorage.listTasks(),
      dbStorage.listReminders(),
      dbStorage.listChats(),
      dbStorage.listDocuments(),
      dbStorage.listBriefings(),
      dbStorage.listAlertLogs(),
      dbStorage.listEmailSummaries(),
      dbStorage.listCalendarEvents(),
      dbStorage.listBusinessMessages(),
    ]);
    setSettings(s);
    setNotes(n);
    setTasks(tk);
    setReminders(r);
    setChats(c);
    setDocuments(d);
    setBriefings(b);
    setAlertLogs(al);
    setEmailSummaries(em);
    setCalendarEvents(cal);
    setBusinessMessages(biz);
    setUnlocked(!s.pinEnabled || !s.pinHash);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void loadAllFromIndexedDB();
  }, [loadAllFromIndexedDB]);

  // Sync Pure OLED Black mode (#000000 vs #0A0A0A)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isOled = Boolean(settings.pureOledBlack);
    document.documentElement.dataset.oled = isOled ? 'true' : 'false';
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', isOled ? '#000000' : '#0A0A0A');
    }
  }, [settings.pureOledBlack]);

  // Handle Web Share Target API GET parameters
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const sharedParts = [
      params.get('shared_title'),
      params.get('shared_text'),
      params.get('shared_url'),
    ]
      .map((v) => v?.trim())
      .filter(Boolean);

    if (sharedParts.length > 0) {
      setSharedIncomingText(sharedParts.join('\n'));
      setScreen('business_inbox');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Register PWA service worker
  useEffect(() => {
    try {
      registerSW({ immediate: true });
    } catch {
      // ignore in unsupported contexts
    }
  }, []);

  // Periodic reminder + overdue task evaluation (1d, 1h, 10m, due)
  useEffect(() => {
    if (!loaded || !unlocked) return;

    const runCheck = async () => {
      const { updatedReminders, updatedSettings, newLogs, inAppBanner } =
        await evaluateDueReminders(reminders, tasks, settings);
      if (newLogs.length > 0) {
        setReminders(updatedReminders);
        setSettings(updatedSettings);
        setAlertLogs((prev) => [...newLogs, ...prev]);
        if (inAppBanner) {
          setAlertToast(inAppBanner);
          window.setTimeout(() => setAlertToast(null), 7000);
        }
      }
    };

    void runCheck();
    const interval = window.setInterval(() => void runCheck(), 20000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setCatchUpTick((x) => x + 1);
        void runCheck();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loaded, unlocked, reminders, tasks, settings]);

  // Catch-Up Scan Priority Feed
  const catchUpItems = useMemo(() => {
    if (!loaded) return [];
    void catchUpTick;
    return runCatchUpScan({
      reminders,
      tasks,
      emailSummaries,
      calendarEvents,
      timezone: settings.timezone,
    });
  }, [loaded, catchUpTick, reminders, tasks, emailSummaries, calendarEvents, settings.timezone]);

  const t = getTranslations(settings.language);

  const handleUpdateSettings = async (next: MachineSettings) => {
    setSettings(next);
    await dbStorage.saveSettings(next);
  };

  const handleReplaceCalendarEvents = useCallback(
    async (events: CalendarEventItem[]) => {
      setCalendarEvents(events);
      await dbStorage.replaceCalendarEvents(events);

      // Mirror upcoming Calendar meetings into local reminders
      const mergedReminders = buildMirroredReminders(events, reminders);
      setReminders(mergedReminders);
      for (const rem of mergedReminders) {
        await dbStorage.saveReminder(rem);
      }
      // Remove stale mirrored reminders that are no longer in upcoming events
      const validIds = new Set(mergedReminders.map((r) => r.id));
      for (const prev of reminders) {
        if (prev.source === 'google_calendar' && !validIds.has(prev.id)) {
          await dbStorage.deleteReminder(prev.id);
        }
      }
    },
    [reminders]
  );

  const handleSendChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isThinking) return;

      setRateLimitMessage(null);
      setLastError(null);
      lastUserMessageRef.current = trimmed;

      const userMsg: ChatMessage = {
        id: createId('msg'),
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString(),
      };

      const nextHistory = [...chats, userMsg];
      setChats(nextHistory);
      await dbStorage.saveChat(userMsg);

      setIsThinking(true);
      setStreamingText('');

      try {
        const result = await aiProvider.streamChat({
          message: trimmed,
          history: chats,
          settings,
          tasks,
          reminders,
          notes,
          documents,
          calendarEvents,
          emailSummaries,
          businessMessages,
          onChunk: (partial) => setStreamingText(partial),
        });

        const assistantMsg: ChatMessage = {
          id: createId('msg'),
          role: 'assistant',
          content: result.text || 'STATUS: NOMINAL\nOBSERVATION: No response text received.',
          timestamp: new Date().toISOString(),
          sources: result.sources,
        };
        setChats((prev) => [...prev, assistantMsg]);
        await dbStorage.saveChat(assistantMsg);
      } catch (err) {
        if (err instanceof AIProviderError && err.isRateLimit) {
          setRateLimitMessage(err.message || t.chat.rateLimitMsg);
        } else {
          setLastError(err instanceof Error ? err.message : 'Error communicating with THE MACHINE.');
        }
      } finally {
        setIsThinking(false);
        setStreamingText('');
      }
    },
    [businessMessages, calendarEvents, chats, documents, emailSummaries, isThinking, notes, reminders, settings, t.chat.rateLimitMsg, tasks]
  );

  const handleRetryLast = async () => {
    const prompt = lastUserMessageRef.current;
    if (!prompt || isThinking) return;
    setRateLimitMessage(null);
    setLastError(null);
    setIsThinking(true);
    setStreamingText('');
    try {
      const result = await aiProvider.streamChat({
        message: prompt,
        history: chats.slice(0, -1),
        settings,
        tasks,
        reminders,
        notes,
        documents,
        calendarEvents,
        emailSummaries,
        businessMessages,
        onChunk: (partial) => setStreamingText(partial),
      });
      const assistantMsg: ChatMessage = {
        id: createId('msg'),
        role: 'assistant',
        content: result.text,
        timestamp: new Date().toISOString(),
        sources: result.sources,
      };
      setChats((prev) => [...prev, assistantMsg]);
      await dbStorage.saveChat(assistantMsg);
    } catch (err) {
      if (err instanceof AIProviderError && err.isRateLimit) {
        setRateLimitMessage(err.message || t.chat.rateLimitMsg);
      } else {
        setLastError(err instanceof Error ? err.message : 'Error communicating with THE MACHINE.');
      }
    } finally {
      setIsThinking(false);
      setStreamingText('');
    }
  };

  if (!bootDone) {
    return <BootScreen tagline={t.tagline} onComplete={() => setBootDone(true)} />;
  }

  if (!loaded) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text-muted)] flex items-center justify-center font-mono text-sm">
        INITIALIZING LOCAL STORAGE...
      </div>
    );
  }

  if (!unlocked && settings.pinEnabled && settings.pinHash) {
    return (
      <PinLockScreen
        salt={settings.pinSalt}
        hash={settings.pinHash}
        language={settings.language}
        onUnlock={() => setUnlocked(true)}
      />
    );
  }

  const desktopNavItems: Array<{ id: ScreenId; label: string; icon: typeof Home }> = [
    { id: 'command', label: t.nav.command, icon: Home },
    { id: 'chat', label: t.nav.chat, icon: MessageSquare },
    { id: 'notes_tasks', label: t.nav.notesTasks, icon: CheckSquare },
    { id: 'reminders', label: t.nav.reminders, icon: Bell },
    { id: 'google', label: t.nav.google, icon: Globe },
    { id: 'business_inbox', label: t.nav.businessInbox, icon: MessageCircle },
    { id: 'documents', label: t.nav.documents, icon: FileText },
    { id: 'briefing', label: t.nav.briefing, icon: Newspaper },
    { id: 'settings', label: t.nav.settings, icon: Settings },
  ];

  const mobileBottomItems: Array<{ id: ScreenId | 'more'; label: string; icon: typeof Home }> = [
    { id: 'command', label: t.nav.command, icon: Home },
    { id: 'chat', label: t.nav.chat, icon: MessageSquare },
    { id: 'google', label: t.nav.google, icon: Globe },
    { id: 'notes_tasks', label: t.nav.notesTasks, icon: CheckSquare },
    { id: 'more', label: t.nav.more, icon: Menu },
  ];

  const moreScreens: Array<{ id: ScreenId; label: string; icon: typeof FileText }> = [
    { id: 'reminders', label: t.nav.reminders, icon: Bell },
    { id: 'business_inbox', label: t.nav.businessInbox, icon: MessageCircle },
    { id: 'documents', label: t.nav.documents, icon: FileText },
    { id: 'briefing', label: t.nav.briefing, icon: Newspaper },
    { id: 'settings', label: t.nav.settings, icon: Settings },
  ];

  const activeScreenLabel =
    desktopNavItems.find((item) => item.id === screen)?.label ?? t.appTitle;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-[var(--bg)] border-r border-[var(--border)] p-4 justify-between">
        <div>
          <div className="px-2 py-2 mb-4 flex items-center justify-between gap-2">
            <BrandLogo showTagline tagline={t.tagline} />
            {isThinking && (
              <span
                className="w-2.5 h-2.5 rounded-full bg-[var(--gold-500)] machine-dot-pulse-fast shrink-0"
                aria-label="Analyzing"
              />
            )}
          </div>
          <hr className="machine-divider mb-4" />

          <nav className="space-y-1" aria-label="Main navigation">
            {desktopNavItems.map((item) => {
              const Icon = item.icon;
              const active = screen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setScreen(item.id)}
                  className={`w-full min-h-[44px] px-3 rounded-xl flex items-center gap-3 text-sm font-medium transition border ${
                    active
                      ? 'bg-[var(--surface-2)] text-[var(--gold-300)] border-[var(--gold-700)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] border-transparent'
                  }`}
                >
                  <Icon
                    strokeWidth={1.5}
                    className={`w-4 h-4 shrink-0 ${active ? 'text-[var(--gold-500)]' : 'text-[var(--text-muted)]'}`}
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-4 space-y-3">
          <hr className="machine-divider" />
          <PWAInstallButton />
          <p className="text-[11px] font-mono text-[var(--text-muted)] px-1 tabular-nums">
            {settings.timezone} · {settings.currency}
          </p>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        <OfflineBanner language={settings.language} />

        {/* Expired Google Session Banner (never fails silently) */}
        {googleAuth.status === 'expired' && (
          <div className="bg-[var(--surface)] border-b border-[var(--status-elevated)]/60 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-mono text-[var(--status-elevated)] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--status-elevated)] machine-dot-pulse-fast" />
              {t.google.expiredTitle}
            </span>
            <button
              type="button"
              onClick={() => void googleAuth.reconnect()}
              className="min-h-[44px] px-3.5 rounded-xl machine-btn-secondary text-xs"
            >
              {t.google.reconnectBtn}
            </button>
          </div>
        )}

        {/* Compact Mobile Top Header (solid --bg, zero heavy blur for low-end Android performance) */}
        <header className="lg:hidden sticky top-0 z-30 h-14 bg-[var(--bg)] border-b border-[var(--border)] px-4 flex items-center justify-between gap-3">
          <BrandLogo compact />
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--gold-500)] truncate">
            {activeScreenLabel}
          </span>
          <div className="shrink-0">
            <PWAInstallButton compact />
          </div>
        </header>

        {/* In-App Alert Toast */}
        {alertToast && (
          <div className="mx-4 mt-3 lg:mx-8 machine-card border-[var(--gold-500)] px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm text-[var(--text)]">
              <Bell strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)] shrink-0" />
              <span>{alertToast}</span>
            </div>
            <button
              type="button"
              onClick={() => setAlertToast(null)}
              aria-label="Dismiss notification"
              className="text-[var(--text-muted)] hover:text-[var(--text)] min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <X strokeWidth={1.5} className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Active Screen Viewport */}
        <main className="flex-1 w-full max-w-6xl mx-auto p-4 lg:p-8 pb-24 lg:pb-8">
          <div key={screen} className="machine-page-enter">
            {screen === 'command' && (
              <CommandCenter
                settings={settings}
                tasks={tasks}
                reminders={reminders}
                notes={notes}
                briefings={briefings}
                catchUpItems={catchUpItems}
                isThinking={isThinking}
                onNavigate={(next) => setScreen(next)}
                onQuickChat={(prompt) => {
                  setPendingChatPrompt(prompt);
                  setScreen('chat');
                }}
                onQuickParse={(text) => {
                  setPendingParseText(text);
                  setScreen('notes_tasks');
                }}
                onToggleTaskStatus={async (task) => {
                  const nextStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
                  const updated: TaskItem = {
                    ...task,
                    status: nextStatus,
                    updatedAt: new Date().toISOString(),
                  };
                  await dbStorage.saveTask(updated);
                  setTasks((prev) => prev.map((x) => (x.id === task.id ? updated : x)));
                }}
                onRunCatchUp={() => setCatchUpTick((x) => x + 1)}
              />
            )}

            {screen === 'chat' && (
              <AIChatScreen
                settings={settings}
                chats={chats}
                tasks={tasks}
                reminders={reminders}
                notes={notes}
                isThinking={isThinking}
                streamingText={streamingText}
                rateLimitMessage={rateLimitMessage}
                lastError={lastError}
                pendingPrompt={pendingChatPrompt}
                onConsumePendingPrompt={() => setPendingChatPrompt(null)}
                onSendMessage={handleSendChat}
                onRetryLast={handleRetryLast}
                onClearChats={async () => {
                  await dbStorage.clearChats();
                  setChats([]);
                }}
                onChangeVoiceLang={(lang) => {
                  void handleUpdateSettings({ ...settings, voiceInputLang: lang });
                }}
                onToggleAutoSpeak={(enabled) => {
                  void handleUpdateSettings({ ...settings, voiceOutputEnabled: enabled });
                }}
              />
            )}

            {screen === 'notes_tasks' && (
              <NotesTasksScreen
                settings={settings}
                tasks={tasks}
                notes={notes}
                pendingParseText={pendingParseText}
                onConsumePendingParse={() => setPendingParseText(null)}
                onSaveTask={async (task) => {
                  await dbStorage.saveTask(task);
                  setTasks(await dbStorage.listTasks());
                }}
                onDeleteTask={async (id) => {
                  await dbStorage.deleteTask(id);
                  setTasks(await dbStorage.listTasks());
                }}
                onSaveNote={async (note) => {
                  await dbStorage.saveNote(note);
                  setNotes(await dbStorage.listNotes());
                }}
                onDeleteNote={async (id) => {
                  await dbStorage.deleteNote(id);
                  setNotes(await dbStorage.listNotes());
                }}
                onSaveReminder={async (rem) => {
                  await dbStorage.saveReminder(rem);
                  setReminders(await dbStorage.listReminders());
                }}
              />
            )}

            {screen === 'reminders' && (
              <RemindersScreen
                settings={settings}
                reminders={reminders}
                alertLogs={alertLogs}
                googleStatus={googleAuth.status}
                onSaveReminder={async (rem) => {
                  await dbStorage.saveReminder(rem);
                  setReminders(await dbStorage.listReminders());
                }}
                onDeleteReminder={async (id) => {
                  await dbStorage.deleteReminder(id);
                  setReminders(await dbStorage.listReminders());
                }}
                onUpdateSettings={handleUpdateSettings}
                onAddAlertLog={async (log) => {
                  await dbStorage.saveAlertLog(log);
                  setAlertLogs(await dbStorage.listAlertLogs());
                }}
                onNavigate={(next) => setScreen(next)}
                onCalendarEventAdded={async () => {
                  if (googleAuth.status === 'connected') {
                    const events = await fetchUpcomingCalendarEvents(settings.googleClientId, 14);
                    await handleReplaceCalendarEvents(events);
                  }
                }}
              />
            )}

            {screen === 'google' && (
              <GoogleWorkspaceScreen
                settings={settings}
                googleStatus={googleAuth.status}
                remainingSeconds={googleAuth.remainingSeconds}
                isConnecting={googleAuth.isConnecting}
                authError={googleAuth.authError}
                hasClientId={googleAuth.hasClientId}
                emailSummaries={emailSummaries}
                calendarEvents={calendarEvents}
                onConnectGoogle={googleAuth.connect}
                onReconnectGoogle={googleAuth.reconnect}
                onDisconnectGoogle={googleAuth.disconnect}
                onNavigate={(next) => setScreen(next)}
                onReplaceEmails={async (items) => {
                  setEmailSummaries(items);
                  await dbStorage.replaceEmailSummaries(items);
                }}
                onReplaceCalendarEvents={handleReplaceCalendarEvents}
              />
            )}

            {screen === 'business_inbox' && (
              <BusinessInboxScreen
                settings={settings}
                messages={businessMessages}
                sharedIncomingText={sharedIncomingText}
                onConsumeSharedText={() => setSharedIncomingText(null)}
                onSaveMessage={async (msg) => {
                  await dbStorage.saveBusinessMessage(msg);
                  setBusinessMessages(await dbStorage.listBusinessMessages());
                }}
                onDeleteMessage={async (id) => {
                  await dbStorage.deleteBusinessMessage(id);
                  setBusinessMessages(await dbStorage.listBusinessMessages());
                }}
              />
            )}

            {screen === 'documents' && (
              <DocumentsScreen
                settings={settings}
                documents={documents}
                onSaveDocument={async (doc) => {
                  await dbStorage.saveDocument(doc);
                  setDocuments(await dbStorage.listDocuments());
                }}
                onDeleteDocument={async (id) => {
                  await dbStorage.deleteDocument(id);
                  setDocuments(await dbStorage.listDocuments());
                }}
              />
            )}

            {screen === 'briefing' && (
              <DailyBriefingScreen
                settings={settings}
                briefings={briefings}
                tasks={tasks}
                reminders={reminders}
                notes={notes}
                calendarEvents={calendarEvents}
                emailSummaries={emailSummaries}
                googleStatus={googleAuth.status}
                onSaveBriefing={async (b) => {
                  await dbStorage.saveBriefing(b);
                  setBriefings(await dbStorage.listBriefings());
                }}
              />
            )}

            {screen === 'settings' && (
              <SettingsScreen
                settings={settings}
                googleStatus={googleAuth.status}
                remainingSeconds={googleAuth.remainingSeconds}
                isConnecting={googleAuth.isConnecting}
                authError={googleAuth.authError}
                onConnectGoogle={googleAuth.connect}
                onReconnectGoogle={googleAuth.reconnect}
                onDisconnectGoogle={googleAuth.disconnect}
                onUpdateSettings={handleUpdateSettings}
                onLockNow={() => setUnlocked(false)}
                onDataReloaded={loadAllFromIndexedDB}
              />
            )}
          </div>
        </main>

        {/* Mobile Fixed Bottom Navigation — thin gold top border & top indicator line */}
        <nav
          aria-label="Mobile navigation"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg)] border-t border-[var(--gold-900)] pb-safe"
        >
          <div className="grid grid-cols-5 h-16 items-center">
            {mobileBottomItems.map((item) => {
              const Icon = item.icon;
              const isMoreActive =
                item.id === 'more' &&
                (screen === 'reminders' ||
                  screen === 'business_inbox' ||
                  screen === 'documents' ||
                  screen === 'briefing' ||
                  screen === 'settings');
              const active = screen === item.id || isMoreActive;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'more') {
                      setMoreOpen((v) => !v);
                    } else {
                      setMoreOpen(false);
                      setScreen(item.id);
                    }
                  }}
                  className={`relative min-h-[48px] h-full flex flex-col items-center justify-center gap-1 transition ${
                    active
                      ? 'text-[var(--gold-500)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-[var(--gold-500)]"
                    />
                  )}
                  <Icon strokeWidth={1.5} className="w-5 h-5" />
                  <span className="text-[11px] font-medium tracking-tight whitespace-nowrap">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Mobile "More" Bottom Sheet */}
        {moreOpen && (
          <div
            className="lg:hidden fixed inset-0 z-50 bg-black/75 flex items-end"
            onClick={() => setMoreOpen(false)}
          >
            <div
              className="w-full bg-[var(--surface)] border-t border-[var(--gold-900)] rounded-t-3xl p-5 pb-8 space-y-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-[var(--gold-900)] rounded-full mx-auto mb-4" />
              {moreScreens.map((item) => {
                const Icon = item.icon;
                const active = screen === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setScreen(item.id);
                      setMoreOpen(false);
                    }}
                    className={`w-full min-h-[52px] px-4 rounded-xl flex items-center gap-3 text-sm font-medium transition border ${
                      active
                        ? 'bg-[var(--surface-2)] border-[var(--gold-500)] text-[var(--gold-300)]'
                        : 'bg-[var(--bg)] border-[var(--border)] text-[var(--text)] hover:border-[var(--gold-700)]'
                    }`}
                  >
                    <Icon
                      strokeWidth={1.5}
                      className={`w-5 h-5 ${active ? 'text-[var(--gold-500)]' : 'text-[var(--text-muted)]'}`}
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
