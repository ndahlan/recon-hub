/**
 * database.ts
 *
 * All data lives in the shared recon-hub Supabase project.
 * Row Level Security on each table ensures users only see their own data.
 * Shared projects are accessible via project_members + RLS.
 */

import NetInfo from '@react-native-community/netinfo';
import { hubSupabase } from '../lib/hubSupabase';
import { EntryComment, FieldEntry, Project, ProjectComment, ProjectMember, UploadStatus, UserProfile } from '../types';
import { HUB_URL, HUB_KEY } from '../lib/hubSupabase';
import * as UploadQueue from './uploadQueue';
import * as localDb from './localDb';

const SIGNED_URL_EXPIRES = 3600;

/** Race a promise against a timeout — rejects with Error('timeout') if too slow. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function isOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === true && state.isInternetReachable !== false;
  } catch {
    return true; // assume online if we can't check
  }
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  const { data: { session } } = await hubSupabase.auth.getSession();
  if (!session) return [];

  try {
    // Fetch with a generous timeout — multiple parallel queries still need time
    const fresh = await withTimeout(_fetchAllProjects(session), 15000);
    await localDb.saveProjects(fresh);  // update cache
    return fresh;
  } catch {
    // Offline or timed out — return cached data
    const cached = await localDb.getLocalProjects();
    return cached;
  }
}

async function _fetchAllProjects(session: any): Promise<Project[]> {
  // Single query — Supabase RLS returns every project the user can see:
  //   • own projects          (owner_id = auth.uid())
  //   • accepted memberships  (project_members.user_id = auth.uid() AND accepted)
  //   • hub invitations       (hub_invitations.invited_email = auth.email())
  //
  // Previously we fired three parallel queries and combined IDs manually.
  // Any query that returned an RLS error was silently treated as [] — meaning
  // shared projects would vanish without any visible failure.  One query is
  // simpler, and any real error now propagates so the caller can act on it.
  const { data, error } = await hubSupabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((p: any) => ({
    ...(p as Project),
    is_owner: p.owner_id === session.user.id,
  }));
}

export async function createProject(name: string, description: string): Promise<Project> {
  const { data: { session } } = await hubSupabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await hubSupabase
    .from('projects')
    .insert({ name, description, owner_id: session.user.id, owner_email: session.user.email ?? '' })
    .select()
    .single();
  if (error) throw error;

  const project: Project = { ...data as Project, is_owner: true };

  // Immediately merge into local cache so a timeout fallback on HomeScreen
  // still shows the newly created project without a second round-trip.
  try {
    const cached = await localDb.getLocalProjects();
    const merged = [project, ...cached.filter((p) => p.id !== project.id)];
    await localDb.saveProjects(merged);
  } catch { /* cache update is best-effort */ }

  return project;
}

export async function updateProjectName(id: string, name: string): Promise<void> {
  const { error } = await hubSupabase
    .from('projects')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
  // Keep local cache in sync
  try {
    const cached = await localDb.getLocalProjects();
    await localDb.saveProjects(cached.map((p) => p.id === id ? { ...p, name } : p));
  } catch { /* best-effort */ }
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await hubSupabase.from('projects').delete().eq('id', id);
  if (error) throw error;
  // Remove from local cache so it doesn't reappear on slow connections
  try {
    const cached = await localDb.getLocalProjects();
    await localDb.saveProjects(cached.filter((p) => p.id !== id));
  } catch { /* cache update is best-effort */ }
}

/** Invitee removes themselves from a shared project (leaves without deleting). */
export async function leaveProject(projectId: string): Promise<void> {
  const { data: { session } } = await hubSupabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  // Remove from project_members by user_id
  const { error: e1 } = await hubSupabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', session.user.id);

  // Also remove from hub_invitations by email (belt-and-suspenders)
  await hubSupabase
    .from('hub_invitations')
    .delete()
    .eq('project_id', projectId)
    .eq('invited_email', session.user.email ?? '');

  if (e1) throw e1;

  // Remove from local cache
  try {
    const cached = await localDb.getLocalProjects();
    await localDb.saveProjects(cached.filter((p) => p.id !== projectId));
  } catch { /* best-effort */ }
}

// ─── Project Members ──────────────────────────────────────────────────────────

