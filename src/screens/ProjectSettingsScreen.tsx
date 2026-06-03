import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { hubSupabase } from '../lib/hubSupabase';
import {
  getProjectMembers, inviteMember, removeMember,
  setMemberAdmin, updateProjectName,
} from '../db/database';
import { ProjectMember, AppStackParamList } from '../types';

type Route = RouteProp<AppStackParamList, 'ProjectSettings'>;

export default function ProjectSettingsScreen() {
  const { params } = useRoute<Route>();
  const { project } = params;
  const [members, setMembers]           = useState<ProjectMember[]>([]);
  const [email, setEmail]               = useState('');
  const [role, setRole]                 = useState<'editor' | 'viewer'>('editor');
  const [loading, setLoading]           = useState(true);
  const [inviting, setInviting]         = useState(false);
  const [editingName, setEditingName]   = useState(false);
  const [projectName, setProjectName]   = useState(project.name);
  const [savingName, setSavingName]     = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const canInvite = project.is_owner || project.is_admin;

  useEffect(() => {
    hubSupabase.auth.getSession().then(({ data }) => {
      setCurrentUserId(data.session?.user?.id ?? null);
    });
  }, []);

  const load = useCallback(async () => {
    const data = await getProjectMembers(project.id);
    setMembers(data);
    setLoading(false);
  }, [project.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saveProjectName = async () => {
    if (!projectName.trim()) { Alert.alert('Error', 'Project name cannot be empty.'); return; }
    setSavingName(true);
    try {
      await updateProjectName(project.id, projectName.trim());
      setEditingName(false);
      Alert.alert('Saved', 'Project name updated.');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not update project name.');
    } finally { setSavingName(false); }
  };

  const invite = async () => {
    if (!email.trim()) { Alert.alert('Error', 'Please enter an email address.'); return; }
    setInviting(true);
    try {
      await inviteMember(project, email.trim(), role);
      setEmail('');
      await load();
      Alert.alert('Invited', `${email.trim()} has been invited. They will see this project when they sign in.`);
    } catch (e: any) {
      Alert.alert('Error', e.message?.includes('unique') ? 'This email is already invited.' : e.message);
    } finally {
      setInviting(false);
    }
  };

  const confirmRemove = (member: ProjectMember) => {
    Alert.alert('Remove Member', `Remove ${member.invited_email} from this project?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await removeMember(member.id); await load(); } },
    ]);
  };

  const toggleAdmin = (member: ProjectMember) => {
    const action = member.is_admin ? 'Revoke admin' : 'Make admin';
    const detail = member.is_admin
      ? `${member.invited_email} will no longer be able to invite new members.`
      : `${member.invited_email} will be able to invite new members to this project.`;
    Alert.alert(action, detail, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action, onPress: async () => {
          try {
            await setMemberAdmin(member.id, !member.is_admin);
            await load();
          } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Could not update admin status.');
          }
        },
      },
    ]);
  };

  const renderMember = ({ item }: { item: ProjectMember }) => {
    const isSelf = item.user_id === currentUserId;
    return (
      <View style={styles.memberRow}>
        <View style={[styles.memberAvatar, item.is_admin && styles.memberAvatarAdmin]}>
          <Text style={styles.memberAvatarText}>{item.invited_email[0].toUpperCase()}</Text>
        </View>
        <View style={styles.memberInfo}>
          <View style={styles.memberNameRow}>
            <Text style={styles.memberEmail} numberOfLines={1}>{item.invited_email}</Text>
            {item.is_admin && (
              <View style={styles.adminBadge}>
                <Text style={styles.adminBadgeText}>👑 Admin</Text>
              </View>
            )}
          </View>
          <View style={styles.memberMeta}>
            <Text style={styles.memberRole}>{item.role}</Text>
            <View style={[styles.statusDot, { backgroundColor: item.accepted ? '#16A34A' : '#F59E0B' }]} />
            <Text style={styles.memberStatus}>{item.accepted ? 'Active' : 'Pending'}</Text>
            {isSelf && <Text style={styles.selfLabel}>(you)</Text>}
          </View>
        </View>

        {/* Owner controls: promote/demote + remove */}
        {project.is_owner && !isSelf && item.accepted && (
          <TouchableOpacity
            style={[styles.adminToggleBtn, item.is_admin && styles.adminToggleBtnActive]}
            onPress={() => toggleAdmin(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.adminToggleText, item.is_admin && styles.adminToggleTextActive]}>
              {item.is_admin ? '👑' : '☆'}
            </Text>
          </TouchableOpacity>
        )}
        {project.is_owner && (
          <TouchableOpacity
            onPress={() => confirmRemove(item)}
            style={styles.removeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.removeBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={88}>
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.content}
        data={members}
        keyExtractor={(m) => m.id}
        ListHeaderComponent={
          <View>
            {/* ── Project name ── */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Project</Text>
              {project.is_owner && editingName ? (
                <View>
                  <TextInput
                    style={styles.nameInput}
                    value={projectName}
                    onChangeText={setProjectName}
                    autoFocus maxLength={100}
                    placeholder="Project name" placeholderTextColor="#aaa"
                  />
                  <View style={styles.nameActions}>
                    <TouchableOpacity
                      style={[styles.nameSaveBtn, savingName && { opacity: 0.6 }]}
                      onPress={saveProjectName} disabled={savingName}
                    >
                      {savingName
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={styles.nameSaveBtnText}>Save</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.nameCancelBtn}
                      onPress={() => { setProjectName(project.name); setEditingName(false); }}
                    >
                      <Text style={styles.nameCancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.nameRow}>
                  <Text style={styles.projectName} numberOfLines={3}>{projectName}</Text>
                  {project.is_owner && (
                    <TouchableOpacity style={styles.editNameBtn} onPress={() => setEditingName(true)}>
                      <Text style={styles.editNameBtnText}>✏️ Edit</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* ── Invite section (owner OR admin) ── */}
            {canInvite && (
              <View style={styles.section}>
                <View style={styles.sectionTitleRow}>
                  <Text style={styles.sectionTitle}>Invite by Email</Text>
                  {project.is_admin && !project.is_owner && (
                    <View style={styles.adminNote}>
                      <Text style={styles.adminNoteText}>👑 Admin access</Text>
                    </View>
                  )}
                </View>
                <TextInput
                  style={styles.input} placeholder="colleague@email.com"
                  placeholderTextColor="#aaa" value={email} onChangeText={setEmail}
                  keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                />
                <View style={styles.pickerWrapper}>
                  <Picker selectedValue={role} onValueChange={(v) => setRole(v as any)} style={styles.picker}>
                    <Picker.Item label="Editor (can add entries)" value="editor" />
                    <Picker.Item label="Viewer (read only)" value="viewer" />
                  </Picker>
                </View>
                <TouchableOpacity
                  style={[styles.inviteBtn, (!email.trim() || inviting) && styles.btnDisabled]}
                  onPress={invite} disabled={!email.trim() || inviting}
                >
                  {inviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.inviteBtnText}>Send Invite</Text>}
                </TouchableOpacity>
              </View>
            )}

            {/* ── Admin legend (owner only) ── */}
            {project.is_owner && members.length > 0 && (
              <View style={styles.legendRow}>
                <Text style={styles.legendText}>
                  Tap <Text style={{ fontSize: 14 }}>☆</Text> to grant admin · <Text style={{ fontSize: 12 }}>👑</Text> to revoke
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>Members ({members.length})</Text>
          </View>
        }
        renderItem={renderMember}
        ListEmptyComponent={
          loading
            ? <ActivityIndicator color="#1a3a2a" style={{ marginTop: 20 }} />
            : <Text style={styles.empty}>No members yet.{canInvite ? ' Invite someone above.' : ''}</Text>
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 24 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  adminNote: { backgroundColor: '#FEF9C3', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 10 },
  adminNoteText: { fontSize: 11, color: '#854D0E', fontWeight: '600' },
  projectName: { fontSize: 20, fontWeight: '700', color: '#111', flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  nameInput: { backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 18, fontWeight: '700', color: '#111', borderWidth: 1, borderColor: '#2563EB', marginBottom: 8 },
  nameActions: { flexDirection: 'row', gap: 10 },
  nameSaveBtn: { flex: 1, backgroundColor: '#1a3a2a', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  nameSaveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  nameCancelBtn: { flex: 1, backgroundColor: '#F1F5F9', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  nameCancelBtnText: { color: '#555', fontWeight: '600', fontSize: 14 },
  editNameBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#EFF6FF', alignSelf: 'flex-start', marginTop: 2 },
  editNameBtnText: { fontSize: 12, color: '#2563EB', fontWeight: '600' },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 13, fontSize: 15, color: '#222', borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 10 },
  pickerWrapper: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 10, overflow: 'hidden' },
  picker: { height: 50, color: '#222' },
  inviteBtn: { backgroundColor: '#2563EB', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  btnDisabled: { backgroundColor: '#93C5FD' },
  inviteBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  legendRow: { backgroundColor: '#F0FDF4', borderRadius: 8, padding: 10, marginBottom: 12 },
  legendText: { fontSize: 12, color: '#166534', textAlign: 'center' },
  // Member row
  memberRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10 },
  memberAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a3a2a', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  memberAvatarAdmin: { backgroundColor: '#854D0E' },
  memberAvatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  memberInfo: { flex: 1, minWidth: 0 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  memberEmail: { fontSize: 14, fontWeight: '600', color: '#222', flexShrink: 1 },
  adminBadge: { backgroundColor: '#FEF9C3', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  adminBadgeText: { fontSize: 10, color: '#854D0E', fontWeight: '700' },
  memberMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  memberRole: { fontSize: 12, color: '#888', textTransform: 'capitalize' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  memberStatus: { fontSize: 12, color: '#888' },
  selfLabel: { fontSize: 11, color: '#16A34A', fontWeight: '600' },
  adminToggleBtn: { padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', marginRight: 4 },
  adminToggleBtnActive: { borderColor: '#854D0E', backgroundColor: '#FEF9C3' },
  adminToggleText: { fontSize: 16, color: '#94a3b8' },
  adminToggleTextActive: { color: '#854D0E' },
  removeBtn: { padding: 8 },
  removeBtnText: { color: '#DC2626', fontSize: 16, fontWeight: '700' },
  empty: { textAlign: 'center', color: '#aaa', fontSize: 14, marginTop: 10 },
});
