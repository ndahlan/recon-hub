import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { hubSupabase } from '../lib/hubSupabase';
import { getProfile, saveProfile } from '../db/database';
import { UserProfile, AppStackParamList } from '../types';

type Nav = StackNavigationProp<AppStackParamList, 'Profile'>;

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const [profile, setProfile] = useState<UserProfile>({ name: '', phone: '', email: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const init = async () => {
      const p = await getProfile();
      setProfile(p);
      setLoading(false);
    };
    init();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveProfile(profile);
      Alert.alert('Saved', 'Profile updated.');
    } catch { Alert.alert('Error', 'Could not save profile.'); }
    finally { setSaving(false); }
  };

  const signOut = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => { await hubSupabase.auth.signOut(); } },
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#1a3a2a" /></View>;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={88}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>

        {/* Signed in as */}
        <View style={styles.emailRow}>
          <Text style={styles.emailLabel}>Signed in as</Text>
          <Text style={styles.emailValue}>{profile.email}</Text>
        </View>

        {/* Profile fields */}
        <View style={styles.fieldWrapper}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input} value={profile.name}
            onChangeText={(v) => setProfile((p) => ({ ...p, name: v }))}
            placeholder="Dr. Nurdin Dahlan" placeholderTextColor="#aaa"
          />
        </View>
        <View style={styles.fieldWrapper}>
          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input} value={profile.phone}
            onChangeText={(v) => setProfile((p) => ({ ...p, phone: v }))}
            placeholder="+65 9123 4567" placeholderTextColor="#aaa" keyboardType="phone-pad"
          />
        </View>

        <TouchableOpacity style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Profile</Text>}
        </TouchableOpacity>

        {/* Database card */}
        <View style={styles.dbCard}>
          <Text style={styles.dbCardTitle}>🗄️ Data Storage</Text>
          <View style={styles.credentialsBox}>
            <Text style={styles.credentialsNote}>
              Your photos and field entries are stored securely in the cloud. Only the project administrator can access the raw database via the Supabase dashboard.
            </Text>
          </View>
        </View>

        {/* Export */}
        <TouchableOpacity style={styles.exportCard} onPress={() => navigation.navigate('Export' as any)}>
          <Text style={styles.exportCardIcon}>⬇️</Text>
          <View style={styles.exportCardText}>
            <Text style={styles.exportCardTitle}>Export to Computer</Text>
            <Text style={styles.exportCardSub}>Download all photos + metadata, then transfer via USB cable</Text>
          </View>
          <Text style={styles.exportCardArrow}>›</Text>
        </TouchableOpacity>

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emailRow: { backgroundColor: '#1a3a2a12', borderRadius: 12, padding: 14, marginBottom: 24 },
  emailLabel: { fontSize: 11, color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  emailValue: { fontSize: 15, color: '#1a3a2a', fontWeight: '700', marginTop: 2 },
  fieldWrapper: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 13, fontSize: 15, color: '#222', borderWidth: 1, borderColor: '#E2E8F0' },
  saveBtn: { backgroundColor: '#1a3a2a', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8, marginBottom: 24 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnDisabled: { backgroundColor: '#6B9E8A' },
  dbCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E2E8F0', elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  dbCardTitle: { fontSize: 13, fontWeight: '700', color: '#1a3a2a', marginBottom: 6 },
  dbUrl: { fontSize: 11, color: '#888', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 12 },
  dashboardBtn: { backgroundColor: '#EFF6FF', borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#BFDBFE' },
  dashboardBtnText: { color: '#2563EB', fontWeight: '700', fontSize: 14 },
  credentialsBox: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  credentialsTitle: { fontSize: 11, fontWeight: '700', color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  credentialsLine: { fontSize: 13, color: '#555', marginBottom: 4 },
  credentialsValue: { color: '#1a3a2a', fontWeight: '600' },
  credentialsNote: { fontSize: 11, color: '#94a3b8', lineHeight: 16, marginTop: 4 },
  exportCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#E2E8F0', elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  exportCardIcon: { fontSize: 28 },
  exportCardText: { flex: 1 },
  exportCardTitle: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 2 },
  exportCardSub: { fontSize: 12, color: '#888', lineHeight: 16 },
  exportCardArrow: { fontSize: 24, color: '#1a3a2a' },
  signOutBtn: { borderRadius: 12, paddingVertical: 15, alignItems: 'center', backgroundColor: '#FEE2E2' },
  signOutText: { color: '#DC2626', fontSize: 16, fontWeight: '700' },
});
