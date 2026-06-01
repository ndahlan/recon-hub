import React from 'react';
import {
  StyleSheet, Text, TouchableOpacity, View, StatusBar, Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AuthStackParamList } from '../types';

type Nav = StackNavigationProp<AuthStackParamList, 'Landing'>;

const { width } = Dimensions.get('window');

const FEATURES = [
  { icon: '📸', label: 'Capture', desc: 'Photos, videos & GPS location in the field' },
  { icon: '☁️', label: 'Sync',    desc: 'Auto-upload to secure cloud storage' },
  { icon: '👥', label: 'Collaborate', desc: 'Share projects with your team instantly' },
];

export default function LandingScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a3a2a" />

      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.logo}>🔍</Text>
        <Text style={styles.appName}>Recon</Text>
        <Text style={styles.tagline}>Field Intelligence Platform</Text>
        <Text style={styles.heroSub}>
          Capture, sync and share field reconnaissance data — anywhere in the world.
        </Text>
      </View>

      {/* Feature pills */}
      <View style={styles.featuresRow}>
        {FEATURES.map((f) => (
          <View key={f.label} style={styles.featureCard}>
            <Text style={styles.featureIcon}>{f.icon}</Text>
            <Text style={styles.featureLabel}>{f.label}</Text>
            <Text style={styles.featureDesc}>{f.desc}</Text>
          </View>
        ))}
      </View>

      {/* CTA buttons */}
      <View style={styles.ctaBlock}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate('Register')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Create Account →</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryBtnText}>Sign In</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footerNote}>
        Free to use · Data stays yours · Works offline
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3a2a',
    paddingHorizontal: 24,
    paddingBottom: 32,
    paddingTop: 0,
  },

  /* Hero */
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  logo: { fontSize: 72, marginBottom: 12 },
  appName: {
    fontSize: 48, fontWeight: '900', color: '#fff',
    letterSpacing: 2, marginBottom: 4,
  },
  tagline: {
    fontSize: 14, fontWeight: '600', color: '#74c69d',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16,
  },
  heroSub: {
    fontSize: 15, color: '#95d5b2', textAlign: 'center',
    lineHeight: 22, paddingHorizontal: 8,
  },

  /* Feature cards */
  featuresRow: {
    flexDirection: 'row', gap: 10, marginBottom: 32,
  },
  featureCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  featureIcon: { fontSize: 26, marginBottom: 6 },
  featureLabel: {
    fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 4,
  },
  featureDesc: {
    fontSize: 10, color: '#95d5b2', textAlign: 'center', lineHeight: 14,
  },

  /* CTAs */
  ctaBlock: { gap: 12, marginBottom: 20 },
  primaryBtn: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryBtnText: {
    color: '#1a3a2a', fontSize: 17, fontWeight: '800',
  },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  secondaryBtnText: {
    color: '#fff', fontSize: 16, fontWeight: '600',
  },

  footerNote: {
    textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 11,
  },
});
