/**
 * ExportScreen.tsx
 *
 * Downloads all projects + entries + photos/videos from Supabase.
 *
 * Photos/videos → saved to the phone's Gallery (MediaLibrary) in a
 *   "Recon Export" album — accessible via USB file transfer or Photos app.
 *
 * Metadata → exported as CSV, shareable via the system share sheet.
 */

import React, { useState } from 'react';
import {
  Alert, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { hubSupabase } from '../lib/hubSupabase';
import { FieldEntry, Project } from '../types';

const ALBUM_NAME = 'Recon Export';
const SIGNED_EXPIRES = 3600;

interface ExportProgress {
  phase: string;
  current: number;
  total: number;
}

interface ExportResult {
  csvPath: string;
  photosTotal: number;
  photosSaved: number;
}

export default function ExportScreen() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    setRunning(true);
    setResult(null);
    setError('');
    setProgress({ phase: 'Starting…', current: 0, total: 0 });

    try {
      // ── 0. MediaLibrary permissions ───────────────────────────────────────────
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Photo library permission is required to save photos to your Gallery.');
      }

      const client = hubSupabase;

      // ── 1. Auth ───────────────────────────────────────────────────────────────
      const { data: { session } } = await client.auth.getSession();
      if (!session) throw new Error('Not authenticated.');

      // ── 2. Fetch all projects ─────────────────────────────────────────────────
      setProgress({ phase: 'Fetching projects…', current: 0, total: 0 });
      const { data: projects, error: pErr } = await client
        .from('projects')
        .select('*')
        .eq('owner_id', session.user.id)
        .order('created_at', { ascending: true });
      if (pErr) throw pErr;

      const allProjects = (projects ?? []) as Project[];

      // ── 3. Create a temp folder for CSVs ─────────────────────────────────────
      const datestamp = new Date().toISOString().slice(0, 10);
      const exportRoot = `${FileSystem.documentDirectory}Recon_Export_${datestamp}/`;
      await FileSystem.makeDirectoryAsync(exportRoot, { intermediates: true });

      const summaryRows: string[] = [
        'project_name,entry_id,category,country,description,latitude,longitude,altitude,media_type,filename,created_at',
      ];

      let totalPhotos = 0;
      let savedPhotos = 0;

      // ── 4. Process each project ───────────────────────────────────────────────
      for (let pi = 0; pi < allProjects.length; pi++) {
        const project = allProjects[pi];

        setProgress({ phase: `Loading entries — ${project.name}`, current: pi, total: allProjects.length });

        // Fetch entries for this project
        const { data: entries } = await client
          .from('entries')
          .select('*')
          .eq('project_id', project.id)
          .is('archived_at', null)
          .order('created_at', { ascending: true });

        const projectEntries = (entries ?? []) as FieldEntry[];
        const uploaded = projectEntries.filter(
          (e) => e.upload_status === 'uploaded' || !e.upload_status
        );

        totalPhotos += uploaded.length;

        // Get storage paths (full path including user_id subfolder, e.g. "uid/filename.jpg")
        // photo_url in DB stores the full storage path used when uploading
        const storagePaths = uploaded.map((e) => storagePath(e.photo_url, e.media_type));

        // Create signed URLs in batch
        const signedMap: Record<string, string> = {};
        if (storagePaths.length > 0) {
          const { data: signed } = await client.storage
            .from('photos')
            .createSignedUrls(storagePaths, SIGNED_EXPIRES);
          (signed ?? []).forEach((s, i) => {
            if (s.signedUrl) signedMap[storagePaths[i]] = s.signedUrl;
          });
        }

        // CSV rows for this project
        const csvRows = [
          'entry_id,category,country,description,latitude,longitude,altitude,media_type,filename,created_at',
        ];

        for (let ei = 0; ei < projectEntries.length; ei++) {
          const e = projectEntries[ei];
          const path = storagePath(e.photo_url, e.media_type);
          const basename = path.split('/').pop() ?? path;   // just the filename part
          const signedUrl = signedMap[path];

          setProgress({
            phase: `Saving photos — ${project.name} (${ei + 1}/${projectEntries.length})`,
            current: savedPhotos,
            total: totalPhotos,
          });

          // Download and save to Gallery
          if (signedUrl) {
            try {
              const tmpPath = `${FileSystem.cacheDirectory}recon_tmp_${basename}`;
              await FileSystem.downloadAsync(signedUrl, tmpPath);
              // Save to phone Gallery in "Recon Export" album
              const asset = await MediaLibrary.createAssetAsync(tmpPath);
              await MediaLibrary.createAlbumAsync(ALBUM_NAME, asset, false);
              // Clean up temp file
              await FileSystem.deleteAsync(tmpPath, { idempotent: true });
              savedPhotos++;
            } catch {
              /* skip failed individual downloads — continue with rest */
            }
          }

          const csvLine = [
            e.id,
            csvEscape(e.category),
            csvEscape(e.country),
            csvEscape(e.description),
            e.latitude ?? '',
            e.longitude ?? '',
            e.altitude ?? '',
            e.media_type,
            basename,
            e.created_at,
          ].join(',');

          csvRows.push(csvLine);
          summaryRows.push(`${csvEscape(project.name)},${csvLine}`);
        }

        // Write per-project CSV
        const safeName = project.name.replace(/[^a-z0-9_\- ]/gi, '_').trim();
        await FileSystem.writeAsStringAsync(
          `${exportRoot}${safeName}_entries.csv`,
          csvRows.join('\n'),
        );
      }

      // ── 5. Write summary CSV ──────────────────────────────────────────────────
      setProgress({ phase: 'Writing CSV…', current: totalPhotos, total: totalPhotos });
      const summaryPath = `${exportRoot}export_summary.csv`;
      await FileSystem.writeAsStringAsync(summaryPath, summaryRows.join('\n'));

      setResult({ csvPath: summaryPath, photosTotal: totalPhotos, photosSaved: savedPhotos });
      setProgress(null);

    } catch (e: any) {
      setError(e?.message ?? 'Export failed');
      setProgress(null);
    } finally {
      setRunning(false);
    }
  };

  const shareCSV = async () => {
    if (!result) return;
    try {
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(result.csvPath, {
          mimeType: 'text/csv',
          dialogTitle: 'Save or share your Recon CSV',
        });
      }
    } catch (e: any) {
      Alert.alert('Share error', e?.message);
    }
  };

  const pct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Export All Data</Text>
      <Text style={styles.subtitle}>
        Downloads all photos and videos to your phone's Gallery and exports metadata as CSV.
      </Text>

      {/* How it works */}
      <View style={styles.stepsCard}>
        <Text style={styles.stepsTitle}>How it works</Text>
        {[
          { icon: '☁️', text: 'Photos & videos saved to Gallery → "Recon Export" album' },
          { icon: '📋', text: 'Metadata (GPS, category, description) exported as CSV' },
          { icon: '🔌', text: 'Connect phone via USB → copy Gallery photos to computer' },
          { icon: '💾', text: 'Or share the CSV directly to email, Drive, etc.' },
        ].map((s, i) => (
          <View key={i} style={styles.step}>
            <Text style={styles.stepIcon}>{s.icon}</Text>
            <Text style={styles.stepText}>{s.text}</Text>
          </View>
        ))}
      </View>

      {/* Progress */}
      {running && progress && (
        <View style={styles.progressCard}>
          <Text style={styles.progressPhase}>{progress.phase}</Text>
          {pct !== null && (
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${pct}%` as any }]} />
            </View>
          )}
          {pct !== null && (
            <Text style={styles.progressPct}>{pct}% — {progress.current} of {progress.total} photos</Text>
          )}
        </View>
      )}

      {/* Error */}
      {!!error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>⚠ {error}</Text>
        </View>
      )}

      {/* Done */}
      {result && (
        <View style={styles.doneCard}>
          <Text style={styles.doneIcon}>✅</Text>
          <Text style={styles.doneTitle}>Export complete!</Text>

          <View style={styles.doneRow}>
            <Text style={styles.doneRowIcon}>📸</Text>
            <Text style={styles.doneRowText}>
              {result.photosSaved} of {result.photosTotal} photos/videos saved to your Gallery
              {'\n'}<Text style={styles.doneHint}>Open Photos app → Albums → "{ALBUM_NAME}"</Text>
            </Text>
          </View>

          <View style={styles.doneRow}>
            <Text style={styles.doneRowIcon}>📋</Text>
            <Text style={styles.doneRowText}>
              CSV metadata file ready to share
              {'\n'}<Text style={styles.doneHint}>Includes GPS, category, description for every entry</Text>
            </Text>
          </View>

          <TouchableOpacity style={styles.shareBtn} onPress={shareCSV}>
            <Text style={styles.shareBtnText}>Share CSV File</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Export button */}
      {!running && (
        <TouchableOpacity style={styles.exportBtn} onPress={run}>
          <Text style={styles.exportBtnText}>{result ? '↺ Export Again' : '⬇ Start Export'}</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.note}>
        💡 To transfer photos to your computer via USB:{'\n'}
        Connect phone → swipe down notification bar → tap "USB" → select "File Transfer" → open DCIM/Pictures on your computer.
      </Text>
    </ScrollView>
  );
}

/** Returns the full storage path as stored in DB (e.g. "uid/filename.jpg").
 *  Strips query string if a signed URL was stored by mistake. */
function storagePath(urlOrFilename: string, mediaType: 'photo' | 'video' = 'photo'): string {
  const ext = mediaType === 'video' ? 'mp4' : 'jpg';
  // Keep slashes (user_id subdirectory), strip query string only
  const match = urlOrFilename.match(new RegExp(`([^?]+\\.${ext})`));
  return match ? match[1] : urlOrFilename;
}

function csvEscape(val: string): string {
  if (!val) return '';
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '800', color: '#111', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888', lineHeight: 20, marginBottom: 24 },

  stepsCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 24,
    borderWidth: 1, borderColor: '#E2E8F0',
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  stepsTitle: { fontSize: 13, fontWeight: '700', color: '#1a3a2a', marginBottom: 14 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  stepIcon: { fontSize: 20, width: 28 },
  stepText: { fontSize: 13, color: '#555', flex: 1, lineHeight: 18 },

  progressCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 20,
    borderWidth: 1, borderColor: '#BFDBFE',
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  progressPhase: { fontSize: 14, color: '#2563EB', fontWeight: '600', marginBottom: 12 },
  progressBarBg: { height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  progressBarFill: { height: 6, backgroundColor: '#2563EB', borderRadius: 3 },
  progressPct: { fontSize: 12, color: '#888', textAlign: 'right' },

  errorCard: {
    backgroundColor: '#FEF2F2', borderRadius: 12, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: '#FECACA',
  },
  errorText: { color: '#DC2626', fontSize: 13 },

  doneCard: {
    backgroundColor: '#F0FDF4', borderRadius: 14, padding: 20, marginBottom: 20,
    borderWidth: 1, borderColor: '#BBF7D0', alignItems: 'center',
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  doneIcon: { fontSize: 40, marginBottom: 8 },
  doneTitle: { fontSize: 18, fontWeight: '700', color: '#16A34A', marginBottom: 16 },
  doneRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14, alignSelf: 'stretch' },
  doneRowIcon: { fontSize: 22 },
  doneRowText: { flex: 1, fontSize: 13, color: '#333', lineHeight: 18 },
  doneHint: { fontSize: 11, color: '#16A34A', fontWeight: '600' },
  shareBtn: {
    backgroundColor: '#16A34A', borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 28, marginTop: 4,
  },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  exportBtn: {
    backgroundColor: '#1a3a2a', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 20,
  },
  exportBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  note: {
    fontSize: 12, color: '#94a3b8', lineHeight: 18, textAlign: 'center',
  },
});