export async function getProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await hubSupabase
    .from('project_members')
    .select('*')
    .eq('project_id', projectId)
    .order('invited_at', { ascending: true });
  if (error) throw error;
  return data as ProjectMember[];
}

export async function inviteMember(
  project: Project,
  email: string,
  role: 'editor' | 'viewer',
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  // Write to project_members in hub
  const { error } = await hubSupabase
    .from('project_members')
    .insert({ project_id: project.id, invited_email: normalizedEmail, role, accepted: false });
  if (error) throw error;

  // Also write to hub_invitations for cross-device discovery
  const { data: { session } } = await hubSupabase.auth.getSession();
  const { error: hubError } = await hubSupabase
    .from('hub_invitations')
    .insert({
      project_id: project.id,
      invited_email: normalizedEmail,
      role,
      owner_id: session?.user.id,
      supabase_url: HUB_URL,
      supabase_anon_key: HUB_KEY,
    });
  if (hubError) throw hubError;
}

export async function removeMember(memberId: string): Promise<void> {
  const { error } = await hubSupabase.from('project_members').delete().eq('id', memberId);
  if (error) throw error;
}

// ─── Entries ──────────────────────────────────────────────────────────────────

export async function getEntries(projectId: string): Promise<FieldEntry[]> {
  // Always prepend locally-created offline entries for this project
  const pendingLocal = (await localDb.getPendingEntries())
    .filter((p) => p.project_id === projectId)
    .map(_pendingToEntry);

  try {
    const remote = await withTimeout(_fetchRemoteEntries(projectId), 6000);
    await localDb.saveEntries(projectId, remote);  // update cache
    return [...pendingLocal, ...remote];
  } catch {
    // Offline — return pending + cached
    const cached = await localDb.getLocalEntries(projectId);
    return [...pendingLocal, ...cached];
  }
}

