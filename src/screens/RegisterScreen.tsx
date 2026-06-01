import React, { useCallback, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { hubSupabase } from '../lib/hubSupabase';
import { AuthStackParamList } from '../types';

type Nav = StackNavigationProp<AuthStackParamList, 'Register'>;

// ── Alphanumeric CAPTCHA helpers ──────────────────────────────────────────────
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing 0/O/1/I
function generateCaptcha(len = 6): string {
  let result = '';
  for (let i = 0; i < len; i++) {
    result += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
  }
  return result;
}

export default function RegisterScreen() {
  const navigation = useNavigation<Nav>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  // CAPTCHA state
  const [captchaCode, setCaptchaCode] = useState(() => generateCaptcha());
  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaError, setCaptchaError] = useState(false);

  const refreshCaptcha = useCallback(() => {
    setCaptchaCode(generateCaptcha());
    setCaptchaInput('');
    setCaptchaError(false);
  }, []);

  const register = async () => {
    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      Alert.alert('Missing fields', 'Fill in all fields.'); return;
    }
    // Basic email format check
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      Alert.alert('Invalid Email', 'Please enter a valid email address (e.g. you@example.com).'); return;
    }
    // Common TLD typo check (.comn, .cmo, .ocm, etc.)
    const tld = email.trim().split('.').pop()?.toLowerCase() ?? '';
    const comTypos = ['comn', 'cmo', 'ocm', 'con', 'vom', 'cpm', 'comm', 'xom', 'cob', 'col'];
    if (comTypos.includes(tld)) {
      Alert.alert('Check your email', `".${tld}" doesn't look right — did you mean ".com"?`); return;
    }
    if (password.length < 8) {
      Alert.alert('Weak password', 'Use at least 8 characters.'); return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Please make sure both passwords are identical.'); return;
    }
    if (captchaInput.toUpperCase().trim() !== captchaCode) {
      setCaptchaError(true);
      refreshCaptcha();
      Alert.alert('CAPTCHA incorrect', 'Please retype the security code shown.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await hubSupabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { full_name: name.trim() },
          emailRedirectTo: 'https://bright-cendol-a9299f.netlify.app',
        },
      });
      if (error) throw error;

      if (!data.session) {
        // Email confirmation is required — show the "check your email" screen
        setAwaitingConfirmation(true);
      }
    } catch (e: any) {
      Alert.alert('Registration failed', e?.message ?? 'Please try again.');
      refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  // ── "Check your email" screen ─────────────────────────────────────────────
  if (awaitingConfirmation) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView style={styles.container} contentContainerStyle={[styles.content, { justifyContent: 'center' }]}>
          <View style={styles.header}>
            <Text style={styles.logo}>📧</Text>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.subtitle}>
              We sent a confirmation link to{'\n'}
              <Text style={{ color: '#1a3a2a', fontWeight: '700' }}>{email.trim().toLowerCase()}</Text>
            </Text>
          </View>
          <View style={styles.form}>
            <View style={styles.confirmBox}>
              <Text style={styles.confirmStep}>1️⃣  Open the email from Recon</Text>
              <Text style={styles.confirmStep}>2️⃣  Tap the <Text style={{ fontWeight: '700' }}>Confirm your account</Text> link</Text>
              <Text style={styles.confirmStep}>3️⃣  The app will open and log you in automatically</Text>
            </View>
            <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
              <Text style={styles.btnText}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Registration form ─────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>🔍</Text>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Your personal field database awaits</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput style={styles.input} placeholder="Jane Smith" placeholderTextColor="#aaa"
            value={name} onChangeText={setName} autoCapitalize="words" />

          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} placeholder="you@example.com" placeholderTextColor="#aaa"
            value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
            autoCorrect={false} />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Min. 8 characters"
              placeholderTextColor="#aaa"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
              <Text style={styles.eyeText}>{showPassword ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Confirm Password</Text>
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

          {/* ── CAPTCHA ─────────────────────────────────────────────────── */}
          <Text style={styles.label}>Security Code</Text>
          <Text style={styles.captchaHint}>Type the characters below to prove you're human</Text>
          <View style={styles.captchaBox}>
            {captchaCode.split('').map((ch, i) => (
              <Text key={i} style={[styles.captchaChar, { transform: [{ rotate: `${(i % 3 - 1) * 8}deg` }] }]}>
                {ch}
              </Text>
            ))}
            <TouchableOpacity style={styles.captchaRefresh} onPress={refreshCaptcha}>
              <Text style={styles.captchaRefreshText}>🔄</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.input, captchaError && styles.inputError]}
            placeholder="Type the code above"
            placeholderTextColor="#aaa"
            value={captchaInput}
            onChangeText={(t) => { setCaptchaInput(t); setCaptchaError(false); }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
          />
          {captchaError && <Text style={styles.errorHint}>Incorrect — a new code has been generated</Text>}

          <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={register} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Create Account</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.link} onPress={() => navigation.goBack()}>
            <Text style={styles.linkText}>Already have an account? <Text style={styles.linkBold}>Sign in →</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 28 },
  logo: { fontSize: 52, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#1a3a2a' },
  subtitle: { fontSize: 13, color: '#888', marginTop: 4, textAlign: 'center' },
  form: {},
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 13, fontSize: 15, color: '#222', borderWidth: 1, borderColor: '#E2E8F0' },
  inputError: { borderColor: '#DC2626' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  passwordRowError: { borderColor: '#DC2626', marginBottom: 2 },
  passwordInput: { flex: 1, padding: 13, fontSize: 15, color: '#222' },
  eyeBtn: { paddingHorizontal: 14, paddingVertical: 13 },
  eyeText: { fontSize: 18 },
  errorHint: { fontSize: 12, color: '#DC2626', marginTop: 4, marginBottom: 4 },

  // CAPTCHA
  captchaHint: { fontSize: 11, color: '#94a3b8', marginBottom: 8 },
  captchaBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1a3a2a', borderRadius: 12, paddingVertical: 14,
    paddingHorizontal: 16, gap: 6, marginBottom: 10,
  },
  captchaChar: {
    fontSize: 26, fontWeight: '900', color: '#fff',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    letterSpacing: 2,
    textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2,
  },
  captchaRefresh: { marginLeft: 10, padding: 4 },
  captchaRefreshText: { fontSize: 20 },

  // Confirmation screen
  confirmBox: {
    backgroundColor: '#F0FDF4', borderRadius: 12, padding: 20,
    borderWidth: 1, borderColor: '#BBF7D0', marginBottom: 24, gap: 12,
  },
  confirmStep: { fontSize: 14, color: '#166534', lineHeight: 22 },

  btn: { backgroundColor: '#1a3a2a', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  btnDisabled: { backgroundColor: '#6B9E8A' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#888', fontSize: 14 },
  linkBold: { color: '#1a3a2a', fontWeight: '700' },
});
