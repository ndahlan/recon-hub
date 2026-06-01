/**
 * localDb.ts — SQLite offline cache
 *
 * Three tables:
 *   cached_projects  — mirror of Supabase projects (for offline viewing)
 *   cached_entries   — mirror of Supabase entries  (for offline viewing)
 *   pending_entries  — entries created while offline, waiting to sync
 *
 * NOTE: withTransactionAsync is intentionally NOT used here.
 * expo-sqlite v14 (SDK 56) has a known Android bug where withTransactionAsync
 * causes a NullPointerException in NativeDatabase.PrepareAsync.
 * Sequential runAsync calls are safe for these cache-write operations.
 */

import * as SQLite from 'expo-sqlite';
import { Project, FieldEntry } from '../types';

const DB_NAME = 'recon_cache.db';

// Promise-based singleton prevents race conditions when multiple callers
// await db() before the first open/init has finished.
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync(DB_NAME);
      await d.execAsync(`
        CREATE TABLE IF NOT EXISTS cached_projects (
          id         TEXT PRIMARY KEY,
          json       TEXT NOT NULL,
          synced_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cached_entries (
          id          TEXT PRIMARY KEY,
          project_id  TEXT NOT NULL,
          json        TEXT NOT NULL,
          local_uri   TEXT,
          synced_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ce_project ON cached_entries(project_id);

        CREATE TABLE IF NOT EXISTS pending_entries (
          id          TEXT PRIMARY KEY,
          project_id  TEXT NOT NULL,
          local_uri   TEXT NOT NULL,
          media_type  TEXT NOT NULL,
          filename    TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          category    TEXT NOT NULL DEFAULT '',
          country     TEXT NOT NULL DEFAULT '',
          latitude    REAL,
          longitude   REAL,
          altitude    REAL,
          created_at  TEXT NOT NULL
        );
      `);
      return d;
    })();
  }
  return _dbPromise;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function saveProjects(projects: Project[]): Promise<void> {
  const d = await db();
  const now = new Date().toISOString();
  // Sequential writes — no withTransactionAsync to avoid Android NullPointerException
  await d.runAsync('DELETE FROM cached_projects');
  for (const p of projects) {
    await d.runAsync(
      'INSERT OR REPLACE INTO cached_projects (id, json, synced_at) VALUES (?, ?, ?)',
      [p.id, JSON.stringify(p), now],
    );
  }
}

export async function getLocalProjects(): Promise<Project[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ json: string }>('SELECT json FROM cached_projects');
  return rows.map((r) => JSON.parse(r.json) as Project);
}

// ─── Entries ──────────────────────────────────────────────────────────────────

export async function saveEntries(projectId: string, entries: FieldEntry[]): Promise<void> {
  const d = await db();
  const now = new Date().toISOString();
  // Sequential writes — no withTransactionAsync to avoid Android NullPointerException
  await d.runAsync('DELETE FROM cached_entries WHERE project_id = ?', [projectId]);
  for (const e of entries) {
    await d.runAsync(
      `INSERT OR REPLACE INTO cached_entries
         (id, project_id, json, local_uri, synced_at)
         VALUES (?, ?, ?, ?, ?)`,
      [e.id, e.project_id, JSON.stringify(e), e.local_uri ?? null, now],
    );
  }
}

export async function getLocalEntries(projectId: string): Promise<FieldEntry[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ json: string; local_uri: string | null }>(
    'SELECT json, local_uri FROM cached_entries WHERE project_id = ? ORDER BY rowid DESC',
    [projectId],
  );
  return rows.map((r) => {
    const e = JSON.parse(r.json) as FieldEntry;
    if (r.local_uri && !e.local_uri) e.local_uri = r.local_uri;
    return e;
  });
}

// ─── Pending entries (created while offline) ──────────────────────────────────

export interface PendingEntry {
  id:          string;
  project_id:  string;
  local_uri:   string;
  media_type:  'photo' | 'video';
  filename:    string;
  description: string;
  category:    string;
  country:     string;
  latitude?:   number;
  longitude?:  number;
  altitude?:   number;
  created_at:  string;
}

export async function savePendingEntry(entry: PendingEntry): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT INTO pending_entries
       (id, project_id, local_uri, media_type, filename,
        description, category, country, latitude, longitude, altitude, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id, entry.project_id, entry.local_uri, entry.media_type, entry.filename,
      entry.description, entry.category, entry.country,
      entry.latitude ?? null, entry.longitude ?? null, entry.altitude ?? null,
      entry.created_at,
    ],
  );
}

export async function getPendingEntries(): Promise<PendingEntry[]> {
  const d = await db();
  return d.getAllAsync<PendingEntry>('SELECT * FROM pending_entries ORDER BY created_at ASC');
}

export async function deletePendingEntry(id: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM pending_entries WHERE id = ?', [id]);
}

export async function getPendingCount(): Promise<number> {
  const d = await db();
  const row = await d.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM pending_entries');
  return row?.c ?? 0;
}
