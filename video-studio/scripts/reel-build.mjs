// Turn reels/<name>/reel.json (script scenes + photos + your voiceover) into a 9:16 HyperFrames
// project (reel-edit/index.html), plus captions for upload (output/<slug>.srt).
// Usage: npm run reel:build [-- <name>]
// Without a voiceover, scenes are timed from the script at `wordsPerSecond` (a silent draft).
// With one, the same proportions are stretched to the real recording length.
import fs from 'node:fs';
import path from 'node:path';
import { REEL_DIR, fail, fromRoot, linkAsset, loadReel, p, probe, slugify, takeReelArg, writeJson } from './lib.mjs';

const name = takeReelArg(process.argv.slice(2), { flag: false });
const cfg = loadReel(name);
if (!cfg.scenes?.length) fail(`reels/${name}/reel.json has no scenes.`);

const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const slug = slugify(cfg.title || name);
const out = (...parts) => p(REEL_DIR, ...parts);
const CROSSFADE = 0.5;

// ---------- Voiceover ----------
let voice = null;
if (cfg.voiceover) {
  const file = fromRoot(cfg.voiceover);
  if (!fs.existsSync(file)) fail(`voiceover not found: ${cfg.voiceover}`);
  const info = probe(file);
  if (!info.hasAudio) fail(`${cfg.voiceover} has no audio track.`);
  const dest = out('assets', `voiceover${path.extname(file).toLowerCase()}`);
  linkAsset(file, dest);
  voice = { src: `assets/${path.basename(dest)}`, duration: Math.floor(info.duration * 100) / 100 };
}

// ---------- Script → phrases (one caption line each), timed by word count ----------
const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;

