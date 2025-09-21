# Family Stream — Watch Party

A dead-simple self-hosted watch-party for family and friends. Drop a video, convert to **HLS**, share a link, and watch together with **synced play/pause/seek**, **subtitles**, and **chat**.

---

## 0) What you’ll build

- A Node.js server (`server.js`) that serves the app and a WebSocket for sync.
- A `public/` folder with the web UI (`index.html`, `app.js`).
- Windows scripts to convert videos to **HLS** and convert **SRT → VTT** subtitles.
- Optional: expose your local site to the internet with **Cloudflare Tunnel**.

You can **start watching while a movie is still converting** (HLS segments stream as they’re produced).

---

## 1) Prerequisites (beginner-friendly)

### Windows 10/11 (recommended)

1. **Install Node.js (LTS)**  
   - Download from <https://nodejs.org> (choose **LTS**).  
   - After install: open **Command Prompt** → run:
     ```bat
     node -v
     npm -v
     ```
     Both should print versions.

2. **Install FFmpeg**  
   - Download a Windows build (e.g. “git/essentials” builds) and extract to `C:\ffmpeg` (so you have `C:\ffmpeg\bin\ffmpeg.exe`).  
   - Add `C:\ffmpeg\bin` to your **PATH**:  
     Start → “Edit the system environment variables” → **Environment Variables…** → **Path** → **New** → `C:\ffmpeg\bin` → OK.  
   - Test in a **new** Command Prompt:
     ```bat
     ffmpeg -version
     ```

3. **PowerShell**  
   - Comes with Windows. The `.bat` scripts call PowerShell for you.

> macOS/Linux work fine too (Node + FFmpeg). The provided Windows batch/PowerShell scripts won’t run as-is on macOS/Linux, but you can run the equivalent `ffmpeg` command shown below.

---

## 2) Project layout

```
family-stream/
├─ server.js                # Node server (ESM: uses "import" syntax)
├─ public/
│  ├─ index.html            # UI
│  ├─ app.js                # Front-end logic (HLS player, chat, sync)
│  └─ videos/               # HLS outputs: MovieName/playlist.m3u8 + segment###.ts + .vtt
├─ scripts/
│  ├─ convert-hls.bat       # Windows entry point
│  ├─ convert-media.ps1     # PowerShell: robust HLS encoder (EVENT playlist)
│  └─ srt2vtt.bat           # (optional) SRT → VTT helper
└─ unconverted/             # Drop source .mkv/.mp4 here (easiest path)
```

**Config variables** (top of `server.js` or via environment):

- `PORT` (default **3000**)
- `ADMIN_PIN` (default **1234**) – enter this PIN in the UI to unlock host controls
- `RAW_DIR` (default `./unconverted`) – where the **Unconverted** dropdown looks for files

---

## 3) Install & run

1. **Install server deps** (from the project folder):
   ```bat
   npm i express ws cors
   ```

2. **Start the server**:
   ```bat
   node server.js
   ```
   You should see:
   ```
   Watch party server on http://localhost:3000
   Admin PIN: 1234
   Videos dir: ...\public\videos
   Raw dir:    ...\unconverted
   ```

3. **Open the app**: <http://localhost:3000>

---

## 4) Convert a movie to HLS (so browsers can stream it)

### Easiest (Windows): use the provided script

- Put the source file (MKV/MP4/etc.) into `unconverted\`
- Run:
  ```bat
  scripts\convert-hls.bat "unconverted\MyMovie.mkv" "MyMovie"
  ```
  This creates:
  ```
  public\videos\MyMovie\playlist.m3u8
  public\videos\MyMovie\segment000.ts (and so on)
  ```

**What the script does**

- Picks an English audio track when available (falls back to the first audio)
- Transcodes to **H.264 + AAC** (universal in browsers)
- Writes an **EVENT** playlist that **starts at segment 0**, so you can **start at 0** even while converting
- Normalizes audio timing so the **first seconds are audible**

> The app’s **Unconverted → Convert → HLS** button runs the same logic for the selected file.

### Cross-platform (manual)

If you’re on macOS/Linux, run an equivalent `ffmpeg`:

```bash
ffmpeg -y -fflags +genpts -i "path/to/MyMovie.mkv" \
  -map 0:v:0 -map 0:a:0? -sn -dn \
  -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 20 \
  -profile:v high -level 4.0 -g 60 -keyint_min 60 -sc_threshold 0 \
  -c:a aac -ac 2 -ar 48000 -b:a 160k -af aresample=async=1:first_pts=0 \
  -f hls -hls_time 6 -hls_list_size 0 \
  -hls_flags independent_segments+append_list -hls_playlist_type event \
  -start_number 0 -hls_segment_type mpegts \
  -hls_segment_filename "public/videos/MyMovie/segment%03d.ts" \
  "public/videos/MyMovie/playlist.m3u8"
