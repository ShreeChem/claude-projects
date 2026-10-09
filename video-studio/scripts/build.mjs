// Turn config/video.json + the Tella footage/transcript into a HyperFrames project (edit/index.html),
// plus YouTube-ready captions (.srt) and chapters in output/.
// Usage: npm run build
import fs from 'node:fs';
import path from 'node:path';
import { fail, fromRoot, loadConfig, p, probe, readJson, slugify, writeJson } from './lib.mjs';

const cfg = loadConfig();
if (!cfg.footage) {
  fail('No footage yet. Run "npm run tella:pull -- latest", or set "footage" in config/video.json.');
}
const footage = fromRoot(cfg.footage);
if (!fs.existsSync(footage)) fail(`Footage not found: ${cfg.footage}`);

const r3 = (n) => Math.round(n * 1000) / 1000;
const media = probe(footage);
const intro = Math.max(0, Number(cfg.introSeconds) || 0);
const outro = Math.max(0, Number(cfg.outroSeconds) || 0);
const dur = Math.floor(media.duration * 100) / 100;
const slug = slugify(cfg.title);

// ---------- Footage → edit/assets (hard link, so multi-GB files aren't copied) ----------
const assets = p('edit', 'assets');
fs.mkdirSync(assets, { recursive: true });
for (const f of fs.readdirSync(assets)) {
  if (f.startsWith('footage.')) fs.rmSync(path.join(assets, f));
}
const ext = path.extname(footage).toLowerCase();
const linked = path.join(assets, `footage${ext}`);
try {
  fs.linkSync(footage, linked);
} catch {
  fs.copyFileSync(footage, linked);
}

// ---------- Captions from the Tella transcript ----------
function loadSentences() {
  if (!cfg.captions || !cfg.transcript) return [];
  const file = fromRoot(cfg.transcript);
  if (!fs.existsSync(file)) {
    console.warn(`! Transcript not found (${cfg.transcript}) — building without captions.`);
    return [];
  }
  const data = readJson(file);
  return data.transcript?.sentences ?? data.sentences ?? [];
}

// Split long sentences into short on-screen lines, timing each by its share of characters.
function chunk(sentence, maxWords = 8) {
  const words = String(sentence.text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const size = Math.ceil(words.length / Math.ceil(words.length / maxWords));
  const lines = [];
  for (let i = 0; i < words.length; i += size) lines.push(words.slice(i, i + size).join(' '));
  const chars = lines.reduce((sum, l) => sum + l.length, 0);
  const span = sentence.endSeconds - sentence.startSeconds;
  let t = sentence.startSeconds;
  return lines.map((text) => {
    const start = t;
    t += (span * text.length) / chars;
    return { text, start, end: t };
  });
}

const captions = loadSentences()
  .flatMap((s) => chunk(s))
  .map((c) => ({ ...c, start: Math.max(0, c.start), end: Math.min(dur, c.end) }))
  .filter((c) => c.end - c.start >= 0.2)
  .sort((a, b) => a.start - b.start);
for (let i = 0; i < captions.length - 1; i++) {
  captions[i].end = Math.min(captions[i].end, captions[i + 1].start);
}

// ---------- Fill the template ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const lowerThird = { start: r3(intro + 1.5), duration: r3(Math.min(6, dur - 2)) };
const enabled = {
  intro: intro > 0,
  outro: outro > 0,
  lowerThird: Boolean(cfg.lowerThird && cfg.channelName && lowerThird.duration >= 2),
};
const timing = {
  intro,
  footageStart: intro,
  footageDuration: dur,
  outroStart: r3(intro + dur),
  outro,
  total: r3(intro + dur + outro),
  lowerThird,
};

const captionHtml = captions
  .map(
    (c, i) =>
      `      <div id="caption-${i + 1}" class="clip layer caption" data-start="${r3(c.start + intro)}" data-duration="${r3(c.end - c.start)}" data-track-index="3"><span>${esc(c.text)}</span></div>`,
  )
  .join('\n');

const vars = {
  ACCENT: /^#[0-9a-f]{3,8}$/i.test(cfg.accentColor ?? '') ? cfg.accentColor : '#7C5CFF',
  TITLE: esc(cfg.title),
  SUBTITLE: esc(cfg.subtitle),
  CHANNEL: esc(cfg.channelName),
  OUTRO_TEXT: esc(cfg.outroText),
  OUTRO_CTA: esc(cfg.outroCta),
  TOTAL: timing.total,
  INTRO: intro,
  OUTRO: outro,
  OUTRO_START: timing.outroStart,
  FOOTAGE_START: intro,
  FOOTAGE_DURATION: dur,
  FOOTAGE_SRC: `assets/footage${ext}`,
  FOOTAGE_AUDIO: media.hasAudio ? 'data-has-audio="true"' : 'muted',
  LT_START: lowerThird.start,
  LT_DURATION: lowerThird.duration,
  CAPTIONS: captionHtml,
  TIMING_JSON: JSON.stringify(timing),
};

let html = fs.readFileSync(p('template', 'composition.html'), 'utf8');
html = html.replace(/[ \t]*<!-- if:(\w+) -->\r?\n([\s\S]*?)[ \t]*<!-- \/if:\1 -->\r?\n?/g, (_, name, body) =>
  enabled[name] ? body : '',
);
html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!(key in vars)) fail(`template/composition.html uses an unknown token {{${key}}}`);
  return String(vars[key]);
});
fs.writeFileSync(p('edit', 'index.html'), html);

// ---------- Sidecars for upload: captions (.srt) and chapters ----------
fs.mkdirSync(p('output'), { recursive: true });

const srtTime = (sec) => {
  const ms = Math.round(sec * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
if (captions.length) {
  const srt = captions
    .map((c, i) => `${i + 1}\n${srtTime(c.start + intro)} --> ${srtTime(c.end + intro)}\n${c.text}\n`)
    .join('\n');
  fs.writeFileSync(p('output', `${slug}.srt`), srt);
}

const ytTime = (sec) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor(s / 60) % 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};
const chapters = cfg.transcript && fs.existsSync(fromRoot(cfg.transcript)) ? readJson(fromRoot(cfg.transcript)).chapters ?? [] : [];
if (chapters.length) {
  const lines = chapters.map((c) => `${ytTime(c.timestampSeconds + intro)} ${c.title}`);
  if (intro > 0) lines.unshift('0:00 Intro');
  fs.writeFileSync(p('output', `${slug}-chapters.txt`), lines.join('\n') + '\n');
}

writeJson(p('edit', 'build.json'), { slug, title: cfg.title, hasAudio: media.hasAudio, ...timing });

console.log(`✓ Built edit/index.html — "${cfg.title}"`);
console.log(`  ${intro}s intro + ${dur}s footage + ${outro}s outro = ${timing.total}s`);
console.log(`  ${captions.length} caption lines${captions.length ? ` → output/${slug}.srt` : ''}`);
if (chapters.length) console.log(`  ${chapters.length} chapters → output/${slug}-chapters.txt`);
console.log('\nNext: npm run preview (look at it)  or  npm run render\n');
