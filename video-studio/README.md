# Video Studio — Tella + Epidemic Sound + HyperFrames + FFmpeg

A video editing pipeline for Windows. You record in **Tella**, pick music from **Epidemic Sound**, and run a few commands. **HyperFrames** adds the intro, captions, lower third and outro. **FFmpeg** does the final mix: it lowers the music while you talk, sets YouTube loudness and makes a thumbnail.

```
 ┌──────────┐  npm run tella:pull  ┌───────────────┐
 │  Tella   │ ───────────────────▶ │ media/tella/  │  MP4 + transcript + chapters
 │ (record) │     (Tella API)      └───────┬───────┘
 └──────────┘                              │
                                           ▼   npm run build
 ┌──────────────┐                 ┌─────────────────┐   npm run render   ┌─────────────────────┐
 │ Epidemic     │                 │ HyperFrames     │ ─────────────────▶ │ output/*-picture.mp4│
 │ Sound (music)│                 │ edit/index.html │   (picture+voice)  └──────────┬──────────┘
 └──────┬───────┘                 │ intro · captions│                               │
        │ via Claude or website   │ lower third ·   │                               ▼  npm run finish
        ▼                         │ outro           │                    ┌─────────────────────┐
 ┌──────────────┐                 └─────────────────┘                    │ FFmpeg: music bed,  │
 │ media/music/ │ ─────────────────────────────────────────────────────▶ │ ducking, -14 LUFS,  │
 └──────────────┘                                                        │ thumbnail           │
                                                                         └──────────┬──────────┘
                                                                                    ▼
                                                     output/<title>.mp4  .srt  -chapters.txt  -thumb.jpg
```

**What it costs:** HyperFrames and FFmpeg are free and open source. Tella has a 7-day trial and no free plan; after that it's from $13/month (billed yearly). With a free Epidemic Sound account you can search and preview music. You need a paid subscription to download tracks.

---

## Setup (one time, about 15 minutes)

All commands run in **PowerShell** from this folder:

```bash
cd C:\Mshr_Proj\claude\video-studio
```

### Step 1 — Install FFmpeg

HyperFrames needs FFmpeg to encode video, and the finishing step uses it for the audio mix.

```bash
winget install --id Gyan.FFmpeg -e
```

Then **close and reopen PowerShell and the Claude app** so they pick up the new PATH. Check it worked:

```bash
ffmpeg -version
```

### Step 2 — Node.js and project packages

Node.js 22 or newer is required. This machine already has v24, so you can skip installing it. Install the project packages, which include the pinned HyperFrames CLI:

```bash
npm install
```

(This was already run when the project was created. Run it again on any new machine.)

### Step 3 — Tella account and API key

1. Sign up at <https://www.tella.tv> (the 7-day trial works for this).
2. In Tella, go to **Settings → API keys** and create a key. It starts with `tella_pk_`.
3. Create your `.env` file and paste the key into it:

```bash
Copy-Item .env.example .env
```

```bash
notepad .env
```

Your `.env` should contain one line, `TELLA_API_KEY=tella_pk_...`. Keep this file private.

### Step 4 — Connect Epidemic Sound to Claude

With this connection, Claude can search Epidemic Sound for you ("find an upbeat lo-fi track around 3 minutes") and download the track into `media/music/`.

