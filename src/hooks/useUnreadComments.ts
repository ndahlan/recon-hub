/**
 * useUnreadComments
 *
 * Tracks how many new project comments each project has since the user last
 * opened that project's discussion screen.
 *
 * - One Supabase query fetches all relevant comments (no N+1).
 * - Last-seen timestamps are persisted in AsyncStorage per project.
 * - A real-time subscription keeps counts live without polling.
 *
 * Usage:
 *   const { unreadByProject, totalUnread, markRead } = useUnreadComments(projectIds, userId);
 *   // mark a project's comments as read:
 *   await markRead(projectId);
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hubSupabase } from '../lib/hubSupabase';

let instanceCount = 0;

const SEEN_KEY = 'recon_comments_seen'; // { [projectId]: ISO timestamp }

export function useUnreadComments(projectIds: string[], currentUserId: string | null) {
  const [unreadByProject, setUnreadByProject] = useState<Record<string, number>>({});
  // Stable ref so the realtime callback always has the latest projectIds/userId
  const argsRef = useRef({ projectIds, currentUserId });
  argsRef.current = { projectIds, currentUserId };
  // Each hook instance gets a unique channel name to avoid Supabase conflicts
  const channelName = useRef(`unread-comments-${++instanceCount}`).current;

  const refresh = useCallback(async () => {
    const { projectIds: pids, currentUserId: uid } = argsRef.current;
    if (!pids.length || !uid) return;

    // Single query — all comments for all projects, excluding the current user's own
    const { data } = await hubSupabase
      .from('project_comments')
      .select('project_id, created_at')
      .in('project_id', pids)
      .neq('user_id', uid);

    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const seenMap: Record<string, string> = raw ? JSON.parse(raw) : {};

    const counts: Record<string, number> = {};
    for (const pid of pids) counts[pid] = 0;
    for (const row of data ?? []) {
      const lastSeen = seenMap[row.project_id] ?? '1970-01-01T00:00:00Z';
      if (row.created_at > lastSeen) {
        counts[row.project_id] = (counts[row.project_id] ?? 0) + 1;
      }
    }
    setUnreadByProject(counts);
  }, []); // stable — reads from ref

  // Mark a project's comments as read (call when user opens the discussion screen)
  const markRead = useCallback(async (projectId: string) => {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const seenMap: Record<string, string> = raw ? JSON.parse(raw) : {};
    seenMap[projectId] = new Date().toISOString();
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seenMap));
    setUnreadByProject((prev) => ({ ...prev, [projectId]: 0 }));
  }, []);

  // Refresh whenever projectIds or userId changes
  useEffect(() => { refresh(); }, [projectIds.join(','), currentUserId, refresh]); // eslint-disable-line

  // Real-time: any new project comment triggers a recount
  useEffect(() => {
    if (!projectIds.length) return;
    const channel = hubSupabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_comments' }, () => {
        refresh();
      })
      .subscribe();
    return () => { hubSupabase.removeChannel(channel); };
  }, [projectIds.join(','), refresh]); // eslint-disable-line

  const totalUnread = Object.values(unreadByProject).reduce((a, b) => a + b, 0);

  return { unreadByProject, totalUnread, markRead, refresh };
}
