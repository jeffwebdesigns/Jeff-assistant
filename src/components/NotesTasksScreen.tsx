import React, { useEffect, useState } from 'react';
import { Check, Pencil, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import type {
  MachineSettings,
  NoteItem,
  ProposedStructuredItem,
  ReminderCategory,
  ReminderItem,
  TaskItem,
  TaskPriority,
  TaskStatus,
} from '../types/machine';
import { getTranslations } from '../i18n/translations';
import { createId } from '../db/storage';
import { aiProvider } from '../services/aiProvider';
import { formatShortDateTime, toLocalDateTimeInputValue } from '../utils/datetime';
import { GoldToggle } from './GoldToggle';

interface NotesTasksScreenProps {
  settings: MachineSettings;
  tasks: TaskItem[];
  notes: NoteItem[];
  pendingParseText: string | null;
  onConsumePendingParse: () => void;
  onSaveTask: (task: TaskItem) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onSaveNote: (note: NoteItem) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
  onSaveReminder: (reminder: ReminderItem) => Promise<void>;
}

export const NotesTasksScreen: React.FC<NotesTasksScreenProps> = ({
  settings,
  tasks,
  notes,
  pendingParseText,
  onConsumePendingParse,
  onSaveTask,
  onDeleteTask,
  onSaveNote,
  onDeleteNote,
  onSaveReminder,
}) => {
  const t = getTranslations(settings.language);
  const [activeTab, setActiveTab] = useState<'tasks' | 'notes'>('tasks');
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [sparkleTaskId, setSparkleTaskId] = useState<string | null>(null);

  // Natural Language AI Input
  const [aiInput, setAiInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [proposedItems, setProposedItems] = useState<ProposedStructuredItem[]>([]);
  const [parseExplanation, setParseExplanation] = useState('');

  // Task Modal State
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskNotes, setTaskNotes] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('medium');
  const [taskStatus, setTaskStatus] = useState<TaskStatus>('todo');
  const [taskTags, setTaskTags] = useState('');

  // Note Modal State
  const [editingNote, setEditingNote] = useState<NoteItem | null>(null);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteTags, setNoteTags] = useState('');

  const runNaturalLanguageParse = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || isParsing) return;
    setIsParsing(true);
    setParseError(null);
    try {
      const result = await aiProvider.parseNaturalLanguageItems(trimmed, settings.timezone);
      if (result.items.length === 0) {
        setParseError('No structured task, note, or reminder could be identified from that text.');
      } else {
        setProposedItems(result.items);
        setParseExplanation(result.explanation);
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to parse input.');
    } finally {
      setIsParsing(false);
    }
  };

  useEffect(() => {
    if (pendingParseText) {
      onConsumePendingParse();
      setAiInput(pendingParseText);
      void runNaturalLanguageParse(pendingParseText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingParseText]);

  const updateProposedItem = (tempId: string, patch: Partial<ProposedStructuredItem>) => {
    setProposedItems((prev) =>
      prev.map((item) => (item.tempId === tempId ? { ...item, ...patch } : item))
    );
  };

  const confirmProposedItem = async (item: ProposedStructuredItem) => {
    const nowIso = new Date().toISOString();
    const title = item.title.trim();
    if (!title) return;

    if (item.kind === 'reminder') {
      const dueIso = item.dueAt && !Number.isNaN(Date.parse(item.dueAt))
        ? new Date(item.dueAt).toISOString()
        : new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await onSaveReminder({
        id: createId('rem'),
        title,
        dueAt: dueIso,
        category: item.category ?? 'general',
        isMeeting: Boolean(item.isMeeting),
        completed: false,
        firedKeys: [],
        createdAt: nowIso,
      });
    } else if (item.kind === 'note') {
      await onSaveNote({
        id: createId('note'),
        title,
        content: item.content?.trim() || title,
        tags: item.tags ?? [],
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } else {
      await onSaveTask({
        id: createId('task'),
        title,
        notes: item.content?.trim(),
        dueDate: item.dueAt ? item.dueAt.slice(0, 10) : undefined,
        priority: item.priority ?? 'medium',
        status: 'todo',
        tags: item.tags ?? [],
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    setProposedItems((prev) => prev.filter((p) => p.tempId !== item.tempId));
  };

  const discardProposedItem = (tempId: string) => {
    setProposedItems((prev) => prev.filter((p) => p.tempId !== tempId));
  };

  const openTaskModal = (existing?: TaskItem) => {
    setEditingTask(existing ?? null);
    setTaskTitle(existing?.title ?? '');
    setTaskNotes(existing?.notes ?? '');
    setTaskDue(existing?.dueDate ?? '');
    setTaskPriority(existing?.priority ?? 'medium');
    setTaskStatus(existing?.status ?? 'todo');
    setTaskTags(existing?.tags.join(', ') ?? '');
    setTaskModalOpen(true);
  };

  const submitTaskForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    const nowIso = new Date().toISOString();
    const tags = taskTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    await onSaveTask({
      id: editingTask?.id ?? createId('task'),
      title: taskTitle.trim(),
      notes: taskNotes.trim() || undefined,
      dueDate: taskDue || undefined,
      priority: taskPriority,
      status: taskStatus,
      tags,
      createdAt: editingTask?.createdAt ?? nowIso,
      updatedAt: nowIso,
    });
    setTaskModalOpen(false);
  };

  const openNoteModal = (existing?: NoteItem) => {
    setEditingNote(existing ?? null);
    setNoteTitle(existing?.title ?? '');
    setNoteContent(existing?.content ?? '');
    setNoteTags(existing?.tags.join(', ') ?? '');
    setNoteModalOpen(true);
  };

  const submitNoteForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) return;
    const nowIso = new Date().toISOString();
    const tags = noteTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    await onSaveNote({
      id: editingNote?.id ?? createId('note'),
      title: noteTitle.trim(),
      content: noteContent.trim(),
      tags,
      createdAt: editingNote?.createdAt ?? nowIso,
      updatedAt: nowIso,
    });
    setNoteModalOpen(false);
  };

  const allTags = Array.from(
    new Set([...tasks.flatMap((tk) => tk.tags), ...notes.flatMap((n) => n.tags)])
  ).sort();

  const q = search.trim().toLowerCase();
  const filteredTasks = tasks.filter((tk) => {
    const matchesTag = selectedTag === 'all' || tk.tags.includes(selectedTag);
    const matchesQ =
      !q ||
      tk.title.toLowerCase().includes(q) ||
      (tk.notes ?? '').toLowerCase().includes(q) ||
      tk.tags.some((tg) => tg.toLowerCase().includes(q));
    return matchesTag && matchesQ;
  });

  const filteredNotes = notes.filter((n) => {
    const matchesTag = selectedTag === 'all' || n.tags.includes(selectedTag);
    const matchesQ =
      !q ||
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.tags.some((tg) => tg.toLowerCase().includes(q));
    return matchesTag && matchesQ;
  });

  return (
    <div className="space-y-5">
      {/* AI Natural Language Parser Bar */}
      <section className="machine-card p-4 sm:p-5">
        <label htmlFor="nl-parse-input" className="block section-title-gold text-xs mb-2">
          {t.notesTasks.aiBarLabel}
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runNaturalLanguageParse(aiInput);
          }}
          className="flex flex-col sm:flex-row gap-2.5"
        >
          <input
            id="nl-parse-input"
            type="text"
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            placeholder={t.notesTasks.aiPlaceholder}
            className="flex-1 min-h-[48px] machine-input px-4 text-sm"
          />
          <button
            type="submit"
            disabled={!aiInput.trim() || isParsing}
            className="min-h-[48px] px-5 machine-btn-primary text-sm flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            {isParsing ? (
              <span className="w-2.5 h-2.5 rounded-full bg-[#0A0A0A] machine-dot-pulse-fast" />
            ) : (
              <Sparkles strokeWidth={1.5} className="w-4 h-4" />
            )}
            <span>{isParsing ? t.notesTasks.aiAnalyzing : t.notesTasks.aiButton}</span>
          </button>
        </form>

        {parseError && (
          <p className="mt-3 text-sm text-[var(--error)]">{parseError}</p>
        )}

        {/* Mandatory Confirmation Cards before saving */}
        {proposedItems.length > 0 && (
          <div className="mt-4 space-y-3 pt-4">
            <hr className="machine-divider mb-3" />
            <div>
              <h2 className="section-title-gold text-sm font-semibold">
                {t.notesTasks.confirmTitle}
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {parseExplanation || t.notesTasks.confirmSubtitle}
              </p>
            </div>

            {proposedItems.map((item) => (
              <div
                key={item.tempId}
                className="bg-[var(--bg)] border border-[var(--gold-700)] rounded-xl p-4 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Type</label>
                    <select
                      value={item.kind}
                      onChange={(e) =>
                        updateProposedItem(item.tempId, {
                          kind: e.target.value as ProposedStructuredItem['kind'],
                        })
                      }
                      className="w-full min-h-[44px] machine-input px-3 text-sm"
                    >
                      <option value="task">Task</option>
                      <option value="reminder">Reminder</option>
                      <option value="note">Note</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldTitle}</label>
                    <input
                      type="text"
                      value={item.title}
                      onChange={(e) => updateProposedItem(item.tempId, { title: e.target.value })}
                      className="w-full min-h-[44px] machine-input px-3 text-sm"
                    />
                  </div>
                </div>

                {item.kind === 'reminder' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">{t.reminders.fieldDueAt}</label>
                      <input
                        type="datetime-local"
                        value={toLocalDateTimeInputValue(item.dueAt, settings.timezone)}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) {
                            updateProposedItem(item.tempId, {
                              dueAt: new Date(`${val}:00+03:00`).toISOString(),
                            });
                          }
                        }}
                        className="w-full min-h-[44px] machine-input px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">{t.reminders.fieldCategory}</label>
                      <select
                        value={item.category ?? 'general'}
                        onChange={(e) =>
                          updateProposedItem(item.tempId, {
                            category: e.target.value as ReminderCategory,
                          })
                        }
                        className="w-full min-h-[44px] machine-input px-3 text-sm"
                      >
                        <option value="general">{t.reminders.categories.general}</option>
                        <option value="meeting">{t.reminders.categories.meeting}</option>
                        <option value="finance">{t.reminders.categories.finance}</option>
                        <option value="errand">{t.reminders.categories.errand}</option>
                        <option value="health">{t.reminders.categories.health}</option>
                      </select>
                    </div>
                    <div className="pt-2 sm:pt-4">
                      <GoldToggle
                        checked={Boolean(item.isMeeting)}
                        onChange={(next) => updateProposedItem(item.tempId, { isMeeting: next })}
                        label={t.reminders.fieldIsMeeting}
                      />
                    </div>
                  </div>
                )}

                {item.kind === 'task' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldDueDate}</label>
                      <input
                        type="date"
                        value={item.dueAt ? item.dueAt.slice(0, 10) : ''}
                        onChange={(e) => updateProposedItem(item.tempId, { dueAt: e.target.value })}
                        className="w-full min-h-[44px] machine-input px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldPriority}</label>
                      <select
                        value={item.priority ?? 'medium'}
                        onChange={(e) =>
                          updateProposedItem(item.tempId, {
                            priority: e.target.value as TaskPriority,
                          })
                        }
                        className="w-full min-h-[44px] machine-input px-3 text-sm"
                      >
                        <option value="low">{t.notesTasks.priorities.low}</option>
                        <option value="medium">{t.notesTasks.priorities.medium}</option>
                        <option value="high">{t.notesTasks.priorities.high}</option>
                      </select>
                    </div>
                  </div>
                )}

                {item.kind === 'note' && (
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldContent}</label>
                    <textarea
                      rows={2}
                      value={item.content ?? ''}
                      onChange={(e) => updateProposedItem(item.tempId, { content: e.target.value })}
                      className="w-full machine-input p-3 text-sm"
                    />
                  </div>
                )}

                <div className="flex flex-wrap gap-2 justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => discardProposedItem(item.tempId)}
                    className="min-h-[44px] px-4 machine-btn-ghost text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    {t.notesTasks.confirmDiscard}
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmProposedItem(item)}
                    className="min-h-[44px] px-4 machine-btn-primary text-xs flex items-center gap-1.5"
                  >
                    <Check strokeWidth={1.5} className="w-4 h-4" />
                    <span>{t.notesTasks.confirmSave}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Toolbar: Tabs + Search + Add */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('tasks')}
            className={`flex-1 sm:flex-initial min-h-[44px] px-4 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              activeTab === 'tasks'
                ? 'machine-btn-primary'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {t.notesTasks.tabTasks} ({filteredTasks.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`flex-1 sm:flex-initial min-h-[44px] px-4 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              activeTab === 'notes'
                ? 'machine-btn-primary'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {t.notesTasks.tabNotes} ({filteredNotes.length})
          </button>
        </div>

        <div className="flex items-center gap-2 flex-1 sm:max-w-md">
          <div className="relative flex-1">
            <Search
              strokeWidth={1.5}
              className="w-4 h-4 text-[var(--gold-500)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.notesTasks.searchPlaceholder}
              className="w-full min-h-[44px] machine-input pl-10 pr-3 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => (activeTab === 'tasks' ? openTaskModal() : openNoteModal())}
            className="min-h-[44px] px-4 machine-btn-primary text-sm flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus strokeWidth={1.5} className="w-4 h-4" />
            <span>{activeTab === 'tasks' ? t.notesTasks.addTask : t.notesTasks.addNote}</span>
          </button>
        </div>
      </div>

      {/* Tag Filter Bar */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedTag('all')}
            className={`min-h-[44px] px-3.5 rounded-xl text-xs font-mono transition whitespace-nowrap shrink-0 border ${
              selectedTag === 'all'
                ? 'bg-[var(--surface-2)] text-[var(--gold-300)] border-[var(--gold-500)]'
                : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)]'
            }`}
          >
            {t.notesTasks.allTags}
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTag(tag)}
              className={`min-h-[44px] px-3.5 rounded-xl text-xs font-mono transition whitespace-nowrap shrink-0 border ${
                selectedTag === tag
                  ? 'bg-[var(--surface-2)] text-[var(--gold-300)] border-[var(--gold-500)]'
                  : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)]'
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* List Section */}
      {activeTab === 'tasks' ? (
        <div className="space-y-2.5">
          {filteredTasks.length === 0 ? (
            <div className="machine-card p-8 text-center text-sm text-[var(--text-muted)]">
              {t.notesTasks.emptyTasks}
            </div>
          ) : (
            filteredTasks.map((task) => (
              <div
                key={task.id}
                className="machine-card p-4 flex items-start justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      const nextStatus: TaskStatus =
                        task.status === 'done' ? 'todo' : 'done';
                      if (nextStatus === 'done') {
                        setSparkleTaskId(task.id);
                        window.setTimeout(() => {
                          setSparkleTaskId((cur) => (cur === task.id ? null : cur));
                        }, 600);
                      }
                      void onSaveTask({
                        ...task,
                        status: nextStatus,
                        updatedAt: new Date().toISOString(),
                      });
                    }}
                    aria-label={`Toggle ${task.title}`}
                    className="relative min-w-[44px] min-h-[44px] -ml-2 -mt-1 flex items-center justify-center shrink-0"
                  >
                    <span
                      className={`w-5 h-5 rounded border flex items-center justify-center transition ${
                        task.status === 'done'
                          ? 'bg-[var(--gold-500)] border-[var(--gold-500)] text-[#0A0A0A]'
                          : 'border-[var(--gold-700)] hover:border-[var(--gold-300)]'
                      }`}
                    >
                      {task.status === 'done' && <Check strokeWidth={2} className="w-3.5 h-3.5" />}
                    </span>
                    {sparkleTaskId === task.id && (
                      <Sparkles
                        strokeWidth={1.5}
                        className="w-5 h-5 text-[var(--gold-100)] absolute pointer-events-none machine-sparkle"
                      />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <h3
                      className={`text-sm font-medium ${
                        task.status === 'done'
                          ? 'line-through text-[var(--text-muted)]'
                          : 'text-[var(--text)]'
                      }`}
                    >
                      {task.title}
                    </h3>
                    {task.notes && (
                      <p className="text-xs text-[var(--text-muted)] mt-1 whitespace-pre-wrap">
                        {task.notes}
                      </p>
                    )}
                    <p className="text-xs text-[var(--gold-300)]/90 mt-2 font-mono tabular-nums">
                      {t.notesTasks.statuses[task.status]} · {t.notesTasks.priorities[task.priority]}
                      {task.dueDate ? ` · Due ${task.dueDate}` : ''}
                      {task.tags.length > 0 ? ` · ${task.tags.map((x) => `#${x}`).join(' ')}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openTaskModal(task)}
                    aria-label={t.notesTasks.editTask}
                    className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--gold-300)] flex items-center justify-center transition"
                  >
                    <Pencil strokeWidth={1.5} className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteTask(task.id)}
                    aria-label={t.notesTasks.delete}
                    className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--error)] flex items-center justify-center transition"
                  >
                    <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filteredNotes.length === 0 ? (
            <div className="lg:col-span-2 machine-card p-8 text-center text-sm text-[var(--text-muted)]">
              {t.notesTasks.emptyNotes}
            </div>
          ) : (
            filteredNotes.map((note) => (
              <article
                key={note.id}
                className="machine-card p-4 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[var(--text)]">{note.title}</h3>
                    <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
                      <button
                        type="button"
                        onClick={() => openNoteModal(note)}
                        aria-label={t.notesTasks.editNote}
                        className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--gold-300)] flex items-center justify-center transition"
                      >
                        <Pencil strokeWidth={1.5} className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteNote(note.id)}
                        aria-label={t.notesTasks.delete}
                        className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--error)] flex items-center justify-center transition"
                      >
                        <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-[var(--text)]/90 mt-2 whitespace-pre-wrap leading-relaxed">
                    {note.content}
                  </p>
                </div>

                <p className="text-xs font-mono text-[var(--text-muted)] tabular-nums">
                  {formatShortDateTime(note.updatedAt, settings.timezone)}
                  {note.tags.length > 0 ? ` · ${note.tags.map((x) => `#${x}`).join(' ')}` : ''}
                </p>
              </article>
            ))
          )}
        </div>
      )}

      {/* Task Edit/Create Modal */}
      {taskModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-lg machine-card rounded-t-3xl sm:rounded-2xl p-5 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title-gold text-base font-semibold">
                {editingTask ? t.notesTasks.editTask : t.notesTasks.addTask}
              </h2>
              <button
                type="button"
                onClick={() => setTaskModalOpen(false)}
                aria-label="Close"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--gold-300)]"
              >
                <X strokeWidth={1.5} className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitTaskForm} className="space-y-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldTitle}</label>
                <input
                  type="text"
                  required
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="w-full min-h-[44px] machine-input px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldContent}</label>
                <textarea
                  rows={3}
                  value={taskNotes}
                  onChange={(e) => setTaskNotes(e.target.value)}
                  className="w-full machine-input p-3.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldDueDate}</label>
                  <input
                    type="date"
                    value={taskDue}
                    onChange={(e) => setTaskDue(e.target.value)}
                    className="w-full min-h-[44px] machine-input px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldPriority}</label>
                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value as TaskPriority)}
                    className="w-full min-h-[44px] machine-input px-3 text-sm"
                  >
                    <option value="low">{t.notesTasks.priorities.low}</option>
                    <option value="medium">{t.notesTasks.priorities.medium}</option>
                    <option value="high">{t.notesTasks.priorities.high}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldStatus}</label>
                  <select
                    value={taskStatus}
                    onChange={(e) => setTaskStatus(e.target.value as TaskStatus)}
                    className="w-full min-h-[44px] machine-input px-3 text-sm"
                  >
                    <option value="todo">{t.notesTasks.statuses.todo}</option>
                    <option value="in_progress">{t.notesTasks.statuses.in_progress}</option>
                    <option value="done">{t.notesTasks.statuses.done}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldTags}</label>
                <input
                  type="text"
                  value={taskTags}
                  onChange={(e) => setTaskTags(e.target.value)}
                  placeholder="finance, bank, nairobi"
                  className="w-full min-h-[44px] machine-input px-3.5 text-sm"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setTaskModalOpen(false)}
                  className="min-h-[44px] px-4 machine-btn-ghost text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  {t.notesTasks.cancel}
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 machine-btn-primary text-sm"
                >
                  {t.notesTasks.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Note Edit/Create Modal */}
      {noteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-lg machine-card rounded-t-3xl sm:rounded-2xl p-5 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title-gold text-base font-semibold">
                {editingNote ? t.notesTasks.editNote : t.notesTasks.addNote}
              </h2>
              <button
                type="button"
                onClick={() => setNoteModalOpen(false)}
                aria-label="Close"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--gold-300)]"
              >
                <X strokeWidth={1.5} className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitNoteForm} className="space-y-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldTitle}</label>
                <input
                  type="text"
                  required
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  className="w-full min-h-[44px] machine-input px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldContent}</label>
                <textarea
                  rows={5}
                  required
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  className="w-full machine-input p-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">{t.notesTasks.fieldTags}</label>
                <input
                  type="text"
                  value={noteTags}
                  onChange={(e) => setNoteTags(e.target.value)}
                  placeholder="personal, reference"
                  className="w-full min-h-[44px] machine-input px-3.5 text-sm"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setNoteModalOpen(false)}
                  className="min-h-[44px] px-4 machine-btn-ghost text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  {t.notesTasks.cancel}
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 machine-btn-primary text-sm"
                >
                  {t.notesTasks.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
