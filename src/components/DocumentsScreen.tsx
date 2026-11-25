import React, { useRef, useState } from 'react';
import { FileText, Send, Sparkles, Trash2, Upload } from 'lucide-react';
import type { DocumentItem, MachineSettings } from '../types/machine';
import { getTranslations } from '../i18n/translations';
import { createId } from '../db/storage';
import { extractDocumentText } from '../services/documentParser';
import { aiProvider } from '../services/aiProvider';
import { formatBytes, formatShortDateTime } from '../utils/datetime';

interface DocumentsScreenProps {
  settings: MachineSettings;
  documents: DocumentItem[];
  onSaveDocument: (doc: DocumentItem) => Promise<void>;
  onDeleteDocument: (id: string) => Promise<void>;
}

export const DocumentsScreen: React.FC<DocumentsScreenProps> = ({
  settings,
  documents,
  onSaveDocument,
  onDeleteDocument,
}) => {
  const t = getTranslations(settings.language);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(documents[0]?.id ?? null);
  const [extracting, setExtracting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [askingId, setAskingId] = useState<string | null>(null);
  const [qaInput, setQaInput] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);

  const activeDoc = documents.find((d) => d.id === selectedId) ?? documents[0] ?? null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setExtracting(true);
    setUploadError(null);
    setAiError(null);
    try {
      const { fileType, extractedText } = await extractDocumentText(file);
      const newDoc: DocumentItem = {
        id: createId('doc'),
        name: file.name,
        fileType,
        sizeBytes: file.size,
        extractedText,
        qaHistory: [],
        createdAt: new Date().toISOString(),
      };
      await onSaveDocument(newDoc);
      setSelectedId(newDoc.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to extract document.');
    } finally {
      setExtracting(false);
    }
  };

  const handleAnalyze = async (doc: DocumentItem) => {
    setAnalyzingId(doc.id);
    setAiError(null);
    try {
      const result = await aiProvider.analyzeDocument({
        title: doc.name,
        text: doc.extractedText,
        settings,
      });
      await onSaveDocument({
        ...doc,
        summary: result.summary,
        keyPoints: result.keyPoints,
      });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDoc || !qaInput.trim() || askingId) return;
    const question = qaInput.trim();
    setQaInput('');
    setAskingId(activeDoc.id);
    setAiError(null);

    try {
      const answer = await aiProvider.askDocumentQuestion({
        title: activeDoc.name,
        text: activeDoc.extractedText,
        question,
        settings,
      });
      const updatedDoc: DocumentItem = {
        ...activeDoc,
        qaHistory: [
          ...activeDoc.qaHistory,
          {
            id: createId('qa'),
            question,
            answer,
            createdAt: new Date().toISOString(),
          },
        ],
      };
      await onSaveDocument(updatedDoc);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to answer question.');
    } finally {
      setAskingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Upload Header */}
      <section className="machine-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="section-title-gold text-base font-semibold">{t.documents.title}</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">{t.documents.emptyBody}</p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => void handleFileChange(e)}
            className="hidden"
          />
          <button
            type="button"
            disabled={extracting}
            onClick={() => fileInputRef.current?.click()}
            className="w-full sm:w-auto min-h-[48px] px-4 machine-btn-primary text-sm flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Upload strokeWidth={1.5} className="w-4 h-4" />
            <span>{extracting ? t.documents.extracting : t.documents.uploadBtn}</span>
          </button>
        </div>
      </section>

      {uploadError && (
        <div className="machine-card border-[var(--error)]/70 p-3.5 text-sm text-[var(--error)]">
          {uploadError}
        </div>
      )}

      {documents.length === 0 ? (
        <div className="machine-card p-10 text-center">
          <FileText strokeWidth={1.5} className="w-8 h-8 text-[var(--gold-500)] mx-auto mb-3" />
          <h2 className="section-title-gold text-sm font-semibold">{t.documents.emptyTitle}</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-md mx-auto">{t.documents.emptyBody}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Document List */}
          <aside className="lg:col-span-4 machine-card p-3 space-y-1.5 max-h-[340px] lg:max-h-[680px] overflow-y-auto">
            {documents.map((doc) => {
              const selected = activeDoc?.id === doc.id;
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(doc.id);
                    setAiError(null);
                  }}
                  className={`w-full text-left p-3 rounded-xl border transition min-h-[56px] ${
                    selected
                      ? 'bg-[var(--surface-2)] border-[var(--gold-500)] text-[var(--gold-100)]'
                      : 'bg-transparent border-transparent hover:bg-[var(--surface-2)] text-[var(--text)]'
                  }`}
                >
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  <p className="text-xs font-mono text-[var(--text-muted)] mt-1 tabular-nums">
                    {doc.fileType.toUpperCase()} · {formatBytes(doc.sizeBytes)} ·{' '}
                    {formatShortDateTime(doc.createdAt, settings.timezone)}
                  </p>
                </button>
              );
            })}
          </aside>

          {/* Selected Document Detail */}
          {activeDoc && (
            <div className="lg:col-span-8 space-y-4">
              <section className="machine-card p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
                  <div className="min-w-0">
                    <h2 className="font-cinzel text-base font-semibold text-[var(--text)] truncate">
                      {activeDoc.name}
                    </h2>
                    <p className="text-xs font-mono text-[var(--gold-500)] mt-1 tabular-nums">
                      {activeDoc.fileType.toUpperCase()} · {formatBytes(activeDoc.sizeBytes)} ·{' '}
                      {activeDoc.extractedText.length.toLocaleString()} chars
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={analyzingId === activeDoc.id}
                      onClick={() => void handleAnalyze(activeDoc)}
                      className="min-h-[44px] px-4 machine-btn-secondary text-xs flex items-center gap-2 whitespace-nowrap"
                    >
                      {analyzingId === activeDoc.id ? (
                        <span className="w-2 h-2 rounded-full bg-[var(--gold-500)] machine-dot-pulse-fast" />
                      ) : (
                        <Sparkles strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
                      )}
                      <span>
                        {analyzingId === activeDoc.id
                          ? t.documents.analyzing
                          : t.documents.generateSummary}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onDeleteDocument(activeDoc.id);
                        setSelectedId(null);
                      }}
                      aria-label={t.documents.deleteDoc}
                      className="min-w-[44px] min-h-[44px] machine-btn-ghost text-[var(--text-muted)] hover:text-[var(--error)] flex items-center justify-center"
                    >
                      <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <hr className="machine-divider" />

                {aiError && (
                  <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--error)]/70 p-3 text-xs text-[var(--error)]">
                    {aiError}
                  </div>
                )}

                <div>
                  <h3 className="section-title-gold text-xs font-semibold mb-2">
                    {t.documents.summaryTitle}
                  </h3>
                  {activeDoc.summary ? (
                    <div className="space-y-3">
                      <p className="text-sm text-[var(--text)] leading-relaxed">{activeDoc.summary}</p>
                      {activeDoc.keyPoints && activeDoc.keyPoints.length > 0 && (
                        <ul className="space-y-1.5 text-sm text-[var(--text)]/90 list-disc pl-5 marker:text-[var(--gold-500)]">
                          {activeDoc.keyPoints.map((kp, idx) => (
                            <li key={idx}>{kp}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">{t.documents.noSummary}</p>
                  )}
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setShowRawText((v) => !v)}
                    className="min-h-[44px] text-xs font-mono text-[var(--gold-300)] hover:text-[var(--gold-100)] underline underline-offset-4"
                  >
                    {t.documents.rawText} ({showRawText ? 'Hide' : 'Show'})
                  </button>
                  {showRawText && (
                    <pre className="mt-2 p-3.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text-muted)] whitespace-pre-wrap max-h-56 overflow-y-auto font-mono">
                      {activeDoc.extractedText}
                    </pre>
                  )}
                </div>
              </section>

              {/* Document Q&A */}
              <section className="machine-card p-5 space-y-4">
                <h3 className="section-title-gold text-sm font-semibold">
                  {t.documents.qaTitle}
                </h3>

                {activeDoc.qaHistory.length > 0 && (
                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    {activeDoc.qaHistory.map((qa) => (
                      <div key={qa.id} className="rounded-xl machine-bubble-user p-3.5 space-y-2">
                        <p className="text-xs font-mono text-[var(--gold-300)]">Q: {qa.question}</p>
                        <p className="text-sm text-[var(--text)] whitespace-pre-wrap leading-relaxed">
                          {qa.answer}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleAsk} className="flex gap-2">
                  <input
                    type="text"
                    value={qaInput}
                    onChange={(e) => setQaInput(e.target.value)}
                    placeholder={t.documents.qaPlaceholder}
                    className="flex-1 min-h-[48px] machine-input px-4 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={!qaInput.trim() || askingId === activeDoc.id}
                    className="min-h-[48px] px-4 machine-btn-primary text-sm flex items-center gap-1.5 shrink-0"
                  >
                    <Send strokeWidth={1.5} className="w-4 h-4" />
                    <span>{t.documents.qaAsk}</span>
                  </button>
                </form>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
