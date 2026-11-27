import {
  CREATOR_ADMIN_NAME,
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  LEGACY_DEFAULT_PROMPTS,
  type ActivityEventItem,
  type AlertLogItem,
  type BriefingItem,
  type BusinessMessageItem,
  type CalendarEventItem,
  type ChatMessage,
  type DocumentItem,
  type EmailSummaryItem,
  type HourlyReportItem,
  type MachineBackupPayload,
  type MachineSettings,
  type NoteItem,
  type ReminderItem,
  type TaskItem,
} from '../types/machine';

const DB_NAME = 'machine_private_db';
const DB_VERSION = 3;

const STORES = {
  notes: 'notes',
  tasks: 'tasks',
  reminders: 'reminders',
  chats: 'chats',
  documents: 'documents',
  briefings: 'briefings',
  alertLogs: 'alertLogs',
  activityLogs: 'activityLogs',
  hourlyReports: 'hourlyReports',
  emailSummaries: 'emailSummaries',
  calendarEvents: 'calendarEvents',
  businessMessages: 'businessMessages',
  settings: 'settings',
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

async function getAllFromStore<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error ?? new Error(`Failed reading ${storeName}`));
  });
}

async function getOneFromStore<T>(storeName: StoreName, id: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error(`Failed reading ${id} from ${storeName}`));
  });
}

async function putInStore<T>(storeName: StoreName, item: T): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed writing to ${storeName}`));
  });
}

async function replaceAllInStore<T extends { id: string }>(storeName: StoreName, items: T[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items) {
      if (item && item.id) store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed replacing ${storeName}`));
  });
}

async function deleteFromStore(storeName: StoreName, id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed deleting ${id} from ${storeName}`));
  });
}

async function clearStore(storeName: StoreName): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed clearing ${storeName}`));
  });
}

