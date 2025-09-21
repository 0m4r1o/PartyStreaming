// public/app.js — wider chat, chat-only list, presence toasts, activity box

// ----- tiny helpers -----
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const statusEl = $("#status");
function setStatus(s){ statusEl.textContent = s || ""; }
function isNearBottom(el, pad=30){ return (el.scrollTop + el.clientHeight >= el.scrollHeight - pad); }
function scrollToBottom(el){ el.scrollTop = el.scrollHeight; }

// ----- DOM -----
const video = $("#video");
const videoSelect = $("#videoSelect");
const subsSelect  = $("#subsSelect");
const prebufferSel = $("#prebuffer");
const rawSelect = $("#rawSelect");
const refreshRawBtn = $("#refreshRaw");
const convertBtn = $("#convertBtn");
const convStatus = $("#convStatus");
const refreshListBtn = $("#refreshList");
const loadVideoBtn = $("#loadVideo");
const seekBtn = $("#seekBtn");
const hostControls = $("#hostControls");

// Chat DOM
const chatList = $("#chatList");
const msgInput = $("#msg");
const jumpBtn = $("#jumpLatest");

// Activity DOM
const activityList = $("#activityList");
const activityBox = $("#activityBox");

// Toasts (join / leave)
const toastWrap = $("#toasts");
function showToast(text, timeout=3000){
  const d = document.createElement("div");
  d.className = "toast";
  d.textContent = text;
  toastWrap.appendChild(d);
  setTimeout(()=> d.classList.add("hide"), timeout-200);
  setTimeout(()=> d.remove(), timeout);
}

// ----- state -----
let ws;
let isHost = false;
let roomId = "family";
let applyingRemote = false;
let currentFolder = "";
let lastState = { video:null, playing:false, time:0, updatedAt:Date.now() };
const SEGMENT_SECONDS = 6;
let firstLoadDone = false;

// ----- CHAT (only real chat) -----
function addChat({from, text, ts}){
  const atBottom = isNearBottom(chatList);
  const item = document.createElement("li");
  item.className = "chat-item";
  const time = new Date(ts||Date.now()).toLocaleTimeString();
  item.innerHTML = `
    <div class="top"><span>${esc(from||'')}</span><span class="muted">${time}</span></div>
    <div class="msg">${esc(text||'')}</div>`;
  chatList.appendChild(item);
  if (atBottom) { scrollToBottom(chatList); jumpBtn.hidden = true; }
  else { jumpBtn.hidden = false; }
}
chatList.addEventListener("scroll", () => { if (isNearBottom(chatList)) jumpBtn.hidden = true; });
jumpBtn.addEventListener("click", () => { scrollToBottom(chatList); jumpBtn.hidden = true; });

// ----- ACTIVITY (prebuffer / encoder) -----
function activity(line){
  const li = document.createElement("li");
  li.textContent = line;
  activityList.appendChild(li);
  activityBox.scrollTop = activityBox.scrollHeight;
}
function activityClear(){ activityList.innerHTML=""; }

// ----- errors -----
video.addEventListener("error", () => alert("Video error code: " + (video.error?.code || "unknown")));

// ----- HLS load (force start at 0 on first load) -----
function loadHls(src){
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src;
    const onMeta = () => { if (!firstLoadDone){ try{ video.currentTime = 0; }catch{} firstLoadDone = true; } video.removeEventListener("loadedmetadata", onMeta); };
    video.addEventListener("loadedmetadata", onMeta);
    return;
  }
  if (window.Hls && window.Hls.isSupported()){
    if (window._hls) window._hls.destroy();
    const hls = new Hls({
      maxBufferLength: 30,
      startPosition: 0,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      lowLatencyMode: false,
      enableWorker: true
    });
    hls.on(Hls.Events.ERROR, (_,data) => { console.error("hls.js",data); alert("hls.js error: " + data.type + " - " + data.details); });
    hls.on(Hls.Events.MANIFEST_PARSED, () => { if (!firstLoadDone){ try{ video.currentTime = 0; }catch{} firstLoadDone = true; } });
    hls.loadSource(src);
    hls.attachMedia(video);
    window._hls = hls;
    return;
  }
  video.src = src;
}

// ----- path helpers -----
function folderFromPath(p){
  if (!p) return "";
  const m = /^\/videos\/([^/]+)\/playlist\.m3u8$/.exec(p);
  return m ? decodeURIComponent(m[1]) : "";
}