async function _fetchRemoteEntries(projectId: string): Promise<FieldEntry[]> {
  const { data, error } = await hubSupabase
    .from('entries')
    .select('*')
    .eq('project_id', projectId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const entries = (data ?? []) as FieldEntry[];
  if (entries.length === 0) return [];

  // Sign uploaded media URLs
  const uploaded = entries.filter((e) => e.upload_status === 'uploaded' || !e.upload_status);
  if (uploaded.length > 0) {
    const paths = uploaded.map((e) => extractFilename(e.photo_url, e.media_type));
    const { data: signedData } = await hubSupabase.storage
      .from('photos')
      .createSignedUrls(paths, SIGNED_URL_EXPIRES);

    const signedMap: Record<string, string> = {};
    (signedData ?? []).forEach((item, i) => {
      if (item.signedUrl) signedMap[paths[i]] = item.signedUrl;
    });

    return entries.map((e) => ({
      ...e,
      photo_url: e.upload_status === 'uploaded'
        ? (signedMap[extractFilename(e.photo_url, e.media_type)] ?? e.photo_url)
        : e.photo_url,
    }));
  }

  // Attach local URIs for queued uploads
  return Promise.all(entries.map(async (e) => {
    if (e.upload_status === 'pending' || e.upload_status === 'uploading' || e.upload_status === 'failed') {
      const qi = await UploadQueue.getByEntryId(e.id);
      return { ...e, local_uri: qi?.local_uri };
    }
    return e;
  }));
}

function _pendingToEntry(p: localDb.PendingEntry): FieldEntry {
  return {
    id: p.id,
    project_id: p.project_id,
    user_id: '',
    local_uri: p.local_uri,
    photo_url: p.local_uri,        // display local file while offline
    media_type: p.media_type,
    upload_status: 'pending',
    description: p.description,
    category: p.category,
    country: p.country,
    latitude: p.latitude,
    longitude: p.longitude,
    altitude: p.altitude,
    created_at: p.created_at,
    is_local_only: true,
  };
}

export async function createEntryLocal(
  projectId: string,
  localUri: string,
  mediaType: 'photo' | 'video',
  description: string,
  category: string,
  country: string,
  latitude?: number,
  longitude?: number,
  altitude?: number,
): Promise<FieldEntry> {
  const { data: { session } } = await hubSupabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const ext = mediaType === 'video' ? 'mp4' : 'jpg';
  const filename = `${session.user.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const uploadedBy = session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? '';

  const online = await isOnline();
  if (!online) {
    // ── Offline path: save to local pending queue ──────────────────────────
    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const pending: localDb.PendingEntry = {
      id: localId,
      project_id: projectId,
      local_uri: localUri,
      media_type: mediaType,
      filename,
      description,
      category,
      country,
      latitude,
      longitude,
      altitude,
      created_at: new Date().toISOString(),
    };
    await localDb.savePendingEntry(pending);
    return _pendingToEntry(pending);
  }

  // ── Online path: write to Supabase ─────────────────────────────────────
  const { data, error } = await hubSupabase
    .from('entries')
    .insert({
      project_id: projectId,
      user_id: session.user.id,
      uploaded_by: uploadedBy,
      photo_url: filename,
      media_type: mediaType,
      upload_status: 'pending',
      description,
      category,
      country,
      latitude,
      longitude,
      altitude,
    })
    .select()
    .single();
  if (error) throw error;

  await UploadQueue.enqueue({
    entry_id: (data as FieldEntry).id,
    project_id: projectId,
    local_uri: localUri,
    media_type: mediaType,
    filename,
  });

  return { ...(data as FieldEntry), local_uri: localUri, upload_status: 'pending' };
}

/** Sync all pending offline entries to Supabase. Called when internet returns. */
export async function syncPendingEntries(): Promise<number> {
  const pending = await localDb.getPendingEntries();
  if (pending.length === 0) return 0;

  const { data: { session } } = await hubSupabase.auth.getSession();
  if (!session) return 0;

  let synced = 0;
  for (const p of pending) {
    try {
      const syncUploadedBy = session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? '';
      const { data, error } = await hubSupabase
        .from('entries')
        .insert({
          project_id: p.project_id,
          user_id: session.user.id,
          uploaded_by: syncUploadedBy,
          photo_url: p.filename,
          media_type: p.media_type,
          upload_status: 'pending',
          description: p.description,
          category: p.category,
          country: p.country,
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
          altitude: p.altitude ?? null,
          created_at: p.created_at,
        })
        .select()
        .single();
      if (error) continue;

      // Now queue the media upload (entry exists in Supabase)
      await UploadQueue.enqueue({
        entry_id: (data as FieldEntry).id,
        project_id: p.project_id,
        local_uri: p.local_uri,
        media_type: p.media_type,
        filename: p.filename,
      });

      await localDb.deletePendingEntry(p.id);
      synced++;
    } catch { /* skip and retry next time */ }
  }
  return synced;
}

export async function updateEntryUploadStatus(entryId: string, status: UploadStatus): Promise<void> {
  const { error } = await hubSupabase
    .from('entries')
    .update({ upload_status: status })
    .eq('id', entryId);
  if (error) throw error;
}

export async function updateEntry(
  id: string,
  description: string,
  category: string,
  country: string,
): Promise<void> {
  const { error } = await hubSupabase
    .from('entries')
    .update({ description, category, country })
    .eq('id', id);
  if (error) throw error;
}

export async function archiveEntry(id: string): Promise<void> {
  const { error } = await hubSupabase
    .from('entries')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ─── Upload (called by background uploader) ───────────────────────────────────

export async function uploadMedia(
  localUri: string,
  filename: string,
  mediaType: 'photo' | 'video',
): Promise<void> {
  const { data: { session } } = await hubSupabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const contentType = mediaType === 'video' ? 'video/mp4' : 'image/jpeg';

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${HUB_URL}/storage/v1/object/photos/${filename}`);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('apikey', HUB_KEY);
    xhr.timeout = 180000;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    const fd = new FormData();
    fd.append('file', { uri: localUri, name: filename, type: contentType } as any);
    xhr.send(fd);
  });
}

// ─── Aliases used by screens (matching Rekee's API) ──────────────────────────

/** Alias for createEntryLocal — same signature as Rekee's insertEntry */
export async function insertEntry(
  projectId: string,
  localUri: string,
  mediaType: 'photo' | 'video',
  description: string,
  category: string,
  country: string,
  latitude?: number,
  longitude?: number,
  altitude?: number,
): Promise<FieldEntry> {
  return createEntryLocal(projectId, localUri, mediaType, description, category, country, latitude, longitude, altitude);
}