```

---

## 5) Add subtitles (SRT → VTT)

Browsers expect **WebVTT** (`.vtt`). You can:

- **Convert with the helper**:
  ```bat
  scripts\srt2vtt.bat "movies\Watchmen.srt" "public\videos\Watchmen" -overwrite
  ```

- **Or run `ffmpeg` directly** (works everywhere):
  ```bat
  ffmpeg -y -hide_banner -loglevel error -sub_charenc UTF-8 ^
    -i "movies\Watchmen.srt" -f webvtt "public\videos\Watchmen\Watchmen.vtt"
  ```

Then, in the UI choose the video folder and select the `.vtt` from the **Subtitles** dropdown (the app auto-lists `.vtt` files in that folder).

---

## 6) Use the app (host & viewers)

1. Open <http://localhost:3000>
2. Enter a **Name** and **Room** (e.g., `family`). Everyone who uses the same Room joins together.
3. To become **Host**, enter the **PIN** (default **1234**) and click **Join**. The host can:
   - **Load Video**: select a converted title (e.g., `MyMovie`) and click **Load Video**
   - **Prebuffer**: pick 15–60s so viewers don’t catch up to the live edge
   - Control **Play / Pause / Seek** for everyone
4. **Chat**: right panel. Join/leave appear as small toasts; chat list contains chat only.
5. **Watch while converting**: You can load a title once a few segments exist. The player stays slightly behind the encoder. Increase **Prebuffer** if you reach the live edge.

---

## 7) Share it on the internet (quick & easy)

**Cloudflare Tunnel (quick tunnel)**

1. Download `cloudflared.exe` from Cloudflare’s docs and put it in your PATH (or same folder).
2. With the Node server running, open Command Prompt:
   ```bat
   cloudflared tunnel --url http://localhost:3000
   ```
3. It prints a public URL like:
   ```
   https://something.trycloudflare.com
   ```
   Share that with your family. (Keep the `cloudflared` window open.)

> Quick tunnels are great for testing but not guaranteed for uptime/auth. For regular use, create a **named tunnel** in a free Cloudflare account and point a subdomain at it.

---

## 8) Common problems & fixes

- **Video starts in the middle / no audio at the start**  
  Use the provided scripts. They (a) write an **EVENT** playlist starting at 0 and (b) normalize timestamps and audio. Increase **Prebuffer** if you’re hitting the live edge.

- **“manifestLoadError” / 404 for `playlist.m3u8`**  
  The folder name in the app must match the converted folder under `public\videos\`. Use the name the script created.

- **“bufferAppendingError” in hls.js**  
  Usually caused by odd codecs/bitdepths. The script outputs H.264 (8-bit) + AAC; reconvert with the script.

- **Folder won’t delete (“file in use”)**  
  Stop Node/players, then:
  ```bat
  taskkill /im ffmpeg.exe /f
  ```
  Retry deleting the folder.

- **10-bit HEVC source fails with H.264 High profile**  
  The script transcodes to **8-bit yuv420p** automatically.

- **Cloudflare loads the page but video fails**  
  Always open the **app** through the tunnel URL (not just the playlist). The app uses relative URLs so the same host serves the HLS.

---

## 9) Useful commands (copy-paste)

```bat
:: Convert movie → HLS (outputs to public\videos\Watchmen)
scripts\convert-hls.bat "movies\Watchmen.mp4" "Watchmen"

:: Convert SRT → VTT into the same folder
scripts\srt2vtt.bat "movies\Watchmen.srt" "public\videos\Watchmen" -overwrite

:: Or directly with ffmpeg
ffmpeg -y -hide_banner -loglevel error -sub_charenc UTF-8 -i "movies\Watchmen.srt" -f webvtt "public\videos\Watchmen\Watchmen.vtt"

:: Another example
scripts\convert-hls.bat "movies\Manchester.By.The.Sea.mp4" "ManchesterByTheSea"

:: Quick Cloudflare tunnel
cloudflared tunnel --url http://localhost:3000
```

---

## 10) Tips for smooth sessions

- For 1080p sources on average PCs, **CRF 20** + **preset veryfast** is a good balance.  
  If CPU is struggling, try `-preset superfast` (larger files, faster encode).
- Use **30–60s Prebuffer** with large groups or slower encodes.
- Keep folder names simple (letters, numbers, spaces/hyphens are fine).
- Put multiple `.vtt` files in the video folder (e.g., `English.vtt`, `French.vtt`) and switch from the dropdown.

---

## 11) Changing defaults

- **Admin PIN**: set `ADMIN_PIN` env var or change the value at the top of `server.js`.  
- **Port**: `PORT=4000 node server.js` (or change in code).  
- **Raw folder for “Unconverted”**: change `RAW_DIR` (env var or code).

---

### That’s it!

If you hit anything weird, copy the **first 40 lines** of the `ffmpeg` output (from the conversion run) and any browser error, and we’ll tweak flags fast. Happy streaming 🎬🍿
