import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { hubSupabase } from '../lib/hubSupabase';
import { AuthStackParamList } from '../types';

type Nav = StackNavigationProp<AuthStackParamList, 'ForgotPassword'>;

export default function ForgotPasswordScreen() {
  const navigation = useNavigation<Nav>();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!email.trim()) { Alert.alert('Enter your email address.'); return; }
    setLoading(true);
    try {
      const { error } = await hubSupabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: 'recon://reset-password' },
      );
      if (error) throw error;
      setSent(true);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not send reset email. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView style={styles.container} contentContainerStyle={[styles.content, { justifyContent: 'center' }]}>
          <View style={styles.header}>
            <Text style={styles.logo}>📧</Text>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.subtitle}>
              We sent a password reset link to{'\n'}
              <Text style={styles.emailHighlight}>{email.trim().toLowerCase()}</Text>
            </Text>
          </View>
          <View style={styles.form}>
            <Text style={styles.infoText}>
              Tap the link in the email to open the app and set a new password.
              {'\n\n'}
              If you don't see it, check your spam folder.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Login')}>
              <Text style={styles.btnText}>Back to Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.resendLink} onPress={() => { setSent(false); }}>
              <Text style={styles.resendText}>Resend email</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>🔑</Text>
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>Enter your email and we'll send you a reset link</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor="#aaa"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoFocus
          />

          <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={send} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Send Reset Link</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.backLink} onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>← Back to Sign In</Text>
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
  subtitle: { fontSize: 13, color: '#888', marginTop: 4, textAlign: 'center', lineHeight: 18 },
  emailHighlight: { color: '#1a3a2a', fontWeight: '700' },
  form: {},
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6 },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 13, fontSize: 15, color: '#222', borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 16 },
  btn: { backgroundColor: '#1a3a2a', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  btnDisabled: { backgroundColor: '#6B9E8A' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  backLink: { marginTop: 20, alignItems: 'center' },
  backText: { color: '#888', fontSize: 14 },
  infoText: { color: '#555', fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  resendLink: { marginTop: 16, alignItems: 'center' },
  resendText: { color: '#1a3a2a', fontSize: 13, fontWeight: '600' },
});