// ----- subtitles -----
function clearTracks(){ for (const t of video.querySelectorAll("track")) t.remove(); for (const tt of video.textTracks) tt.mode = "disabled"; }
function addTrack(src, label, lang){
  clearTracks();
  const tr = document.createElement("track");
  tr.kind="subtitles"; tr.label=label||"Subtitles"; tr.srclang=lang||"en"; tr.src=src; tr.default = true;
  video.appendChild(tr);
  tr.addEventListener("load", ()=>{ for (const tt of video.textTracks){ tt.mode = tt.label===tr.label ? "showing":"disabled"; }});
}
async function loadSubtitleList(folder){
  subsSelect.innerHTML = `<option value="">Off</option>`;
  if (!folder) return;
  try{
    const res = await fetch(`/api/subtitles?folder=${encodeURIComponent(folder)}`, {cache:"no-store"});
    const data = await res.json();
    const items = Array.isArray(data.items)?data.items:[];
    if (!items.length) return;
    subsSelect.innerHTML = `<option value="">Off</option>` + items.map(it=>`<option value="${it.path}" data-lang="${it.lang}">${esc(it.label)}</option>`).join("");
  }catch{}
}
$("#refreshSubs").addEventListener("click", ()=> loadSubtitleList(currentFolder));
subsSelect.addEventListener("change", ()=>{
  const src = subsSelect.value;
  if (!src){ clearTracks(); return; }
  const opt = subsSelect.options[subsSelect.selectedIndex];
  addTrack(src, opt?.textContent, opt?.getAttribute("data-lang")||"en");
});

// ----- lists -----
async function loadVideoList(){
  try{
    videoSelect.innerHTML = `<option>— loading… —</option>`;
    const res = await fetch("/api/videos", {cache:"no-store"});
    const data = await res.json();
    const items = Array.isArray(data.items)?data.items:[];
    if (!items.length){ videoSelect.innerHTML = `<option>(no videos found)</option>`; return; }
    videoSelect.innerHTML = items.map(it=>`<option value="${it.id}" data-folder="${it.id}" data-path="${it.path}">${esc(it.label)}</option>`).join("");
  }catch{
    videoSelect.innerHTML = `<option>(failed to load)</option>`;
  }
}
refreshListBtn.addEventListener("click", ()=>{ if (isHost) loadVideoList(); });

async function loadRawList(){
  try{
    rawSelect.innerHTML = `<option>— loading… —</option>`;
    const res = await fetch("/api/unconverted", {cache:"no-store"});
    const data = await res.json();
    const items = Array.isArray(data.items)?data.items:[];
    if (!items.length){ rawSelect.innerHTML = `<option>(no raw files)</option>`; return; }
    rawSelect.innerHTML = items.map(it=>`<option value="${it.path}">${esc(it.label)} (${it.sizeMB} MB)</option>`).join("");
  }catch{
    rawSelect.innerHTML = `<option>(failed to load)</option>`;
  }
}
if (refreshRawBtn) refreshRawBtn.addEventListener("click", ()=> loadRawList());

