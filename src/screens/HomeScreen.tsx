import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl,
  StyleSheet, Text, TouchableOpacity, View,
  ToastAndroid, Platform,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { hubSupabase } from '../lib/hubSupabase';
import { getProjects, deleteProject, leaveProject, acceptPendingInvitations } from '../db/database';
import { useUploadQueue } from '../hooks/useUploadQueue';
import { useIsOnline } from '../hooks/useIsOnline';
import { getPendingCount } from '../db/localDb';
import { Project, AppStackParamList } from '../types';

const BUILD_DATE = 'v4.2.2'; // bump this with each new APK build
function buildStamp(): string {
  if (__DEV__) return 'Dev build';
  return `Build ${BUILD_DATE}`;
}

type Nav = StackNavigationProp<AppStackParamList, 'Home'>;
type Tab = 'yours' | 'all';

const PROJECT_COLORS = ['#1a3a2a', '#2563EB', '#7C3AED', '#0891B2', '#DC2626', '#D97706', '#16A34A'];

function projectColor(id: string) {
  const sum = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return PROJECT_COLORS[sum % PROJECT_COLORS.length];
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('yours');
  const hasLoaded = useRef(false);
  const { pendingCount } = useUploadQueue();
  const isOnline = useIsOnline();
  const [offlinePending, setOfflinePending] = useState(0);

  useEffect(() => {
    getPendingCount().then(setOfflinePending);
  }, [projects]);

  useEffect(() => {
    hubSupabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      const name = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? '';
      setUserName(name);
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await getProjects();
      setProjects(data);
      setFetchError(null);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error('[HomeScreen] getProjects error:', msg);
      setFetchError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  /**
   * acceptAndLoad — accept pending memberships first, then load projects.
   * Order matters: project_members must be updated before the SELECT runs.
   */
  const acceptAndLoad = useCallback(async () => {
    let accepted = 0;
    try {
      const { data: { session } } = await hubSupabase.auth.getSession();
      if (session?.user?.email) {
        accepted = await acceptPendingInvitations(session.user.id, session.user.email);
      }
    } catch { /* non-critical */ }

    await load();

    if (accepted > 0) {
      const msg = `You've been added to ${accepted} shared project${accepted > 1 ? 's' : ''} 🎉`;
      if (Platform.OS === 'android') {
        ToastAndroid.show(msg, ToastAndroid.LONG);
      } else {
        Alert.alert('New Shared Project', msg);
      }
    }
  }, [load]);

  useFocusEffect(useCallback(() => {
    if (!hasLoaded.current) {
      setLoading(true);
      hasLoaded.current = true;
    }
    acceptAndLoad();
  }, [acceptAndLoad]));

  // ── Real-time: sync deletions instantly across devices ────────────────────
  useEffect(() => {
    const channel = hubSupabase
      .channel('home-project-changes')
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'projects' }, (payload) => {
        const deletedId = payload.old?.id;
        if (deletedId) setProjects((prev) => prev.filter((p) => p.id !== deletedId));
        else load();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'project_members' }, (payload) => {
        const deletedProjectId = payload.old?.project_id;
        if (deletedProjectId) setProjects((prev) => prev.filter((p) => p.id !== deletedProjectId));
        else load();
      })
      .subscribe();

    return () => { hubSupabase.removeChannel(channel); };
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); };

  const confirmDelete = (project: Project) => {
    if (!project.is_owner) return;
    Alert.alert('Delete Project', `Delete "${project.name}" and all its entries?\n\nThis cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteProject(project.id); await load(); } },
    ]);
  };

  const confirmLeave = (project: Project) => {
    Alert.alert(
      'Leave Project',
      `Remove "${project.name}" from your device?\n\nThe project and its data will remain for other members.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave', style: 'destructive',
          onPress: async () => {
            try {
              await leaveProject(project.id);
              setProjects((prev) => prev.filter((p) => p.id !== project.id));
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Could not leave project.');
            }
          },
        },
      ],
    );
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  // ── "Your Projects" card — clean, no clutter ──────────────────────────────
  const renderYoursCard = ({ item }: { item: Project }) => {
    const color = projectColor(item.id);
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Gallery', { project: item })}
        activeOpacity={0.85}
      >
        <View style={[styles.cardAccent, { backgroundColor: color }]} />
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
          </View>
          {item.description ? (
            <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
          ) : null}
          <View style={styles.cardFooter}>
            <Text style={styles.cardDate}>Created {formatDate(item.created_at)}</Text>
          </View>
        </View>
        <View style={[styles.cardArrow, { backgroundColor: color + '18' }]}>
          <Text style={[styles.arrowText, { color }]}>›</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // ── "All Projects" card — compact, single-row header with actions ──────────
  // Name is truncated; long-press it to reveal the full name in an alert.
  const renderAllCard = ({ item }: { item: Project }) => {
    const color = projectColor(item.id);
    return (
      <TouchableOpacity
        style={styles.compactCard}
        onPress={() => navigation.navigate('Gallery', { project: item })}
        activeOpacity={0.85}
      >
        <View style={[styles.cardAccent, { backgroundColor: color }]} />
        <View style={styles.compactBody}>
          {/* Single row: name + shared badge + action button */}
          <View style={styles.compactRow}>
            <Text
              style={styles.compactName}
              numberOfLines={1}
              onLongPress={() => Alert.alert('Project Name', item.name)}
              suppressHighlighting
            >
              {item.name}
            </Text>
            {!item.is_owner && (
              <View style={styles.sharedBadge}>
                <Text style={styles.sharedText}>Shared</Text>
              </View>
            )}
            {item.is_owner ? (
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => confirmDelete(item)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.deleteBtnText}>🗑</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.iconBtn, styles.leavePill]}
                onPress={() => confirmLeave(item)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.leaveBtnText}>✕ Leave</Text>
              </TouchableOpacity>
            )}
          </View>
          {/* Date row */}
          <Text style={styles.compactDate}>Created {formatDate(item.created_at)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderItem = (info: { item: Project }) =>
    activeTab === 'all' ? renderAllCard(info) : renderYoursCard(info);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a3a2a" />
      </View>
    );
  }

  const ownedCount  = projects.filter((p) => p.is_owner).length;
  const sharedCount = projects.filter((p) => !p.is_owner).length;

  return (
    <View style={styles.container}>

      {/* Offline banner */}
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            📡 No internet — showing cached data
            {offlinePending > 0 ? ` · ${offlinePending} entr${offlinePending === 1 ? 'y' : 'ies'} will sync when back online` : ''}
          </Text>
        </View>
      )}

      {/* Fetch error banner */}
      {fetchError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>⚠️ Could not load projects: {fetchError}</Text>
        </View>
      ) : null}

      {/* Hero header */}
      <View style={styles.hero}>
        <Text style={styles.greeting}>{greeting()} 👋</Text>
        {userName ? <Text style={styles.userName}>{userName}</Text> : null}
        <Text style={styles.heroSub}>
          {projects.length === 0
            ? 'Start by creating your first project'
            : `${ownedCount} owned · ${sharedCount} shared`}
        </Text>
        <View style={styles.badgeRow}>
          <View style={styles.buildBadge}>
            <Text style={styles.buildBadgeText}>🔄 {buildStamp()}</Text>
          </View>
          {pendingCount > 0 && (
            <View style={styles.uploadBadge}>
              <Text style={styles.uploadBadgeText}>☁ {pendingCount} uploading…</Text>
            </View>
          )}
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'yours' && styles.tabActive]}
          onPress={() => setActiveTab('yours')}
          activeOpacity={0.75}
        >
          <Text style={[styles.tabText, activeTab === 'yours' && styles.tabTextActive]}>
            Your Projects
          </Text>
          {activeTab === 'yours' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'all' && styles.tabActive]}
          onPress={() => setActiveTab('all')}
          activeOpacity={0.75}
        >
          <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>
            All Projects
          </Text>
          {activeTab === 'all' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
      </View>

      {/* Project list */}
      {projects.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🗺️</Text>
          <Text style={styles.emptyTitle}>No Projects Yet</Text>
          <Text style={styles.emptyHint}>Tap + to create your first fieldwork project</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('CreateProject')}>
            <Text style={styles.emptyBtnText}>+ Create Project</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            <Text style={styles.sectionLabel}>
              {activeTab === 'yours'
                ? `${projects.length} PROJECT${projects.length !== 1 ? 'S' : ''}`
                : `${projects.length} TOTAL · ${ownedCount} OWNED · ${sharedCount} SHARED`}
            </Text>
          }
          extraData={activeTab}
        />
      )}

      <View style={styles.fabContainer}>
        <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('CreateProject')}>
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  offlineBanner: { backgroundColor: '#FEF3C7', paddingVertical: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#FDE68A' },
  offlineText: { fontSize: 12, color: '#92400E', fontWeight: '600', textAlign: 'center' },
  errorBanner: { backgroundColor: '#FEE2E2', paddingVertical: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#FECACA' },
  errorText: { fontSize: 11, color: '#991B1B', fontWeight: '600', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F7FA' },

  // Hero
  hero: { backgroundColor: '#1a3a2a', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 },
  greeting: { fontSize: 22, fontWeight: '800', color: '#fff' },
  userName: { fontSize: 14, color: '#95d5b2', marginTop: 2, fontWeight: '500' },
  heroSub: { fontSize: 13, color: '#74c69d', marginTop: 6 },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  buildBadge: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  buildBadgeText: { fontSize: 10, color: '#95d5b2', fontWeight: '600' },
  uploadBadge: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  uploadBadgeText: { fontSize: 10, color: '#74c69d', fontWeight: '600' },

  // Tab bar
  tabBar: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
    elevation: 2, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 13, position: 'relative' },
  tabActive: {},
  tabText: { fontSize: 14, fontWeight: '600', color: '#94a3b8' },
  tabTextActive: { color: '#1a3a2a', fontWeight: '700' },
  tabUnderline: {
    position: 'absolute', bottom: 0, left: 20, right: 20, height: 3,
    backgroundColor: '#1a3a2a', borderRadius: 2,
  },

  // Section label
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: '#94a3b8',
    letterSpacing: 0.8, paddingHorizontal: 4, marginBottom: 10, marginTop: 4,
  },
  list: { padding: 16, paddingBottom: 100 },

  // ── "Your Projects" cards (full card with description + arrow) ─────────────
  card: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, marginBottom: 12,
    overflow: 'hidden', elevation: 2,
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  cardAccent: { width: 6 },
  cardBody: { flex: 1, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardName: { fontSize: 17, fontWeight: '700', color: '#111', flex: 1 },
  cardDesc: { fontSize: 13, color: '#666', lineHeight: 18, marginBottom: 6 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  cardDate: { fontSize: 11, color: '#aaa' },
  cardArrow: { width: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 28, fontWeight: '300' },

  // ── "All Projects" cards (compact, single-row header) ──────────────────────
  compactCard: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, marginBottom: 8,
    overflow: 'hidden', elevation: 1,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  compactBody: { flex: 1, paddingHorizontal: 12, paddingVertical: 10 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compactName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#111' },
  compactDate: { fontSize: 11, color: '#aaa', marginTop: 4 },

  // Shared badge (used in All Projects tab)
  sharedBadge: { backgroundColor: '#EFF6FF', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  sharedText: { fontSize: 10, color: '#2563EB', fontWeight: '600' },

  // Action buttons (used in All Projects tab)
  iconBtn: { paddingHorizontal: 6, paddingVertical: 3 },
  leavePill: { backgroundColor: '#FEF3C7', borderRadius: 6, paddingHorizontal: 8 },
  deleteBtnText: { fontSize: 15, color: '#DC2626' },
  leaveBtnText: { fontSize: 11, color: '#92400E', fontWeight: '600' },

  // Kept for potential future use (old full-card action buttons)
  deleteBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#FEE2E2' },
  leaveBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#FEF3C7' },

  // Empty state
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  emptyIcon: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: '#333' },
  emptyHint: { fontSize: 14, color: '#999', marginTop: 8, textAlign: 'center', paddingHorizontal: 40 },
  emptyBtn: { marginTop: 24, backgroundColor: '#1a3a2a', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // FAB
  fabContainer: { position: 'absolute', bottom: 100, left: 0, right: 0, alignItems: 'center' },
  fab: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#1a3a2a', alignItems: 'center', justifyContent: 'center',
    elevation: 5, shadowColor: '#1a3a2a', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  fabText: { color: '#fff', fontSize: 32, lineHeight: 36 },
});
