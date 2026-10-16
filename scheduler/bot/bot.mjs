// WA Scheduler bot: links to your WhatsApp as a "linked device" (like WhatsApp Web)
// and sends scheduled messages at their time, even while the phone is locked.
// Open http://localhost:8080 in the phone's browser to link and schedule.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from "@whiskeysockets/baileys";
import pino from "pino";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(HERE, "auth");
const DATA_FILE = path.join(HERE, "schedule.json");
const PORT = Number(process.env.PORT) || 8080;
const CHECK_EVERY_MS = 15000;

const log = (...a) => console.log(new Date().toLocaleString(), "-", ...a);

// ---------- schedule storage ----------
function loadItems(){
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return []; }
}
function saveItems(){
  fs.writeFileSync(DATA_FILE + ".tmp", JSON.stringify(items, null, 2));
  fs.renameSync(DATA_FILE + ".tmp", DATA_FILE);
}
let items = loadItems();

// Repeats are stepped in the phone owner's local time (offset sent by the browser),
// so "every day at 9:00" stays at 9:00 whatever timezone Node runs in.
function nextTime(ms, repeat, tzOffsetMin){
  const shift = -(tzOffsetMin || 0) * 60000;
  const d = new Date(ms + shift);
  if (repeat === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (repeat === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (repeat === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (repeat === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.getTime() - shift;
}

// ---------- WhatsApp connection ----------
let sock = null;
let status = { linked: false, connected: false, pairingCode: null, me: null, error: null };
let pairingNumber = null;

async function connect(){
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch {}

  sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: "silent" }),
    browser: Browsers.ubuntu("Chrome"),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });
  status.linked = !!state.creds.registered;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect, qr } = update;

    // WhatsApp is ready for linking: ask it for an 8-letter pairing code instead of a QR.
    if (qr && !state.creds.registered && pairingNumber && !status.pairingCode){
      try {
        status.pairingCode = await sock.requestPairingCode(pairingNumber);
        log("Pairing code:", status.pairingCode, "- enter it in WhatsApp > Linked devices > Link with phone number");
      } catch (e){
        status.error = "Could not get pairing code: " + e.message;
        log(status.error);
      }
    }

    if (connection === "open"){
      status = { linked: true, connected: true, pairingCode: null, me: sock.user?.id?.split(":")[0] || null, error: null };
      log("Connected to WhatsApp as", status.me);
      checkDue();
    }

    if (connection === "close"){
      status.connected = false;
      // A pairing code dies with its connection; a fresh one is requested on reconnect.
      if (!state.creds.registered) status.pairingCode = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut){
        log("Logged out from WhatsApp. Link again from the web page.");
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        status = { linked: false, connected: false, pairingCode: null, me: null, error: "Logged out. Link again." };
        pairingNumber = null;
      } else {
        log("Connection closed (" + (code || "network") + "), reconnecting...");
      }
      // Waiting for a pairing request? Don't spin until the user asks for a code.
      if (status.linked || pairingNumber) setTimeout(connect, 3000);
    }
  });
}

async function startPairing(number){
  pairingNumber = number;
  status.pairingCode = null;
  status.error = null;
  if (sock) { try { sock.end(undefined); } catch {} }
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  await connect();
}

// ---------- sending ----------
let checking = false;
async function checkDue(){
  if (checking || !status.connected) return;
  checking = true;
  try {
    const now = Date.now();
    for (const item of items){
      if (item.done || item.at > now) continue;
      try {
        const [found] = await sock.onWhatsApp(item.phone);
        if (!found?.exists) throw new Error("This number is not on WhatsApp");
        await sock.sendMessage(found.jid, { text: item.text });
        item.lastSent = Date.now();
        item.error = null;
        log("Sent to", item.phone);
        if (item.repeat && item.repeat !== "none"){
          let next = nextTime(item.at, item.repeat, item.tz);
          while (next <= Date.now()) next = nextTime(next, item.repeat, item.tz);
          item.at = next;
        } else {
          item.done = true;
        }
      } catch (e){
        item.error = e.message;
        log("Failed to send to", item.phone, "-", e.message);
        // Bad number: stop retrying. Anything else retries next check.
        if (/not on WhatsApp/.test(e.message)) item.done = true;
      }
      saveItems();
    }
  } finally {
    checking = false;
  }
}
setInterval(checkDue, CHECK_EVERY_MS);

// ---------- local web page + API (only reachable from this phone) ----------
function send(res, code, body, type = "application/json"){
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}
function readBody(req){
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 100000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e){ reject(e); } });
    req.on("error", reject);
  });
}
const digits = s => String(s || "").replace(/\D/g, "");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/"){
      return send(res, 200, fs.readFileSync(path.join(HERE, "ui.html")), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/api/state"){
      return send(res, 200, { status, items });
    }
    if (req.method === "POST" && url.pathname === "/api/pair"){
      const { phone } = await readBody(req);
      const number = digits(phone);
      if (number.length < 10) return send(res, 400, { error: "Enter your number with country code" });
      startPairing(number).catch(e => { status.error = e.message; });
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/items"){
      const b = await readBody(req);
      const phone = digits(b.phone);
      const text = String(b.text || "").trim();
      const at = Number(b.at);
      if (phone.length < 10) return send(res, 400, { error: "Enter the number with country code" });
      if (!text) return send(res, 400, { error: "Type a message" });
      if (!Number.isFinite(at)) return send(res, 400, { error: "Pick a date and time" });
      const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        phone, name: String(b.name || "").trim(), text, at,
        repeat: ["daily", "weekly", "monthly", "yearly"].includes(b.repeat) ? b.repeat : "none",
        tz: Number(b.tz) || 0, done: false, error: null, lastSent: null
      };
      items.push(item);
      saveItems();
      log("Scheduled for", phone, "at", new Date(at).toISOString());
      return send(res, 200, item);
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/items/")){
      const id = url.pathname.split("/").pop();
      items = items.filter(i => i.id !== id);
      saveItems();
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: "Not found" });
  } catch (e){
    send(res, 500, { error: e.message });
  }
});

// 127.0.0.1 only, so nobody else on the Wi-Fi can send messages from your number.
server.listen(PORT, "127.0.0.1", () => {
  log("WA Scheduler running. Open http://localhost:" + PORT + " in this phone's browser.");
});

if (fs.existsSync(path.join(AUTH_DIR, "creds.json"))) connect();
else log("Not linked yet. Open the page to link your WhatsApp.");
