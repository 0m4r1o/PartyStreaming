// server.js (ESM version for "type":"module")
// Requires: npm i express ws cors

import { createServer } from "http";
import express from "express";
import cors from "cors";
import path from "path";
import * as fs from "fs";
import * as fsp from "fs/promises";
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import process from "process";

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234"; // PIN to unlock host controls

// ----- paths (root-based) -----
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const VIDEOS_DIR = path.join(PUBLIC_DIR, "videos");
const RAW_DIR = process.env.RAW_DIR ? path.resolve(process.env.RAW_DIR) : path.join(ROOT, "unconverted");
const PS1_ENC = path.join(ROOT, "scripts", "convert-media.ps1");

// Ensure folders
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(VIDEOS_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

// ----- app & static -----
const app = express();
app.use(cors());
app.use(express.json());

// cache policy: m3u8 no-store, ts cacheable
app.use((req, res, next) => {
  if (req.url.endsWith(".m3u8")) res.setHeader("Cache-Control", "no-store");
  else if (req.url.endsWith(".ts")) res.setHeader("Cache-Control", "public, max-age=3600, immutable");
  next();
});

// serve index.html, app.js, and /videos/**
app.use(express.static(PUBLIC_DIR));

// health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ----- helpers -----
async function listDirs(root) {
  try {
    const names = await fsp.readdir(root);
    const out = [];
    for (const n of names) {
      const full = path.join(root, n);
      try {
        const st = await fsp.stat(full);
        if (st.isDirectory()) out.push(n);
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}
function sanitizeName(s) { return s.replace(/[^\w\- ]+/g, "_").trim(); }
function pickUniqueFolder(base) {
  let name = sanitizeName(base);
  let dir = path.join(VIDEOS_DIR, name);
  let i = 1;
  while (fs.existsSync(dir)) { i += 1; name = `${sanitizeName(base)}-${i}`; dir = path.join(VIDEOS_DIR, name); }
  return { name, dir };
}
function readTextSafe(file) { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }

// ----- API: list converted videos -----
app.get("/api/videos", async (_req, res) => {
  const folders = await listDirs(VIDEOS_DIR);
  const items = [];
  for (const id of folders) {
    const playlist = path.join(VIDEOS_DIR, id, "playlist.m3u8");
    if (fs.existsSync(playlist)) {
      items.push({ id, label: id, path: `/videos/${encodeURIComponent(id)}/playlist.m3u8` });
    }
  }
  items.sort((a, b) => a.label.localeCompare(b.label));
  res.json({ items });
});

// ----- API: list .vtt subtitles in a video folder -----
app.get("/api/subtitles", async (req, res) => {
  const folder = (req.query.folder || "").toString();
  if (!folder) return res.json({ items: [] });
  const dir = path.join(VIDEOS_DIR, folder);
  try {
    const names = await fsp.readdir(dir);
    const items = names
      .filter((n) => path.extname(n).toLowerCase() === ".vtt")
      .map((n) => ({ label: path.basename(n, ".vtt"), lang: "en", path: `/videos/${encodeURIComponent(folder)}/${encodeURIComponent(n)}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: "list_failed", detail: String(e) });
  }
});

// ----- API: list unconverted raw files -----
app.get("/api/unconverted", async (_req, res) => {
  try {
    const files = await fsp.readdir(RAW_DIR);
    const items = [];
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (![".mkv", ".mp4", ".mov", ".avi"].includes(ext)) continue;
      const p = path.join(RAW_DIR, f);
      const st = await fsp.stat(p);
      if (!st.isFile()) continue;
      items.push({ label: f, path: p, sizeMB: Math.round(st.size / 1e6), mtime: st.mtimeMs });
    }
    items.sort((a, b) => a.label.localeCompare(b.label));
    res.json({ dir: RAW_DIR, items });
  } catch (e) {
    res.status(500).json({ error: "list_failed", detail: String(e) });
  }
});

// ----- API: start conversion job -----
const convertJobs = new Map(); // id -> job

app.post("/api/convert", async (req, res) => {
  try {
    const { path: filePath, name } = req.body || {};
    if (!filePath) return res.status(400).json({ error: "missing_path" });

    const abs = path.resolve(filePath);
    if (!abs.startsWith(path.resolve(RAW_DIR))) return res.status(400).json({ error: "invalid_path" });

    const base = name && name.trim() ? name.trim() : path.basename(abs, path.extname(abs));
    const { name: folderName, dir: outDir } = pickUniqueFolder(base);
    fs.mkdirSync(outDir, { recursive: true });
    const playlist = path.join(outDir, "playlist.m3u8");

    const id = Math.random().toString(36).slice(2);
    const job = { id, file: abs, outDir, folderName, playlist, status: "running", log: [], started: Date.now() };
    convertJobs.set(id, job);

    if (process.platform === "win32") {
      const args = ["-ExecutionPolicy","Bypass","-NoProfile","-File", PS1_ENC, "-In", abs, "-OutDir", outDir, "-Crf", "20", "-Seg", "6"];
      const p = spawn("powershell.exe", args);
      p.stdout.on("data", d => { const s = d.toString(); job.log.push(s); if (job.log.length > 250) job.log.shift(); });
      p.stderr.on("data", d => { const s = d.toString(); job.log.push(s); if (job.log.length > 250) job.log.shift(); });
      p.on("close", code => { job.status = code === 0 ? "done" : "error"; job.ended = Date.now(); });
      job.proc = p;
    } else {
      const ffArgs = [
        "-y","-hide_banner","-loglevel","info","-stats","-i", abs,
        "-map","0:v:0","-map","0:a:0?","-sn","-dn",
        "-c:v","libx264","-pix_fmt","yuv420p",
        "-preset","veryfast","-crf","20",
        "-profile:v","high","-level","4.0",
        "-g","60","-keyint_min","60","-sc_threshold","0",
        "-c:a","aac","-ac","2","-ar","48000","-b:a","160k",
        "-f","hls","-hls_time","6","-hls_list_size","0","-hls_flags","independent_segments",
        "-hls_segment_type","mpegts","-hls_segment_filename", path.join(outDir, "segment%03d.ts"),
        playlist
      ];
      const p = spawn("ffmpeg", ffArgs);
      p.stdout.on("data", d => { const s = d.toString(); job.log.push(s); if (job.log.length > 250) job.log.shift(); });
      p.stderr.on("data", d => { const s = d.toString(); job.log.push(s); if (job.log.length > 250) job.log.shift(); });
      p.on("close", code => { job.status = code === 0 ? "done" : "error"; job.ended = Date.now(); });
      job.proc = p;
    }

    res.json({ jobId: id, outputFolder: folderName, playlist: `/videos/${encodeURIComponent(folderName)}/playlist.m3u8` });
  } catch (e) {
    res.status(500).json({ error: "convert_failed", detail: String(e) });
  }
});

// ----- API: poll conversion status -----
app.get("/api/convert/status/:id", (req, res) => {
  const job = convertJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "not_found" });
  let segs = 0;
  const txt = readTextSafe(job.playlist);
  if (txt) segs = (txt.match(/\.ts/g) || []).length;
  res.json({ id: job.id, status: job.status, folder: job.folderName, segs, started: job.started, ended: job.ended || null, log: job.log.slice(-20) });
});

// ----- WebSocket rooms (sync video + chat) -----
const rooms = new Map(); // roomId -> { state, chat[], clients:Set }

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { state: { video: null, playing: false, time: 0, updatedAt: Date.now() }, chat: [], clients: new Set() });
  }
  return rooms.get(roomId);
}
function broadcast(room, msg) {
  const s = JSON.stringify(msg);
  for (const c of room.clients) { try { c.socket.send(s); } catch {} }
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket, req) => {
  const url = new URL(req.url, "http://x");
  const roomId = url.searchParams.get("room") || "family";
  const name = (url.searchParams.get("name") || "Guest").slice(0, 40);
  const pin = url.searchParams.get("pin") || "";
  const isHost = pin === ADMIN_PIN;

  const room = getRoom(roomId);
  const client = { socket, name, isHost, roomId };
  room.clients.add(client);

  socket.send(JSON.stringify({ type: "hello", payload: { you: { name, isHost }, chat: room.chat, state: room.state } }));
  broadcast(room, { type: "system", payload: `${name} joined.` });

  socket.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.type === "chat") {
      const entry = { from: name, text: String(msg.payload || "").slice(0, 2000), ts: Date.now() };
      room.chat.push(entry); if (room.chat.length > 200) room.chat.shift();
      broadcast(room, { type: "chat", payload: entry });
      return;
    }

    if (msg.type === "setVideo") {
      if (!client.isHost) return;
      const p = String(msg.payload || "");
      const now = Date.now();
      room.state = { video: p, playing: false, time: 0, updatedAt: now };
      broadcast(room, { type: "state", payload: room.state });
      return;
    }

    if (msg.type === "control") {
      const { action, time } = msg.payload || {};
      const now = Date.now();
      if (action === "play") { room.state.playing = true; room.state.time = Number(time) || 0; room.state.updatedAt = now; }
      else if (action === "pause") { room.state.playing = false; room.state.time = Number(time) || 0; room.state.updatedAt = now; }
      else if (action === "seek") { room.state.time = Number(time) || 0; room.state.updatedAt = now; }
      broadcast(room, { type: "state", payload: room.state });
    }
  });

  socket.on("close", () => {
    room.clients.delete(client);
    broadcast(room, { type: "system", payload: `${name} left.` });
  });
});

// ----- start -----
server.listen(PORT, () => {
  console.log(`Watch party server on http://localhost:${PORT}`);
  console.log(`Admin PIN: ${ADMIN_PIN}`);
  console.log(`Videos dir: ${VIDEOS_DIR}`);
  console.log(`Raw dir:    ${RAW_DIR}`);
});