// ----- conversion poll -----
async function countSegmentsOnce(folder){
  const res = await fetch(`/videos/${encodeURIComponent(folder)}/playlist.m3u8?ts=${Date.now()}`, {cache:"no-store"});
  if (!res.ok) return 0;
  const txt = await res.text();
  return (txt.match(/\.ts/g)||[]).length;
}
async function waitForSegments(folder, minSegs, timeoutMs=120000){
  const deadline = Date.now()+timeoutMs;
  let last=-1;
  while (Date.now()<deadline){
    try{
      const n = await countSegmentsOnce(folder);
      if (n!==last){ last=n; activity(`Encoder wrote ${n} segments…`); }
      if (n>=minSegs) return true;
    }catch{}
    await sleep(1500);
  }
  return false;
}
async function pollConversion(jobId, folder){
  convStatus.textContent = "Starting encoder…";
  while (true){
    await sleep(2000);
    try{
      const r = await fetch(`/api/convert/status/${encodeURIComponent(jobId)}?t=${Date.now()}`, {cache:"no-store"});
      if (!r.ok){ convStatus.textContent = "Job not found."; return; }
      const st = await r.json();
      if (st.status==="running"){ convStatus.textContent = `Converting… segments written: ${st.segs}`; continue; }
      if (st.status==="done"){
        convStatus.textContent = `Done → /videos/${folder}/playlist.m3u8`;
        await loadVideoList();
        for (let i=0;i<videoSelect.options.length;i++){
          if (videoSelect.options[i].getAttribute("data-folder")===folder){ videoSelect.selectedIndex = i; break; }
        }
        return;
      }
      if (st.status==="error"){ convStatus.textContent="Conversion failed."; return; }
      convStatus.textContent="Unknown status.";
      return;
    }catch{
      convStatus.textContent="Status error, retrying…";
    }
  }
}
if (convertBtn) convertBtn.addEventListener("click", async ()=>{
  if (!isHost) return alert("Host only");
  const rawPath = rawSelect?.value;
  if (!rawPath) return alert("Pick a file first.");
  activityClear();
  convStatus.textContent="Starting…";
  try{
    const baseName = rawPath.split(/[\\/]/).pop().replace(/\.[^.]+$/,'');
    const res = await fetch("/api/convert", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({path:rawPath, name:baseName})
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    convStatus.textContent = `Job ${data.jobId} → ${data.outputFolder}`;
    firstLoadDone = false;
    pollConversion(data.jobId, data.outputFolder);
  }catch(e){
    convStatus.textContent="Failed to start conversion.";
    alert(String(e));
  }
});

// ----- sync controls -----
function sendControl(action, t){ if (!ws || ws.readyState!==1) return; ws.send(JSON.stringify({type:"control", payload:{action, time:t}})); }
video.addEventListener("play",   ()=>{ if (!applyingRemote) sendControl("play", video.currentTime); });
video.addEventListener("pause",  ()=>{ if (!applyingRemote) sendControl("pause", video.currentTime); });
video.addEventListener("seeking",()=>{ if (!applyingRemote) sendControl("seek",  video.currentTime); });
video.addEventListener("seeked", ()=>{ if (!applyingRemote) sendControl("seek",  video.currentTime); });

function applyState(state, forceLoad=false){
  const changedVideo = state.video !== lastState.video;
  lastState = state;

  if (state.video && (changedVideo || forceLoad)){
    currentFolder = folderFromPath(state.video);
    loadSubtitleList(currentFolder);
    firstLoadDone = false;
    loadHls(state.video);
  }

  let t = state.time;
  if (state.playing) t += (Date.now() - state.updatedAt) / 1000;

  applyingRemote = true;
  try{
    if (Math.abs((video.currentTime||0) - t) > 1.0){ try{ video.currentTime = t; }catch{} }
    if (state.playing && video.paused) video.play().catch(()=>{});
    else if (!state.playing && !video.paused) video.pause();
  } finally {
    setTimeout(()=> applyingRemote=false, 50);
  }
}

// ----- WS connect -----
function connect(){
  const name = ($("#name").value.trim() || "Guest");
  roomId     = ($("#room").value.trim() || "family");
  const pin  = ($("#pin").value.trim());
  const proto = location.protocol==="https:" ? "wss":"ws";
  const url = `${proto}://${location.host}/ws?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(name)}&pin=${encodeURIComponent(pin)}`;

  try{
    setStatus("Connecting…");
    ws = new WebSocket(url);
    ws.onopen   = ()=> setStatus(`Connected to “${roomId}”`);
    ws.onerror  = (e)=>{ setStatus("WebSocket error"); console.error(e); };
    ws.onclose  = (e)=> setStatus(`Disconnected (${e.code})`);

    ws.onmessage = (ev)=>{
      const msg = JSON.parse(ev.data);
      if (msg.type==="hello"){
        isHost = !!msg.payload.you.isHost;
        hostControls.hidden = !isHost;
        if (isHost){ loadVideoList(); loadRawList(); }
        // Seed chat history (chat only)
        for (const entry of msg.payload.chat || []) addChat(entry);
        if (msg.payload.state) applyState(msg.payload.state, true);
        return;
      }
      if (msg.type==="system"){
        // Show presence toasts; do NOT put into chat
        showToast(msg.payload);
        return;
      }
      if (msg.type==="chat"){
        addChat(msg.payload);
        return;
      }
      if (msg.type==="state"){
        applyState(msg.payload);
        return;
      }
      if (msg.type==="hostGranted"){
        isHost = true; hostControls.hidden = false; loadVideoList(); loadRawList();
      }
    };
  }catch(err){
    setStatus("Connect failed");
    alert(err.message);
  }
}
$("#join").addEventListener("click", ()=>{ if (ws && ws.readyState===1) ws.close(); connect(); });
connect(); // auto-connect

// ----- send chat -----
msgInput.addEventListener("keydown", (e)=>{
  if (e.key==="Enter" && e.target.value.trim()){
    ws?.send(JSON.stringify({type:"chat", payload:e.target.value}));
    e.target.value = "";
  }
});

// ----- host load with prebuffer & move logs to Activity -----
loadVideoBtn.addEventListener("click", async ()=>{
  if (!isHost) return;
  const opt = videoSelect.options[videoSelect.selectedIndex];
  if (!opt) return alert("Select a video first.");
  const folder = opt.getAttribute("data-folder");
  const p = opt.getAttribute("data-path");
  if (!p || !folder) return alert("Invalid selection.");

  const pre = parseInt(prebufferSel?.value || "0", 10);
  if (pre > 0){
    const need = Math.max(1, Math.ceil(pre / SEGMENT_SECONDS));
    activity(`Prebuffering about ${pre}s (${need} segments)…`);
    const ok = await waitForSegments(folder, need, 180000);
    if (!ok){ alert("Timed out waiting for encoder to produce segments."); return; }
    activity("Prebuffer ready. Sharing to room…");
  }
  ws.send(JSON.stringify({type:"setVideo", payload:p}));
  currentFolder = folder;
  loadSubtitleList(currentFolder);
});

// Manual host buttons
document.querySelectorAll('.right-actions [data-act="play"]').forEach(b =>
  b.addEventListener("click", ()=> sendControl("play", video.currentTime))
);
document.querySelectorAll('.right-actions [data-act="pause"]').forEach(b =>
  b.addEventListener("click", ()=> sendControl("pause", video.currentTime))
);
if (seekBtn) seekBtn.addEventListener("click", ()=> sendControl("seek", video.currentTime));
