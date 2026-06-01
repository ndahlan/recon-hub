/**
 * userSupabase.ts
 *
 * Creates and caches Supabase clients for each user's personal project.
 * Each project can point to a different Supabase instance (for shared projects).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PERSONAL_CONFIG_KEY = '@recon/personal_supabase';
const clientCache = new Map<string, SupabaseClient>();

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

// ─── Persist / retrieve the current user's personal Supabase config ────────────

export async function savePersonalConfig(config: SupabaseConfig) {
  await AsyncStorage.setItem(PERSONAL_CONFIG_KEY, JSON.stringify(config));
}

export async function getPersonalConfig(): Promise<SupabaseConfig | null> {
  const raw = await AsyncStorage.getItem(PERSONAL_CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearPersonalConfig() {
  await AsyncStorage.removeItem(PERSONAL_CONFIG_KEY);
  clientCache.clear();
}

// ─── Get a Supabase client for a given config ──────────────────────────────────

export function getSupabaseClient(config: SupabaseConfig): SupabaseClient {
  const cacheKey = config.url;
  if (clientCache.has(cacheKey)) return clientCache.get(cacheKey)!;

  const client = createClient(config.url, config.anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  clientCache.set(cacheKey, client);
  return client;
}

// ─── Convenience: get the current user's personal client ──────────────────────

let _personalClient: SupabaseClient | null = null;

export function setPersonalClient(config: SupabaseConfig) {
  _personalClient = getSupabaseClient(config);
}

export function personalClient(): SupabaseClient {
  if (!_personalClient) throw new Error('Personal Supabase not configured yet');
  return _personalClient;
}

// ─── SQL to run on each newly provisioned user database ───────────────────────
// The provisioning Edge Function runs this against the new project's DB.
// Kept here as a reference — not executed client-side.
export const USER_DB_SCHEMA = `
-- Projects
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  name        text not null,
  description text default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table projects enable row level security;
create policy "owner full access" on projects for all using (auth.uid() = owner_id);
create policy "members can view" on projects for select using (
  exists (select 1 from project_members where project_id = projects.id and user_id = auth.uid() and accepted = true)
);

-- Entries
create table if not exists entries (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null,
  photo_url   text not null,
  media_type  text not null default 'photo',
  description text default '',
  category    text default 'Other',
  country     text default '',
  latitude    float8,
  longitude   float8,
  altitude    float8,
  archived_at timestamptz,
  created_at  timestamptz default now()
);
alter table entries enable row level security;
create policy "project members access" on entries for all using (
  exists (select 1 from projects where id = entries.project_id and owner_id = auth.uid())
  or
  exists (select 1 from project_members where project_id = entries.project_id and user_id = auth.uid() and accepted = true)
);

-- Project members (for sharing within this user's DB)
create table if not exists project_members (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  user_id         uuid,
  invited_email   text not null,
  role            text not null default 'viewer',
  accepted        boolean default false,
  invited_at      timestamptz default now()
);
alter table project_members enable row level security;
create policy "owner manages members" on project_members for all using (
  exists (select 1 from projects where id = project_members.project_id and owner_id = auth.uid())
);

-- Storage bucket
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict do nothing;
create policy "authenticated upload" on storage.objects for insert
  with check (bucket_id = 'photos' and auth.role() = 'authenticated');
create policy "authenticated read" on storage.objects for select
  using (bucket_id = 'photos' and auth.role() = 'authenticated');
create policy "authenticated delete" on storage.objects for delete
  using (bucket_id = 'photos' and auth.role() = 'authenticated');
`;