1. Create an account at <https://www.epidemicsound.com>. You need a paid plan to download.
2. Connect it in **one** of these ways:
   - **Claude desktop app (easiest):** go to **Settings → Connectors**, find **Epidemic Sound** in the directory (<https://claude.ai/directory/epidemic-sound>), then click **Connect** and log in.
   - **Claude Code in a terminal:** create an API key at <https://www.epidemicsound.com/account/api-keys>. Keys expire after 30 days. Then run:

     ```bash
     setx EPIDEMIC_SOUND_API_KEY "paste-your-key-here"
     ```

     Open a new terminal and run:

     ```bash
     claude mcp add -s user --transport http epidemic-sound https://www.epidemicsound.com/a/mcp-service/mcp --header 'Authorization: Bearer ${EPIDEMIC_SOUND_API_KEY}'
     ```

   - **No Claude at all:** download an MP3 from the Epidemic Sound website and save it in `media/music/`.
3. If you publish to YouTube, link your channel in your Epidemic Sound account so the music doesn't get copyright claims.

### Step 5 — (Optional) Connect Tella to Claude

The pull script uses the API key from Step 3, so you don't need this. Connect Tella if you also want Claude to browse or edit your Tella videos directly. It's useful for jobs like "cut the first 10 seconds of my last recording".

- **Claude desktop app:** go to **Settings → Connectors → Add custom connector**, name it `Tella`, and enter the URL `https://api.tella.com/mcp`.
- **Claude Code in a terminal:**

  ```bash
  claude mcp add --transport http --scope user tella https://api.tella.com/mcp
  ```

### Step 6 — (Optional) Install the HyperFrames skills for Claude

These teach Claude HyperFrames' own patterns, which helps when you ask it to redesign the template. Installing them may require Git (`winget install --id Git.Git -e`).

```bash
npx hyperframes skills update
```

### Step 7 — Check everything

```bash
npm run doctor
```

You want ✓ next to Node, ffmpeg, ffprobe, HyperFrames and the Tella key. The HyperFrames system check at the end also lists optional extras (whisper, TTS, MusicGen, Docker), and you can ignore those.

### Step 8 — Make it yours

Edit `config/video.json`:

| Field | What it does |
|---|---|
| `title`, `subtitle` | Text on the intro card. The title also names the output files. If you leave the title as "My Video Title", it gets filled from your Tella video's name |
| `channelName` | Shown in the lower third and the outro |
| `outroText`, `outroCta` | Outro headline and button text |
| `accentColor` | Brand colour as hex, for example `#FF4D4F` |
| `introSeconds`, `outroSeconds` | Length of each, in seconds. Set to `0` to turn one off |
| `captions`, `lowerThird` | `true` / `false` |
| `musicVolume` | Music level, from `0` to `1`. Default is `0.35` |
| `duckUnderVoice` | When `true`, the music automatically drops while you talk |
| `loudnessLufs` | Final loudness. `-14` is the YouTube/Spotify standard |
| `music` | Which file in `media/music/` to use. Leave it empty if there's only one |
| `footage`, `transcript`, `tellaVideoId` | Filled in for you by `tella:pull` |

To change the **look** (fonts, colours, animations, layout), edit `template/composition.html`. Don't edit `edit/index.html`, because `npm run build` overwrites it each time.

---

## Making a video

1. **Record in Tella.** Use Tella's **Auto Cut** to remove silences, filler words and mistakes, and add zooms and layouts there. Tella does the rough cut.
2. **Pull it into the project.** List your videos, then pull the newest one or a specific ID:

   ```bash
   npm run tella:list
   ```

   ```bash
   npm run tella:pull -- latest
   ```

   This exports a 1080p MP4 through the Tella API, downloads it with the transcript and chapters, and updates `config/video.json`. Add `--60fps` for a 60 fps export.
3. **Add music.** Either ask Claude (*"find a calm, modern background track about 3 minutes long on Epidemic Sound and download it to media/music"*) or put an MP3 in `media/music/` yourself.
4. **Build and preview:**

   ```bash
   npm run build
   ```

   ```bash
   npm run preview
   ```

   HyperFrames Studio opens in your browser so you can scrub through the edit. Press Ctrl+C in the terminal to stop it. The music isn't in the preview, because FFmpeg adds it in step 6.
5. **Render the picture.** This takes a few minutes depending on length. For a quick, lower-quality test, use `npm run render -- --quality draft`.

   ```bash
   npm run render
   ```

6. **Finish the video** with the music mix, loudness and thumbnail:

   ```bash
   npm run finish
   ```

Steps 4–6 in one go:

```bash
npm run make
```

**What you get, in `output/`:**

| File | Use |
|---|---|
| `<title>.mp4` | The finished video |
| `<title>.srt` | Captions file to upload to YouTube or LinkedIn |
| `<title>-chapters.txt` | Paste into the YouTube description (if you set chapters in Tella) |
| `<title>-thumb.jpg` | Thumbnail taken from the intro card |
| `<title>-picture.mp4` | Intermediate file without music. Safe to delete |

---

## Let Claude run it

Open this folder in Claude Code (or the Claude app's Code tab) and ask in plain English. For example:

- *"Make a video from my latest Tella recording, with upbeat electronic music."*
- *"Change the accent colour to orange and make the captions bigger."*
- *"Turn off the outro and render a draft."*

`CLAUDE.md` in this folder tells Claude how the pipeline works.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ffmpeg was not found` right after installing | Restart PowerShell and the Claude app so they pick up the new PATH |
| Render is slow or runs out of memory | Close other apps, or run `npm run render -- --low-memory-mode` (or `-- --workers 2`) |
| `Tella API … 401` | Your API key is wrong or was revoked. Create a new one and update `.env` |
| Tella export fails or you're not on a paid plan | In Tella, use **Download** to save the MP4 into `media/tella/`. Set `"footage": "media/tella/yourfile.mp4"` and `"transcript": ""` in the config. Captions are skipped without a transcript |
| Captions are missing | Tella's transcript wasn't ready yet. Wait a minute, then run `npm run tella:pull` again |
| `media/music has 2 tracks` | Set `"music": "media/music/the-one-you-want.mp3"` in the config |
| Music too loud or quiet | Change `musicVolume` (for example `0.2` or `0.5`) and run `npm run finish` again. You don't need to re-render |
| Want to check the composition | `npm run check` (lint, runtime and layout checks) |

## Project layout

```
config/video.json          ← your settings per video
template/composition.html  ← the look (HyperFrames HTML + GSAP animations)
scripts/                   ← tella-list, tella-pull, build, render, finish, doctor
edit/                      ← generated HyperFrames project (index.html, assets/)
media/tella/  media/music/ ← downloaded footage and music
output/                    ← finished videos
```
