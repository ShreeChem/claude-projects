// FFmpeg finishing pass: lay the Epidemic Sound track under the voice, duck it while you talk,
// fade it in/out, normalise loudness for YouTube, and grab a thumbnail.
// Usage: npm run finish
//        npm run reel:finish [-- <name>]   (reads reels/<name>/reel.json and reel-edit/ instead)
import fs from 'node:fs';
import path from 'node:path';
import {
  REEL_DIR,
  fail,
  hasCommand,
  loadBuild,
  loadConfig,
  loadReel,
  p,
  probe,
  resolveMusic,
  run,
  takeReelArg,
  toRoot,
} from './lib.mjs';

if (!hasCommand('ffmpeg')) fail('ffmpeg was not found on PATH. Install FFmpeg (README step 1).');

const reel = takeReelArg(process.argv.slice(2));
const cfg = reel ? loadReel(reel) : loadConfig();
const build = loadBuild(reel ? REEL_DIR : 'edit');
const picture = p('output', `${build.slug}-picture.mp4`);
if (!fs.existsSync(picture)) fail(`Missing ${toRoot(picture)}. Run: npm run render`);

const final = p('output', `${build.slug}.mp4`);
const thumb = p('output', `${build.slug}-thumb.jpg`);
const music = resolveMusic(cfg);
const { duration: T, hasAudio: hasVoice } = probe(picture);

const lufs = Number(cfg.loudnessLufs) || -14;
const loudnorm = `loudnorm=I=${lufs}:TP=-1.5:LRA=11`;
const stereo = 'aformat=sample_rates=48000:channel_layouts=stereo';
const musicVolume = Number(cfg.musicVolume ?? 0.35);
const fadeOut = Math.min(3, T / 4);

const args = ['-y', '-hide_banner', '-loglevel', 'warning', '-stats', '-i', picture];
const filters = [];

if (music) {
  args.push('-stream_loop', '-1', '-i', music); // loop short tracks; trimmed to the video below
  filters.push(
    `[1:a]${stereo},atrim=end=${T.toFixed(3)},asetpts=PTS-STARTPTS,volume=${musicVolume},` +
      `afade=t=in:d=1.5,afade=t=out:st=${(T - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[music]`,
  );
  if (hasVoice && cfg.duckUnderVoice !== false) {
    filters.push(
      `[0:a]${stereo},asplit=2[voice][key]`,
      `[music][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[bed]`,
      `[voice][bed]amix=inputs=2:duration=first:normalize=0,${loudnorm}[aout]`,
    );
  } else if (hasVoice) {
    filters.push(`[0:a]${stereo}[voice]`, `[voice][music]amix=inputs=2:duration=first:normalize=0,${loudnorm}[aout]`);
  } else {
    filters.push(`[music]${loudnorm}[aout]`);
  }
} else if (hasVoice) {
  console.log('! No music found in media/music/ — finishing with voice only.');
  filters.push(`[0:a]${stereo},${loudnorm}[aout]`);
}

if (filters.length) {
  args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]');
  args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
} else {
  args.push('-map', '0:v');
}
args.push('-c:v', 'copy', '-t', T.toFixed(3), '-movflags', '+faststart', final);

console.log(`Mixing${music ? ` "${path.basename(music)}"` : ''} → ${toRoot(final)}`);
run('ffmpeg', args);

// Thumbnail from the intro title card (or 1s in when there is no intro); reels name their own frame.
const thumbAt = build.thumbAt ?? (build.intro > 1 ? build.intro - 0.6 : Math.min(1, T / 2));
run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(thumbAt), '-i', final, '-frames:v', '1', '-q:v', '2', thumb]);

console.log(`\n✓ Done!\n  Video:     ${toRoot(final)}\n  Thumbnail: ${toRoot(thumb)}`);
for (const extra of [`${build.slug}.srt`, `${build.slug}-chapters.txt`]) {
  if (fs.existsSync(p('output', extra))) console.log(`  Upload:    output/${extra}`);
}
console.log('');
