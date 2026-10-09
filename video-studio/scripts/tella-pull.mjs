// Export a Tella video, download the MP4 and its transcript, and point config/video.json at them.
// Usage: npm run tella:pull -- <videoId | latest> [--4k] [--60fps]
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fail, loadConfig, p, saveConfig, sleep, tella, toRoot, writeJson } from './lib.mjs';

const args = process.argv.slice(2);
let id = args.find((a) => !a.startsWith('--')) || 'latest';
const resolution = args.includes('--4k') ? '4k' : '1080p';
const fps = args.includes('--60fps') ? '60' : '30';

if (id === 'latest') {
  const { videos } = await tella('/videos?limit=1');
  if (!videos.length) fail('No videos in your Tella workspace yet.');
  id = videos[0].id;
}

const { video } = await tella(`/videos/${encodeURIComponent(id)}`);
console.log(`\nTella video: "${video.name}" (${id})`);

const outDir = p('media', 'tella');
fs.mkdirSync(outDir, { recursive: true });
const sidecar = path.join(outDir, `${id}.json`);
const mp4 = path.join(outDir, `${id}.mp4`);

// 1. Transcript + chapters (sentence-level timestamps, in seconds)
const transcript = video.transcript ?? null;
writeJson(sidecar, {
  id,
  name: video.name,
  durationSeconds: video.durationSeconds,
  chapters: video.chapters ?? [],
  transcript,
});
if (transcript?.status === 'ready' && transcript.sentences?.length) {
  console.log(`✓ Transcript: ${transcript.sentences.length} sentences`);
} else {
  console.log(`! Transcript not ready (status: ${transcript?.status ?? 'none'}) — captions will be skipped.`);
}

// 2. Export (speed stays at 1 so transcript timestamps line up with the file)
console.log(`Starting export (${resolution}, ${fps} fps)…`);
let { export: job } = await tella(`/videos/${encodeURIComponent(id)}/exports`, {
  method: 'POST',
  body: { granularity: 'video', resolution, fps, speed: '1', subtitles: false },
});
while (job.status !== 'completed') {
  if (job.status === 'failed') {
    fail('Tella export failed. Retry, or download the MP4 from the Tella editor into media/tella/ (see README → Troubleshooting).');
  }
  process.stdout.write(`\r  ${job.status}… ${job.progress ?? 0}%      `);
  await sleep(5000);
  ({ export: job } = await tella(
    `/videos/${encodeURIComponent(id)}/exports/${encodeURIComponent(job.exportId)}`,
  ));
}
console.log('\r✓ Export ready                ');

// 3. Download
const res = await fetch(job.downloadUrl);
if (!res.ok || !res.body) fail(`Download failed: ${res.status} ${res.statusText}`);
const total = Number(res.headers.get('content-length')) || 0;
let received = 0;
const progress = new Transform({
  transform(chunk, _enc, cb) {
    received += chunk.length;
    const mb = (received / 1e6).toFixed(1);
    process.stdout.write(`\r  downloading… ${mb} MB${total ? ` / ${(total / 1e6).toFixed(1)} MB` : ''}   `);
    cb(null, chunk);
  },
});
const tmp = `${mp4}.part`;
await pipeline(Readable.fromWeb(res.body), progress, fs.createWriteStream(tmp));
fs.renameSync(tmp, mp4);
console.log(`\r✓ Saved ${toRoot(mp4)} (${(received / 1e6).toFixed(1)} MB)          `);

// 4. Point the edit at this recording
const cfg = loadConfig();
cfg.tellaVideoId = id;
cfg.footage = toRoot(mp4);
cfg.transcript = toRoot(sidecar);
if (!cfg.title || cfg.title === 'My Video Title') cfg.title = video.name;
saveConfig(cfg);
console.log('✓ Updated config/video.json\n\nNext: add music to media/music/, then run: npm run make\n');
