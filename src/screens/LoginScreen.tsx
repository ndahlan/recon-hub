import React, { useEffect, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { hubSupabase } from '../lib/hubSupabase';
import { AuthStackParamList } from '../types';

type Nav = StackNavigationProp<AuthStackParamList, 'Login'>;

const CRED_KEY = 'recon_saved_credentials';

interface SavedCreds { email: string; password: string; }

export default function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]   = useState(false);

  // Biometric state
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [savedCreds, setSavedCreds] = useState<SavedCreds | null>(null);
  const [biometricLabel, setBiometricLabel] = useState('Biometric Login');

  // ── Check biometric capability + saved credentials on mount ──────────────
  useEffect(() => {
    (async () => {
      try {
        const hasHardware  = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled   = await LocalAuthentication.isEnrolledAsync();
        const types        = await LocalAuthentication.supportedAuthenticationTypesAsync();

        if (hasHardware && isEnrolled) {
          const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
          setBiometricLabel(hasFace ? '😊 Sign in with Face ID' : '👆 Sign in with Fingerprint');
          setBiometricAvailable(true);
        }

        const raw = await SecureStore.getItemAsync(CRED_KEY);
        if (raw) {
          const creds: SavedCreds = JSON.parse(raw);
          setSavedCreds(creds);
          setEmail(creds.email); // pre-fill email for convenience
        }
      } catch { /* SecureStore may not be available in all environments */ }
    })();
  }, []);

  // ── Biometric login ───────────────────────────────────────────────────────
  const loginWithBiometric = async () => {
    if (!savedCreds) {
      Alert.alert('No saved credentials', 'Sign in with email and password first, then enable biometric login.');
      return;
    }
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Sign in to Recon',
        fallbackLabel: 'Use password',
        disableDeviceFallback: false,
      });
      if (result.success) {
        await doSignIn(savedCreds.email, savedCreds.password, false);
      }
    } catch (e: any) {
      Alert.alert('Biometric error', e.message ?? 'Could not authenticate.');
    }
  };

  // ── Core sign-in logic ────────────────────────────────────────────────────
  const doSignIn = async (loginEmail: string, loginPassword: string, offerSave: boolean) => {
    setLoading(true);
    try {
      const { error } = await hubSupabase.auth.signInWithPassword({
        email: loginEmail.trim().toLowerCase(),
        password: loginPassword,
      });
      if (error) throw error;

      // Offer to save credentials after a successful manual login
      if (offerSave) {
        Alert.alert(
          'Save login?',
          'Save your email and password so you can sign in with biometrics next time.',
          [
            {
              text: 'Save', onPress: async () => {
                try {
                  await SecureStore.setItemAsync(CRED_KEY, JSON.stringify({ email: loginEmail.trim().toLowerCase(), password: loginPassword }));
                } catch { /* ignore */ }
              },
            },
            { text: 'Not now', style: 'cancel' },
          ],
        );
      }
    } catch (e: any) {
      Alert.alert('Sign in failed', e?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const signIn = () => {
    if (!email.trim() || !password) { Alert.alert('Missing fields', 'Enter email and password.'); return; }
    doSignIn(email, password, true);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
          <Text style={styles.logo}>🔍</Text>
          <Text style={styles.title}>Recon</Text>
          <Text style={styles.subtitle}>Field Intelligence Platform</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input} placeholder="you@example.com" placeholderTextColor="#aaa"
            value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
            autoCorrect={false}
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              placeholder="••••••••"
              placeholderTextColor="#aaa"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
              <Text style={styles.eyeText}>{showPassword ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.forgotLink} onPress={() => navigation.navigate('ForgotPassword')}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={signIn} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign In</Text>}
          </TouchableOpacity>

          {/* ── Biometric button — only if hardware available + creds saved ── */}
          {biometricAvailable && savedCreds && (
            <TouchableOpacity style={styles.biometricBtn} onPress={loginWithBiometric} disabled={loading}>
              <Text style={styles.biometricText}>{biometricLabel}</Text>
            </TouchableOpacity>
          )}

          {/* Hint when biometrics available but no saved credentials yet */}
          {biometricAvailable && !savedCreds && (
            <Text style={styles.biometricHint}>
              💡 Sign in once to enable biometric login next time
            </Text>
          )}

          <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('Register')}>
            <Text style={styles.linkText}>No account? <Text style={styles.linkBold}>Create one →</Text></Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 52, marginBottom: 8 },
  title: { fontSize: 32, fontWeight: '800', color: '#1a3a2a', letterSpacing: 1 },
  subtitle: { fontSize: 13, color: '#888', marginTop: 4 },
  form: {},
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 13, fontSize: 15, color: '#222', borderWidth: 1, borderColor: '#E2E8F0' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  passwordInput: { flex: 1, padding: 13, fontSize: 15, color: '#222' },
  eyeBtn: { paddingHorizontal: 14, paddingVertical: 13 },
  eyeText: { fontSize: 18 },
  forgotLink: { alignSelf: 'flex-end', marginTop: 8, marginBottom: 8 },
  forgotText: { fontSize: 13, color: '#1a3a2a', fontWeight: '600' },
  btn: { backgroundColor: '#1a3a2a', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  btnDisabled: { backgroundColor: '#6B9E8A' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // Biometric
  biometricBtn: {
    marginTop: 12, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#1a3a2a', backgroundColor: '#fff',
  },
  biometricText: { color: '#1a3a2a', fontSize: 15, fontWeight: '700' },
  biometricHint: { textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 14, lineHeight: 18 },
  link: { marginTop: 24, alignItems: 'center' },
  linkText: { color: '#888', fontSize: 14 },
  linkBold: { color: '#1a3a2a', fontWeight: '700' },
});