// Sentences end at . ! ? or … (plus a closing quote). Long sentences break at commas first, so a
// caption never ends mid-thought; a clause that is still too long is split into balanced halves.
function phrases(text, maxWords = 8) {
  const sentences = String(text).match(/[^.!?…]+[.!?…]+["”’']?|[^.!?…]+$/g) ?? [];
  const balanced = (words) => {
    const size = Math.ceil(words.length / Math.ceil(words.length / maxWords));
    const lines = [];
    for (let i = 0; i < words.length; i += size) lines.push(words.slice(i, i + size).join(' '));
    return lines;
  };
  return sentences.flatMap((s) => {
    const words = s.trim().split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return [words.join(' ')];
    const clauses = s.trim().split(/(?<=,)\s+/).map((c) => c.split(/\s+/));
    // Fold one- and two-word clauses ("Last month,", "Papa.") into the next clause (or the previous one).
    for (let i = 0; i < clauses.length && clauses.length > 1; i++) {
      if (clauses[i].length > 2) continue;
      const j = i < clauses.length - 1 ? i + 1 : i - 1;
      if (clauses[i].length + clauses[j].length > maxWords + 1) continue;
      const a = Math.min(i, j);
      clauses.splice(a, 2, [...clauses[a], ...clauses[a + 1]]);
      i = -1;
    }
    return clauses.flatMap((c) => (c.length <= maxWords + 1 ? [c.join(' ')] : balanced(c)));
  });
}

const wps = Number(cfg.wordsPerSecond) || 2.6;
const scenes = cfg.scenes.map((s, i) => {
  if (!s.image) fail(`Scene ${i + 1} has no image.`);
  const lines = phrases(s.vo ?? '');
  return { ...s, n: i + 1, lines, words: lines.reduce((sum, l) => sum + wordCount(l), 0) };
});
const estimate = scenes.reduce((sum, s) => sum + s.words / wps, 0);
const speech = voice ? voice.duration : estimate;
const stretch = speech / estimate;
const tail = Math.max(0, Number(cfg.tailSeconds ?? 1.8));
const total = r3(speech + tail);

// ---------- Scene timing, camera moves, captions ----------
const brand = String(cfg.brandLine ?? '').trim();
const captions = [];
let endStart = null;
let t = 0;
for (const s of scenes) {
  s.start = t;
  s.length = (s.words / wps) * stretch;
  // Lines share the scene by word count, plus a beat for the pause at the end of each line.
  const weights = s.lines.map((l) => wordCount(l) + 0.6);
  const sum = weights.reduce((a, b) => a + b, 0);
  let lt = t;
  s.lines.forEach((text, i) => {
    const length = (s.length * weights[i]) / sum;
    if (brand && text === brand) endStart = lt;
    else captions.push({ text, start: lt, end: lt + length });
    lt += length;
  });
  t += s.length;
}
if (endStart === null) endStart = Math.max(0, speech - 1.5);
captions.forEach((c, i) => {
  const next = captions[i + 1]?.start ?? endStart;
  c.end = Math.min(c.end, next, endStart) - 0.04;
});

const MOVES = {
  in: (z) => [{ scale: z, x: 0 }, { scale: z * 1.08, x: 0 }],
  out: (z) => [{ scale: z * 1.1, x: 0 }, { scale: z, x: 0 }],
  left: (z) => [{ scale: z * 1.1, x: 36 }, { scale: z * 1.1, x: -36 }],
  right: (z) => [{ scale: z * 1.1, x: -36 }, { scale: z * 1.1, x: 36 }],
};

const timingScenes = [];
const sceneHtml = scenes.map((s, i) => {
  const file = fromRoot(s.image);
  if (!fs.existsSync(file)) fail(`Scene ${s.n} image not found: ${s.image}`);
  const asset = `assets/${path.basename(file)}`;
  linkAsset(file, out(asset));
  const last = i === scenes.length - 1;
  const duration = last ? total - s.start : s.length + CROSSFADE;
  const [from, to] = (MOVES[s.move] ?? MOVES.in)(Number(s.zoom) || 1);
  const [fx, fy] = Array.isArray(s.focus) ? s.focus : [50, 50];
  const id = `scene-${s.n}`;
  timingScenes.push({ id, start: r3(s.start), duration: r3(duration), from, to });
  return `      <img id="${id}" class="clip shot" data-start="${r3(s.start)}" data-duration="${r3(duration)}" data-track-index="1" src="${asset}" alt="" style="z-index: ${s.n}; transform-origin: ${fx}% ${fy}%" />`;
});

const captionHtml = captions.map(
  (c, i) =>
    `      <div id="caption-${i + 1}" class="clip layer caption" data-start="${r3(c.start)}" data-duration="${r3(c.end - c.start)}" data-track-index="3"><span>${esc(c.text)}</span></div>`,
);

const timing = {
  total,
  crossfade: CROSSFADE,
  scenes: timingScenes,
  captions: captions.map((c, i) => ({ id: `caption-${i + 1}`, start: r3(c.start), end: r3(c.end) })),
  endcard: { start: r3(endStart) },
};

// ---------- Fill the template ----------
const vars = {
  ACCENT: /^#[0-9a-f]{3,8}$/i.test(cfg.accentColor ?? '') ? cfg.accentColor : '#E8C38A',
  TOTAL: total,
  SCENES: sceneHtml.join('\n'),
  CAPTIONS: captionHtml.join('\n'),
  CHANNEL: esc(cfg.channel),
  TAGLINE: esc(cfg.tagline),
  HANDLE: esc(cfg.handle),
  VOICE_SRC: voice?.src ?? '',
  VOICE_DURATION: voice?.duration ?? 0,
  END_START: r3(endStart),
  END_DURATION: r3(total - endStart),
  TIMING_JSON: JSON.stringify(timing),
};
const enabled = { voice: Boolean(voice) };

let html = fs.readFileSync(p('template', 'reel.html'), 'utf8');
html = html.replace(/[ \t]*<!-- if:(\w+) -->\r?\n([\s\S]*?)[ \t]*<!-- \/if:\1 -->\r?\n?/g, (_, key, body) =>
  enabled[key] ? body : '',
);
html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!(key in vars)) fail(`template/reel.html uses an unknown token {{${key}}}`);
  return String(vars[key]);
});
fs.mkdirSync(out(), { recursive: true });
fs.writeFileSync(out('index.html'), html);

// HyperFrames project files (same settings as edit/).
for (const f of ['hyperframes.json', 'meta.json']) {
  if (!fs.existsSync(out(f)) && fs.existsSync(p('edit', f))) fs.copyFileSync(p('edit', f), out(f));
}

// ---------- Captions for upload (.srt) ----------
const srtTime = (sec) => {
  const ms = Math.round(sec * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
const srtCues = [...captions, ...(brand ? [{ text: brand, start: endStart, end: Math.min(total, endStart + 2.5) }] : [])];
fs.mkdirSync(p('output'), { recursive: true });
fs.writeFileSync(
  p('output', `${slug}.srt`),
  srtCues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'),
);

writeJson(out('build.json'), { slug, title: cfg.title, reel: name, hasAudio: Boolean(voice), total, thumbAt: 1.2 });

console.log(`✓ Built ${REEL_DIR}/index.html — "${cfg.title}" (${scenes.length} scenes, ${captions.length} captions, ${total}s)`);
console.log(voice ? `  Voiceover: ${cfg.voiceover} (${voice.duration}s)` : `  No voiceover yet — silent draft timed at ${wps} words/s.`);
const stand = scenes.filter((s) => s.draft);
if (stand.length) console.log(`  Stand-in shots: ${stand.map((s) => `scene ${s.n}`).join(', ')} (see "draft" in reel.json)`);
console.log(`  Captions → output/${slug}.srt`);
console.log('\nNext: npm run reel:preview (look at it)  or  npm run reel:render\n');
