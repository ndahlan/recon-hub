/**
 * hubSupabase.ts
 *
 * Client for the central "Recon Hub" Supabase project.
 * This handles:
 *   - User authentication (sign up / sign in)
 *   - Triggering auto-provisioning of a user's personal Supabase project
 *   - Storing and retrieving each user's personal Supabase credentials
 *   - Storing shared-project invitations
 *
 * ─── Supabase Hub Setup ───────────────────────────────────────────────────────
 * Create a new Supabase project at https://supabase.com (call it "recon-hub").
 * Then run this SQL in the SQL Editor:
 *
 *   -- Stores each user's personal Supabase project credentials
 *   create table user_supabase_configs (
 *     id          uuid primary key default gen_random_uuid(),
 *     user_id     uuid not null references auth.users(id) on delete cascade,
 *     url         text not null,
 *     anon_key    text not null,
 *     created_at  timestamptz default now()
 *   );
 *   alter table user_supabase_configs enable row level security;
 *   create policy "users read own config" on user_supabase_configs
 *     for select using (auth.uid() = user_id);
 *   create policy "users insert own config" on user_supabase_configs
 *     for insert with check (auth.uid() = user_id);
 *
 *   -- Stores invitations (includes owner's Supabase URL so invitee can connect)
 *   create table hub_invitations (
 *     id              uuid primary key default gen_random_uuid(),
 *     project_id      text not null,
 *     invited_email   text not null,
 *     role            text not null default 'viewer',
 *     owner_id        uuid not null references auth.users(id),
 *     supabase_url    text not null,
 *     supabase_anon_key text not null,
 *     accepted        boolean default false,
 *     invited_at      timestamptz default now()
 *   );
 *   alter table hub_invitations enable row level security;
 *   create policy "owner can manage" on hub_invitations
 *     for all using (auth.uid() = owner_id);
 *   create policy "invited user can read" on hub_invitations
 *     for select using (invited_email = auth.jwt()->>'email');
 *   create policy "invited user can accept" on hub_invitations
 *     for update using (invited_email = auth.jwt()->>'email');
 *
 * Then replace HUB_URL and HUB_KEY below with your recon-hub project's values.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const HUB_URL = 'https://hcyheqsvvbnvhlbwgzei.supabase.co';
export const HUB_KEY = 'sb_publishable_noC1LibHsedf-mkJYXmung_PKfNkaNY';

export const hubSupabase = createClient(HUB_URL, HUB_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