/** Alias for acceptPendingHubInvitations — matches Rekee's function name */
export async function acceptPendingInvitations(userId: string, email: string): Promise<number> {
  return acceptPendingHubInvitations(userId, email);
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function getProfile(): Promise<UserProfile> {
  const { data: { session } } = await hubSupabase.auth.getSession();
  if (!session) return { name: '', phone: '', email: '' };
  const user = session.user;
  return {
    name: user.user_metadata?.full_name ?? '',
    phone: user.user_metadata?.phone ?? '',
    email: user.email ?? '',
    id: user.id,
  };
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  const { error } = await hubSupabase.auth.updateUser({
    data: {
      full_name: profile.name,
      phone: profile.phone,
    },
  });
  if (error) throw error;
}

// ─── Hub: accept pending invitations ─────────────────────────────────────────

export async function acceptPendingHubInvitations(userId: string, email: string): Promise<number> {
  if (!email) return 0;
  const normalizedEmail = email.toLowerCase().trim();

  // Step 1: Mark pending hub_invitations as accepted.
  const { data: hubData, error: hubError } = await hubSupabase
    .from('hub_invitations')
    .update({ accepted: true })
    .eq('invited_email', normalizedEmail)
    .eq('accepted', false)
    .select('project_id');

  if (hubError) console.warn('[invite] hub_invitations update failed:', hubError.message);

  // Step 2: ALWAYS link user_id in project_members — do NOT skip when hub_invitations
  // returns 0 rows.  On a prior session the hub_invitations update may have succeeded
  // while the project_members update silently failed (bad RLS).  Once hub_invitations
  // is already accepted it returns 0 rows, so without this fix the membership is
  // permanently stuck with user_id = NULL and accepted = false.
  // Also catches rows where accepted was somehow left false.
  const { error: memberError } = await hubSupabase
    .from('project_members')
    .update({ user_id: userId, accepted: true })
    .eq('invited_email', normalizedEmail)
    .or('user_id.is.null,accepted.eq.false');

  if (memberError) {
    console.warn('[invite] project_members update failed:', memberError.message,
      '\nFix: ensure RLS UPDATE policy allows invitee to accept on project_members');
  }

  return hubData?.length ?? 0;
}

// ─── Entry Comments ───────────────────────────────────────────────────────────

export async function getEntryComments(entryId: string): Promise<EntryComment[]> {
  const { data, error } = await hubSupabase
    .from('entry_comments')
    .select('*')
    .eq('entry_id', entryId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as EntryComment[];
}

export async function addEntryComment(
  entryId: string,
  projectId: string,
  comment: string,
): Promise<EntryComment> {
  const { data: { session } } = await hubSupabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const userName = session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? 'User';
  const { data, error } = await hubSupabase
    .from('entry_comments')
    .insert({
      entry_id: entryId,
      project_id: projectId,
      user_id: session.user.id,
      user_email: session.user.email ?? '',
      user_name: userName,
      comment,
    })
    .select()
    .single();
  if (error) throw error;
  return data as EntryComment;
}

export async function deleteEntryComment(commentId: string): Promise<void> {
  const { error } = await hubSupabase.from('entry_comments').delete().eq('id', commentId);
  if (error) throw error;
}

// ─── Project Comments ─────────────────────────────────────────────────────────

export async function getProjectComments(projectId: string): Promise<ProjectComment[]> {
  const { data, error } = await hubSupabase
    .from('project_comments')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProjectComment[];
}

export async function addProjectComment(
  projectId: string,
  comment: string,
  mentions: string[],
): Promise<ProjectComment> {
  const { data: { session } } = await hubSupabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const userName = session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? 'User';
  const { data, error } = await hubSupabase
    .from('project_comments')
    .insert({
      project_id: projectId,
      user_id: session.user.id,
      user_email: session.user.email ?? '',
      user_name: userName,
      comment,
      mentions,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ProjectComment;
}

export async function deleteProjectComment(commentId: string): Promise<void> {
  const { error } = await hubSupabase.from('project_comments').delete().eq('id', commentId);
  if (error) throw error;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractFilename(urlOrFilename: string, mediaType: 'photo' | 'video' = 'photo'): string {
  const ext = mediaType === 'video' ? 'mp4' : 'jpg';
  const match = urlOrFilename.match(new RegExp(`([^?]+\\.${ext})`));
  return match ? match[1] : urlOrFilename;
}
