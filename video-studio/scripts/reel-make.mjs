// Build, render and finish a reel in one go.
// Usage: npm run reel:make [-- <name>] [any `hyperframes render` flag, e.g. --quality draft]
import { run, takeReelArg } from './lib.mjs';

const args = process.argv.slice(2);
const name = takeReelArg(args, { flag: false });
run(process.execPath, ['scripts/reel-build.mjs', name]);
run(process.execPath, ['scripts/render.mjs', '--reel', name, ...args]);
run(process.execPath, ['scripts/finish.mjs', '--reel', name]);