export const dbStorage = {
  // Notes
  async listNotes(): Promise<NoteItem[]> {
    const list = await getAllFromStore<NoteItem>(STORES.notes);
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  saveNote: (note: NoteItem) => putInStore(STORES.notes, note),
  replaceNotes: (items: NoteItem[]) => replaceAllInStore(STORES.notes, items),
  deleteNote: (id: string) => deleteFromStore(STORES.notes, id),

  // Tasks
  async listTasks(): Promise<TaskItem[]> {
    const list = await getAllFromStore<TaskItem>(STORES.tasks);
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  saveTask: (task: TaskItem) => putInStore(STORES.tasks, task),
  replaceTasks: (items: TaskItem[]) => replaceAllInStore(STORES.tasks, items),
  deleteTask: (id: string) => deleteFromStore(STORES.tasks, id),

  // Reminders
  async listReminders(): Promise<ReminderItem[]> {
    const list = await getAllFromStore<ReminderItem>(STORES.reminders);
    return list.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  },
  saveReminder: (reminder: ReminderItem) => putInStore(STORES.reminders, reminder),
  replaceReminders: (items: ReminderItem[]) => replaceAllInStore(STORES.reminders, items),
  deleteReminder: (id: string) => deleteFromStore(STORES.reminders, id),

  // Chats
  async listChats(): Promise<ChatMessage[]> {
    const list = await getAllFromStore<ChatMessage>(STORES.chats);
    return list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  },
  saveChat: (msg: ChatMessage) => putInStore(STORES.chats, msg),
  replaceChats: (items: ChatMessage[]) => replaceAllInStore(STORES.chats, items),
  clearChats: () => clearStore(STORES.chats),

  // Documents
  async listDocuments(): Promise<DocumentItem[]> {
    const list = await getAllFromStore<DocumentItem>(STORES.documents);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  saveDocument: (doc: DocumentItem) => putInStore(STORES.documents, doc),
  replaceDocuments: (items: DocumentItem[]) => replaceAllInStore(STORES.documents, items),
  deleteDocument: (id: string) => deleteFromStore(STORES.documents, id),

  // Briefings
  async listBriefings(): Promise<BriefingItem[]> {
    const list = await getAllFromStore<BriefingItem>(STORES.briefings);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  saveBriefing: (briefing: BriefingItem) => putInStore(STORES.briefings, briefing),
  replaceBriefings: (items: BriefingItem[]) => replaceAllInStore(STORES.briefings, items),

  // Alert logs
  async listAlertLogs(): Promise<AlertLogItem[]> {
    const list = await getAllFromStore<AlertLogItem>(STORES.alertLogs);
    return list.sort((a, b) => b.firedAt.localeCompare(a.firedAt));
  },
  saveAlertLog: (log: AlertLogItem) => putInStore(STORES.alertLogs, log),
  replaceAlertLogs: (items: AlertLogItem[]) => replaceAllInStore(STORES.alertLogs, items),

  // Device activity logs (newest first, capped at 180)
  async listActivityLogs(): Promise<ActivityEventItem[]> {
    const list = await getAllFromStore<ActivityEventItem>(STORES.activityLogs);
    return list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
  async saveActivityLog(event: ActivityEventItem): Promise<void> {
    await putInStore(STORES.activityLogs, event);
    const all = await this.listActivityLogs();
    if (all.length > 180) {
      for (const stale of all.slice(180)) {
        await deleteFromStore(STORES.activityLogs, stale.id);
      }
    }
  },
  replaceActivityLogs: (items: ActivityEventItem[]) =>
    replaceAllInStore(STORES.activityLogs, items),

  // Hourly reports (newest first, capped at 48)
  async listHourlyReports(): Promise<HourlyReportItem[]> {
    const list = await getAllFromStore<HourlyReportItem>(STORES.hourlyReports);
    return list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
  async saveHourlyReport(report: HourlyReportItem): Promise<void> {
    await putInStore(STORES.hourlyReports, report);
    const all = await this.listHourlyReports();
    if (all.length > 48) {
      for (const stale of all.slice(48)) {
        await deleteFromStore(STORES.hourlyReports, stale.id);
      }
    }
  },
  replaceHourlyReports: (items: HourlyReportItem[]) =>
    replaceAllInStore(STORES.hourlyReports, items),

  // Cached Gmail summaries
  async listEmailSummaries(): Promise<EmailSummaryItem[]> {
    const list = await getAllFromStore<EmailSummaryItem>(STORES.emailSummaries);
    const rank = { high: 0, medium: 1, low: 2 };
    return list.sort((a, b) => {
      const rDiff = (rank[a.urgency] ?? 2) - (rank[b.urgency] ?? 2);
      if (rDiff !== 0) return rDiff;
      return b.cachedAt.localeCompare(a.cachedAt);
    });
  },
  replaceEmailSummaries: (items: EmailSummaryItem[]) => replaceAllInStore(STORES.emailSummaries, items),

  // Cached Calendar events
  async listCalendarEvents(): Promise<CalendarEventItem[]> {
    const list = await getAllFromStore<CalendarEventItem>(STORES.calendarEvents);
    return list.sort((a, b) => a.startIso.localeCompare(b.startIso));
  },
  replaceCalendarEvents: (items: CalendarEventItem[]) => replaceAllInStore(STORES.calendarEvents, items),

  // Business Inbox messages
  async listBusinessMessages(): Promise<BusinessMessageItem[]> {
    const list = await getAllFromStore<BusinessMessageItem>(STORES.businessMessages);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  saveBusinessMessage: (msg: BusinessMessageItem) => putInStore(STORES.businessMessages, msg),
  replaceBusinessMessages: (items: BusinessMessageItem[]) =>
    replaceAllInStore(STORES.businessMessages, items),
  deleteBusinessMessage: (id: string) => deleteFromStore(STORES.businessMessages, id),

  // Settings
  async getSettings(): Promise<MachineSettings> {
    const existing = await getOneFromStore<MachineSettings>(STORES.settings, 'owner_settings');
    if (!existing) {
      await putInStore(STORES.settings, DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    const merged: MachineSettings = {
      ...DEFAULT_SETTINGS,
      ...existing,
      alertCategories: {
        ...DEFAULT_SETTINGS.alertCategories,
        ...(existing.alertCategories ?? {}),
      },
    };
    const isLegacyPrompt = LEGACY_DEFAULT_PROMPTS.some((prefix) =>
      merged.systemPrompt.startsWith(prefix)
    );
    let dirty = false;

    if (!existing.voiceDefaultUpgraded) {
      merged.voiceOutputEnabled = true;
      merged.voiceDefaultUpgraded = true;
      dirty = true;
    }
    if (!existing.englishOnlyUpgraded) {
      merged.language = 'en';
      if (merged.voiceInputLang === 'sw-KE') {
        merged.voiceInputLang = 'en-KE';
      }
      if (merged.systemPrompt.includes('English or Swahili') || isLegacyPrompt) {
        merged.systemPrompt = DEFAULT_SYSTEM_PROMPT;
      }
      if (typeof existing.hourlyUpdatesEnabled !== 'boolean') {
        merged.hourlyUpdatesEnabled = true;
      }
      if (typeof existing.hourlySpeakEnabled !== 'boolean') {
        merged.hourlySpeakEnabled = true;
      }
      merged.englishOnlyUpgraded = true;
      dirty = true;
    } else if (isLegacyPrompt) {
      merged.systemPrompt = DEFAULT_SYSTEM_PROMPT;
      dirty = true;
    }

    if (!merged.displayName || merged.displayName === 'Owner') {
      merged.displayName = CREATOR_ADMIN_NAME;
      dirty = true;
    }

    if (dirty) {
      await putInStore(STORES.settings, merged);
    }
    return merged;
  },
  saveSettings: (settings: MachineSettings) => putInStore(STORES.settings, settings),

  // Export, Import, Delete All
  async exportAllData(): Promise<MachineBackupPayload> {
    const [
      notes,
      tasks,
      reminders,
      chats,
      documents,
      briefings,
      alertLogs,
      emailSummaries,
      businessMessages,
      settings,
    ] = await Promise.all([
      this.listNotes(),
      this.listTasks(),
      this.listReminders(),
      this.listChats(),
      this.listDocuments(),
      this.listBriefings(),
      this.listAlertLogs(),
      this.listEmailSummaries(),
      this.listBusinessMessages(),
      this.getSettings(),
    ]);

    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      notes,
      tasks,
      reminders,
      chats,
      documents,
      briefings,
      alertLogs,
      emailSummaries,
      businessMessages,
      settings,
    };
  },

  async importBackup(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid backup file format.');
    }
    const data = raw as Partial<MachineBackupPayload>;
    if (
      !Array.isArray(data.notes) ||
      !Array.isArray(data.tasks) ||
      !Array.isArray(data.reminders) ||
      !Array.isArray(data.chats) ||
      !Array.isArray(data.documents) ||
      !Array.isArray(data.briefings)
    ) {
      throw new Error('Backup file is missing required data sections.');
    }

    await this.deleteAllData();

    const db = await openDatabase();
    const storeNames: StoreName[] = [
      STORES.notes,
      STORES.tasks,
      STORES.reminders,
      STORES.chats,
      STORES.documents,
      STORES.briefings,
      STORES.alertLogs,
      STORES.emailSummaries,
      STORES.businessMessages,
      STORES.settings,
    ];

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite');
      for (const n of data.notes ?? []) if (n && n.id) tx.objectStore(STORES.notes).put(n);
      for (const t of data.tasks ?? []) if (t && t.id) tx.objectStore(STORES.tasks).put(t);
      for (const r of data.reminders ?? []) if (r && r.id) tx.objectStore(STORES.reminders).put(r);
      for (const c of data.chats ?? []) if (c && c.id) tx.objectStore(STORES.chats).put(c);
      for (const d of data.documents ?? []) if (d && d.id) tx.objectStore(STORES.documents).put(d);
      for (const b of data.briefings ?? []) if (b && b.id) tx.objectStore(STORES.briefings).put(b);
      for (const a of data.alertLogs ?? []) if (a && a.id) tx.objectStore(STORES.alertLogs).put(a);
      for (const e of data.emailSummaries ?? []) if (e && e.id) tx.objectStore(STORES.emailSummaries).put(e);
      for (const m of data.businessMessages ?? []) if (m && m.id) tx.objectStore(STORES.businessMessages).put(m);

      const mergedSettings: MachineSettings = {
        ...DEFAULT_SETTINGS,
        ...(data.settings ?? {}),
        id: 'owner_settings',
        alertCategories: {
          ...DEFAULT_SETTINGS.alertCategories,
          ...(data.settings?.alertCategories ?? {}),
        },
      };
      tx.objectStore(STORES.settings).put(mergedSettings);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed importing backup'));
    });
  },

  async deleteAllData(): Promise<void> {
    await Promise.all(Object.values(STORES).map((s) => clearStore(s)));
    await putInStore(STORES.settings, DEFAULT_SETTINGS);
  },
};

export async function hashPin(pin: string, existingSalt?: string): Promise<{ salt: string; hash: string }> {
  const saltBytes = new Uint8Array(16);
  if (existingSalt) {
    const encoded = new TextEncoder().encode(existingSalt);
    saltBytes.set(encoded.slice(0, 16));
  } else {
    crypto.getRandomValues(saltBytes);
  }
  const salt = existingSalt || Array.from(saltBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { salt, hash };
}

export async function verifyPin(pin: string, salt: string, expectedHash: string): Promise<boolean> {
  if (!salt || !expectedHash) return false;
  const { hash } = await hashPin(pin, salt);
  return hash === expectedHash;
}

export function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
