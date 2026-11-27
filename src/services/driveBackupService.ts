import { dbStorage } from '../db/storage';
import type { MachineBackupPayload } from '../types/machine';
import { getValidAccessToken, markGoogleTokenExpired } from './googleAuth';

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const BACKUP_FILENAME = 'the-machine-backup.json';

export interface DriveBackupMetadata {
  id: string;
  name: string;
  modifiedTime: string;
  sizeBytes: number;
}

async function driveFetch(url: string, init: RequestInit, settingsClientId?: string): Promise<Response> {
  const token = getValidAccessToken(settingsClientId);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    markGoogleTokenExpired();
    throw new Error('Google session expired. Please reconnect.');
  }
  return res;
}

async function formatDriveError(res: Response, fallback: string): Promise<string> {
  const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  const msg = err?.error?.message || fallback;
  const lower = msg.toLowerCase();
  if (lower.includes('has not been used in project') || lower.includes('is disabled')) {
    return `${msg} — Google Drive API may still be propagating for project 804415406495. Wait 1–2 minutes and retry.`;
  }
  if (res.status === 403 && (lower.includes('insufficient') || lower.includes('scope'))) {
    return `${msg} — Disconnect and reconnect Google, approving Drive AppData permission.`;
  }
  return msg;
}

export async function findDriveBackup(settingsClientId?: string): Promise<DriveBackupMetadata | null> {
  const qs = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${BACKUP_FILENAME}' and trashed = false`,
    fields: 'files(id, name, modifiedTime, size)',
    orderBy: 'modifiedTime desc',
    pageSize: '1',
  });

  const res = await driveFetch(`${DRIVE_FILES_API}?${qs.toString()}`, { method: 'GET' }, settingsClientId);
  if (!res.ok) {
    throw new Error(await formatDriveError(res, 'Failed to query Google Drive appDataFolder.'));
  }
  const data = (await res.json()) as {
    files?: Array<{ id: string; name: string; modifiedTime?: string; size?: string }>;
  };
  const first = data.files?.[0];
  if (!first) return null;
  return {
    id: first.id,
    name: first.name,
    modifiedTime: first.modifiedTime ?? new Date().toISOString(),
    sizeBytes: Number(first.size ?? 0),
  };
}

export async function backupToGoogleDrive(settingsClientId?: string): Promise<DriveBackupMetadata> {
  const payload = await dbStorage.exportAllData();
  const jsonText = JSON.stringify(payload, null, 2);
  const existing = await findDriveBackup(settingsClientId);

  const boundary = `machine_boundary_${Date.now()}`;
  const metadata = existing
    ? { name: BACKUP_FILENAME }
    : { name: BACKUP_FILENAME, parents: ['appDataFolder'] };

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${jsonText}\r\n` +
    `--${boundary}--`;

  const url = existing
    ? `${DRIVE_UPLOAD_API}/${encodeURIComponent(existing.id)}?uploadType=multipart&fields=id,name,modifiedTime,size`
    : `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,modifiedTime,size`;

  const res = await driveFetch(
    url,
    {
      method: existing ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    },
    settingsClientId
  );

  if (!res.ok) {
    throw new Error(await formatDriveError(res, 'Failed uploading backup to Google Drive.'));
  }

  const file = (await res.json()) as { id: string; name: string; modifiedTime?: string; size?: string };
  return {
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime ?? new Date().toISOString(),
    sizeBytes: Number(file.size ?? jsonText.length),
  };
}

export async function downloadDriveBackup(
  fileId: string,
  settingsClientId?: string
): Promise<MachineBackupPayload> {
  const res = await driveFetch(
    `${DRIVE_FILES_API}/${encodeURIComponent(fileId)}?alt=media`,
    { method: 'GET' },
    settingsClientId
  );

  if (!res.ok) {
    throw new Error(await formatDriveError(res, 'Failed downloading backup from Google Drive.'));
  }
  return (await res.json()) as MachineBackupPayload;
}
