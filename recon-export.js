#!/usr/bin/env node
/**
 * recon-export.js
 *
 * Downloads all Recon projects, entries and photos/videos
 * directly from Supabase to your Mac Desktop.
 *
 * No phone needed. Zero phone storage used.
 *
 * Usage (from the Recon project folder):
 *   node recon-export.js
 *
 * Or pass credentials directly:
 *   node recon-export.js you@example.com yourpassword
 *
 * Output:
 *   ~/Desktop/ReconExport_YYYY-MM-DD/
 *     export_summary.csv
 *     Project Name/
 *       entries.csv
 *       photos/
 *         filename.jpg
 *         filename.mp4
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const rl   = require('readline');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

// ── Supabase config (same as the app) ────────────────────────────────────────
const HUB_URL = 'https://hcyheqsvvbnvhlbwgzei.supabase.co';
const HUB_KEY = 'sb_publishable_noC1LibHsedf-mkJYXmung_PKfNkaNY';

// ─────────────────────────────────────────────────────────────────────────────

function ask(question) {
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => iface.question(question, (a) => { iface.close(); resolve(a.trim()); }));
}

function safeName(name) {
  return name.replace(/[^a-z0-9_\- ]/gi, '_').trim();
}

function storagePath(urlOrFilename, mediaType = 'photo') {
  const ext = mediaType === 'video' ? 'mp4' : 'jpg';
  const match = urlOrFilename.match(new RegExp(`([^?]+\\.${ext})`));
  return match ? match[1] : urlOrFilename;
}

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Convert Web ReadableStream → Node Readable, pipe to file
  const nodeStream = Readable.fromWeb(res.body);
  await pipeline(nodeStream, fs.createWriteStream(destPath));
}

async function main() {
  console.log('\n🔍  Recon — Direct Export to Mac\n');

  const email    = process.argv[2] || await ask('Email:    ');
  const password = process.argv[3] || await ask('Password: ');

  // Create a plain Node.js Supabase client (no AsyncStorage needed)
  const supabase = createClient(HUB_URL, HUB_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('\n⏳  Signing in…');
  const { data: { session }, error: authErr } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase(), password,
  });
  if (authErr) { console.error('❌  Sign in failed:', authErr.message); process.exit(1); }
  console.log(`✅  Signed in as ${session.user.email}`);

  // ── Create output folder on Desktop ──────────────────────────────────────
  const datestamp = new Date().toISOString().slice(0, 10);
  const exportDir = path.join(os.homedir(), 'Desktop', `ReconExport_${datestamp}`);
  fs.mkdirSync(exportDir, { recursive: true });
  console.log(`\n📁  Saving to: ${exportDir}\n`);

  // ── Fetch projects owned by this user ─────────────────────────────────────
  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('*')
    .eq('owner_id', session.user.id)
    .order('created_at', { ascending: true });
  if (pErr) throw pErr;

  const allProjects = projects ?? [];
  if (allProjects.length === 0) {
    console.log('No projects found for this account.');
    process.exit(0);
  }

  const summaryRows = [
    'project_name,entry_id,category,country,description,latitude,longitude,altitude,media_type,filename,created_at',
  ];

  let totalPhotos = 0;
  let savedPhotos = 0;
  let failedPhotos = 0;

  for (const project of allProjects) {
    const projectDir = path.join(exportDir, safeName(project.name));
    const photosDir  = path.join(projectDir, 'photos');
    fs.mkdirSync(photosDir, { recursive: true });

    console.log(`\n📂  ${project.name}`);

    // Fetch entries
    const { data: entries } = await supabase
      .from('entries')
      .select('*')
      .eq('project_id', project.id)
      .is('archived_at', null)
      .order('created_at', { ascending: true });

    const all      = entries ?? [];
    const uploaded = all.filter((e) => e.upload_status === 'uploaded' || !e.upload_status);
    totalPhotos   += uploaded.length;

    console.log(`    ${all.length} entries, ${uploaded.length} uploaded photos/videos`);

    // Batch-create signed download URLs
    const storagePaths = uploaded.map((e) => storagePath(e.photo_url, e.media_type));
    const signedMap = {};

    if (storagePaths.length > 0) {
      const { data: signed } = await supabase.storage
        .from('photos')
        .createSignedUrls(storagePaths, 3600);
      (signed ?? []).forEach((s, i) => {
        if (s.signedUrl) signedMap[storagePaths[i]] = s.signedUrl;
      });
    }

    // Download each file
    const csvRows = [
      'entry_id,category,country,description,latitude,longitude,altitude,media_type,filename,created_at',
    ];

    for (const e of all) {
      const spath   = storagePath(e.photo_url, e.media_type);
      const basename = spath.split('/').pop() ?? spath;
      const signedUrl = signedMap[spath];

      if (signedUrl) {
        const destPath = path.join(photosDir, basename);
        process.stdout.write(`    ⬇  ${basename}  `);
        try {
          await downloadFile(signedUrl, destPath);
          const size = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
          console.log(`✓  ${size} MB`);
          savedPhotos++;
        } catch (err) {
          console.log(`✗  ${err.message}`);
          failedPhotos++;
        }
      }

      csvRows.push([
        e.id,
        csvEscape(e.category),
        csvEscape(e.country),
        csvEscape(e.description),
        e.latitude  ?? '',
        e.longitude ?? '',
        e.altitude  ?? '',
        e.media_type,
        basename,
        e.created_at,
      ].join(','));

      summaryRows.push([
        csvEscape(project.name),
        e.id,
        csvEscape(e.category),
        csvEscape(e.country),
        csvEscape(e.description),
        e.latitude  ?? '',
        e.longitude ?? '',
        e.altitude  ?? '',
        e.media_type,
        basename,
        e.created_at,
      ].join(','));
    }

    fs.writeFileSync(path.join(projectDir, 'entries.csv'), csvRows.join('\n'));
    console.log(`    📋  entries.csv written`);
  }

  // Write summary
  fs.writeFileSync(path.join(exportDir, 'export_summary.csv'), summaryRows.join('\n'));

  console.log('\n─────────────────────────────────────────────');
  console.log(`✅  Export complete`);
  console.log(`    Photos downloaded : ${savedPhotos}`);
  if (failedPhotos > 0) console.log(`    Failed           : ${failedPhotos}`);
  console.log(`    Location         : ${exportDir}`);
  console.log('─────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('\n❌  Export failed:', err.message);
  process.exit(1);
});
