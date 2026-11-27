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
import type { User } from 'firebase/auth';
import { registerSW } from 'virtual:pwa-register';
import { createId, dbStorage } from './db/storage';
import { getTranslations } from './i18n/translations';
import { aiProvider, AIProviderError } from './services/aiProvider';
import { dispatchSystemNotification, evaluateDueReminders } from './services/notificationScheduler';
import { runCatchUpScan } from './services/catchUpScan';
import {
  buildHourlyUpdateReport,
  collectDeviceTelemetry,
  detectDeviceLabel,
  type DeviceTelemetry,
} from './services/hourlyUpdateService';
import {
  signInWithGoogleAccount,
  signOutGoogleAccount,
  subscribeFirebaseAuth,
} from './services/firebase';
import {
  getLastCloudOwnerUid,
  setLastCloudOwnerUid,
  startUserRealtimeSync,
  syncDeleteItem,
  syncWriteItem,
  syncWriteSettings,
  type SyncCollectionName,
  type SyncStatus,
} from './services/realtimeSync';
import { isWithinQuietHours } from './utils/datetime';
import { useSpeech } from './hooks/useSpeech';
import {
  buildMirroredReminders,
  fetchUpcomingCalendarEvents,
} from './services/calendarService';
import { useGoogleAuth } from './hooks/useGoogleAuth';
import {
  DEFAULT_SETTINGS,
  type ActivityEventItem,
  type AlertLogItem,
  type BriefingItem,
  type BusinessMessageItem,
  type CalendarEventItem,
  type ChatMessage,
  type ChatMode,
  type DocumentItem,
  type EmailSummaryItem,
  type HourlyReportItem,
  type MachineSettings,
  type NoteItem,
  type ReminderItem,
  type ScreenId,
  type TaskItem,
  type TaskStatus,
  type TeachingDepth,
} from './types/machine';
import { PinLockScreen } from './components/PinLockScreen';
import { OfflineBanner, PWAInstallButton } from './components/PWAInstallButton';
import { BrandLogo } from './components/BrandMark';
import { BootScreen } from './components/BootScreen';
import { GoogleAccountControl } from './components/GoogleAccountButton';
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
  const [activityLogs, setActivityLogs] = useState<ActivityEventItem[]>([]);
  const [hourlyReports, setHourlyReports] = useState<HourlyReportItem[]>([]);
  const [deviceTelemetry, setDeviceTelemetry] = useState<DeviceTelemetry | null>(null);
  const [emailSummaries, setEmailSummaries] = useState<EmailSummaryItem[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventItem[]>([]);
  const [businessMessages, setBusinessMessages] = useState<BusinessMessageItem[]>([]);

  // Cross-device cloud auth & real-time sync state
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('local');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [cloudAuthBusy, setCloudAuthBusy] = useState(false);

  // Chat streaming state
  const [chatMode, setChatMode] = useState<ChatMode>(() => {
    try {
      const saved = localStorage.getItem('machine_chat_mode');
      return saved === 'research' || saved === 'instructor' || saved === 'fast' ? saved : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [teachingDepth, setTeachingDepth] = useState<TeachingDepth>(() => {
    try {
      const saved = localStorage.getItem('machine_teaching_depth');
      return saved === 'foundational' || saved === 'intermediate' || saved === 'expert'
        ? saved
        : 'advanced';
    } catch {
      return 'advanced';
    }
  });
  const [isThinking, setIsThinking] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const lastUserMessageRef = useRef<string | null>(null);
  const lastChatModeRef = useRef<ChatMode>(chatMode);
  const chatsRef = useRef<ChatMessage[]>([]);
  const settingsRef = useRef<MachineSettings>(settings);
  const cloudUserRef = useRef<User | null>(cloudUser);
  const chatAbortRef = useRef<AbortController | null>(null);
  const streamingTextRef = useRef('');
  const isThinkingRef = useRef(false);
  const hourlyRunningRef = useRef(false);

  chatsRef.current = chats;
  settingsRef.current = settings;
  cloudUserRef.current = cloudUser;

  // Cross-screen handoffs & Web Share Target
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null);
  const [pendingParseText, setPendingParseText] = useState<string | null>(null);
  const [sharedIncomingText, setSharedIncomingText] = useState<string | null>(null);

  // In-app alert toast & manual catch-up trigger
  const [alertToast, setAlertToast] = useState<string | null>(null);
  const [catchUpTick, setCatchUpTick] = useState(0);

  const googleAuth = useGoogleAuth(settings.googleClientId);
  const { speak, unlockAudio } = useSpeech();

  const reportSyncError = useCallback((err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    let friendly = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed?.error) friendly = parsed.error;
    } catch {
      // keep raw message
    }
    setSyncStatus('error');
    setSyncError(friendly);
  }, []);

  const pushItemToCloud = useCallback(
    (colName: SyncCollectionName, item: { id: string }) => {
      const u = cloudUserRef.current;
      if (!u || !u.emailVerified) return;
      void syncWriteItem(u.uid, colName, item).catch(reportSyncError);
    },
    [reportSyncError]
  );

  const deleteItemFromCloud = useCallback(
    (colName: SyncCollectionName, id: string) => {
      const u = cloudUserRef.current;
      if (!u || !u.emailVerified) return;
      void syncDeleteItem(u.uid, colName, id).catch(reportSyncError);
    },
    [reportSyncError]
  );

  const pushSettingsToCloud = useCallback(
    (nextSettings: MachineSettings) => {
      const u = cloudUserRef.current;
      if (!u || !u.emailVerified) return;
      void syncWriteSettings(u.uid, nextSettings).catch(reportSyncError);
    },
    [reportSyncError]
  );

  const handleChooseCloudAccount = useCallback(async () => {
    setCloudAuthBusy(true);
    setSyncError(null);
    try {
      await signInWithGoogleAccount();
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        return;
      }
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      if (code === 'auth/unauthorized-domain') {
        setSyncError(
          `Domain "${host}" is not authorized in Firebase Auth yet. Add "${host}" under Firebase Console → Authentication → Settings → Authorized domains (project gen-lang-client-0036993655), then tap Google again.`
        );
      } else if (code === 'auth/popup-blocked') {
        setSyncError(
          'Google Sign-In popup was blocked by your browser. Allow popups for this site and tap Google again.'
        );
      } else if (code === 'auth/network-request-failed') {
        setSyncError('Network error while signing in with Google. Check your internet connection and retry.');
      } else {
        setSyncError(err instanceof Error ? err.message : 'Unable to sign in with Google.');
      }
    } finally {
      setCloudAuthBusy(false);
    }
  }, []);

  const handleSignOutCloudAccount = useCallback(async () => {
    setCloudAuthBusy(true);
    setSyncError(null);
    try {
      await signOutGoogleAccount();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unable to sign out.');
    } finally {
      setCloudAuthBusy(false);
    }
  }, []);

  const loadAllFromIndexedDB = useCallback(async () => {
    const [s, n, tk, r, c, d, b, al, act, hr, em, cal, biz] = await Promise.all([
      dbStorage.getSettings(),
      dbStorage.listNotes(),
      dbStorage.listTasks(),
      dbStorage.listReminders(),
      dbStorage.listChats(),
      dbStorage.listDocuments(),
      dbStorage.listBriefings(),
      dbStorage.listAlertLogs(),
      dbStorage.listActivityLogs(),
      dbStorage.listHourlyReports(),
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
    setActivityLogs(act);
    setHourlyReports(hr);
    setEmailSummaries(em);
    setCalendarEvents(cal);
    setBusinessMessages(biz);
    setUnlocked(!s.pinEnabled || !s.pinHash);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void loadAllFromIndexedDB();
  }, [loadAllFromIndexedDB]);

  // Listen to Firebase Auth state changes (Google account sign-in / switch / sign-out)
  useEffect(() => {
    const unsubscribe = subscribeFirebaseAuth((user) => {
      setCloudUser(user);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Attach real-time Firestore cross-device listeners whenever a Google account is active
  useEffect(() => {
    if (!loaded || !authReady) return;

    if (!cloudUser) {
      setLastCloudOwnerUid(null);
      setSyncStatus('local');
      setSyncError(null);
      return;
    }

    if (!cloudUser.emailVerified) {
      setSyncStatus('error');
      setSyncError('Please use a Google account with a verified email for real-time sync.');
      return;
    }

    let active = true;
    let stopRealtime: (() => void) | null = null;

    void (async () => {
      const prevOwnerUid = getLastCloudOwnerUid();
      const switchedAccount = Boolean(prevOwnerUid && prevOwnerUid !== cloudUser.uid);

      if (switchedAccount) {
        const currentSettings = settingsRef.current;
        await dbStorage.deleteAllData();
        const resetSettings: MachineSettings = {
          ...DEFAULT_SETTINGS,
          pinEnabled: currentSettings.pinEnabled,
          pinSalt: currentSettings.pinSalt,
          pinHash: currentSettings.pinHash,
        };
        await dbStorage.saveSettings(resetSettings);
        if (!active) return;
        setSettings(resetSettings);
        setNotes([]);
        setTasks([]);
        setReminders([]);
        setChats([]);
        setDocuments([]);
        setBriefings([]);
        setAlertLogs([]);
        setActivityLogs([]);
        setHourlyReports([]);
        setEmailSummaries([]);
        setCalendarEvents([]);
        setBusinessMessages([]);
      }

      setLastCloudOwnerUid(cloudUser.uid);
      if (!active) return;

      stopRealtime = startUserRealtimeSync({
        user: cloudUser,
        allowMergeLocalIntoCloud: !switchedAccount,
        callbacks: {
          getLocalSettings: () => settingsRef.current,
          onSettings: setSettings,
          onNotes: setNotes,
          onTasks: setTasks,
          onReminders: setReminders,
          onChats: setChats,
          onDocuments: setDocuments,
          onBriefings: setBriefings,
          onActivityLogs: setActivityLogs,
          onHourlyReports: setHourlyReports,
          onBusinessMessages: setBusinessMessages,
          onAlertLogs: setAlertLogs,
          onSyncStatus: (status, errMsg) => {
            setSyncStatus(status);
            setSyncError(errMsg ?? null);
          },
        },
      });
    })();

    return () => {
      active = false;
      stopRealtime?.();
    };
  }, [loaded, authReady, cloudUser]);

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
        pushSettingsToCloud(updatedSettings);
        for (const l of newLogs) pushItemToCloud('alertLogs', l);
        for (const rem of updatedReminders) pushItemToCloud('reminders', rem);
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

  // Refresh live device telemetry on load, network change, and visibility changes
  const refreshTelemetry = useCallback(async () => {
    const tlm = await collectDeviceTelemetry({
      googleStatus: googleAuth.status,
      remainingSeconds: googleAuth.remainingSeconds,
    });
    setDeviceTelemetry(tlm);
    return tlm;
  }, [googleAuth.status, googleAuth.remainingSeconds]);

  useEffect(() => {
    if (!loaded || !unlocked) return;
    void refreshTelemetry();
    const onNet = () => void refreshTelemetry();
    const onVis = () => void refreshTelemetry();
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [loaded, unlocked, refreshTelemetry]);

  const recordActivity = useCallback(
    (action: string, detail = '', targetScreen?: ScreenId) => {
      const ev: ActivityEventItem = {
        id: createId('act'),
        action,
        detail: detail.slice(0, 120),
        screen: targetScreen ?? screen,
        timestamp: new Date().toISOString(),
        deviceLabel: detectDeviceLabel(),
      };
      setActivityLogs((prev) => [ev, ...prev].slice(0, 180));
      void dbStorage.saveActivityLog(ev).catch(() => {});
      pushItemToCloud('activityLogs', ev);
    },
    [pushItemToCloud, screen]
  );

  const navigateTo = useCallback(
    (next: ScreenId) => {
      if (next !== screen) {
        setScreen(next);
        recordActivity('Opened screen', next, next);
      }
    },
    [recordActivity, screen]
  );

  const runHourlyUpdate = useCallback(
    async (opts?: { manual?: boolean; silentInit?: boolean }) => {
      if (hourlyRunningRef.current) return;
      hourlyRunningRef.current = true;
      try {
        const telemetry = await refreshTelemetry();
        const report = buildHourlyUpdateReport({
          telemetry,
          settings,
          activityLogs,
          tasks,
          reminders,
          notes,
          calendarEvents,
          emailSummaries,
        });

        setHourlyReports((prev) => [report, ...prev].slice(0, 48));
        await dbStorage.saveHourlyReport(report);
        pushItemToCloud('hourlyReports', report);

        const nextSettings: MachineSettings = {
          ...settings,
          lastHourlyUpdateAt: report.timestamp,
        };
        setSettings(nextSettings);
        await dbStorage.saveSettings(nextSettings);
        pushSettingsToCloud(nextSettings);

        if (!opts?.silentInit) {
          const channel = await dispatchSystemNotification(
            'THE MACHINE — Hourly Device & Activity Update',
            report.spokenSummary,
            report.id
          );
          const log: AlertLogItem = {
            id: createId('alog'),
            reminderId: report.id,
            title: 'Hourly Device & Activity Update',
            triggerType: 'hourly_update',
            firedAt: report.timestamp,
            channel,
          };
          setAlertLogs((prev) => [log, ...prev]);
          await dbStorage.saveAlertLog(log);
          pushItemToCloud('alertLogs', log);

          setAlertToast(report.spokenSummary);
          window.setTimeout(() => setAlertToast(null), 10000);

          if (opts?.manual || (settings.hourlySpeakEnabled !== false && settings.voiceOutputEnabled)) {
            speak(report.spokenSummary, {
              rate: settings.voiceRate,
              voiceURI: settings.voiceURI,
              langHint: 'en',
            });
          }
        }
      } finally {
        hourlyRunningRef.current = false;
      }
    },
    [
      activityLogs,
      calendarEvents,
      emailSummaries,
      notes,
      refreshTelemetry,
      reminders,
      settings,
      speak,
      tasks,
    ]
  );

  // Automatic 1-hour device & activity update scheduler
  useEffect(() => {
    if (!loaded || !unlocked) return;

    const checkHourly = async () => {
      if (!settings.lastHourlyUpdateAt) {
        await runHourlyUpdate({ silentInit: true });
        return;
      }
      if (settings.hourlyUpdatesEnabled === false) return;
      const lastMs = Date.parse(settings.lastHourlyUpdateAt);
      if (Number.isNaN(lastMs) || Date.now() - lastMs >= 60 * 60 * 1000) {
        const quiet = isWithinQuietHours(
          new Date(),
          settings.quietHoursEnabled,
          settings.quietHoursStart,
          settings.quietHoursEnd,
          settings.timezone
        );
        if (!quiet) {
          await runHourlyUpdate({ manual: false });
        }
      }
    };

    void checkHourly();
    const timer = window.setInterval(() => void checkHourly(), 30000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkHourly();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loaded, unlocked, settings, runHourlyUpdate]);

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
    pushSettingsToCloud(next);
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
        pushItemToCloud('reminders', rem);
      }
      // Remove stale mirrored reminders that are no longer in upcoming events
      const validIds = new Set(mergedReminders.map((r) => r.id));
      for (const prev of reminders) {
        if (prev.source === 'google_calendar' && !validIds.has(prev.id)) {
          await dbStorage.deleteReminder(prev.id);
          deleteItemFromCloud('reminders', prev.id);
        }
      }
    },
    [deleteItemFromCloud, pushItemToCloud, reminders]
  );

  const handleCancelChat = useCallback(() => {
    chatAbortRef.current?.abort(new DOMException('Cancelled by user', 'AbortError'));
  }, []);

  const handleChangeChatMode = useCallback((nextMode: ChatMode) => {
    setChatMode(nextMode);
    try {
      localStorage.setItem('machine_chat_mode', nextMode);
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleChangeTeachingDepth = useCallback((nextDepth: TeachingDepth) => {
    setTeachingDepth(nextDepth);
    try {
      localStorage.setItem('machine_teaching_depth', nextDepth);
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleSendChat = useCallback(
    async (text: string, overrideMode?: ChatMode) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const activeMode: ChatMode = overrideMode ?? chatMode;

      // If an earlier request is somehow still running, cancel it cleanly instead of dropping the new prompt
      if (isThinkingRef.current) {
        chatAbortRef.current?.abort(new DOMException('Superseded by new message', 'AbortError'));
      }

      setRateLimitMessage(null);
      setLastError(null);
      lastUserMessageRef.current = trimmed;
      lastChatModeRef.current = activeMode;
      recordActivity('Asked AI Chat', trimmed.slice(0, 70), 'chat');

      const userMsg: ChatMessage = {
        id: createId('msg'),
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString(),
      };

      const historyBefore = chatsRef.current;
      const nextHistory = [...historyBefore, userMsg];
      chatsRef.current = nextHistory;
      setChats(nextHistory);
      // Persist user message without delaying the network call
      void dbStorage.saveChat(userMsg).catch(() => {});
      pushItemToCloud('chats', userMsg);

      const controller = new AbortController();
      chatAbortRef.current = controller;
      isThinkingRef.current = true;
      streamingTextRef.current = '';
      setIsThinking(true);
      setStreamingText('');

      try {
        const result = await aiProvider.streamChat({
          message: trimmed,
          mode: activeMode,
          teachingDepth,
          history: historyBefore,
          settings,
          activeUserEmail: cloudUserRef.current?.email ?? null,
          tasks,
          reminders,
          notes,
          documents,
          calendarEvents,
          emailSummaries,
          businessMessages,
          activityLogs,
          deviceTelemetry,
          signal: controller.signal,
          onChunk: (partial) => {
            streamingTextRef.current = partial;
            setStreamingText(partial);
          },
        });

        const assistantMsg: ChatMessage = {
          id: createId('msg'),
          role: 'assistant',
          content: result.text,
          timestamp: new Date().toISOString(),
          sources: result.sources,
        };
        setChats((prev) => [...prev, assistantMsg]);
        void dbStorage.saveChat(assistantMsg).catch(() => {});
        pushItemToCloud('chats', assistantMsg);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          const partial = streamingTextRef.current.trim();
          if (partial) {
            const partialMsg: ChatMessage = {
              id: createId('msg'),
              role: 'assistant',
              content: partial,
              timestamp: new Date().toISOString(),
            };
            setChats((prev) => [...prev, partialMsg]);
            void dbStorage.saveChat(partialMsg).catch(() => {});
            pushItemToCloud('chats', partialMsg);
          }
          return;
        }
        if (err instanceof AIProviderError && err.isRateLimit) {
          setRateLimitMessage(err.message || t.chat.rateLimitMsg);
        } else {
          setLastError(err instanceof Error ? err.message : 'Error communicating with THE MACHINE.');
        }
      } finally {
        if (chatAbortRef.current === controller) {
          chatAbortRef.current = null;
          isThinkingRef.current = false;
          streamingTextRef.current = '';
          setIsThinking(false);
          setStreamingText('');
        }
      }
    },
    [businessMessages, calendarEvents, chatMode, documents, emailSummaries, notes, pushItemToCloud, recordActivity, reminders, settings, t.chat.rateLimitMsg, tasks, teachingDepth, activityLogs, deviceTelemetry]
  );

  const handleRetryLast = async () => {
    const prompt = lastUserMessageRef.current;
    if (!prompt || isThinkingRef.current) return;
    setRateLimitMessage(null);
    setLastError(null);

    const controller = new AbortController();
    chatAbortRef.current = controller;
    isThinkingRef.current = true;
    streamingTextRef.current = '';
    setIsThinking(true);
    setStreamingText('');

    const currentChats = chatsRef.current;
    const last = currentChats[currentChats.length - 1];
    const cleanHistory =
      last && last.role === 'user' && last.content === prompt
        ? currentChats.slice(0, -1)
        : currentChats;

    try {
      const result = await aiProvider.streamChat({
        message: prompt,
        mode: lastChatModeRef.current,
        teachingDepth,
        history: cleanHistory,
        settings,
        activeUserEmail: cloudUserRef.current?.email ?? null,
        tasks,
        reminders,
        notes,
        documents,
        calendarEvents,
        emailSummaries,
        businessMessages,
        activityLogs,
        deviceTelemetry,
        signal: controller.signal,
        onChunk: (partial) => {
          streamingTextRef.current = partial;
          setStreamingText(partial);
        },
      });
      const assistantMsg: ChatMessage = {
        id: createId('msg'),
        role: 'assistant',
        content: result.text,
        timestamp: new Date().toISOString(),
        sources: result.sources,
      };
      setChats((prev) => [...prev, assistantMsg]);
      void dbStorage.saveChat(assistantMsg).catch(() => {});
      pushItemToCloud('chats', assistantMsg);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const partial = streamingTextRef.current.trim();
        if (partial) {
          const partialMsg: ChatMessage = {
            id: createId('msg'),
            role: 'assistant',
            content: partial,
            timestamp: new Date().toISOString(),
          };
          setChats((prev) => [...prev, partialMsg]);
          void dbStorage.saveChat(partialMsg).catch(() => {});
          pushItemToCloud('chats', partialMsg);
        }
        return;
      }
      if (err instanceof AIProviderError && err.isRateLimit) {
        setRateLimitMessage(err.message || t.chat.rateLimitMsg);
      } else {
        setLastError(err instanceof Error ? err.message : 'Error communicating with THE MACHINE.');
      }
    } finally {
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
        isThinkingRef.current = false;
        streamingTextRef.current = '';
        setIsThinking(false);
        setStreamingText('');
      }
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
                  onClick={() => navigateTo(item.id)}
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
          <GoogleAccountControl
            compact
            user={cloudUser}
            syncStatus={syncStatus}
            syncError={syncError}
            busy={cloudAuthBusy}
            onChooseAccount={() => void handleChooseCloudAccount()}
            onSignOut={() => void handleSignOutCloudAccount()}
          />
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
        <header className="lg:hidden sticky top-0 z-30 h-14 bg-[var(--bg)] border-b border-[var(--border)] px-3 flex items-center justify-between gap-2">
          <BrandLogo compact />
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--gold-500)] truncate">
            {activeScreenLabel}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={cloudAuthBusy}
              onClick={() => void handleChooseCloudAccount()}
              aria-label={cloudUser ? `Switch Google account (${cloudUser.email})` : 'Choose Google account'}
              className="min-h-[44px] px-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--gold-500)] text-[11px] font-mono flex items-center gap-1.5 text-[var(--text)]"
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  syncStatus === 'synced'
                    ? 'bg-[var(--success)]'
                    : syncStatus === 'syncing'
                    ? 'bg-[var(--gold-300)] machine-dot-pulse-fast'
                    : syncStatus === 'error'
                    ? 'bg-[var(--error)]'
                    : 'bg-[var(--text-muted)]'
                }`}
              />
              <span className="truncate max-w-[90px]">
                {cloudUser ? (cloudUser.displayName?.split(' ')[0] || 'Synced') : 'Google'}
              </span>
            </button>
            <PWAInstallButton compact />
          </div>
        </header>

        {/* Mobile Cloud Auth / Sync Error Banner */}
        {syncError && (
          <div className="lg:hidden mx-4 mt-3 machine-card border-[var(--error)]/70 px-3.5 py-2.5 flex items-start justify-between gap-2 text-xs text-[var(--error)]">
            <span className="leading-relaxed break-words">{syncError}</span>
            <button
              type="button"
              onClick={() => setSyncError(null)}
              aria-label="Dismiss sync error"
              className="text-[var(--text-muted)] hover:text-[var(--text)] min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 -my-1 -mr-1"
            >
              <X strokeWidth={1.5} className="w-4 h-4" />
            </button>
          </div>
        )}

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
                deviceTelemetry={deviceTelemetry}
                activityLogs={activityLogs}
                hourlyReports={hourlyReports}
                isThinking={isThinking}
                cloudUser={cloudUser}
                syncStatus={syncStatus}
                syncError={syncError}
                cloudAuthBusy={cloudAuthBusy}
                onChooseCloudAccount={() => void handleChooseCloudAccount()}
                onSignOutCloudAccount={() => void handleSignOutCloudAccount()}
                onNavigate={navigateTo}
                onQuickChat={(prompt) => {
                  setPendingChatPrompt(prompt);
                  navigateTo('chat');
                }}
                onQuickParse={(text) => {
                  setPendingParseText(text);
                  navigateTo('notes_tasks');
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
                  pushItemToCloud('tasks', updated);
                  recordActivity(
                    nextStatus === 'done' ? 'Completed task' : 'Reopened task',
                    task.title,
                    'command'
                  );
                }}
                onRunCatchUp={() => {
                  setCatchUpTick((x) => x + 1);
                  recordActivity('Refreshed catch-up scan', '', 'command');
                }}
                onRunHourlyUpdate={() => {
                  unlockAudio();
                  void runHourlyUpdate({ manual: true });
                }}
              />
            )}

            {screen === 'chat' && (
              <AIChatScreen
                settings={settings}
                chats={chats}
                tasks={tasks}
                reminders={reminders}
                notes={notes}
                chatMode={chatMode}
                teachingDepth={teachingDepth}
                isThinking={isThinking}
                streamingText={streamingText}
                rateLimitMessage={rateLimitMessage}
                lastError={lastError}
                pendingPrompt={pendingChatPrompt}
                onConsumePendingPrompt={() => setPendingChatPrompt(null)}
                onChangeChatMode={handleChangeChatMode}
                onChangeTeachingDepth={handleChangeTeachingDepth}
                onSendMessage={handleSendChat}
                onCancelStream={handleCancelChat}
                onRetryLast={handleRetryLast}
                onClearChats={async () => {
                  const ids = chatsRef.current.map((c) => c.id);
                  await dbStorage.clearChats();
                  setChats([]);
                  for (const id of ids) {
                    deleteItemFromCloud('chats', id);
                  }
                  recordActivity('Cleared chat history', '', 'chat');
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
                  pushItemToCloud('tasks', task);
                  recordActivity('Saved task', task.title, 'notes_tasks');
                }}
                onDeleteTask={async (id) => {
                  await dbStorage.deleteTask(id);
                  setTasks(await dbStorage.listTasks());
                  deleteItemFromCloud('tasks', id);
                  recordActivity('Deleted task', '', 'notes_tasks');
                }}
                onSaveNote={async (note) => {
                  await dbStorage.saveNote(note);
                  setNotes(await dbStorage.listNotes());
                  pushItemToCloud('notes', note);
                  recordActivity('Saved note', note.title, 'notes_tasks');
                }}
                onDeleteNote={async (id) => {
                  await dbStorage.deleteNote(id);
                  setNotes(await dbStorage.listNotes());
                  deleteItemFromCloud('notes', id);
                  recordActivity('Deleted note', '', 'notes_tasks');
                }}
                onSaveReminder={async (rem) => {
                  await dbStorage.saveReminder(rem);
                  setReminders(await dbStorage.listReminders());
                  pushItemToCloud('reminders', rem);
                  recordActivity('Saved reminder', rem.title, 'notes_tasks');
                }}
              />
            )}

            {screen === 'reminders' && (
              <RemindersScreen
                settings={settings}
                reminders={reminders}
                alertLogs={alertLogs}
                hourlyReports={hourlyReports}
                deviceTelemetry={deviceTelemetry}
                googleStatus={googleAuth.status}
                onSaveReminder={async (rem) => {
                  await dbStorage.saveReminder(rem);
                  setReminders(await dbStorage.listReminders());
                  pushItemToCloud('reminders', rem);
                  recordActivity(
                    rem.completed ? 'Completed reminder' : 'Saved reminder',
                    rem.title,
                    'reminders'
                  );
                }}
                onDeleteReminder={async (id) => {
                  await dbStorage.deleteReminder(id);
                  setReminders(await dbStorage.listReminders());
                  deleteItemFromCloud('reminders', id);
                  recordActivity('Deleted reminder', '', 'reminders');
                }}
                onUpdateSettings={handleUpdateSettings}
                onAddAlertLog={async (log) => {
                  await dbStorage.saveAlertLog(log);
                  setAlertLogs(await dbStorage.listAlertLogs());
                  pushItemToCloud('alertLogs', log);
                }}
                onNavigate={navigateTo}
                onCalendarEventAdded={async () => {
                  if (googleAuth.status === 'connected') {
                    const events = await fetchUpcomingCalendarEvents(settings.googleClientId, 14);
                    await handleReplaceCalendarEvents(events);
                  }
                }}
                onRunHourlyUpdate={() => {
                  unlockAudio();
                  void runHourlyUpdate({ manual: true });
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
                onSwitchGoogleAccount={googleAuth.switchAccount}
                onDisconnectGoogle={googleAuth.disconnect}
                onNavigate={navigateTo}
                onReplaceEmails={async (items) => {
                  setEmailSummaries(items);
                  await dbStorage.replaceEmailSummaries(items);
                  recordActivity('Synced Gmail inbox', `${items.length} emails`, 'google');
                }}
                onReplaceCalendarEvents={async (events) => {
                  await handleReplaceCalendarEvents(events);
                  recordActivity('Synced Google Calendar', `${events.length} events`, 'google');
                }}
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
                  pushItemToCloud('businessMessages', msg);
                  recordActivity('Saved business message', msg.senderLabel, 'business_inbox');
                }}
                onDeleteMessage={async (id) => {
                  await dbStorage.deleteBusinessMessage(id);
                  setBusinessMessages(await dbStorage.listBusinessMessages());
                  deleteItemFromCloud('businessMessages', id);
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
                  pushItemToCloud('documents', doc);
                  recordActivity('Updated document', doc.name, 'documents');
                }}
                onDeleteDocument={async (id) => {
                  await dbStorage.deleteDocument(id);
                  setDocuments(await dbStorage.listDocuments());
                  deleteItemFromCloud('documents', id);
                  recordActivity('Deleted document', '', 'documents');
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
                  pushItemToCloud('briefings', b);
                  recordActivity('Generated briefing', b.dateStr, 'briefing');
                }}
              />
            )}

            {screen === 'settings' && (
              <SettingsScreen
                settings={settings}
                cloudUser={cloudUser}
                syncStatus={syncStatus}
                syncError={syncError}
                cloudAuthBusy={cloudAuthBusy}
                onChooseCloudAccount={() => void handleChooseCloudAccount()}
                onSignOutCloudAccount={() => void handleSignOutCloudAccount()}
                googleStatus={googleAuth.status}
                remainingSeconds={googleAuth.remainingSeconds}
                isConnecting={googleAuth.isConnecting}
                authError={googleAuth.authError}
                onConnectGoogle={googleAuth.connect}
                onReconnectGoogle={googleAuth.reconnect}
                onSwitchGoogleAccount={googleAuth.switchAccount}
                onDisconnectGoogle={googleAuth.disconnect}
                onUpdateSettings={handleUpdateSettings}
                teachingDepth={teachingDepth}
                onChangeTeachingDepth={handleChangeTeachingDepth}
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
                      navigateTo(item.id);
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
                      navigateTo(item.id);
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
