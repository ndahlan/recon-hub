import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const MGMT_TOKEN = Deno.env.get('MGMT_TOKEN')!;
const ORG_ID = Deno.env.get('ORG_ID')!;
const MGMT_BASE = 'https://api.supabase.com/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SCHEMA_SQL = `
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  name        text not null,
  description text default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table projects enable row level security;
create policy "owner full access" on projects
  for all using (auth.uid() = owner_id);

create table if not exists entries (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  user_id      uuid not null,
  photo_url    text not null,
  media_type   text not null default 'photo',
  upload_status text not null default 'pending',
  description  text default '',
  category     text default 'Other',
  country      text default '',
  latitude     float8,
  longitude    float8,
  altitude     float8,
  archived_at  timestamptz,
  created_at   timestamptz default now()
);
alter table entries enable row level security;
create policy "owner access entries" on entries
  for all using (
    exists (select 1 from projects where id = entries.project_id and owner_id = auth.uid())
  );

create table if not exists project_members (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  user_id       uuid,
  invited_email text not null,
  role          text not null default 'viewer',
  accepted      boolean default false,
  invited_at    timestamptz default now()
);
alter table project_members enable row level security;
create policy "owner manages members" on project_members
  for all using (
    exists (select 1 from projects where id = project_members.project_id and owner_id = auth.uid())
  );

insert into storage.buckets (id, name, public)
  values ('photos', 'photos', false)
  on conflict do nothing;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'auth upload'
  ) then
    execute $p$
      create policy "auth upload" on storage.objects
        for insert with check (bucket_id = 'photos' and auth.role() = 'authenticated')
    $p$;
  end if;
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'auth read'
  ) then
    execute $p$
      create policy "auth read" on storage.objects
        for select using (bucket_id = 'photos' and auth.role() = 'authenticated')
    $p$;
  end if;
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'auth delete'
  ) then
    execute $p$
      create policy "auth delete" on storage.objects
        for delete using (bucket_id = 'photos' and auth.role() = 'authenticated')
    $p$;
  end if;
end $$;
`;

async function mgmt(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${MGMT_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${MGMT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Management API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function waitUntilReady(projectRef: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const project = await mgmt(`/projects/${projectRef}`);
    if (project.status === 'ACTIVE_HEALTHY') return;
  }
  throw new Error('Project did not become ready in time');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { userId, email } = await req.json();
    if (!userId || !email) throw new Error('userId and email are required');

    // 1 — Create personal Supabase project
    const dbPass = crypto.randomUUID().replace(/-/g, '') + 'Aa1!';
    const project = await mgmt('/projects', 'POST', {
      name: `recon-${userId.slice(0, 8)}`,
      organization_id: ORG_ID,
      region: 'ap-southeast-1',
      db_pass: dbPass,
    });
    const projectRef = project.ref ?? project.id;

    // 2 — Wait for project to be ready (~1–2 min)
    await waitUntilReady(projectRef);

    // 3 — Apply schema
    await mgmt(`/projects/${projectRef}/database/query`, 'POST', {
      query: SCHEMA_SQL,
    });

    // 4 — Invite the user as project owner so they can log into
    //     supabase.com/dashboard with the same email and access their raw data
    try {
      await mgmt(`/projects/${projectRef}/members`, 'POST', {
        email: email.toLowerCase().trim(),
        role: 'owner',
      });
    } catch {
      // Non-fatal — user can still use the app; dashboard access is a bonus
    }

    // 5 — Get API keys
    const keys = await mgmt(`/projects/${projectRef}/api-keys`);
    const anonKey = keys.find((k: { name: string; api_key: string }) =>
      k.name === 'anon public'
    )?.api_key;
    if (!anonKey) throw new Error('Could not retrieve anon key');

    const url = `https://${projectRef}.supabase.co`;

    return new Response(
      JSON.stringify({ url, anon_key: anonKey }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
