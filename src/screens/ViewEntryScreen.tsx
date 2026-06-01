import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking,
  Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity,
  View, Dimensions,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useVideoPlayer, VideoView } from 'expo-video';
import { hubSupabase } from '../lib/hubSupabase';
import {
  archiveEntry, getEntryComments, addEntryComment, deleteEntryComment, getProjectMembers,
} from '../db/database';
import { AppStackParamList, EntryComment } from '../types';

type Route = RouteProp<AppStackParamList, 'ViewEntry'>;
type Nav   = StackNavigationProp<AppStackParamList, 'ViewEntry'>;

const CATEGORY_COLORS: Record<string, string> = {
  GNSS: '#2563EB', Volcano: '#DC2626', 'Sea Level': '#0891B2',
  Coral: '#F59E0B', Biodiversity: '#16A34A', Climate: '#7C3AED', Other: '#6B7280',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Member { email: string; name: string; }

// Highlight @mentions in comment text
function CommentBody({ text }: { text: string }) {
  const parts = text.split(/(@[\w.@+-]+)/g);
  return (
    <Text style={styles.commentText}>
      {parts.map((part, i) =>
        part.startsWith('@')
          ? <Text key={i} style={styles.mention}>{part}</Text>
          : <Text key={i}>{part}</Text>
      )}
    </Text>
  );
}

function VideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return (
    <VideoView player={player} style={{ width: SCREEN_WIDTH, height: 260 }} nativeControls contentFit="contain" />
  );
}

