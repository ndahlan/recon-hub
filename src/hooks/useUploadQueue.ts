/**
 * useUploadQueue.ts
 *
 * Drives the background upload loop. Processes pending queue items
 * whenever the app is in the foreground. Notifies listeners via a
 * simple counter so components can re-render when uploads finish.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as UploadQueue from '../db/uploadQueue';
import { uploadMedia, updateEntryUploadStatus } from '../db/database';

const POLL_INTERVAL_MS = 5000; // check queue every 5s while active

let _isRunning = false;

// Global counter — incremented each time an upload finishes (success or fail)
// Components subscribe to this to know when to refresh
const listeners = new Set<() => void>();
export function subscribeToUploads(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function notifyListeners() {
  listeners.forEach((fn) => fn());
}

export async function processQueue() {
  if (_isRunning) return;
  _isRunning = true;

  try {
    const pending = await UploadQueue.getPending();

    for (const item of pending) {
      try {
        await UploadQueue.markUploading(item.id);
        await uploadMedia(item.local_uri, item.filename, item.media_type);
        await UploadQueue.setStatus(item.id, 'uploaded');
        await updateEntryUploadStatus(item.entry_id, 'uploaded');
        notifyListeners();
      } catch (e: any) {
        const errMsg = e?.message ?? 'Unknown error';
        await UploadQueue.setStatus(item.id, 'failed', errMsg);
        await updateEntryUploadStatus(item.entry_id, 'failed');
        notifyListeners();
      }
    }
  } finally {
    _isRunning = false;
  }
}

export function useUploadQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshCount = useCallback(async () => {
    const count = await UploadQueue.getPendingCount();
    setPendingCount(count);
  }, []);

  const runAndRefresh = useCallback(async () => {
    await processQueue();
    await refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    // Subscribe to upload completion events
    const unsub = subscribeToUploads(refreshCount);

    // Start polling while app is in foreground
    refreshCount();
    runAndRefresh();
    intervalRef.current = setInterval(runAndRefresh, POLL_INTERVAL_MS);

    // Also trigger on foreground resume
    const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') runAndRefresh();
    });

    return () => {
      unsub();
      if (intervalRef.current) clearInterval(intervalRef.current);
      appStateSub.remove();
    };
  }, [runAndRefresh, refreshCount]);

  return { pendingCount };
}
