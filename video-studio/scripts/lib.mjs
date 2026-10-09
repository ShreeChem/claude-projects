// Shared helpers for the video-studio scripts.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const p = (...parts) => path.join(ROOT, ...parts);

// Load .env (TELLA_API_KEY etc.) if present.
try {
  process.loadEnvFile(p('.env'));
} catch {}

export function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export const CONFIG_PATH = p('config', 'video.json');
export const loadConfig = () => readJson(CONFIG_PATH);
export const saveConfig = (cfg) => writeJson(CONFIG_PATH, cfg);

// Config paths are stored relative to the project root with forward slashes.
export const fromRoot = (rel) => (rel ? path.resolve(ROOT, rel) : '');
export const toRoot = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hasCommand(cmd) {
  return spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.error?.code === 'ENOENT') fail(`${cmd} was not found on PATH. See README step 1.`);
  if (r.error) fail(`Could not start ${cmd}: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} exited with code ${r.status}`);
}

export function probe(file) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { encoding: 'utf8' },
  );
  if (r.error) fail('ffprobe was not found on PATH. Install FFmpeg (README step 1).');
  if (r.status !== 0) fail(`ffprobe could not read ${file}:\n${r.stderr}`);
  const info = JSON.parse(r.stdout);
  return {
    duration: Number(info.format.duration),
    hasAudio: info.streams.some((s) => s.codec_type === 'audio'),
  };
}

export function slugify(s) {
  const slug = String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 60);
  return slug || 'video';
}

// Music: config.music, or the only audio file sitting in media/music/.
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;
export function resolveMusic(cfg) {
  if (cfg.music) {
    const file = fromRoot(cfg.music);
    if (!fs.existsSync(file)) fail(`config.music points to a missing file: ${cfg.music}`);
    return file;
  }
  const dir = p('media', 'music');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => AUDIO_EXT.test(f)) : [];
  if (files.length === 1) return path.join(dir, files[0]);
  if (files.length > 1) {
    fail(`media/music has ${files.length} tracks. Set "music" in config/video.json to pick one.`);
  }
  return null;
}

// ---------- Tella Public API ----------
const TELLA_BASE = 'https://api.tella.com/v1';

export async function tella(pathname, { method = 'GET', body } = {}) {
  const key = process.env.TELLA_API_KEY;
  if (!key) fail('TELLA_API_KEY is missing. Copy .env.example to .env and paste your key (README step 3).');
  const res = await fetch(TELLA_BASE + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    fail(`Tella API ${method} ${pathname} → ${res.status} ${res.statusText}\n${await res.text()}`);
  }
  return res.json();
}

// ---------- HyperFrames CLI (pinned in package.json) ----------
export const HYPERFRAMES_BIN = p('node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');

export function hyperframes(args) {
  if (!fs.existsSync(HYPERFRAMES_BIN)) fail('HyperFrames is not installed. Run: npm install');
  run(process.execPath, [HYPERFRAMES_BIN, ...args]);
}

export function loadBuild(dir = 'edit') {
  const file = p(dir, 'build.json');
  if (!fs.existsSync(file)) fail(`No build found. Run: npm run ${dir === 'edit' ? 'build' : 'reel:build'}`);
  return readJson(file);
}

// ---------- Reels: vertical 9:16 shorts in reels/<name>/reel.json, built into reel-edit/ ----------
export const REEL_DIR = 'reel-edit';
export const reelPath = (name, ...parts) => p('reels', name, ...parts);
export const loadReel = (name) => readJson(reelPath(name, 'reel.json'));

// Pick the reel from argv (`--reel <name>` or a bare `<name>`) and remove those args, so the rest
// can be passed on to HyperFrames. With no name, use the only folder in reels/.
export function takeReelArg(args, { flag = true } = {}) {
  let name = null;
  const i = args.indexOf('--reel');
  if (i !== -1) {
    name = args[i + 1] && !args[i + 1].startsWith('-') ? args[i + 1] : '';
    args.splice(i, name ? 2 : 1);
  } else if (flag) {
    return null;
  } else if (args[0] && !args[0].startsWith('-')) {
    name = args.shift();
  }
  if (!name) {
    const dir = p('reels');
    const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => fs.existsSync(reelPath(d, 'reel.json'))) : [];
    if (all.length !== 1) fail(`Name the reel to use (${all.join(', ') || 'none found in reels/'}).`);
    name = all[0];
  }
  if (!fs.existsSync(reelPath(name, 'reel.json'))) fail(`No reel named "${name}" (expected reels/${name}/reel.json).`);
  return name;
}

// Hard-link a media file into a HyperFrames project's assets/ (copy if linking fails).
export function linkAsset(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { force: true });
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
}
