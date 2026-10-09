// Check that every part of the pipeline is installed and connected.
// Usage: npm run doctor
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { HYPERFRAMES_BIN, hasCommand, p } from './lib.mjs';

let problems = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg, fix) => {
  problems++;
  console.log(`  ✗ ${msg}\n      → ${fix}`);
};

console.log('\nvideo-studio doctor\n');

const major = Number(process.versions.node.split('.')[0]);
if (major >= 22) ok(`Node.js ${process.versions.node}`);
else bad(`Node.js ${process.versions.node} (need 22+)`, 'winget install OpenJS.NodeJS.LTS');

for (const tool of ['ffmpeg', 'ffprobe']) {
  if (hasCommand(tool)) ok(tool);
  else bad(`${tool} not on PATH`, 'winget install --id Gyan.FFmpeg -e   (then restart the terminal / Claude app)');
}

if (fs.existsSync(HYPERFRAMES_BIN)) ok('HyperFrames CLI installed');
else bad('HyperFrames CLI not installed', 'npm install');

if (!fs.existsSync(p('.env'))) {
  bad('.env file missing', 'copy .env.example .env   then paste your Tella API key into it');
} else if (!process.env.TELLA_API_KEY) {
  bad('TELLA_API_KEY is empty in .env', 'Tella → Settings → API keys → create key, paste it into .env');
} else {
  const res = await fetch('https://api.tella.com/v1/videos?limit=1', {
    headers: { Authorization: `Bearer ${process.env.TELLA_API_KEY}` },
  }).catch((e) => ({ ok: false, status: e.message }));
  if (res.ok) ok('Tella API key works');
  else bad(`Tella API rejected the key (${res.status})`, 'Create a fresh key in Tella → Settings → API keys');
}

const musicDir = p('media', 'music');
const tracks = fs.existsSync(musicDir) ? fs.readdirSync(musicDir).filter((f) => !f.startsWith('.')) : [];
if (tracks.length) ok(`${tracks.length} music track(s) in media/music`);
else console.log('  · No music yet in media/music (optional — add an Epidemic Sound track, README step 4)');

console.log(problems ? `\n${problems} thing(s) to fix above.\n` : '\nAll good.\n');

if (fs.existsSync(HYPERFRAMES_BIN)) {
  console.log('HyperFrames system check (whisper/TTS/MusicGen/Docker are optional):');
  spawnSync(process.execPath, [HYPERFRAMES_BIN, 'doctor'], { stdio: 'inherit' });
}
