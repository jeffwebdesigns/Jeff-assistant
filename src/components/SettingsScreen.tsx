import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Copy,
  Download,
  GraduationCap,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  CREATOR_ADMIN_EMAIL,
  CREATOR_ADMIN_NAME,
  DEFAULT_SYSTEM_PROMPT,
  INSTRUCTOR_SYSTEM_PROMPT,
  type MachineBackupPayload,
  type MachineSettings,
  type TeachingDepth,
  type TeachingFocus,
} from '../types/machine';
import { getTranslations } from '../i18n/translations';
import { dbStorage, hashPin } from '../db/storage';
import { useSpeech } from '../hooks/useSpeech';
import {
  backupToGoogleDrive,
  downloadDriveBackup,
  findDriveBackup,
  type DriveBackupMetadata,
} from '../services/driveBackupService';
import {
  resolveGoogleClientId,
  type GoogleConnectionStatus,
} from '../services/googleAuth';
import type { User } from 'firebase/auth';
import { formatBytes, formatShortDateTime } from '../utils/datetime';
import type { SyncStatus } from '../services/realtimeSync';
import { GoldToggle } from './GoldToggle';
import { GoogleAccountControl } from './GoogleAccountButton';

interface SettingsScreenProps {
  settings: MachineSettings;
  cloudUser: User | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  cloudAuthBusy: boolean;
  onChooseCloudAccount: () => void;
  onSignOutCloudAccount: () => void;
  googleStatus: GoogleConnectionStatus;
  remainingSeconds: number;
  isConnecting: boolean;
  authError: string | null;
  onConnectGoogle: () => Promise<void>;
  onReconnectGoogle: () => Promise<void>;
  onSwitchGoogleAccount: () => Promise<void>;
  onDisconnectGoogle: () => Promise<void>;
  onUpdateSettings: (next: MachineSettings) => Promise<void>;
  teachingDepth?: TeachingDepth;
  onChangeTeachingDepth?: (depth: TeachingDepth) => void;
  teachingFocus?: TeachingFocus;
  onChangeTeachingFocus?: (focus: TeachingFocus) => void;
  onLockNow: () => void;
  onDataReloaded: () => Promise<void>;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  settings,
  cloudUser,
  syncStatus,
  syncError,
  cloudAuthBusy,
  onChooseCloudAccount,
  onSignOutCloudAccount,
  googleStatus,
  remainingSeconds,
  isConnecting,
  authError,
  onConnectGoogle,
  onReconnectGoogle,
  onSwitchGoogleAccount,
  onDisconnectGoogle,
  onUpdateSettings,
  teachingDepth,
  onChangeTeachingDepth,
  teachingFocus,
  onChangeTeachingFocus,
  onLockNow,
  onDataReloaded,
}) => {
  const t = getTranslations(settings.language);
  const { hasSpeechSynthesis, voices, isSpeaking, speak, stopSpeaking, unlockAudio } = useSpeech();
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<'general' | 'google' | 'security'>('general');
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [voiceRate, setVoiceRate] = useState(settings.voiceRate);
  const [voiceURI, setVoiceURI] = useState(settings.voiceURI);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(settings.voiceOutputEnabled);
  const [voiceInputLang, setVoiceInputLang] = useState<'en-KE' | 'en-US'>(
    settings.voiceInputLang === 'en-US' ? 'en-US' : 'en-KE'
  );
  const [hourlyUpdatesEnabled, setHourlyUpdatesEnabled] = useState(
    settings.hourlyUpdatesEnabled !== false
  );
  const [hourlySpeakEnabled, setHourlySpeakEnabled] = useState(
    settings.hourlySpeakEnabled !== false
  );
  const [pureOledBlack, setPureOledBlack] = useState(Boolean(settings.pureOledBlack));
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));

  // Google Client ID override & Drive backup state
  const [customClientId, setCustomClientId] = useState(settings.googleClientId ?? '');
  const [originCopied, setOriginCopied] = useState(false);
  const [hostCopied, setHostCopied] = useState(false);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthResult, setHealthResult] = useState<{
    status: 'ok' | 'missing_key' | 'error';
    summary: string;
  } | null>(null);

  React.useEffect(() => {
    setDisplayName(settings.displayName);
    setTimezone(settings.timezone);
    setSystemPrompt(settings.systemPrompt);
    setVoiceRate(settings.voiceRate);
    setVoiceURI(settings.voiceURI);
    setVoiceOutputEnabled(settings.voiceOutputEnabled);
    setVoiceInputLang(settings.voiceInputLang === 'en-US' ? 'en-US' : 'en-KE');
    setHourlyUpdatesEnabled(settings.hourlyUpdatesEnabled !== false);
    setHourlySpeakEnabled(settings.hourlySpeakEnabled !== false);
    setPureOledBlack(Boolean(settings.pureOledBlack));
    setCustomClientId(settings.googleClientId ?? '');
  }, [settings]);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveMsg, setDriveMsg] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [pendingDriveRestore, setPendingDriveRestore] = useState<{
    meta: DriveBackupMetadata;
    payload: MachineBackupPayload;
  } | null>(null);

  // PIN lock state
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  // Import / Delete state
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const resolvedClientId = resolveGoogleClientId(settings.googleClientId);
  const remainingMins = Math.max(1, Math.ceil(remainingSeconds / 60));

  const handleCheckBackendHealth = async () => {
    if (healthBusy) return;
    setHealthBusy(true);
    setHealthResult(null);
    try {
      const resp = await fetch('/api/health', { cache: 'no-store' });
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('application/json')) {
        setHealthResult({
          status: 'error',
          summary: `HTTP ${resp.status} non-JSON response. Push api/index.ts, server/apiApp.ts, and vercel.json to GitHub and redeploy on Vercel.`,
        });
        return;
      }
      const data = (await resp.json()) as {
        ok?: boolean;
        aiConfigured?: boolean;
        runtime?: string;
        model?: string;
        groundingModel?: string;
      };
      if (!resp.ok || !data.ok) {
        setHealthResult({
          status: 'error',
          summary: `Server returned HTTP ${resp.status}. Check deployment logs.`,
        });
        return;
      }
      if (!data.aiConfigured) {
        setHealthResult({
          status: 'missing_key',
          summary: `Server reachable (${data.runtime ?? 'node'}), but GEMINI_API_KEY is missing. Add GEMINI_API_KEY in Vercel Environment Variables and redeploy.`,
        });
        return;
      }
      setHealthResult({
        status: 'ok',
        summary: `AI Server Online · Runtime: ${data.runtime ?? 'node'} · Key configured · Models: ${data.groundingModel ?? 'gemini-4'} / ${data.model ?? 'lite'}`,
      });
    } catch (err) {
      setHealthResult({
        status: 'error',
        summary: err instanceof Error ? err.message : 'Unable to reach /api/health.',
      });
    } finally {
      setHealthBusy(false);
    }
  };

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: MachineSettings = {
      ...settings,
      displayName: displayName.trim() || 'Owner',
      language: 'en',
      timezone: timezone.trim() || 'Africa/Nairobi',
      systemPrompt: systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT,
      voiceRate,
      voiceURI,
      voiceOutputEnabled,
      voiceInputLang,
      hourlyUpdatesEnabled,
      hourlySpeakEnabled,
      pureOledBlack,
    };
    await onUpdateSettings(next);
    setSavedBanner(t.settings.savedNotice);
    window.setTimeout(() => setSavedBanner(null), 3000);
  };

  const handleToggleOled = async (nextVal: boolean) => {
    setPureOledBlack(nextVal);
    await onUpdateSettings({
      ...settings,
      pureOledBlack: nextVal,
    });
  };

  const handleSaveClientId = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateSettings({
      ...settings,
      googleClientId: customClientId.trim(),
    });
    setDriveMsg('Google OAuth Client ID setting saved.');
  };

  const handleDriveBackup = async () => {
    if (driveBusy) return;
    setDriveBusy(true);
    setDriveMsg(null);
    setDriveError(null);
    try {
      const meta = await backupToGoogleDrive(settings.googleClientId);
      await onUpdateSettings({
        ...settings,
        lastDriveBackupAt: meta.modifiedTime,
      });
      setDriveMsg(
        `Backed up to Google Drive (${formatBytes(meta.sizeBytes)}) at ${formatShortDateTime(meta.modifiedTime, settings.timezone)}.`
      );
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Google Drive backup failed.');
    } finally {
      setDriveBusy(false);
    }
  };

  const handlePrepareDriveRestore = async () => {
    if (driveBusy) return;
    setDriveBusy(true);
    setDriveMsg(null);
    setDriveError(null);
    try {
      const meta = await findDriveBackup(settings.googleClientId);
      if (!meta) {
        setDriveError('No backup file found in Google Drive appDataFolder.');
        return;
      }
      const payload = await downloadDriveBackup(meta.id, settings.googleClientId);
      setPendingDriveRestore({ meta, payload });
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Unable to read Google Drive backup.');
    } finally {
      setDriveBusy(false);
    }
  };

  const handleConfirmDriveRestore = async () => {
    if (!pendingDriveRestore) return;
    setDriveBusy(true);
    try {
      await dbStorage.importBackup(pendingDriveRestore.payload);
      await onDataReloaded();
      setDriveMsg('Local data restored from Google Drive backup.');
      setPendingDriveRestore(null);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Failed restoring Drive backup.');
    } finally {
      setDriveBusy(false);
    }
  };

  const handleSetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinMsg(null);
    if (!/^\d{4,6}$/.test(newPin)) {
      setPinMsg('PIN must be 4 to 6 digits.');
      return;
    }
    const { salt, hash } = await hashPin(newPin);
    await onUpdateSettings({
      ...settings,
      pinEnabled: true,
      pinSalt: salt,
      pinHash: hash,
    });
    setNewPin('');
    setPinMsg('PIN lock enabled on this device.');
  };

  const handleRemovePin = async () => {
    await onUpdateSettings({
      ...settings,
      pinEnabled: false,
      pinSalt: '',
      pinHash: '',
    });
    setPinMsg('PIN lock removed.');
  };

  const handleExport = async () => {
    setDataMsg(null);
    const payload = await dbStorage.exportAllData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `machine-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDataMsg('Backup JSON exported.');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDataMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await dbStorage.importBackup(parsed);
      await onDataReloaded();
      setDataMsg('Backup restored to local storage.');
    } catch (err) {
      setDataMsg(err instanceof Error ? err.message : 'Failed to import backup JSON.');
    }
  };

  const handleDeleteAll = async () => {
    await dbStorage.deleteAllData();
    await onDataReloaded();
    setConfirmWipe(false);
    setDataMsg('All local data erased.');
  };

  return (
    <div className="space-y-5">
      <GoogleAccountControl
        user={cloudUser}
        syncStatus={syncStatus}
        syncError={syncError}
        busy={cloudAuthBusy}
        onChooseAccount={onChooseCloudAccount}
        onSignOut={onSignOutCloudAccount}
      />

      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-1 p-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab('general')}
          className={`flex-1 min-h-[44px] px-4 rounded-lg text-sm font-medium transition whitespace-nowrap ${
            tab === 'general'
              ? 'machine-btn-primary'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          {t.settings.tabGeneral}
        </button>
        <button
          type="button"
          onClick={() => setTab('google')}
          className={`flex-1 min-h-[44px] px-4 rounded-lg text-sm font-medium transition whitespace-nowrap ${
            tab === 'google'
              ? 'machine-btn-primary'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          {t.settings.tabGoogle}
        </button>
        <button
          type="button"
          onClick={() => setTab('security')}
          className={`flex-1 min-h-[44px] px-4 rounded-lg text-sm font-medium transition whitespace-nowrap ${
            tab === 'security'
              ? 'machine-btn-primary'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          {t.settings.tabSecurity}
        </button>
      </div>

      {tab === 'general' && (
        <form onSubmit={handleSaveGeneral} className="machine-card p-5 space-y-5">
          {/* Creator & Primary Admin Identity */}
          <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--gold-900)] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <span className="text-[var(--gold-300)] uppercase tracking-wider">
              Father Creator &amp; Primary Admin: {CREATOR_ADMIN_NAME}
            </span>
            <span className="text-[var(--text-muted)]">{CREATOR_ADMIN_EMAIL}</span>
          </div>

          {/* Pure OLED Black Battery Mode */}
          <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--border)] px-4 py-2">
            <GoldToggle
              checked={pureOledBlack}
              onChange={(next) => void handleToggleOled(next)}
              label={t.settings.pureOledLabel}
              description={t.settings.pureOledDesc}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">{t.settings.displayName}</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[44px] machine-input px-3.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">{t.settings.language}</label>
              <input
                type="text"
                readOnly
                value="English (Strictly English)"
                className="w-full min-h-[44px] machine-input px-3.5 text-sm font-mono text-[var(--gold-300)]"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">{t.settings.timezone}</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full min-h-[44px] machine-input px-3.5 text-sm"
              >
                <option value="Africa/Nairobi">Africa/Nairobi (EAT, UTC+3)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">{t.settings.currency}</label>
              <input
                type="text"
                readOnly
                value={settings.currency}
                className="w-full min-h-[44px] machine-input px-3.5 text-sm font-mono text-[var(--text-muted)]"
              />
            </div>
          </div>

          {(teachingDepth && onChangeTeachingDepth) || (teachingFocus && onChangeTeachingFocus) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {teachingDepth && onChangeTeachingDepth && (
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Technical Research Default Depth
                  </label>
                  <select
                    value={teachingDepth}
                    onChange={(e) => onChangeTeachingDepth(e.target.value as TeachingDepth)}
                    className="w-full min-h-[44px] machine-input px-3.5 text-sm"
                  >
                    <option value="foundational">Foundational (First principles, terminology &amp; prerequisites)</option>
                    <option value="intermediate">Intermediate (Protocol mechanics, methodology &amp; lab workflows)</option>
                    <option value="advanced">Advanced (Low-level internals, trade-offs &amp; failure analysis)</option>
                    <option value="expert">Expert (Research-grade edge cases, forensics &amp; countermeasures)</option>
                  </select>
                </div>
              )}

              {teachingFocus && onChangeTeachingFocus && (
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Practical Learning Lab Focus
                  </label>
                  <select
                    value={teachingFocus}
                    onChange={(e) => onChangeTeachingFocus(e.target.value as TeachingFocus)}
                    className="w-full min-h-[44px] machine-input px-3.5 text-sm"
                  >
                    <option value="full">10-Stage Full Curriculum (Balanced theory, lab &amp; countermeasures)</option>
                    <option value="lab_vm">Isolated VM &amp; Simulation Lab (Exercises, datasets &amp; scripts)</option>
                    <option value="forensics_defense">Forensics, Tracing &amp; Countermeasures (Artifacts &amp; mitigation)</option>
                  </select>
                </div>
              )}
            </div>
          ) : null}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <label className="text-xs text-[var(--text-muted)]">{t.settings.systemPrompt}</label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSystemPrompt(INSTRUCTOR_SYSTEM_PROMPT)}
                  className="min-h-[44px] px-2.5 text-xs font-mono text-[var(--gold-300)] hover:text-[var(--gold-100)] flex items-center gap-1"
                >
                  <GraduationCap strokeWidth={1.5} className="w-3.5 h-3.5" />
                  <span>Load Instructor Preset</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
                  className="min-h-[44px] px-2.5 text-xs font-mono text-[var(--gold-300)] hover:text-[var(--gold-100)] flex items-center gap-1"
                >
                  <RotateCcw strokeWidth={1.5} className="w-3.5 h-3.5" />
                  <span>{t.settings.restorePrompt}</span>
                </button>
              </div>
            </div>
            <textarea
              rows={6}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full machine-input p-3.5 text-xs font-mono leading-relaxed"
            />
          </div>

          <hr className="machine-divider" />

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">{t.settings.voiceInputLang}</label>
                <select
                  value={voiceInputLang}
                  onChange={(e) => setVoiceInputLang(e.target.value as 'en-KE' | 'en-US')}
                  className="w-full min-h-[44px] machine-input px-3.5 text-sm"
                >
                  <option value="en-KE">English (Kenya · en-KE)</option>
                  <option value="en-US">English (US · en-US)</option>
                </select>
              </div>

              {hasSpeechSynthesis && (
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    {t.settings.voiceRate}: <span className="font-mono text-[var(--gold-300)]">{voiceRate.toFixed(1)}x</span>
                  </label>
                  <input
                    type="range"
                    min="0.7"
                    max="1.4"
                    step="0.1"
                    value={voiceRate}
                    onChange={(e) => setVoiceRate(Number(e.target.value))}
                    className="w-full min-h-[44px] machine-slider"
                  />
                </div>
              )}
            </div>

            {hasSpeechSynthesis && (
              <>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">{t.settings.voiceSelect}</label>
                  <select
                    value={voiceURI}
                    onChange={(e) => setVoiceURI(e.target.value)}
                    className="w-full min-h-[44px] machine-input px-3.5 text-sm"
                  >
                    <option value="">THE MACHINE Neural Voice (English only)</option>
                    {englishVoices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex-1 min-w-[220px] space-y-1">
                    <GoldToggle
                      checked={voiceOutputEnabled}
                      onChange={(next) => setVoiceOutputEnabled(next)}
                      label={t.settings.voiceAutoRead}
                    />
                    <GoldToggle
                      checked={hourlyUpdatesEnabled}
                      onChange={(next) => setHourlyUpdatesEnabled(next)}
                      label="Hourly device & activity updates (every 1 hour)"
                    />
                    <GoldToggle
                      checked={hourlySpeakEnabled}
                      onChange={(next) => setHourlySpeakEnabled(next)}
                      label="Speak hourly updates aloud in English"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      unlockAudio();
                      if (isSpeaking) {
                        stopSpeaking();
                      } else {
                        speak('Systems nominal. I speak strictly in English and update you every hour.', {
                          rate: voiceRate,
                          voiceURI,
                          langHint: 'en',
                        });
                      }
                    }}
                    className="min-h-[44px] px-4 machine-btn-secondary text-xs font-mono shrink-0"
                  >
                    {isSpeaking ? t.chat.stopSpeaking : 'Test Voice'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            {savedBanner ? (
              <span className="text-xs font-mono text-[var(--success)]">{savedBanner}</span>
            ) : (
              <span />
            )}
            <button
              type="submit"
              className="min-h-[48px] px-5 machine-btn-primary text-sm flex items-center gap-2"
            >
              <Save strokeWidth={1.5} className="w-4 h-4" />
              <span>{t.settings.saveSettings}</span>
            </button>
          </div>
        </form>
      )}

      {tab === 'google' && (
        <div className="space-y-4">
          {/* Google Connect & Drive Backup Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="machine-card p-5 space-y-4">
              <h2 className="section-title-gold text-sm font-semibold">
                {t.settings.googleConnectTitle}
              </h2>
              <p className="text-xs font-mono text-[var(--text-muted)] tabular-nums">
                Status:{' '}
                <span className="text-[var(--gold-300)]">
                  {googleStatus === 'connected'
                    ? `${t.google.statusConnected} (~${remainingMins}m remaining)`
                    : googleStatus === 'expired'
                    ? t.google.statusExpired
                    : t.google.statusDisconnected}
                </span>
              </p>

              <div className="flex flex-wrap gap-2">
                {googleStatus === 'disconnected' && (
                  <button
                    type="button"
                    disabled={isConnecting || !resolvedClientId}
                    onClick={() => void onConnectGoogle()}
                    className="min-h-[44px] px-4 machine-btn-primary text-sm"
                  >
                    {isConnecting ? 'Connecting...' : t.google.connectBtn}
                  </button>
                )}
                {googleStatus === 'expired' && (
                  <button
                    type="button"
                    disabled={isConnecting}
                    onClick={() => void onReconnectGoogle()}
                    className="min-h-[44px] px-4 machine-btn-primary text-sm"
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
                      className="min-h-[44px] px-4 machine-btn-secondary text-xs"
                    >
                      {isConnecting ? 'Switching...' : 'Switch Google Account'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDisconnectGoogle()}
                      className="min-h-[44px] px-4 machine-btn-ghost text-xs"
                    >
                      {t.google.disconnectBtn}
                    </button>
                  </>
                )}
              </div>

              {authError && <p className="text-xs text-[var(--error)] font-mono">{authError}</p>}

              <hr className="machine-divider" />
              <form onSubmit={handleSaveClientId} className="space-y-2.5">
                <label className="block text-xs text-[var(--text-muted)]">
                  {t.settings.googleClientIdLabel}
                </label>
                <input
                  type="text"
                  value={customClientId}
                  onChange={(e) => setCustomClientId(e.target.value)}
                  placeholder="xxxxx.apps.googleusercontent.com"
                  className="w-full min-h-[44px] machine-input px-3.5 text-xs font-mono"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                    Active ID: {resolvedClientId ? `${resolvedClientId.slice(0, 22)}...` : 'None'}
                  </span>
                  <button
                    type="submit"
                    className="min-h-[44px] px-4 machine-btn-secondary text-xs shrink-0"
                  >
                    Save ID
                  </button>
                </div>
              </form>
            </section>

            {/* Google Drive Backup */}
            <section className="machine-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Cloud strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
                <h2 className="section-title-gold text-sm font-semibold">
                  {t.settings.driveBackupTitle}
                </h2>
              </div>
              <p className="text-sm text-[var(--text-muted)] leading-relaxed">{t.settings.driveBackupDesc}</p>

              {settings.lastDriveBackupAt && (
                <p className="text-xs font-mono text-[var(--gold-300)] tabular-nums">
                  Last Drive backup: {formatShortDateTime(settings.lastDriveBackupAt, settings.timezone)}
                </p>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={googleStatus !== 'connected' || driveBusy}
                  onClick={() => void handleDriveBackup()}
                  className="w-full min-h-[48px] px-4 machine-btn-primary text-sm flex items-center justify-center gap-2"
                >
                  <Upload strokeWidth={1.5} className="w-4 h-4" />
                  <span>{driveBusy ? 'Working...' : t.settings.driveBackupBtn}</span>
                </button>
                <button
                  type="button"
                  disabled={googleStatus !== 'connected' || driveBusy}
                  onClick={() => void handlePrepareDriveRestore()}
                  className="w-full min-h-[48px] px-4 machine-btn-secondary text-sm flex items-center justify-center gap-2"
                >
                  <Download strokeWidth={1.5} className="w-4 h-4" />
                  <span>{t.settings.driveRestoreBtn}</span>
                </button>
              </div>

              {driveMsg && <p className="text-xs font-mono text-[var(--success)]">{driveMsg}</p>}
              {driveError && <p className="text-xs font-mono text-[var(--error)]">{driveError}</p>}
            </section>
          </div>

          {/* Live Deployment & Vercel Diagnostics */}
          <section className="machine-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Server strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
                <h2 className="section-title-gold text-sm font-semibold">
                  Live Deployment &amp; Vercel Check
                </h2>
              </div>
              <button
                type="button"
                disabled={healthBusy}
                onClick={() => void handleCheckBackendHealth()}
                className="min-h-[44px] px-4 machine-btn-secondary text-xs flex items-center gap-2"
              >
                <RefreshCw strokeWidth={1.5} className={`w-3.5 h-3.5 ${healthBusy ? 'animate-spin' : ''}`} />
                <span>{healthBusy ? 'Checking...' : 'Test AI Server (/api/health)'}</span>
              </button>
            </div>

            {healthResult && (
              <div
                className={`rounded-xl bg-[var(--surface-2)] border p-3 text-xs font-mono flex items-start gap-2 ${
                  healthResult.status === 'ok'
                    ? 'border-[var(--success)]/70 text-[var(--success)]'
                    : healthResult.status === 'missing_key'
                    ? 'border-[var(--status-elevated)]/70 text-[var(--status-elevated)]'
                    : 'border-[var(--error)]/70 text-[var(--error)]'
                }`}
              >
                <CheckCircle2 strokeWidth={1.5} className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed break-words">{healthResult.summary}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-2">
                <p className="text-[var(--text-muted)]">App Origin (Google OAuth JS Origins)</p>
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-[var(--gold-300)] truncate">{currentOrigin}</code>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(currentOrigin);
                      setOriginCopied(true);
                      window.setTimeout(() => setOriginCopied(false), 2000);
                    }}
                    className="min-h-[44px] px-3 machine-btn-secondary text-xs font-mono flex items-center gap-1.5 shrink-0"
                  >
                    <Copy strokeWidth={1.5} className="w-3.5 h-3.5" />
                    <span>{originCopied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-2">
                <p className="text-[var(--text-muted)]">Hostname (Firebase Authorized Domains)</p>
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-[var(--gold-300)] truncate">{currentHost}</code>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(currentHost);
                      setHostCopied(true);
                      window.setTimeout(() => setHostCopied(false), 2000);
                    }}
                    className="min-h-[44px] px-3 machine-btn-secondary text-xs font-mono flex items-center gap-1.5 shrink-0"
                  >
                    <Copy strokeWidth={1.5} className="w-3.5 h-3.5" />
                    <span>{hostCopied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>

            <ol className="space-y-1.5 text-xs text-[var(--text-muted)] list-decimal pl-5 leading-relaxed marker:text-[var(--gold-500)]">
              <li>
                <strong className="text-[var(--text)]">Vercel AI Chat:</strong> In Vercel Project Settings → Environment Variables, set{' '}
                <code className="font-mono text-[var(--gold-300)]">GEMINI_API_KEY</code> and redeploy.
              </li>
              <li>
                <strong className="text-[var(--text)]">Google Account &amp; Real-Time Sync:</strong> In Firebase Console (project{' '}
                <code className="font-mono text-[var(--gold-300)]">gen-lang-client-0036993655</code>) → Authentication → Settings → Authorized domains, add{' '}
                <code className="font-mono text-[var(--gold-300)]">{currentHost}</code>.
              </li>
              <li>
                <strong className="text-[var(--text)]">Gmail / Calendar / Drive:</strong> In Google Cloud Console (project{' '}
                <code className="font-mono text-[var(--gold-300)]">804415406495</code>) → Credentials → OAuth Client ID, add{' '}
                <code className="font-mono text-[var(--gold-300)]">{currentOrigin}</code> to Authorized JavaScript origins.
              </li>
            </ol>
          </section>

          {/* Step-by-step Google Cloud OAuth Setup Guide */}
          <section className="machine-card p-5 space-y-3">
            <h2 className="section-title-gold text-sm font-semibold">
              {t.settings.googleSetupTitle}
            </h2>
            <ol className="space-y-2 text-sm text-[var(--text)]/90 list-decimal pl-5 leading-relaxed marker:text-[var(--gold-500)]">
              <li>
                Open <strong>Google Cloud Console</strong> and create a free project (no billing account is required for personal Gmail, Calendar, or Drive OAuth).
              </li>
              <li>
                Go to <strong>APIs &amp; Services → Library</strong> and enable <strong>Gmail API</strong>, <strong>Google Calendar API</strong>, and <strong>Google Drive API</strong>.
              </li>
              <li>
                Open <strong>Google Auth Platform / OAuth consent screen</strong>, choose <strong>External</strong>, enter an app name, and under <strong>Audience / Test users</strong> add your own Gmail address.
              </li>
              <li>
                Go to <strong>Clients → Create Client → Web application</strong>. Add this app&apos;s exact URL under <strong>Authorized JavaScript origins</strong> (no Client Secret is needed):
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs font-mono text-[var(--gold-300)] break-all">
                    {currentOrigin}
                  </code>
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
                    <span>{originCopied ? 'Copied' : 'Copy URL'}</span>
                  </button>
                </div>
              </li>
              <li>
                Copy your Web Client ID into <code className="font-mono text-xs text-[var(--gold-300)]">VITE_GOOGLE_CLIENT_ID</code> or paste it in the override field above, then tap <strong>Connect Google</strong>. Access tokens remain strictly in browser memory.
              </li>
            </ol>
          </section>
        </div>
      )}

      {tab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="machine-card p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Lock strokeWidth={1.5} className="w-4 h-4 text-[var(--gold-500)]" />
              <h2 className="section-title-gold text-sm font-semibold">{t.settings.pinTitle}</h2>
            </div>
            <p className="text-sm text-[var(--text-muted)]">{t.settings.pinDesc}</p>

            <form onSubmit={handleSetPin} className="space-y-3">
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                placeholder={t.settings.pinNew}
                className="w-full min-h-[44px] machine-input px-3.5 text-sm font-mono tracking-widest"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="min-h-[44px] px-4 machine-btn-primary text-xs"
                >
                  {t.settings.pinEnable}
                </button>
                {settings.pinEnabled && (
                  <>
                    <button
                      type="button"
                      onClick={onLockNow}
                      className="min-h-[44px] px-4 machine-btn-secondary text-xs"
                    >
                      {t.settings.pinLockNow}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemovePin()}
                      className="min-h-[44px] px-4 machine-btn-ghost text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      {t.settings.pinDisable}
                    </button>
                  </>
                )}
              </div>
            </form>
            {pinMsg && <p className="text-xs font-mono text-[var(--gold-300)]">{pinMsg}</p>}
          </section>

          <section className="machine-card p-5 space-y-4">
            <h2 className="section-title-gold text-sm font-semibold">{t.settings.dataTitle}</h2>
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => void handleExport()}
                className="w-full min-h-[48px] px-4 machine-btn-secondary text-sm flex items-center justify-center gap-2"
              >
                <Download strokeWidth={1.5} className="w-4 h-4" />
                <span>{t.settings.exportBtn}</span>
              </button>

              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleImport(e)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="w-full min-h-[48px] px-4 machine-btn-secondary text-sm flex items-center justify-center gap-2"
              >
                <Upload strokeWidth={1.5} className="w-4 h-4" />
                <span>{t.settings.importBtn}</span>
              </button>

              <button
                type="button"
                onClick={() => setConfirmWipe(true)}
                className="w-full min-h-[48px] px-4 rounded-xl bg-[var(--surface-2)] border border-[var(--status-critical)]/70 hover:bg-[var(--status-critical)]/15 text-sm font-medium text-[var(--error)] flex items-center justify-center gap-2 transition"
              >
                <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                <span>{t.settings.deleteBtn}</span>
              </button>
            </div>
            {dataMsg && <p className="text-xs font-mono text-[var(--gold-300)]">{dataMsg}</p>}
          </section>
        </div>
      )}

      {/* Confirm Restore from Google Drive Modal */}
      {pendingDriveRestore && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md machine-card border-[var(--gold-500)] p-6 space-y-4">
            <h2 className="section-title-gold text-base font-semibold">
              Confirm Restore from Google Drive
            </h2>
            <p className="text-sm text-[var(--text)]/90 leading-relaxed">
              This will replace current device data with the Drive backup from{' '}
              <span className="font-mono text-[var(--gold-300)]">
                {formatShortDateTime(pendingDriveRestore.meta.modifiedTime, settings.timezone)}
              </span>
              .
            </p>
            <p className="text-xs font-mono text-[var(--text-muted)] tabular-nums">
              {pendingDriveRestore.payload.tasks?.length ?? 0} tasks ·{' '}
              {pendingDriveRestore.payload.notes?.length ?? 0} notes ·{' '}
              {pendingDriveRestore.payload.reminders?.length ?? 0} reminders ·{' '}
              {pendingDriveRestore.payload.documents?.length ?? 0} docs
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDriveRestore(null)}
                className="min-h-[44px] px-4 machine-btn-ghost text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={driveBusy}
                onClick={() => void handleConfirmDriveRestore()}
                className="min-h-[44px] px-4 machine-btn-primary text-xs"
              >
                {driveBusy ? 'Restoring...' : 'Confirm & Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Complete Data Wipe Modal */}
      {confirmWipe && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md machine-card border-[var(--status-critical)] p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-[var(--error)]">
              <AlertTriangle strokeWidth={1.5} className="w-5 h-5 shrink-0" />
              <h2 className="font-cinzel text-base font-semibold">{t.settings.deleteConfirmTitle}</h2>
            </div>
            <p className="text-sm text-[var(--text)]/90 leading-relaxed">{t.settings.deleteConfirmBody}</p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setConfirmWipe(false)}
                className="min-h-[44px] px-4 machine-btn-ghost text-sm"
              >
                {t.notesTasks.cancel}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAll()}
                className="min-h-[44px] px-4 rounded-xl bg-[var(--status-critical)] text-sm font-medium text-[var(--text)]"
              >
                {t.settings.deleteConfirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
