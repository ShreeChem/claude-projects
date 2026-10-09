// Render edit/index.html to output/<slug>-picture.mp4 with HyperFrames (picture + voice, no music yet).
// Usage: npm run render [-- --quality draft | --low-memory-mode | any other `hyperframes render` flag]
//        npm run reel:render [-- <name>] [flags]   (renders reel-edit/ instead)
import { REEL_DIR, hyperframes, loadBuild, p, takeReelArg } from './lib.mjs';

const args = process.argv.slice(2);
const reel = takeReelArg(args);
const dir = reel ? REEL_DIR : 'edit';
const { slug } = loadBuild(dir);
hyperframes([
  'render',
  dir,
  '-o',
  p('output', `${slug}-picture.mp4`),
  // PNG frame extraction keeps screen-recording text crisp (JPEG smears UI colours).
  '--video-frame-format',
  'png',
  ...args,
]);
console.log(`\n✓ Rendered output/${slug}-picture.mp4\n\nNext: npm run ${reel ? 'reel:finish' : 'finish'}\n`);
