#!/usr/bin/env node
/**
 * recon-download.js — Download all Recon data from any internet-connected computer.
 *
 * Usage:
 *   node recon-download.js --email owner@example.com --password YourPassword
 *
 * Requirements:
 *   npm install @supabase/supabase-js   (one-time, in any folder)
 *
 * Output:
 *   ~/Desktop/ReconExport_YYYY-MM-DD/
 *     projects.csv
 *     entries.csv
 *     photos/   (all original photos + videos)
 *
 * Security:
 *   Only the account owner can download — Supabase RLS enforces row-level access.
 *   Credentials are never stored on disk; they authenticate a one-time session.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Recon Hub config ─────────────────────────────────────────────────────────
const HUB_URL = 'https://hcyheqsvvbnvhlbwgzei.supabase.co';
const HUB_KEY = 'sb_publishable_noC1LibHsedf-mkJYXmung_PKfNkaNY';

// ─── Parse CLI arguments ──────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) result.email = args[++i];
    else if (args[i] === '--password' && args[i + 1]) result.password = args[++i];
    else if (args[i] === '--output' && args[i + 1]) result.output = args[++i];
  }
  return result;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────
function escCsv(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows, cols) {
  const header = cols.join(',');
  const lines = rows.map((r) => cols.map((c) => escCsv(r[c])).join(','));
  return [header, ...lines].join('\n');
}

// ─── File download (Node-native, no extra deps) ───────────────────────────────
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// ─── Extract storage path from photo_url ─────────────────────────────────────
function storagePath(url, mediaType) {
  const ext = mediaType === 'video' ? 'mp4' : 'jpg';
  const m = url.match(new RegExp(`([^?]+\\.${ext})`));
  return m ? m[1] : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  if (!args.email || !args.password) {
    console.error('Usage: node recon-download.js --email you@example.com --password YourPassword');
    console.error('       node recon-download.js --email you@example.com --password YourPassword --output /path/to/folder');
    process.exit(1);
  }

  // ── Auth ──
  console.log(`\n🔐 Signing in as ${args.email}…`);
  const supabase = createClient(HUB_URL, HUB_KEY);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: args.email,
    password: args.password,
  });
  if (authError) {
    console.error('❌ Login failed:', authError.message);
    process.exit(1);
  }
  console.log('✅ Authenticated as', authData.user.email);

  // ── Output directory ──
  const dateStr = new Date().toISOString().slice(0, 10);
  const outputDir = args.output
    ? path.resolve(args.output)
    : path.join(os.homedir(), 'Desktop', `ReconExport_${dateStr}`);
  const photosDir = path.join(outputDir, 'photos');
  fs.mkdirSync(photosDir, { recursive: true });
  console.log(`📁 Output: ${outputDir}\n`);

  // ── Fetch projects ──
  console.log('📂 Fetching projects…');
  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: true });
  if (pErr) throw new Error('Projects fetch failed: ' + pErr.message);
  console.log(`   ${projects.length} project(s) found`);

  // ── Fetch entries ──
  console.log('📋 Fetching entries…');
  const { data: entries, error: eErr } = await supabase
    .from('entries')
    .select('*')
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (eErr) throw new Error('Entries fetch failed: ' + eErr.message);
  console.log(`   ${entries.length} entry/entries found`);

  // ── Write projects CSV ──
  const projectsCsv = toCsv(projects, ['id', 'name', 'description', 'owner_id', 'created_at', 'updated_at']);
  fs.writeFileSync(path.join(outputDir, 'projects.csv'), projectsCsv, 'utf8');
  console.log('\n✅ projects.csv written');

  // ── Write entries CSV ──
  const entriesCsv = toCsv(entries, [
    'id', 'project_id', 'user_id', 'category', 'description', 'country',
    'latitude', 'longitude', 'altitude', 'media_type', 'photo_url',
    'upload_status', 'created_at',
  ]);
  fs.writeFileSync(path.join(outputDir, 'entries.csv'), entriesCsv, 'utf8');
  console.log('✅ entries.csv written');

  // ── Download photos ──
  const photoEntries = entries.filter(
    (e) => e.upload_status === 'uploaded' && e.photo_url
  );
  console.log(`\n📸 Downloading ${photoEntries.length} photo/video file(s)…`);

  let ok = 0, fail = 0;
  for (const entry of photoEntries) {
    const filePath = storagePath(entry.photo_url, entry.media_type);
    if (!filePath) { fail++; continue; }

    const { data: signedData, error: signErr } = await supabase.storage
      .from('photos')
      .createSignedUrl(filePath, 3600);

    if (signErr || !signedData?.signedUrl) {
      console.warn(`   ⚠ Could not sign URL for ${filePath}: ${signErr?.message ?? 'no URL'}`);
      fail++;
      continue;
    }

    // Flatten the storage path to a safe filename
    const safeName = filePath.replace(/\//g, '_');
    const destPath = path.join(photosDir, safeName);

    try {
      await downloadFile(signedData.signedUrl, destPath);
      process.stdout.write('.');
      ok++;
    } catch (dlErr) {
      console.warn(`\n   ⚠ Download failed for ${safeName}: ${dlErr.message}`);
      fail++;
    }
  }

  console.log(`\n\n✅ Done — ${ok} downloaded, ${fail} failed`);
  console.log(`\n📦 Export saved to:\n   ${outputDir}`);
  console.log(`   ├── projects.csv  (${projects.length} rows)`);
  console.log(`   ├── entries.csv   (${entries.length} rows)`);
  console.log(`   └── photos/       (${ok} files)`);
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
