export type UILanguage = 'en' | 'sw';
export type ChatMode = 'auto' | 'research' | 'fast';

export type ScreenId =
  | 'command'
  | 'chat'
  | 'notes_tasks'
  | 'reminders'
  | 'google'
  | 'business_inbox'
  | 'documents'
  | 'briefing'
  | 'settings';

export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type ReminderCategory = 'meeting' | 'errand' | 'finance' | 'health' | 'general';

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  title: string;
  notes?: string;
  dueDate?: string;
  priority: TaskPriority;
  status: TaskStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ReminderItem {
  id: string;
  title: string;
  dueAt: string;
  category: ReminderCategory;
  isMeeting: boolean;
  completed: boolean;
  firedKeys: string[];
  createdAt: string;
  source?: 'local' | 'google_calendar';
  externalEventId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  error?: boolean;
  retryPayload?: string;
  sources?: Array<{ uri: string; title: string }>;
}

export interface DocumentQAItem {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface DocumentItem {
  id: string;
  name: string;
  fileType: 'pdf' | 'txt' | 'docx';
  sizeBytes: number;
  extractedText: string;
  summary?: string;
  keyPoints?: string[];
  qaHistory: DocumentQAItem[];
  createdAt: string;
}

export interface BriefingItem {
  id: string;
  dateStr: string;
  content: string;
  createdAt: string;
  taskCount: number;
  reminderCount: number;
  noteCount: number;
}

export interface AlertLogItem {
  id: string;
  reminderId: string;
  title: string;
  triggerType: 'due' | '1d_before' | '1h_before' | '10m_before' | 'overdue_task' | 'hourly_update' | 'test';
  firedAt: string;
  channel: 'sw' | 'notification' | 'in_app';
}

export interface ActivityEventItem {
  id: string;
  action: string;
  detail: string;
  screen: ScreenId;
  timestamp: string;
  deviceLabel?: string;
}

export interface HourlyReportItem {
  id: string;
  timestamp: string;
  summary: string;
  spokenSummary: string;
  deviceSnapshot: string;
  activityCount: number;
}

export type UrgencyLevel = 'high' | 'medium' | 'low';

export interface EmailSummaryItem {
  id: string; // Gmail message ID
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  bodyText: string;
  urgency: UrgencyLevel;
  aiSummary: string;
  urgencyReason: string;
  suggestedReply: string;
  detectedLanguage: 'en' | 'sw';
  cachedAt: string;
}

export interface CalendarEventItem {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  htmlLink?: string;
  status?: string;
}

export interface CalendarIntentProposal {
  action: 'create' | 'update' | 'cancel';
  targetEventId?: string;
  summary: string;
  description?: string;
  location?: string;
  startIso: string;
  endIso: string;
  hasConflict: boolean;
  conflictDetails?: string;
  suggestedAlternatives: Array<{ startIso: string; endIso: string; label: string }>;
  explanation: string;
}

export type BusinessChannel = 'whatsapp' | 'facebook' | 'instagram';

export interface BusinessMessageItem {
  id: string;
  channel: BusinessChannel;
  senderLabel: string;
  rawText: string;
  summary: string;
  urgency: UrgencyLevel;
  detectedLanguage: string;
  draftReply: string;
  status: 'new' | 'replied' | 'archived';
  createdAt: string;
}

export interface CatchUpItem {
  id: string;
  kind: 'missed_reminder' | 'overdue_task' | 'urgent_email' | 'calendar_clash';
  title: string;
  detail: string;
  timestamp?: string;
  targetScreen: ScreenId;
}

export interface AlertCategoryPrefs {
  meeting: boolean;
  errand: boolean;
  finance: boolean;
  health: boolean;
  general: boolean;
}

export interface MachineSettings {
  id: 'owner_settings';
  displayName: string;
  language: UILanguage;
  timezone: string;
  currency: string;
  systemPrompt: string;
  voiceOutputEnabled: boolean;
  voiceInputLang: 'en-KE' | 'en-US' | 'sw-KE';
  voiceRate: number;
  voiceURI: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  alertCategories: AlertCategoryPrefs;
  pinEnabled: boolean;
  pinSalt: string;
  pinHash: string;
  googleClientId?: string;
  lastDriveBackupAt?: string;
  lastOverdueNudgeDate?: string;
  voiceDefaultUpgraded?: boolean;
  pureOledBlack?: boolean;
  englishOnlyUpgraded?: boolean;
  hourlyUpdatesEnabled?: boolean;
  hourlySpeakEnabled?: boolean;
  lastHourlyUpdateAt?: string;
}

export interface ProposedStructuredItem {
  tempId: string;
  kind: 'task' | 'note' | 'reminder';
  title: string;
  content?: string;
  dueAt?: string;
  priority?: TaskPriority;
  category?: ReminderCategory;
  isMeeting?: boolean;
  tags?: string[];
}

export interface ParsedIntentResult {
  items: ProposedStructuredItem[];
  explanation: string;
}

export interface MachineBackupPayload {
  version: number;
  exportedAt: string;
  notes: NoteItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  chats: ChatMessage[];
  documents: DocumentItem[];
  briefings: BriefingItem[];
  alertLogs: AlertLogItem[];
  emailSummaries?: EmailSummaryItem[];
  businessMessages?: BusinessMessageItem[];
  settings: MachineSettings;
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are THE MACHINE, an elite open-domain AI and deep research assistant serving one owner. Answer ANY question thoroughly and accurately across science, technology, coding, mathematics, business, law, finance, history, strategy, creative writing, current world events, and personal productivity. Adapt depth to the request: crisp for quick questions, deeply structured with evidence and clear reasoning for research and complex topics. Use live Google Search and URL context whenever available for current facts and research, and consult [OWNER LOCAL DATA] only when the question concerns private tasks, notes, reminders, calendar, emails, documents, or device activity. Never invent private user records, refuse surveillance of individuals, and always respond strictly in clear English.';

export const DEFAULT_SETTINGS: MachineSettings = {
  id: 'owner_settings',
  displayName: 'Owner',
  language: 'en',
  timezone: 'Africa/Nairobi',
  currency: 'KES',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  voiceOutputEnabled: true,
  voiceInputLang: 'en-KE',
  voiceRate: 1.0,
  voiceURI: '',
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  alertCategories: {
    meeting: true,
    errand: true,
    finance: true,
    health: true,
    general: true,
  },
  pinEnabled: false,
  pinSalt: '',
  pinHash: '',
  googleClientId: '',
  lastDriveBackupAt: '',
  lastOverdueNudgeDate: '',
  voiceDefaultUpgraded: true,
  pureOledBlack: false,
  englishOnlyUpgraded: true,
  hourlyUpdatesEnabled: true,
  hourlySpeakEnabled: true,
  lastHourlyUpdateAt: '',
};
