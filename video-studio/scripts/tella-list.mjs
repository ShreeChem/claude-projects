// List your most recent Tella videos so you can pick one to pull.
// Usage: npm run tella:list [-- <count>]
import { tella } from './lib.mjs';

const limit = Math.min(Number(process.argv[2]) || 10, 100);
const { videos } = await tella(`/videos?limit=${limit}`);

if (!videos.length) {
  console.log('No videos in your Tella workspace yet. Record one at https://www.tella.tv first.');
} else {
  console.log('\nID                      UPDATED     TITLE');
  for (const v of videos) {
    console.log(`${v.id.padEnd(22)}  ${v.updatedAt.slice(0, 10)}  ${v.name}`);
  }
  console.log('\nNext: npm run tella:pull -- <id>     (or: npm run tella:pull -- latest)\n');
}
