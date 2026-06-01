import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, RefreshControl,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { getEntries, archiveEntry } from '../db/database';
import { subscribeToUploads } from '../hooks/useUploadQueue';
import { useIsOnline } from '../hooks/useIsOnline';
import UploadStatusBadge from '../components/UploadStatusBadge';
import { FieldEntry, CATEGORIES, AppStackParamList } from '../types';

type Nav = StackNavigationProp<AppStackParamList, 'Gallery'>;
type Route = RouteProp<AppStackParamList, 'Gallery'>;

const CATEGORY_COLORS: Record<string, string> = {
  GNSS: '#2563EB', Volcano: '#DC2626', 'Sea Level': '#0891B2',
  Coral: '#F59E0B', Biodiversity: '#16A34A', Climate: '#7C3AED', Other: '#6B7280',
};

export default function GalleryScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { project } = params;
  const [entries, setEntries] = useState<FieldEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const isOnline = useIsOnline();
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');

  const load = useCallback(async () => {
    const data = await getEntries(project.id);
    setEntries(data);
    setLoading(false);
  }, [project.id]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
    const unsub = subscribeToUploads(load);
    return unsub;
  }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const confirmRemove = (entry: FieldEntry) => {
    Alert.alert('Remove from Device', '☁️ Your data stays safely in the cloud.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await archiveEntry(entry.id); await load(); } },
    ]);
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const filtered = activeCategory === 'All' ? entries : entries.filter((e) => e.category === activeCategory);

  const renderItem = ({ item }: { item: FieldEntry }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('ViewEntry', { entry: item, project })}
      onLongPress={() => confirmRemove(item)}
      activeOpacity={0.85}
    >
      {/* Media thumbnail */}
      {item.upload_status === 'uploaded' && item.media_type === 'video' ? (
        <View style={styles.videoThumb}><Text style={styles.videoIcon}>▶</Text></View>
      ) : item.upload_status === 'uploaded' ? (
        <Image source={{ uri: item.photo_url }} style={styles.thumb} />
      ) : (
        <View style={styles.thumbPending}>
          {item.local_uri
            ? <Image source={{ uri: item.local_uri }} style={styles.thumb} />
            : <Text style={styles.thumbIcon}>📷</Text>}
        </View>
      )}

      {/* Upload status badge or offline-only badge */}
      <View style={styles.statusBadgePos}>
        {item.is_local_only
          ? <View style={styles.localBadge}><Text style={styles.localBadgeText}>⏳</Text></View>
          : <UploadStatusBadge status={item.upload_status ?? 'pending'} size={24} />}
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <View style={[styles.badge, { backgroundColor: CATEGORY_COLORS[item.category] ?? '#6B7280' }]}>
            <Text style={styles.badgeText}>{item.category}</Text>
          </View>
          {item.country ? <Text style={styles.country}>{item.country}</Text> : null}
          {item.media_type === 'video' && <Text style={styles.videoTag}>📹</Text>}
        </View>
        <Text style={styles.date}>{formatDate(item.created_at)}</Text>
        <Text style={styles.desc} numberOfLines={2}>
          {item.description || <Text style={styles.noDesc}>No description</Text>}
        </Text>
        {item.latitude != null && (
          <Text style={styles.gps}>📍 {item.latitude.toFixed(5)}, {item.longitude?.toFixed(5)}</Text>
        )}
        {item.uploaded_by ? (
          <Text style={styles.uploader}>👤 {item.uploaded_by}</Text>
        ) : null}
        {item.upload_status === 'failed' && (
          <Text style={styles.failedText}>⚠ Upload failed — will retry</Text>
        )}
      </View>
    </TouchableOpacity>
  );

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#1a3a2a" /></View>;

  return (
    <View style={styles.container}>
      {/* Offline banner */}
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>📡 Offline — showing cached data</Text>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filterContent}>
        {['All', ...CATEGORIES].map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.chip, activeCategory === cat && { backgroundColor: CATEGORY_COLORS[cat] ?? '#1a3a2a', borderColor: 'transparent' }]}
            onPress={() => setActiveCategory(cat)}
          >
            <Text style={[styles.chipText, activeCategory === cat && styles.chipTextActive]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📷</Text>
          <Text style={styles.emptyText}>No entries yet</Text>
          <Text style={styles.emptyHint}>Tap + to log your first record</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(e) => e.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}

      <View style={styles.fabContainer}>
        <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('AddEntry', { project })}>
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  offlineBanner: { backgroundColor: '#FEF3C7', paddingVertical: 7, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#FDE68A' },
  offlineText: { fontSize: 12, color: '#92400E', fontWeight: '600', textAlign: 'center' },
  localBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' },
  localBadgeText: { fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filterBar: { maxHeight: 52, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  filterContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#fff' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#555' },
  chipTextActive: { color: '#fff' },
  list: { padding: 12, paddingBottom: 88 },
  card: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, marginBottom: 12,
    overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  thumb: { width: 100, height: 110 },
  thumbPending: { width: 100, height: 110, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  thumbIcon: { fontSize: 32 },
  videoThumb: { width: 100, height: 110, backgroundColor: '#1a3a2a', alignItems: 'center', justifyContent: 'center' },
  videoIcon: { fontSize: 32, color: '#fff' },
  statusBadgePos: { position: 'absolute', top: 6, left: 6 },
  cardBody: { flex: 1, padding: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  country: { fontSize: 11, color: '#888' },
  videoTag: { fontSize: 12 },
  date: { fontSize: 11, color: '#999', marginBottom: 3 },
  desc: { fontSize: 13, color: '#333', lineHeight: 18 },
  noDesc: { color: '#bbb', fontStyle: 'italic' },
  gps: { fontSize: 10, color: '#94a3b8', marginTop: 4 },
  uploader: { fontSize: 10, color: '#1a3a2a', fontWeight: '600', marginTop: 3 },
  failedText: { fontSize: 11, color: '#DC2626', marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  emptyIcon: { fontSize: 56, marginBottom: 12 },
  emptyText: { fontSize: 20, fontWeight: '600', color: '#333' },
  emptyHint: { fontSize: 14, color: '#999', marginTop: 6 },
  fabContainer: {
    position: 'absolute', bottom: 100, left: 0, right: 0, alignItems: 'center',
  },
  fab: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#1a3a2a', alignItems: 'center', justifyContent: 'center',
    elevation: 5, shadowColor: '#1a3a2a', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  fabText: { color: '#fff', fontSize: 32, lineHeight: 36 },
});
