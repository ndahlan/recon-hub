/**
 * ProjectCommentsScreen — Project-level team discussion board.
 *
 * All members (owner + all invitees) can post.
 * Type @ to instantly see all project members; keep typing to filter.
 * Only the comment author sees their own delete button.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Platform, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hubSupabase } from '../lib/hubSupabase';
import { getProjectComments, addProjectComment, deleteProjectComment, getProjectMembers } from '../db/database';
import { AppStackParamList, ProjectComment } from '../types';

const SEEN_KEY = 'recon_comments_seen';

type Route = RouteProp<AppStackParamList, 'ProjectComments'>;

interface Member { email: string; name: string; }

function parseMentions(text: string): string[] {
  const matches = text.match(/@[\w.@+-]+/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1)))];
}

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

export default function ProjectCommentsScreen() {
  const { params } = useRoute<Route>();
  const { project } = params;
  const insets = useSafeAreaInsets();

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentEmail, setCurrentEmail] = useState<string>('');
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [suggestions, setSuggestions] = useState<Member[]>([]);
  const listRef = useRef<FlatList>(null);

  // ── Boot: load session + member list ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data } = await hubSupabase.auth.getSession();
      const user = data.session?.user;
      if (user) {
        setCurrentUserId(user.id);
        setCurrentEmail(user.email ?? '');
      }

      // Seed list with: project owner + all invitees from project_members
      const seeds: Member[] = [];

      // 1. Project owner (available on the project object for all devices)
      if (project.owner_email) {
        seeds.push({ email: project.owner_email, name: project.owner_email.split('@')[0] });
      }

      // 2. All invited members (project_members table — RLS now allows all members to read)
      try {
        const rows = await getProjectMembers(project.id);
        for (const m of rows) {
          seeds.push({ email: m.invited_email, name: m.invited_email.split('@')[0] });
        }
      } catch { /* ignore */ }

      // 3. Current user (ensures they always appear even before any data loads)
      const selfEmail = user?.email ?? '';
      const selfName = user?.user_metadata?.full_name ?? selfEmail.split('@')[0] ?? '';
      if (selfEmail) seeds.push({ email: selfEmail, name: selfName });

      // Deduplicate by email (case-insensitive)
      const seen = new Set<string>();
      const merged: Member[] = [];
      for (const m of seeds) {
        if (m.email && !seen.has(m.email.toLowerCase())) {
          seen.add(m.email.toLowerCase());
          merged.push(m);
        }
      }
      setAllMembers(merged);
    })();
  }, [project.id]);

  // ── Mark this project's comments as read on open ──────────────────────────
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(SEEN_KEY);
      const seenMap: Record<string, string> = raw ? JSON.parse(raw) : {};
      seenMap[project.id] = new Date().toISOString();
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seenMap));
    })();
  }, [project.id]);

  // ── Load comments ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const data = await getProjectComments(project.id);
      setComments(data);

      // Harvest author emails from existing comments to enrich the member list
      setAllMembers((prev) => {
        const seen = new Set(prev.map((m) => m.email.toLowerCase()));
        const extra: Member[] = [];
        for (const c of data) {
          if (c.user_email && !seen.has(c.user_email.toLowerCase())) {
            seen.add(c.user_email.toLowerCase());
            extra.push({ email: c.user_email, name: c.user_name || c.user_email.split('@')[0] });
          }
        }
        return extra.length > 0 ? [...prev, ...extra] : prev;
      });
    } catch { /* table may not exist yet */ }
    finally { setLoading(false); }
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  // ── Real-time subscription — comments appear instantly on all devices ──────
  useEffect(() => {
    const channel = hubSupabase
      .channel(`project-comments-${project.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_comments', filter: `project_id=eq.${project.id}` },
        () => { load(); },
      )
      .subscribe();

    return () => { hubSupabase.removeChannel(channel); };
  }, [project.id, load]);

  // ── @mention autocomplete ─────────────────────────────────────────────────
  const handleTextChange = (val: string) => {
    setText(val);
    const words = val.split(/\s/);
    const last = words[words.length - 1];
    if (last.startsWith('@')) {
      const query = last.slice(1).toLowerCase();
      // Show ALL members immediately when just '@'; filter as user keeps typing
      setSuggestions(
        query === ''
          ? allMembers
          : allMembers.filter(
              (m) =>
                m.email.toLowerCase().includes(query) ||
                m.name.toLowerCase().includes(query)
            )
      );
    } else {
      setSuggestions([]);
    }
  };

  const applySuggestion = (member: Member) => {
    const words = text.split(/\s/);
    words[words.length - 1] = '@' + member.email + ' ';
    setText(words.join(' '));
    setSuggestions([]);
  };

  // ── Post comment ──────────────────────────────────────────────────────────
  const post = async () => {
    if (!text.trim()) return;
    setPosting(true);
    setSuggestions([]);
    try {
      const mentions = parseMentions(text);
      await addProjectComment(project.id, text.trim(), mentions);
      setText('');
      await load();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      Alert.alert('Could not post', e.message ?? 'Unknown error');
    } finally {
      setPosting(false);
    }
  };

  const confirmDelete = (c: ProjectComment) => {
    Alert.alert('Delete Comment', 'Remove this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => { await deleteProjectComment(c.id); await load(); },
      },
    ]);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  // ── Render one comment bubble ─────────────────────────────────────────────
  const renderComment = ({ item }: { item: ProjectComment }) => {
    const isOwn = item.user_id === currentUserId;
    const initial = (item.user_name || item.user_email || '?')[0].toUpperCase();
    return (
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        <View style={styles.bubbleHeader}>
          <View style={[styles.avatar, isOwn && styles.avatarOwn]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bubbleAuthor}>
              {item.user_name || item.user_email}
              {isOwn ? <Text style={styles.youLabel}> (you)</Text> : null}
            </Text>
            <Text style={styles.bubbleDate}>{formatDate(item.created_at)}</Text>
          </View>
          {isOwn && (
            <TouchableOpacity
              onPress={() => confirmDelete(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.deleteIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <CommentBody text={item.comment} />
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={88}
    >
      <View style={styles.container}>

        {/* Project banner */}
        <View style={styles.projectBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.projectName} numberOfLines={1}>{project.name}</Text>
            <View style={styles.liveIndicator}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          </View>
          <Text style={styles.projectSub}>
            Team discussion · {comments.length} comment{comments.length !== 1 ? 's' : ''} · {allMembers.length} member{allMembers.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* Comment list */}
        {loading ? (
          <View style={styles.center}><ActivityIndicator color="#1a3a2a" size="large" /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={comments}
            keyExtractor={(c) => c.id}
            renderItem={renderComment}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>💬</Text>
                <Text style={styles.emptyText}>No discussion yet</Text>
                <Text style={styles.emptySub}>Start the conversation below</Text>
              </View>
            }
            onContentSizeChange={() =>
              comments.length > 0 && listRef.current?.scrollToEnd({ animated: false })
            }
          />
        )}

        {/* @mention suggestion dropdown */}
        {suggestions.length > 0 && (
          <View style={styles.suggestions}>
            <Text style={styles.suggestionsHeader}>👤 Tap to mention</Text>
            {suggestions.map((m) => (
              <TouchableOpacity
                key={m.email}
                style={styles.suggestionItem}
                onPress={() => applySuggestion(m)}
              >
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

        {/* Input bar — raised above the Android gesture/nav bar */}
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            style={styles.input}
            placeholder={`Comment as ${currentEmail || 'you'}… type @ to mention`}
            placeholderTextColor="#aaa"
            value={text}
            onChangeText={handleTextChange}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || posting) && styles.sendBtnDisabled]}
            onPress={post}
            disabled={!text.trim() || posting}
          >
            {posting
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.sendText}>Post</Text>}
          </TouchableOpacity>
        </View>

      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  projectBanner: { backgroundColor: '#1a3a2a', paddingHorizontal: 20, paddingVertical: 14 },
  projectName: { fontSize: 16, fontWeight: '800', color: '#fff', flex: 1 },
  projectSub: { fontSize: 12, color: '#74c69d', marginTop: 2 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, marginLeft: 8 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ade80' },
  liveText: { fontSize: 11, color: '#4ade80', fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingBottom: 8 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingBottom: 20 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 18, fontWeight: '700', color: '#333' },
  emptySub: { fontSize: 13, color: '#999', marginTop: 4 },
  // Comment bubbles
  bubble: {
    borderRadius: 12, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff',
  },
  bubbleOwn: { borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' },
  bubbleOther: {},
  bubbleHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#1a3a2a', alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  avatarOwn: { backgroundColor: '#16A34A' },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  bubbleAuthor: { fontSize: 13, fontWeight: '700', color: '#111' },
  youLabel: { fontSize: 12, fontWeight: '400', color: '#16A34A' },
  bubbleDate: { fontSize: 11, color: '#999', marginTop: 1 },
  deleteIcon: { color: '#DC2626', fontSize: 16, fontWeight: '700', paddingLeft: 8 },
  commentText: { fontSize: 14, color: '#333', lineHeight: 20 },
  mention: { color: '#2563EB', fontWeight: '600' },
  // Suggestions dropdown
  suggestions: {
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0',
    maxHeight: 220, elevation: 4,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: -2 },
  },
  suggestionsHeader: {
    fontSize: 11, fontWeight: '700', color: '#94a3b8',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, letterSpacing: 0.5,
  },
  suggestionItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  suggestionAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  suggestionAvatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  suggestionName: { fontSize: 13, fontWeight: '600', color: '#222' },
  suggestionEmail: { fontSize: 11, color: '#888', marginTop: 1 },
  // Input bar
  inputBar: {
    flexDirection: 'row', padding: 12, gap: 10,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0', alignItems: 'flex-end',
  },
  input: {
    flex: 1, backgroundColor: '#F8FAFC', borderRadius: 10,
    padding: 11, fontSize: 14, color: '#222',
    borderWidth: 1, borderColor: '#E2E8F0', maxHeight: 120,
  },
  sendBtn: { backgroundColor: '#1a3a2a', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 },
  sendBtnDisabled: { backgroundColor: '#6B9E8A' },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
