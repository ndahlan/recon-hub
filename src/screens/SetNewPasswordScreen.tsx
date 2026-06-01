import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { hubSupabase } from '../lib/hubSupabase';

interface Props {
  onPasswordSet: () => void;
}

export default function SetNewPasswordScreen({ onPasswordSet }: Props) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!password || !confirmPassword) {
      Alert.alert('Missing fields', 'Please fill in both fields.'); return;
    }
    if (password.length < 8) {
      Alert.alert('Weak password', 'Use at least 8 characters.'); return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Both fields must be identical.'); return;
    }
    setLoading(true);
    try {
      const { error } = await hubSupabase.auth.updateUser({ password });
      if (error) throw error;
      Alert.alert('Password updated', 'Your password has been changed. Please sign in again.', [
        { text: 'OK', onPress: () => {
          hubSupabase.auth.signOut();
          onPasswordSet();
        }},
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not update password. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>🔐</Text>
          <Text style={styles.title}>Set New Password</Text>
          <Text style={styles.subtitle}>Choose a strong password for your account</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>New Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Min. 8 characters"
              placeholderTextColor="#aaa"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoFocus
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
              <Text style={styles.eyeText}>{showPassword ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Confirm New Password</Text>
          <View style={[
            styles.passwordRow,
            confirmPassword.length > 0 && password !== confirmPassword && styles.passwordRowError,
          ]}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Re-enter your password"
              placeholderTextColor="#aaa"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showConfirm}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirm((v) => !v)}>
              <Text style={styles.eyeText}>{showConfirm ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>
          {confirmPassword.length > 0 && password !== confirmPassword && (
            <Text style={styles.errorHint}>Passwords do not match</Text>
          )}

          <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={save} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Save New Password</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 36 },
  logo: { fontSize: 52, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#1a3a2a', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#888', marginTop: 4, textAlign: 'center' },
  form: {},
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6, marginTop: 14 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  passwordRowError: { borderColor: '#DC2626', marginBottom: 2 },
  passwordInput: { flex: 1, padding: 13, fontSize: 15, color: '#222' },
  eyeBtn: { paddingHorizontal: 14, paddingVertical: 13 },
  eyeText: { fontSize: 18 },
  errorHint: { fontSize: 12, color: '#DC2626', marginTop: 4, marginBottom: 8 },
  btn: { backgroundColor: '#1a3a2a', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  btnDisabled: { backgroundColor: '#6B9E8A' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
