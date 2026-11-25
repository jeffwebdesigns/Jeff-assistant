import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { dbStorage } from '../db/storage';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  type ActivityEventItem,
  type AlertLogItem,
  type BriefingItem,
  type BusinessMessageItem,
  type ChatMessage,
  type DocumentItem,
  type HourlyReportItem,
  type MachineSettings,
  type NoteItem,
  type ReminderItem,
  type TaskItem,
} from '../types/machine';
import { auth, db, handleFirestoreError, OperationType } from './firebase';

export type SyncCollectionName =
  | 'notes'
  | 'tasks'
  | 'reminders'
  | 'chats'
  | 'documents'
  | 'briefings'
  | 'activityLogs'
  | 'hourlyReports'
  | 'businessMessages'
  | 'alertLogs';

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'error';

const CLOUD_OWNER_STORAGE_KEY = 'machine_cloud_owner_uid';

export function getLastCloudOwnerUid(): string | null {
  try {
    return localStorage.getItem(CLOUD_OWNER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastCloudOwnerUid(uid: string | null): void {
  try {
    if (uid) {
      localStorage.setItem(CLOUD_OWNER_STORAGE_KEY, uid);
    } else {
      localStorage.removeItem(CLOUD_OWNER_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function clampStr(val: string | undefined | null, maxLen: number, fallback = ''): string {
  const s = (val ?? fallback).toString();
  if (!s && fallback) return fallback.slice(0, maxLen);
  return s.slice(0, maxLen);
}

function clampNonEmpty(val: string | undefined | null, maxLen: number, fallback: string): string {
  const trimmed = (val ?? '').toString().trim();
  if (!trimmed) return fallback.slice(0, maxLen);
  return trimmed.slice(0, maxLen);
}

function clampStringList(list: string[] | undefined, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((v): v is string => typeof v === 'string')
    .slice(0, maxItems)
    .map((v) => v.slice(0, maxLen));
}

function isVerifiedActiveUser(uid: string): boolean {
  const u = auth.currentUser;
  return Boolean(u && u.uid === uid && u.emailVerified);
}

function sanitizeWorkspacePayload(user: User, isCreate: boolean) {
  const payload: Record<string, unknown> = {
    ownerId: user.uid,
    displayName: clampNonEmpty(user.displayName || user.email?.split('@')[0], 120, 'Owner'),
    syncedAt: serverTimestamp(),
  };
  if (user.photoURL) {
    payload.photoURL = clampStr(user.photoURL, 1024);
  }
  if (isCreate) {
    payload.createdAt = serverTimestamp();
  }
  return payload;
}

function sanitizePrivateProfilePayload(user: User, isCreate: boolean) {
  const payload: Record<string, unknown> = {
    ownerId: user.uid,
    email: clampNonEmpty(user.email, 320, 'unknown@example.com'),
    displayName: clampNonEmpty(user.displayName || user.email?.split('@')[0], 120, 'Owner'),
    syncedAt: serverTimestamp(),
  };
  if (user.photoURL) {
    payload.photoURL = clampStr(user.photoURL, 1024);
  }
  if (isCreate) {
    payload.createdAt = serverTimestamp();
  }
  return payload;
}

export function sanitizeSettingsForCloud(uid: string, s: MachineSettings): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: 'owner_settings',
    ownerId: uid,
    displayName: clampNonEmpty(s.displayName, 120, 'Owner'),
    language: s.language === 'sw' ? 'sw' : 'en',
    timezone: clampNonEmpty(s.timezone, 80, 'Africa/Nairobi'),
    currency: clampNonEmpty(s.currency, 16, 'KES'),
    systemPrompt: clampNonEmpty(s.systemPrompt, 6000, DEFAULT_SYSTEM_PROMPT),
    voiceOutputEnabled: Boolean(s.voiceOutputEnabled),
    voiceInputLang:
      s.voiceInputLang === 'en-US' || s.voiceInputLang === 'sw-KE' ? s.voiceInputLang : 'en-KE',
    voiceRate: Math.min(2.0, Math.max(0.5, Number(s.voiceRate) || 1.0)),
    voiceURI: clampStr(s.voiceURI, 300),
    quietHoursEnabled: Boolean(s.quietHoursEnabled),
    quietHoursStart: clampStr(s.quietHoursStart, 10, '22:00'),
    quietHoursEnd: clampStr(s.quietHoursEnd, 10, '07:00'),
    alertCategories: {
      meeting: Boolean(s.alertCategories?.meeting ?? true),
      errand: Boolean(s.alertCategories?.errand ?? true),
      finance: Boolean(s.alertCategories?.finance ?? true),
      health: Boolean(s.alertCategories?.health ?? true),
      general: Boolean(s.alertCategories?.general ?? true),
    },
    syncedAt: serverTimestamp(),
  };
  if (s.googleClientId !== undefined) payload.googleClientId = clampStr(s.googleClientId, 200);
  if (s.lastDriveBackupAt !== undefined) payload.lastDriveBackupAt = clampStr(s.lastDriveBackupAt, 64);
  if (s.lastOverdueNudgeDate !== undefined) payload.lastOverdueNudgeDate = clampStr(s.lastOverdueNudgeDate, 64);
  if (s.voiceDefaultUpgraded !== undefined) payload.voiceDefaultUpgraded = Boolean(s.voiceDefaultUpgraded);
  if (s.pureOledBlack !== undefined) payload.pureOledBlack = Boolean(s.pureOledBlack);
  if (s.englishOnlyUpgraded !== undefined) payload.englishOnlyUpgraded = Boolean(s.englishOnlyUpgraded);
  if (s.hourlyUpdatesEnabled !== undefined) payload.hourlyUpdatesEnabled = Boolean(s.hourlyUpdatesEnabled);
  if (s.hourlySpeakEnabled !== undefined) payload.hourlySpeakEnabled = Boolean(s.hourlySpeakEnabled);
  if (s.lastHourlyUpdateAt !== undefined) payload.lastHourlyUpdateAt = clampStr(s.lastHourlyUpdateAt, 64);
  return payload;
}

function sanitizeEntityForCloud(
  uid: string,
  colName: SyncCollectionName,
  item: unknown
): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  switch (colName) {
    case 'notes': {
      const n = item as NoteItem;
      return {
        id: n.id,
        ownerId: uid,
        title: clampNonEmpty(n.title, 300, 'Untitled Note'),
        content: clampStr(n.content, 50000),
        tags: clampStringList(n.tags, 30, 64),
        createdAt: clampNonEmpty(n.createdAt, 64, nowIso),
        updatedAt: clampNonEmpty(n.updatedAt, 64, nowIso),
        syncedAt: serverTimestamp(),
      };
    }
    case 'tasks': {
      const tk = item as TaskItem;
      const payload: Record<string, unknown> = {
        id: tk.id,
        ownerId: uid,
        title: clampNonEmpty(tk.title, 300, 'Untitled Task'),
        priority: tk.priority === 'low' || tk.priority === 'high' ? tk.priority : 'medium',
        status: tk.status === 'in_progress' || tk.status === 'done' ? tk.status : 'todo',
        tags: clampStringList(tk.tags, 30, 64),
        createdAt: clampNonEmpty(tk.createdAt, 64, nowIso),
        updatedAt: clampNonEmpty(tk.updatedAt, 64, nowIso),
        syncedAt: serverTimestamp(),
      };
      if (tk.notes !== undefined && tk.notes !== null) {
        payload.notes = clampStr(tk.notes, 10000);
      }
      if (tk.dueDate !== undefined && tk.dueDate !== null) {
        payload.dueDate = clampStr(tk.dueDate, 32);
      }
      return payload;
    }
    case 'reminders': {
      const r = item as ReminderItem;
      const payload: Record<string, unknown> = {
        id: r.id,
        ownerId: uid,
        title: clampNonEmpty(r.title, 300, 'Reminder'),
        dueAt: clampNonEmpty(r.dueAt, 64, nowIso),
        category:
          r.category === 'meeting' ||
          r.category === 'errand' ||
          r.category === 'finance' ||
          r.category === 'health'
            ? r.category
            : 'general',
        isMeeting: Boolean(r.isMeeting),
        completed: Boolean(r.completed),
        firedKeys: clampStringList(r.firedKeys, 20, 64),
        createdAt: clampNonEmpty(r.createdAt, 64, nowIso),
        syncedAt: serverTimestamp(),
      };
      if (r.source === 'local' || r.source === 'google_calendar') {
        payload.source = r.source;
      }
      if (r.externalEventId !== undefined && r.externalEventId !== null) {
        payload.externalEventId = clampStr(r.externalEventId, 256);
      }
      return payload;
    }
    case 'chats': {
      const c = item as ChatMessage;
      const payload: Record<string, unknown> = {
        id: c.id,
        ownerId: uid,
        role: c.role === 'assistant' ? 'assistant' : 'user',
        content: clampStr(c.content, 60000),
        timestamp: clampNonEmpty(c.timestamp, 64, nowIso),
        syncedAt: serverTimestamp(),
      };
      if (c.error !== undefined) payload.error = Boolean(c.error);
      if (c.retryPayload !== undefined && c.retryPayload !== null) {
        payload.retryPayload = clampStr(c.retryPayload, 10000);
      }
      if (Array.isArray(c.sources) && c.sources.length > 0) {
        payload.sources = c.sources.slice(0, 20).map((s) => ({
          uri: clampStr(s.uri, 500),
          title: clampStr(s.title, 200),
        }));
      }
      return payload;
    }
    case 'documents': {
      const d = item as DocumentItem;
      const payload: Record<string, unknown> = {
        id: d.id,
        ownerId: uid,
        name: clampNonEmpty(d.name, 300, 'Document'),
        fileType: d.fileType === 'pdf' || d.fileType === 'docx' ? d.fileType : 'txt',
        sizeBytes: Math.min(52428800, Math.max(0, Number(d.sizeBytes) || 0)),
        extractedText: clampStr(d.extractedText, 280000),
        qaHistory: Array.isArray(d.qaHistory)
          ? d.qaHistory.slice(0, 100).map((q) => ({
              id: clampNonEmpty(q.id, 128, 'qa'),
              question: clampStr(q.question, 2000),
              answer: clampStr(q.answer, 10000),
              createdAt: clampNonEmpty(q.createdAt, 64, nowIso),
            }))
          : [],
        createdAt: clampNonEmpty(d.createdAt, 64, nowIso),
        syncedAt: serverTimestamp(),
      };
      if (d.summary !== undefined && d.summary !== null) {
        payload.summary = clampStr(d.summary, 20000);
      }
      if (Array.isArray(d.keyPoints)) {
        payload.keyPoints = clampStringList(d.keyPoints, 30, 1000);
      }
      return payload;
    }
    case 'briefings': {
      const b = item as BriefingItem;
      return {
        id: b.id,
        ownerId: uid,
        dateStr: clampNonEmpty(b.dateStr, 64, nowIso.slice(0, 10)),
        content: clampNonEmpty(b.content, 30000, 'Briefing'),
        createdAt: clampNonEmpty(b.createdAt, 64, nowIso),
        taskCount: Math.max(0, Number(b.taskCount) || 0),
        reminderCount: Math.max(0, Number(b.reminderCount) || 0),
        noteCount: Math.max(0, Number(b.noteCount) || 0),
        syncedAt: serverTimestamp(),
      };
    }
    case 'activityLogs': {
      const a = item as ActivityEventItem;
      const payload: Record<string, unknown> = {
        id: a.id,
        ownerId: uid,
        action: clampNonEmpty(a.action, 120, 'Action'),
        detail: clampStr(a.detail, 300),
        screen: a.screen || 'command',
        timestamp: clampNonEmpty(a.timestamp, 64, nowIso),
        syncedAt: serverTimestamp(),
      };
      if (a.deviceLabel) {
        payload.deviceLabel = clampStr(a.deviceLabel, 120);
      }
      return payload;
    }
    case 'hourlyReports': {
      const h = item as HourlyReportItem;
      return {
        id: h.id,
        ownerId: uid,
        timestamp: clampNonEmpty(h.timestamp, 64, nowIso),
        summary: clampNonEmpty(h.summary, 10000, 'Hourly Report'),
        spokenSummary: clampNonEmpty(h.spokenSummary, 3000, 'Hourly status update.'),
        deviceSnapshot: clampStr(h.deviceSnapshot, 500),
        activityCount: Math.max(0, Number(h.activityCount) || 0),
        syncedAt: serverTimestamp(),
      };
    }
    case 'businessMessages': {
      const m = item as BusinessMessageItem;
      return {
        id: m.id,
        ownerId: uid,
        channel: m.channel === 'facebook' || m.channel === 'instagram' ? m.channel : 'whatsapp',
        senderLabel: clampNonEmpty(m.senderLabel, 200, 'Customer'),
        rawText: clampNonEmpty(m.rawText, 15000, '-'),
        summary: clampStr(m.summary, 4000),
        urgency: m.urgency === 'high' || m.urgency === 'medium' ? m.urgency : 'low',
        detectedLanguage: clampStr(m.detectedLanguage, 32, 'en'),
        draftReply: clampStr(m.draftReply, 10000),
        status: m.status === 'replied' || m.status === 'archived' ? m.status : 'new',
        createdAt: clampNonEmpty(m.createdAt, 64, nowIso),
        syncedAt: serverTimestamp(),
      };
    }
    case 'alertLogs': {
      const l = item as AlertLogItem;
      return {
        id: l.id,
        ownerId: uid,
        reminderId: clampNonEmpty(l.reminderId, 128, 'rem'),
        title: clampNonEmpty(l.title, 300, 'Alert'),
        triggerType: l.triggerType || 'due',
        firedAt: clampNonEmpty(l.firedAt, 64, nowIso),
        channel: l.channel || 'in_app',
        syncedAt: serverTimestamp(),
      };
    }
  }
}

function stripCloudMeta<T>(raw: Record<string, unknown>): T {
  const copy = { ...raw };
  delete copy.ownerId;
  delete copy.syncedAt;
  return copy as T;
}

export async function ensureUserWorkspace(user: User): Promise<void> {
  if (!user.emailVerified) return;
  const workspacePath = `users/${user.uid}`;
  const workspaceRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(workspaceRef);
    if (snap.exists()) {
      await updateDoc(workspaceRef, sanitizeWorkspacePayload(user, false));
    } else {
      await setDoc(workspaceRef, sanitizeWorkspacePayload(user, true));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, workspacePath);
  }

  const profilePath = `users/${user.uid}/private/profile`;
  const profileRef = doc(db, 'users', user.uid, 'private', 'profile');
  try {
    const pSnap = await getDoc(profileRef);
    if (pSnap.exists()) {
      await updateDoc(profileRef, sanitizePrivateProfilePayload(user, false));
    } else {
      await setDoc(profileRef, sanitizePrivateProfilePayload(user, true));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, profilePath);
  }
}

export async function syncWriteSettings(uid: string, settings: MachineSettings): Promise<void> {
  if (!isVerifiedActiveUser(uid)) return;
  const path = `users/${uid}/settings/owner_settings`;
  try {
    await setDoc(doc(db, 'users', uid, 'settings', 'owner_settings'), sanitizeSettingsForCloud(uid, settings));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncWriteItem(
  uid: string,
  colName: SyncCollectionName,
  item: { id: string }
): Promise<void> {
  if (!isVerifiedActiveUser(uid) || !item?.id) return;
  const path = `users/${uid}/${colName}/${item.id}`;
  try {
    await setDoc(doc(db, 'users', uid, colName, item.id), sanitizeEntityForCloud(uid, colName, item));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncDeleteItem(
  uid: string,
  colName: SyncCollectionName,
  id: string
): Promise<void> {
  if (!isVerifiedActiveUser(uid) || !id) return;
  const path = `users/${uid}/${colName}/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, colName, id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface RealtimeSyncCallbacks {
  getLocalSettings: () => MachineSettings;
  onSettings: (settings: MachineSettings) => void;
  onNotes: (items: NoteItem[]) => void;
  onTasks: (items: TaskItem[]) => void;
  onReminders: (items: ReminderItem[]) => void;
  onChats: (items: ChatMessage[]) => void;
  onDocuments: (items: DocumentItem[]) => void;
  onBriefings: (items: BriefingItem[]) => void;
  onActivityLogs: (items: ActivityEventItem[]) => void;
  onHourlyReports: (items: HourlyReportItem[]) => void;
  onBusinessMessages: (items: BusinessMessageItem[]) => void;
  onAlertLogs: (items: AlertLogItem[]) => void;
  onSyncStatus: (status: SyncStatus, errorMessage?: string) => void;
}

export function startUserRealtimeSync(params: {
  user: User;
  allowMergeLocalIntoCloud: boolean;
  callbacks: RealtimeSyncCallbacks;
}): () => void {
  const { user, allowMergeLocalIntoCloud, callbacks } = params;
  const uid = user.uid;
  const unsubscribes: Unsubscribe[] = [];
  let cancelled = false;

  const sortNotes = (a: NoteItem, b: NoteItem) => b.updatedAt.localeCompare(a.updatedAt);
  const sortTasks = (a: TaskItem, b: TaskItem) => b.updatedAt.localeCompare(a.updatedAt);
  const sortReminders = (a: ReminderItem, b: ReminderItem) => a.dueAt.localeCompare(b.dueAt);
  const sortChats = (a: ChatMessage, b: ChatMessage) => a.timestamp.localeCompare(b.timestamp);
  const sortDocs = (a: DocumentItem, b: DocumentItem) => b.createdAt.localeCompare(a.createdAt);
  const sortBriefings = (a: BriefingItem, b: BriefingItem) => b.createdAt.localeCompare(a.createdAt);
  const sortActivity = (a: ActivityEventItem, b: ActivityEventItem) =>
    b.timestamp.localeCompare(a.timestamp);
  const sortHourly = (a: HourlyReportItem, b: HourlyReportItem) =>
    b.timestamp.localeCompare(a.timestamp);
  const sortBiz = (a: BusinessMessageItem, b: BusinessMessageItem) =>
    b.createdAt.localeCompare(a.createdAt);
  const sortAlerts = (a: AlertLogItem, b: AlertLogItem) => b.firedAt.localeCompare(a.firedAt);

  const reportError = (err: unknown, op: OperationType, path: string) => {
    try {
      handleFirestoreError(err, op, path);
    } catch (wrapped) {
      const msg = err instanceof Error ? err.message : String(wrapped);
      callbacks.onSyncStatus('error', msg);
    }
  };

  const attachCollectionListener = <T extends { id: string }>(
    colName: SyncCollectionName,
    sortFn: (a: T, b: T) => number,
    listLocal: () => Promise<T[]>,
    replaceLocal: (items: T[]) => Promise<void>,
    applyState: (items: T[]) => void,
    maxLocalKeep?: number
  ) => {
    let initialDone = false;
    const colPath = `users/${uid}/${colName}`;
    const q = query(collection(db, 'users', uid, colName), where('ownerId', '==', uid));

    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        if (cancelled) return;
        const cloudItems = snapshot.docs.map((d) =>
          stripCloudMeta<T>(d.data() as Record<string, unknown>)
        );

        if (!initialDone) {
          initialDone = true;
          if (allowMergeLocalIntoCloud) {
            try {
              const localItems = await listLocal();
              const cloudIds = new Set(cloudItems.map((x) => x.id));
              const localOnly = localItems.filter((x) => x.id && !cloudIds.has(x.id));
              if (localOnly.length > 0) {
                await Promise.all(localOnly.map((item) => syncWriteItem(uid, colName, item)));
              }
            } catch {
              // Merge failures are reported inside syncWriteItem
            }
          }
        }

        const sorted = [...cloudItems].sort(sortFn);
        const trimmed = typeof maxLocalKeep === 'number' ? sorted.slice(0, maxLocalKeep) : sorted;
        await replaceLocal(trimmed).catch(() => {});
        if (!cancelled) {
          applyState(trimmed);
          callbacks.onSyncStatus('synced');
        }
      },
      (error) => {
        if (!cancelled) {
          reportError(error, OperationType.LIST, colPath);
        }
      }
    );
    unsubscribes.push(unsub);
  };

  void (async () => {
    try {
      callbacks.onSyncStatus('syncing');
      await ensureUserWorkspace(user);
      if (cancelled) return;

      // 1. Settings listener (preserve device-local PIN fields!)
      const settingsPath = `users/${uid}/settings/owner_settings`;
      const settingsRef = doc(db, 'users', uid, 'settings', 'owner_settings');
      let settingsBootstrapped = false;

      const unsubSettings = onSnapshot(
        settingsRef,
        async (snap) => {
          if (cancelled) return;
          if (!snap.exists()) {
            if (!settingsBootstrapped) {
              settingsBootstrapped = true;
              const local = callbacks.getLocalSettings();
              const initialSettings: MachineSettings = {
                ...local,
                displayName:
                  local.displayName === 'Owner' && user.displayName
                    ? user.displayName
                    : local.displayName,
              };
              await syncWriteSettings(uid, initialSettings).catch(() => {});
            }
            return;
          }
          settingsBootstrapped = true;
          const cloudData = stripCloudMeta<Partial<MachineSettings>>(
            snap.data() as Record<string, unknown>
          );
          const localCur = callbacks.getLocalSettings();
          const cloudSystemPrompt =
            typeof cloudData.systemPrompt === 'string' &&
            cloudData.systemPrompt.startsWith('You are THE MACHINE, a private personal AI assistant serving one user.')
              ? DEFAULT_SYSTEM_PROMPT
              : cloudData.systemPrompt;
          const merged: MachineSettings = {
            ...DEFAULT_SETTINGS,
            ...cloudData,
            ...(cloudSystemPrompt ? { systemPrompt: cloudSystemPrompt } : {}),
            id: 'owner_settings',
            // Device-local PIN lock stays private on each device
            pinEnabled: localCur.pinEnabled,
            pinSalt: localCur.pinSalt,
            pinHash: localCur.pinHash,
            alertCategories: {
              ...DEFAULT_SETTINGS.alertCategories,
              ...(cloudData.alertCategories ?? {}),
            },
          };
          await dbStorage.saveSettings(merged).catch(() => {});
          if (!cancelled) {
            callbacks.onSettings(merged);
            callbacks.onSyncStatus('synced');
          }
        },
        (error) => {
          if (!cancelled) {
            reportError(error, OperationType.GET, settingsPath);
          }
        }
      );
      unsubscribes.push(unsubSettings);

      // 2. All user workspace collections in real time
      attachCollectionListener<NoteItem>(
        'notes',
        sortNotes,
        () => dbStorage.listNotes(),
        (items) => dbStorage.replaceNotes(items),
        callbacks.onNotes
      );
      attachCollectionListener<TaskItem>(
        'tasks',
        sortTasks,
        () => dbStorage.listTasks(),
        (items) => dbStorage.replaceTasks(items),
        callbacks.onTasks
      );
      attachCollectionListener<ReminderItem>(
        'reminders',
        sortReminders,
        () => dbStorage.listReminders(),
        (items) => dbStorage.replaceReminders(items),
        callbacks.onReminders
      );
      attachCollectionListener<ChatMessage>(
        'chats',
        sortChats,
        () => dbStorage.listChats(),
        (items) => dbStorage.replaceChats(items),
        callbacks.onChats
      );
      attachCollectionListener<DocumentItem>(
        'documents',
        sortDocs,
        () => dbStorage.listDocuments(),
        (items) => dbStorage.replaceDocuments(items),
        callbacks.onDocuments
      );
      attachCollectionListener<BriefingItem>(
        'briefings',
        sortBriefings,
        () => dbStorage.listBriefings(),
        (items) => dbStorage.replaceBriefings(items),
        callbacks.onBriefings
      );
      attachCollectionListener<ActivityEventItem>(
        'activityLogs',
        sortActivity,
        () => dbStorage.listActivityLogs(),
        (items) => dbStorage.replaceActivityLogs(items),
        callbacks.onActivityLogs,
        180
      );
      attachCollectionListener<HourlyReportItem>(
        'hourlyReports',
        sortHourly,
        () => dbStorage.listHourlyReports(),
        (items) => dbStorage.replaceHourlyReports(items),
        callbacks.onHourlyReports,
        48
      );
      attachCollectionListener<BusinessMessageItem>(
        'businessMessages',
        sortBiz,
        () => dbStorage.listBusinessMessages(),
        (items) => dbStorage.replaceBusinessMessages(items),
        callbacks.onBusinessMessages
      );
      attachCollectionListener<AlertLogItem>(
        'alertLogs',
        sortAlerts,
        () => dbStorage.listAlertLogs(),
        (items) => dbStorage.replaceAlertLogs(items),
        callbacks.onAlertLogs,
        120
      );
    } catch (err) {
      if (!cancelled) {
        const msg = err instanceof Error ? err.message : 'Unable to start real-time sync.';
        callbacks.onSyncStatus('error', msg);
      }
    }
  })();

  return () => {
    cancelled = true;
    for (const unsub of unsubscribes) {
      try {
        unsub();
      } catch {
        // ignore unsubscribe cleanup errors
      }
    }
  };
}
