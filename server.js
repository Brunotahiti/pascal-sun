/* =========================================================================
   Galerie Pascal Sun — serveur
   Sert le site statique + l'espace admin (/admin) :
   - GET  /api/catalogue        catalogue éditable (œuvres + textes)
   - PUT  /api/catalogue        sauvegarde (admin)
   - POST /api/upload           photos des toiles (admin)
   - POST /api/login|logout     session admin (cookie signé)
   Données persistées dans DATA_DIR (volume Docker : /app/data).
   ========================================================================= */

"use strict";

const express = require("express");
const multer = require("multer");
const compression = require("compression");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const CATALOGUE_FILE = path.join(DATA_DIR, "catalogue.json");
const SECRET = process.env.APP_SECRET || "pascal-sun-dev-secret";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "3mb" }));

/* ------------------------------------------------------------- session -- */

const sign = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("hex");

function isAuthed(req) {
  const cookie = (req.headers.cookie || "")
    .split(/;\s*/)
    .find((c) => c.startsWith("ps_admin="));
  if (!cookie) return false;
  const [ts, sig] = cookie.slice("ps_admin=".length).split(".");
  if (!ts || !sig) return false;
  const expected = sign(ts);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) &&
    Date.now() - Number(ts) < 7 * 24 * 3600 * 1000;
}

const requireAuth = (req, res, next) =>
  isAuthed(req) ? next() : res.status(401).json({ error: "unauthorized" });

app.post("/api/login", (req, res) => {
  const given = String((req.body || {}).password || "");
  const ok = given.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: "bad-password" });
  const ts = Date.now().toString();
  res.setHeader("Set-Cookie",
    `ps_admin=${ts}.${sign(ts)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "ps_admin=; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => res.json({ authed: isAuthed(req) }));

/* ----------------------------------------------------------- catalogue -- */

app.get("/api/catalogue", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  if (fs.existsSync(CATALOGUE_FILE)) return res.sendFile(CATALOGUE_FILE);
  res.json({ artworks: null, uiTexts: {} });
});

app.put("/api/catalogue", requireAuth, (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.artworks)) {
    return res.status(400).json({ error: "artworks-array-required" });
  }
  fs.writeFileSync(CATALOGUE_FILE, JSON.stringify(body, null, 2));
  res.json({ ok: true });
});

/* ------------------------------------------------- statistiques (Umami) -- */
/* Le serveur interroge Umami en interne (réseau Docker) et sert un résumé
   à l'admin : l'utilisateur ne quitte jamais le site. */

const UMAMI_URL = process.env.UMAMI_URL || "";
const UMAMI_USER = process.env.UMAMI_USER || "admin";
const UMAMI_PASSWORD = process.env.UMAMI_PASSWORD || "";
const UMAMI_WEBSITE_ID = process.env.UMAMI_WEBSITE_ID || "";

let umamiToken = null;

async function umamiLogin() {
  const r = await fetch(`${UMAMI_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: UMAMI_USER, password: UMAMI_PASSWORD })
  });
  if (!r.ok) throw new Error(`umami login ${r.status}`);
  umamiToken = (await r.json()).token;
}

async function umami(pathAndQuery) {
  if (!umamiToken) await umamiLogin();
  const call = () => fetch(`${UMAMI_URL}/api/websites/${UMAMI_WEBSITE_ID}/${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${umamiToken}` }
  });
  let r = await call();
  if (r.status === 401) { await umamiLogin(); r = await call(); }
  if (!r.ok) throw new Error(`umami ${r.status}`);
  return r.json();
}

app.get("/api/stats/overview", requireAuth, async (req, res) => {
  if (!UMAMI_URL || !UMAMI_WEBSITE_ID) {
    return res.status(503).json({ error: "stats-not-configured" });
  }
  try {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 7));
    const endAt = Date.now();
    const startAt = endAt - days * 864e5;
    const unit = days <= 2 ? "hour" : "day";
    const q = `startAt=${startAt}&endAt=${endAt}`;
    const tz = encodeURIComponent("Pacific/Tahiti");

    const [stats, series, countries, pages, referrers, devices, active] = await Promise.all([
      umami(`stats?${q}`),
      umami(`pageviews?${q}&unit=${unit}&timezone=${tz}`),
      umami(`metrics?${q}&type=country&limit=12`),
      umami(`metrics?${q}&type=path&limit=10`),
      umami(`metrics?${q}&type=referrer&limit=10`),
      umami(`metrics?${q}&type=device&limit=6`),
      umami("active")
    ]);

    res.json({ days, unit, stats, series, countries, pages, referrers, devices, active });
  } catch (err) {
    console.error("stats:", err.message);
    res.status(502).json({ error: "stats-unavailable" });
  }
});

/* --------------------------------------------------------------- upload -- */

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const safe = file.originalname.toLowerCase()
        .replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-80);
      cb(null, `${Date.now()}-${safe || "photo.webp"}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 }
});

app.post("/api/upload", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file-required" });
  res.json({ path: `/uploads/${req.file.filename}` });
});

/* --------------------------------------------------------------- static -- */

app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "7d", immutable: true }));

app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));

app.use(express.static(__dirname, {
  maxAge: "7d",
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  }
}));

app.listen(PORT, () => console.log(`Galerie Pascal Sun en écoute sur :${PORT}`));