export default function ViewEntryScreen() {
  const { params }   = useRoute<Route>();
  const navigation   = useNavigation<Nav>();
  const { entry, project } = params;

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [comments, setComments]           = useState<EntryComment[]>([]);
  const [commentText, setCommentText]     = useState('');
  const [loadingComments, setLoadingComments] = useState(true);
  const [posting, setPosting]             = useState(false);
  const [members, setMembers]             = useState<Member[]>([]);
  const [suggestions, setSuggestions]     = useState<Member[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    hubSupabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      setCurrentUserId(user?.id ?? null);
    });

    // Build member list for @mention: owner + all invitees + current user
    (async () => {
      try {
        const { data } = await hubSupabase.auth.getSession();
        const user = data.session?.user;
        const selfEmail = user?.email ?? '';
        const selfName  = user?.user_metadata?.full_name ?? selfEmail.split('@')[0] ?? '';

        const seeds: Member[] = [];

        // 1. Project owner (carried on the project object — visible on all devices)
        if (project.owner_email) {
          seeds.push({ email: project.owner_email, name: project.owner_email.split('@')[0] });
        }

        // 2. All invitees (RLS now allows any member to read all rows)
        try {
          const rows = await getProjectMembers(project.id);
          for (const m of rows) {
            seeds.push({ email: m.invited_email, name: m.invited_email.split('@')[0] });
          }
        } catch { /* ignore */ }

        // 3. Current user (always include self)
        if (selfEmail) seeds.push({ email: selfEmail, name: selfName });

        const seen = new Set<string>();
        const merged: Member[] = [];
        for (const m of seeds) {
          if (m.email && !seen.has(m.email.toLowerCase())) {
            seen.add(m.email.toLowerCase());
            merged.push(m);
          }
        }
        setMembers(merged);
      } catch { /* ignore */ }
    })();
  }, [project.id]);

  // ── Load comments ─────────────────────────────────────────────────────────
  const loadComments = useCallback(async () => {
    try {
      const data = await getEntryComments(entry.id);
      setComments(data);
    } catch { /* table may not exist yet */ }
    finally { setLoadingComments(false); }
  }, [entry.id]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // ── Real-time subscription — new/deleted comments appear instantly ─────────
  useEffect(() => {
    const channel = hubSupabase
      .channel(`entry-comments-${entry.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'entry_comments', filter: `entry_id=eq.${entry.id}` },
        () => { loadComments(); },
      )
      .subscribe();

    return () => { hubSupabase.removeChannel(channel); };
  }, [entry.id, loadComments]);

  // ── @mention autocomplete ─────────────────────────────────────────────────
  const handleTextChange = (val: string) => {
    setCommentText(val);
    const words = val.split(/\s/);
    const last  = words[words.length - 1];
    if (last.startsWith('@')) {
      const query = last.slice(1).toLowerCase();
      setSuggestions(
        query === ''
          ? members
          : members.filter(
              (m) => m.email.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)
            )
      );
    } else {
      setSuggestions([]);
    }
  };

  const applySuggestion = (member: Member) => {
    const words = commentText.split(/\s/);
    words[words.length - 1] = '@' + member.email + ' ';
    setCommentText(words.join(' '));
    setSuggestions([]);
  };

  // ── Post comment ──────────────────────────────────────────────────────────
  const postComment = async () => {
    if (!commentText.trim()) return;
    setPosting(true);
    setSuggestions([]);
    try {
      await addEntryComment(entry.id, entry.project_id, commentText.trim());
      setCommentText('');
      await loadComments();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not post comment.');
    } finally {
      setPosting(false);
    }
  };

  const confirmDeleteComment = (c: EntryComment) => {
    Alert.alert('Delete Comment', 'Remove this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => { await deleteEntryComment(c.id); await loadComments(); },
      },
    ]);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const displayUri = entry.upload_status === 'uploaded'
    ? entry.photo_url
    : entry.local_uri ?? entry.photo_url;

  const formatDate  = (iso: string) => new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const formatShort = (iso: string) => new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const openMap = () => {
    if (entry.latitude == null) return;
    Linking.openURL(`https://maps.google.com/?q=${entry.latitude},${entry.longitude}`);
  };

  const confirmRemove = () => {
    Alert.alert('Remove from Device', '☁️ Your data stays safely in the cloud.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await archiveEntry(entry.id); navigation.navigate('Gallery', { project }); } },
    ]);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={88}>
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {entry.media_type === 'video'
          ? <VideoPlayer uri={displayUri} />
          : <Image source={{ uri: displayUri }} style={styles.photo} resizeMode="contain" />
        }

        <View style={styles.body}>
          <View style={styles.topRow}>
            <View style={[styles.badge, { backgroundColor: CATEGORY_COLORS[entry.category] ?? '#6B7280' }]}>
              <Text style={styles.badgeText}>{entry.category}</Text>
            </View>
            {entry.country ? <Text style={styles.country}>🌏 {entry.country}</Text> : null}
          </View>

          <Text style={styles.date}>{formatDate(entry.created_at)}</Text>

          {entry.latitude != null && (
            <TouchableOpacity style={styles.gpsRow} onPress={openMap}>
              <Text style={styles.gpsIcon}>📍</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.gpsCoords}>{entry.latitude.toFixed(6)}, {entry.longitude?.toFixed(6)}</Text>
                {entry.altitude != null && <Text style={styles.gpsAlt}>Altitude: {entry.altitude.toFixed(1)} m</Text>}
              </View>
              <Text style={styles.mapLink}>Open Map →</Text>
            </TouchableOpacity>
          )}

          {(entry as any).uploaded_by ? (
            <View style={styles.uploaderRow}>
              <Text style={styles.uploaderIcon}>👤</Text>
              <Text style={styles.uploaderText}>Uploaded by <Text style={styles.uploaderName}>{(entry as any).uploaded_by}</Text></Text>
            </View>
          ) : null}

          <Text style={styles.descLabel}>Description</Text>
          <Text style={styles.desc}>{entry.description || <Text style={styles.noDesc}>No description provided.</Text>}</Text>

          <View style={styles.actions}>
            {currentUserId === entry.user_id ? (
              <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('EditEntry', { entry, project })}>
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.viewOnlyBadge}>
                <Text style={styles.viewOnlyText}>🔒 View only</Text>
              </View>
            )}
            <TouchableOpacity style={styles.deleteBtn} onPress={confirmRemove}>
              <Text style={styles.deleteBtnText}>Remove from Device</Text>
            </TouchableOpacity>
          </View>

          {/* ── Comments ── */}
          <View style={styles.commentsSection}>
            <View style={styles.commentsHeaderRow}>
              <Text style={styles.commentsHeader}>💬 Comments</Text>
              <View style={styles.liveIndicator}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Live</Text>
              </View>
            </View>

            {loadingComments ? (
              <ActivityIndicator color="#1a3a2a" style={{ marginVertical: 12 }} />
            ) : comments.length === 0 ? (
              <Text style={styles.noComments}>No comments yet. Be the first to add one.</Text>
            ) : (
              comments.map((c) => (
                <View key={c.id} style={styles.commentCard}>
                  <View style={styles.commentHeader}>
                    <View style={styles.commentAvatar}>
                      <Text style={styles.commentAvatarText}>{(c.user_name || c.user_email || '?')[0].toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.commentAuthor}>{c.user_name || c.user_email}</Text>
                      <Text style={styles.commentDate}>{formatShort(c.created_at)}</Text>
                    </View>
                    {currentUserId === c.user_id && (
                      <TouchableOpacity onPress={() => confirmDeleteComment(c)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.commentDelete}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <CommentBody text={c.comment} />
                </View>
              ))
            )}

            {/* @mention suggestions — rendered inline above input */}
            {suggestions.length > 0 && (
              <View style={styles.suggestions}>
                <Text style={styles.suggestionsHeader}>👤 Tap to mention</Text>
                {suggestions.map((m) => (
                  <TouchableOpacity key={m.email} style={styles.suggestionItem} onPress={() => applySuggestion(m)}>
                    <View style={styles.suggestionAvatar}>
                      <Text style={styles.suggestionAvatarText}>{m.name[0].toUpperCase()}</Text>
                    </View>
                    <View>
                      <Text style={styles.suggestionName}>{m.name}</Text>
                      <Text style={styles.suggestionEmail}>{m.email}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Input */}
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                placeholder="Add a comment… type @ to mention"
                placeholderTextColor="#aaa"
                value={commentText}
                onChangeText={handleTextChange}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[styles.commentSendBtn, (!commentText.trim() || posting) && styles.commentSendBtnDisabled]}
                onPress={postComment}
                disabled={!commentText.trim() || posting}
              >
                {posting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.commentSendText}>Post</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { paddingBottom: 40 },
  photo: { width: '100%', height: 300, backgroundColor: '#111' },
  body: { padding: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  country: { fontSize: 14, color: '#555', fontWeight: '500' },
  date: { fontSize: 13, color: '#888', marginBottom: 14 },
  gpsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, marginBottom: 16 },
  gpsIcon: { fontSize: 18, marginRight: 10 },
  gpsCoords: { fontSize: 13, color: '#1e40af', fontWeight: '600' },
  gpsAlt: { fontSize: 12, color: '#555', marginTop: 2 },
  mapLink: { fontSize: 12, color: '#2563EB', fontWeight: '600' },
  uploaderRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  uploaderIcon: { fontSize: 14, marginRight: 6 },
  uploaderText: { fontSize: 12, color: '#555' },
  uploaderName: { fontWeight: '700', color: '#1a3a2a' },
  descLabel: { fontSize: 12, fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  desc: { fontSize: 16, color: '#222', lineHeight: 24 },
  noDesc: { color: '#bbb', fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 28, marginBottom: 28 },
  editBtn: { flex: 1, backgroundColor: '#1a3a2a', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  editBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  viewOnlyBadge: { flex: 1, backgroundColor: '#F1F5F9', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  viewOnlyText: { color: '#94a3b8', fontWeight: '600', fontSize: 14 },
  deleteBtn: { flex: 1, backgroundColor: '#FEE2E2', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  deleteBtnText: { color: '#DC2626', fontWeight: '700', fontSize: 14 },
  // Comments section
  commentsSection: { borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 20 },
  commentsHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  commentsHeader: { fontSize: 15, fontWeight: '700', color: '#1a3a2a', flex: 1 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F0FDF4', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#16A34A' },
  liveText: { fontSize: 11, color: '#16A34A', fontWeight: '700' },
  noComments: { fontSize: 13, color: '#aaa', fontStyle: 'italic', marginBottom: 16 },
  commentCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  commentHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1a3a2a', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  commentAvatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  commentAuthor: { fontSize: 13, fontWeight: '600', color: '#222' },
  commentDate: { fontSize: 11, color: '#999', marginTop: 1 },
  commentDelete: { color: '#DC2626', fontSize: 16, fontWeight: '700', paddingLeft: 8 },
  commentText: { fontSize: 14, color: '#333', lineHeight: 20 },
  mention: { color: '#2563EB', fontWeight: '600' },
  // @mention suggestions (inline, above input)
  suggestions: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 8, overflow: 'hidden' },
  suggestionsHeader: { fontSize: 11, fontWeight: '700', color: '#94a3b8', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, letterSpacing: 0.5 },
  suggestionItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  suggestionAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  suggestionAvatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  suggestionName: { fontSize: 13, fontWeight: '600', color: '#222' },
  suggestionEmail: { fontSize: 11, color: '#888', marginTop: 1 },
  // Input
  commentInputRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', marginTop: 4 },
  commentInput: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 11, fontSize: 14, color: '#222', borderWidth: 1, borderColor: '#E2E8F0', maxHeight: 100 },
  commentSendBtn: { backgroundColor: '#1a3a2a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11 },
  commentSendBtnDisabled: { backgroundColor: '#6B9E8A' },
  commentSendText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
