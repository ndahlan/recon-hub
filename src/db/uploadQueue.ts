/**
 * uploadQueue.ts
 *
 * Local SQLite queue for media uploads.
 * Entries are saved locally first (offline-friendly), then uploaded in
 * the background. The queue survives app restarts.
 */

import * as SQLite from 'expo-sqlite';
import { UploadQueueItem, UploadStatus } from '../types';

const DB_NAME = 'recon_queue.db';

// Promise-based singleton: concurrent callers all await the same promise
// instead of each racing to open the database — prevents NullPointerException
// in NativeDatabase.PrepareAsync on Android (expo-sqlite v14 / SDK 56).
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync(DB_NAME);
      await d.execAsync(`
        create table if not exists upload_queue (
          id          text primary key,
          entry_id    text not null,
          project_id  text not null,
          local_uri   text not null,
          media_type  text not null,
          filename    text not null,
          status      text not null default 'pending',
          attempts    integer default 0,
          error       text,
          created_at  text not null
        );
        create index if not exists idx_status on upload_queue(status);
      `);
      return d;
    })();
  }
  return _dbPromise;
}

function uuid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function enqueue(item: Omit<UploadQueueItem, 'id' | 'status' | 'attempts' | 'created_at'>): Promise<string> {
  const db = await getDb();
  const id = uuid();
  await db.runAsync(
    `insert into upload_queue (id, entry_id, project_id, local_uri, media_type, filename, status, attempts, created_at)
     values (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [id, item.entry_id, item.project_id, item.local_uri, item.media_type, item.filename, new Date().toISOString()]
  );
  return id;
}

export async function getPending(): Promise<UploadQueueItem[]> {
  const db = await getDb();
  return await db.getAllAsync<UploadQueueItem>(
    `select * from upload_queue where status in ('pending', 'failed') and attempts < 5 order by created_at asc`
  );
}

export async function getByEntryId(entryId: string): Promise<UploadQueueItem | null> {
  const db = await getDb();
  return await db.getFirstAsync<UploadQueueItem>(
    `select * from upload_queue where entry_id = ?`, [entryId]
  );
}

export async function setStatus(id: string, status: UploadStatus, error?: string) {
  const db = await getDb();
  await db.runAsync(
    `update upload_queue set status = ?, error = ?, attempts = attempts + 1 where id = ?`,
    [status, error ?? null, id]
  );
}

export async function markUploading(id: string) {
  const db = await getDb();
  await db.runAsync(`update upload_queue set status = 'uploading' where id = ?`, [id]);
}

export async function remove(id: string) {
  const db = await getDb();
  await db.runAsync(`delete from upload_queue where id = ?`, [id]);
}

export async function getPendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    `select count(*) as count from upload_queue where status in ('pending', 'uploading', 'failed')`
  );
  return row?.count ?? 0;
}

export async function clearUploaded() {
  const db = await getDb();
  await db.runAsync(`delete from upload_queue where status = 'uploaded'`);
}
