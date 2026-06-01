/**
 * ProvisioningScreen.tsx
 *
 * Shown once after sign-up while the Edge Function provisions the user's
 * personal Supabase project. Calls the recon-hub Edge Function which:
 *   1. Calls Supabase Management API to create a new project
 *   2. Applies the USER_DB_SCHEMA
 *   3. Returns { url, anon_key }
 *
 * ─── Edge Function to deploy on recon-hub ─────────────────────────────────────
 * File: supabase/functions/provision-user-db/index.ts
 *
 *   import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
 *   const MGMT_TOKEN = Deno.env.get('SUPABASE_MGMT_TOKEN')!
 *   const ORG_ID = Deno.env.get('SUPABASE_ORG_ID')!
 *
 *   serve(async (req) => {
 *     const { userId, email } = await req.json()
 *
 *     // 1. Create the Supabase project
 *     const res = await fetch('https://api.supabase.com/v1/projects', {
 *       method: 'POST',
 *       headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
 *       body: JSON.stringify({
 *         name: `recon-${userId.slice(0,8)}`,
 *         organization_id: ORG_ID,
 *         region: 'ap-southeast-1',
 *         db_pass: crypto.randomUUID(),
 *       })
 *     })
 *     const project = await res.json()
 *     const projectRef = project.id
 *
 *     // 2. Poll until project is ready (status === 'ACTIVE_HEALTHY')
 *     let ready = false
 *     for (let i = 0; i < 30; i++) {
 *       await new Promise(r => setTimeout(r, 4000))
 *       const s = await fetch(`https://api.supabase.com/v1/projects/${projectRef}`,
 *         { headers: { Authorization: `Bearer ${MGMT_TOKEN}` } })
 *       const status = (await s.json()).status
 *       if (status === 'ACTIVE_HEALTHY') { ready = true; break }
 *     }
 *     if (!ready) throw new Error('Project did not become ready in time')
 *
 *     // 3. Apply schema SQL
 *     await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
 *       method: 'POST',
 *       headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ query: SCHEMA_SQL })  // paste USER_DB_SCHEMA here
 *     })
 *
 *     // 4. Invite the user's email as a team member so they can log into
 *     //    supabase.com/dashboard with the SAME email and see their raw data
 *     await fetch(`https://api.supabase.com/v1/projects/${projectRef}/members`, {
 *       method: 'POST',
 *       headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ email, role: 'owner' })
 *     })
 *     // User will receive: "You've been invited to your Recon database on Supabase"
 *     // They accept → log into supabase.com with same email → see all their data
 *
 *     // 5. Return credentials to the app
 *     const apiKeys = await (await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`,
 *       { headers: { Authorization: `Bearer ${MGMT_TOKEN}` } })).json()
 *     const anonKey = apiKeys.find((k: any) => k.name === 'anon public')?.api_key
 *
 *     return new Response(JSON.stringify({
 *       url: `https://${projectRef}.supabase.co`,
 *       anon_key: anonKey,
 *     }))
 *   })
 *
 * Set env vars on recon-hub:
 *   SUPABASE_MGMT_TOKEN = your personal access token from supabase.com/dashboard/account/tokens
 *   SUPABASE_ORG_ID     = your org ID from supabase.com/dashboard/org (Settings → General)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { hubSupabase } from '../lib/hubSupabase';
import { savePersonalConfig, setPersonalClient } from '../lib/userSupabase';

const STEPS = [
  'Authenticating…',
  'Provisioning your private database…',
  'Applying schema and security policies…',
  'Sending you a Supabase dashboard invitation…',
  'All done — check your email!',
];

interface Props {
  userId: string;
  email: string;
  onProvisioned: () => void;
}

export default function ProvisioningScreen({ userId, email, onProvisioned }: Props) {
  const [step, setStep] = useState(0);
  const [failed, setFailed] = useState(false);
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;
    provision();
  }, []);

  const provision = async () => {
    setFailed(false);
    setStep(0);
    try {
      setStep(1);
      const { data: { session } } = await hubSupabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      setStep(2);
      // Call the Edge Function on recon-hub
      const { data, error } = await hubSupabase.functions.invoke('provision-user-db', {
        body: { userId, email },
      });
      if (error) throw error;

      const { url, anon_key } = data as { url: string; anon_key: string };
      if (!url || !anon_key) throw new Error('Invalid provisioning response');

      setStep(3);
      // Persist the user's personal Supabase config
      await savePersonalConfig({ url, anonKey: anon_key });
      setPersonalClient({ url, anonKey: anon_key });

      // Store in hub so the user can retrieve it on future logins from new devices
      await hubSupabase.from('user_supabase_configs').upsert({
        user_id: userId,
        url,
        anon_key,
      });

      setStep(4);
      setTimeout(onProvisioned, 800);
    } catch (e: any) {
      setFailed(true);
      console.error('Provisioning failed:', e?.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>🔍</Text>
      <Text style={styles.title}>Setting up your database</Text>
      <Text style={styles.subtitle}>This happens once and takes ~30 seconds</Text>

      <View style={styles.stepsCard}>
        {STEPS.map((label, i) => (
          <View key={i} style={styles.stepRow}>
            <View style={[
              styles.stepDot,
              i < step && styles.stepDone,
              i === step && !failed && styles.stepActive,
              failed && i === step && styles.stepFailed,
            ]}>
              {i < step
                ? <Text style={styles.stepDotText}>✓</Text>
                : i === step && !failed
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.stepDotText}>{i + 1}</Text>}
            </View>
            <Text style={[
              styles.stepLabel,
              i < step && styles.stepLabelDone,
              i === step && styles.stepLabelActive,
            ]}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      {failed && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            Provisioning failed. Check your internet connection and make sure the recon-hub Edge Function is deployed.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { called.current = false; provision(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F1923', alignItems: 'center', justifyContent: 'center', padding: 28 },
  logo: { fontSize: 56, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 6, marginBottom: 32, textAlign: 'center' },
  stepsCard: { backgroundColor: '#1E2A35', borderRadius: 16, padding: 24, width: '100%', gap: 18 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#2d3f50', alignItems: 'center', justifyContent: 'center' },
  stepDone: { backgroundColor: '#16A34A' },
  stepActive: { backgroundColor: '#2563EB' },
  stepFailed: { backgroundColor: '#DC2626' },
  stepDotText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  stepLabel: { fontSize: 14, color: '#475569', flex: 1 },
  stepLabelDone: { color: '#94a3b8' },
  stepLabelActive: { color: '#fff', fontWeight: '600' },
  errorBox: { marginTop: 24, backgroundColor: '#2d1515', borderRadius: 12, padding: 16, width: '100%' },
  errorText: { color: '#fca5a5', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  retryBtn: { marginTop: 14, backgroundColor: '#DC2626', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  retryText: { color: '#fff', fontWeight: '700' },
});
