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
const vm = require("vm");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const CATALOGUE_FILE = path.join(DATA_DIR, "catalogue.json");
const SECRET = process.env.APP_SECRET || "pascal-sun-dev-secret";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const NEWSLETTER_FILE = path.join(DATA_DIR, "newsletter.json");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* Au premier démarrage, le catalogue est semé depuis js/data.js afin que la
   gestion de stock fonctionne avant même la première sauvegarde admin. */
function seedCatalogue() {
  if (fs.existsSync(CATALOGUE_FILE)) return;
  try {
    const sandbox = { localStorage: { getItem: () => null } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "js", "data.js"), "utf8"), sandbox);
    const artworks = typeof sandbox.normalizeArtworks === "function"
      ? sandbox.normalizeArtworks(sandbox.ARTWORKS || [])
      : (sandbox.ARTWORKS || []);
    fs.writeFileSync(CATALOGUE_FILE, JSON.stringify({
      artworks,
      events: sandbox.EVENTS || [],
      uiTexts: { fr: {}, en: {} }
    }, null, 2));
    console.log("Catalogue initial semé depuis js/data.js");
  } catch (e) {
    console.error("seed catalogue:", e.message);
  }
}
seedCatalogue();

const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(compression());
app.use(express.json({ limit: "3mb" }));

/* ------------------------------------------------------------ sécurité -- */

/* En-têtes de protection du navigateur */
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // camera=(self) : la visionneuse « Voir chez moi (AR) » en a besoin.
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(), microphone=(), payment=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

/* Limitation de débit : protège la connexion admin (force brute) et les
   formulaires publics (spam). Fenêtre glissante en mémoire. */
const hits = new Map();
function rateLimit({ windowMs, max, key }) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "?";
    const k = key + ":" + ip;
    const now = Date.now();
    const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: "trop-de-tentatives" });
    }
    list.push(now);
    hits.set(k, list);
    if (hits.size > 5000) hits.clear(); // garde-fou mémoire
    next();
  };
}
const loginLimit = rateLimit({ windowMs: 15 * 60e3, max: 8, key: "login" });
const formLimit = rateLimit({ windowMs: 60 * 60e3, max: 20, key: "form" });

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

app.post("/api/login", loginLimit, (req, res) => {
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
  const previous = readJSON(CATALOGUE_FILE, { artworks: [] }).artworks || [];
  fs.writeFileSync(CATALOGUE_FILE, JSON.stringify(body, null, 2));
  res.json({ ok: true });
  // Annonce des nouvelles œuvres aux abonnés (après réponse, sans bloquer)
  setTimeout(() => announceNewArtworks(previous, body.artworks).catch(() => {}), 500);
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

/* -------------------------------------------------------------- emails -- */
/* SMTP Hostinger : s'active dès que SMTP_PASS est fourni en variable
   d'environnement. Sans configuration, le site fonctionne à l'identique
   (les emails sont simplement ignorés). */

/* Le mot de passe email est stocké sur le volume persistant (data/mail.json,
   saisi une fois dans l'admin) : il survit à tous les redéploiements.
   Les variables d'environnement restent prioritaires si présentes. */
const nodemailer = require("nodemailer");
const MAIL_CONF_FILE = path.join(DATA_DIR, "mail.json");
const SMTP_HOST = process.env.SMTP_HOST || "smtp.hostinger.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || "contact@pascal-sun.com";

let mailer = null;
let ARTIST_NOTIFY = SMTP_USER;

function initMailer() {
  const conf = readJSON(MAIL_CONF_FILE, {});
  const pass = process.env.SMTP_PASS || conf.pass || "";
  const user = process.env.SMTP_USER || conf.user || SMTP_USER;
  ARTIST_NOTIFY = process.env.ARTIST_NOTIFY || conf.notify || user;
  mailer = pass
    ? nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user, pass } })
    : null;
  if (mailer) mailer.__from = `"Galerie Pascal Sun" <${user}>`;
  return Boolean(mailer);
}
initMailer();

const mailEnabled = () => Boolean(mailer);

function sendMail(to, subject, text) {
  if (!mailer || !to) return Promise.resolve(false);
  return mailer.sendMail({ from: mailer.__from, to, subject, text })
    .then(() => true)
    .catch((e) => { console.error("mail:", e.message); return false; });
}

/* Saisie du mot de passe email depuis l'admin (jamais renvoyé en clair). */
app.post("/api/mail-config", requireAuth, async (req, res) => {
  const { pass } = req.body || {};
  if (!pass || String(pass).length < 4) return res.status(400).json({ error: "mot-de-passe-requis" });
  writeJSON(MAIL_CONF_FILE, { user: SMTP_USER, pass: String(pass), notify: SMTP_USER });
  const ok = initMailer();
  if (!ok) return res.status(500).json({ error: "configuration-invalide" });
  const test = await sendMail(ARTIST_NOTIFY, "✅ Emails de la galerie activés",
    "La configuration email de pascal-sun.com fonctionne : ce message en est la preuve.\n\nElle est désormais conservée de façon permanente, même après les mises à jour du site.");
  res.json({ ok: true, testSent: test });
});

const COMMISSIONS_FILE = path.join(DATA_DIR, "commissions.json");
const PRODUIT_FR = { original: "Œuvre originale", tirage: "Tirage d'art édition limitée", affiche: "Affiche" };

const DEFAULT_SHIPPING = {
  zones: [
    { key: "pf", fr: "Polynésie française", original: 0, grand: 0, tirage: 15, affiche: 8 },
    { key: "fr", fr: "France métropolitaine", original: 190, grand: 290, tirage: 25, affiche: 15 },
    { key: "eu", fr: "Europe", original: 240, grand: 360, tirage: 30, affiche: 18 },
    { key: "monde", fr: "Reste du monde", original: 320, grand: 480, tirage: 40, affiche: 25 }
  ],
  freeAbove: 4000
};

function orderEmailText(order) {
  const lignes = order.lines.map((l) =>
    `  • ${l.titre} — ${PRODUIT_FR[l.key] || l.key}${l.qty > 1 ? ` × ${l.qty}` : ""} — ${l.prixEUR * l.qty} €`).join("\n");
  const mode = order.mode === "retrait"
    ? "Retrait à Tahiti (gratuit)"
    : `Livraison — ${order.zone || ""} : ${order.livraisonEUR ? order.livraisonEUR + " €" : "offerte"}`;
  const paiement = { card: "Carte bancaire", virement: "Virement bancaire", paypal: "PayPal" }[order.payment] || order.payment;
  return { lignes, mode, paiement };
}

/* --------------------------------------------- sauvegardes quotidiennes -- */
/* Chaque nuit (heure de Tahiti), une archive compressée de toutes les
   données est écrite dans data/backups/. Les 30 dernières sont conservées.
   L'admin peut aussi télécharger une sauvegarde à tout moment. */

const zlib = require("zlib");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function collectData() {
  return {
    exportedAt: new Date().toISOString(),
    catalogue: readJSON(CATALOGUE_FILE, null),
    orders: readJSON(ORDERS_FILE, []),
    contacts: readJSON(NEWSLETTER_FILE, []),
    commissions: readJSON(COMMISSIONS_FILE, []),
    idees: readJSON(IDEAS_FILE, [])
  };
}

function makeBackup() {
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const file = path.join(BACKUP_DIR, `pascal-sun-${stamp}.json.gz`);
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(collectData())));
    // rotation : on garde les 30 plus récentes
    const olds = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".json.gz")).sort();
    olds.slice(0, Math.max(0, olds.length - 30)).forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
    console.log("Sauvegarde écrite :", path.basename(file));
    return file;
  } catch (e) {
    console.error("backup:", e.message);
    return null;
  }
}

/* Vérification toutes les heures : sauvegarde si celle du jour manque. */
function backupTick() {
  const stamp = new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(path.join(BACKUP_DIR, `pascal-sun-${stamp}.json.gz`))) makeBackup();
}
setTimeout(backupTick, 30e3);
setInterval(backupTick, 3600e3);

app.get("/api/backup", requireAuth, (_req, res) => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename=pascal-sun-sauvegarde-${stamp}.json.gz`);
  res.send(zlib.gzipSync(JSON.stringify(collectData(), null, 2)));
});

app.get("/api/backups", requireAuth, (_req, res) => {
  const list = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".json.gz")).sort().reverse()
    .map((f) => ({ file: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size }));
  res.json(list);
});

/* ------------------------------------------------- notifications push -- */
/* Web Push vers les appareils de Pascal (admin). S'active avec les clés
   VAPID en variables d'environnement. */

const webpush = require("web-push");
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || "";
const PUSH_FILE = path.join(DATA_DIR, "push.json");
const IDEAS_FILE = path.join(DATA_DIR, "idees.json");

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails("mailto:contact@pascal-sun.com", VAPID_PUBLIC, VAPID_PRIVATE);
}

async function sendPush(title, body, url) {
  if (!VAPID_PUBLIC) return;
  const subs = readJSON(PUSH_FILE, []);
  const payload = JSON.stringify({ title, body, url: url || "/admin" });
  const alive = [];
  for (const sub of subs) {
    try { await webpush.sendNotification(sub, payload); alive.push(sub); }
    catch (e) { if (e.statusCode !== 404 && e.statusCode !== 410) alive.push(sub); }
  }
  if (alive.length !== subs.length) writeJSON(PUSH_FILE, alive);
}

app.get("/api/push/key", requireAuth, (_req, res) => res.json({ key: VAPID_PUBLIC }));

app.post("/api/push/subscribe", requireAuth, (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: "subscription-invalide" });
  const subs = readJSON(PUSH_FILE, []);
  if (!subs.find((s) => s.endpoint === sub.endpoint)) { subs.push(sub); writeJSON(PUSH_FILE, subs); }
  res.json({ ok: true, devices: subs.length });
});

/* ------------------------------------------------------ boîte à idées -- */

app.post("/api/idees", formLimit, (req, res) => {
  const b = req.body || {};
  if (!b.message || String(b.message).trim().length < 3) {
    return res.status(400).json({ error: "message-requis" });
  }
  const idees = readJSON(IDEAS_FILE, []);
  const idee = {
    id: "ID-" + Date.now().toString(36).toUpperCase(),
    date: new Date().toISOString(),
    name: String(b.name || "").slice(0, 160),
    email: String(b.email || "").slice(0, 200),
    message: String(b.message).slice(0, 3000),
    statut: "nouvelle"
  };
  idees.unshift(idee);
  writeJSON(IDEAS_FILE, idees);
  if (idee.email) upsertContact({ email: idee.email, name: idee.name, source: "idee" });

  sendPush("💡 Nouvelle idée dans la boîte",
    `${idee.name || "Un visiteur"} : « ${idee.message.slice(0, 120)}${idee.message.length > 120 ? "…" : ""} »`);
  sendMail(ARTIST_NOTIFY, "💡 Nouvelle idée dans la boîte à idées",
`${idee.name || "Un visiteur"}${idee.email ? " <" + idee.email + ">" : ""} propose :

« ${idee.message} »

→ https://pascal-sun.com/admin (onglet Boîte à idées)`);

  res.json({ ok: true, id: idee.id });
});

app.get("/api/idees", requireAuth, (_req, res) => res.json(readJSON(IDEAS_FILE, [])));

app.post("/api/idees/statut", requireAuth, (req, res) => {
  const { id, statut } = req.body || {};
  let idees = readJSON(IDEAS_FILE, []);
  if (statut === "supprimee") idees = idees.filter((i) => i.id !== id);
  else { const i = idees.find((x) => x.id === id); if (i && ["nouvelle", "lue"].includes(statut)) i.statut = statut; }
  writeJSON(IDEAS_FILE, idees);
  res.json({ ok: true });
});

/* ----------------------------------------------------- contacts (CRM) -- */

function upsertContact({ email, name, country, source, orderTotalEUR }) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
  const contacts = readJSON(NEWSLETTER_FILE, []);
  let c = contacts.find((x) => x.email.toLowerCase() === email.toLowerCase());
  if (!c) {
    c = { email, name: name || "", country: country || "", sources: [], orders: 0, totalEUR: 0, notes: "", createdAt: new Date().toISOString() };
    contacts.push(c);
  }
  if (name) c.name = name;
  if (country) c.country = country;
  if (source && !c.sources.includes(source)) c.sources.push(source);
  if (source === "commande") { c.orders += 1; c.totalEUR += orderTotalEUR || 0; }
  c.lastSeen = new Date().toISOString();
  writeJSON(NEWSLETTER_FILE, contacts);
}

/* inscription newsletter (publique) */
app.post("/api/newsletter", formLimit, (req, res) => {
  const { email, name } = req.body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
    return res.status(400).json({ error: "email-invalide" });
  }
  upsertContact({ email: String(email).slice(0, 200), name: String(name || "").slice(0, 120), source: "newsletter" });
  res.json({ ok: true });
});

/* liste + édition des contacts (admin) */
app.get("/api/contacts", requireAuth, (_req, res) => res.json(readJSON(NEWSLETTER_FILE, [])));

app.post("/api/contacts", requireAuth, (req, res) => {
  const { email, name, country, notes } = req.body || {};
  if (!email) return res.status(400).json({ error: "email-requis" });
  upsertContact({ email, name, country, source: "manuel" });
  if (notes !== undefined) {
    const contacts = readJSON(NEWSLETTER_FILE, []);
    const c = contacts.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
    if (c) { c.notes = String(notes).slice(0, 2000); writeJSON(NEWSLETTER_FILE, contacts); }
  }
  res.json({ ok: true });
});

app.delete("/api/contacts", requireAuth, (req, res) => {
  const { email } = req.body || {};
  const contacts = readJSON(NEWSLETTER_FILE, []).filter((x) => x.email.toLowerCase() !== String(email || "").toLowerCase());
  writeJSON(NEWSLETTER_FILE, contacts);
  res.json({ ok: true });
});

app.get("/api/contacts.csv", requireAuth, (_req, res) => {
  const rows = readJSON(NEWSLETTER_FILE, []);
  const csv = ["email;nom;pays;sources;commandes;total_eur;inscrit_le"]
    .concat(rows.map((c) => [c.email, c.name, c.country, (c.sources || []).join("|"), c.orders, c.totalEUR, c.createdAt].join(";")))
    .join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=contacts-pascal-sun.csv");
  res.send("﻿" + csv);
});

/* ----------------------------------------------------------- commandes -- */
/* Enregistre la commande, réserve automatiquement les originaux et
   décrémente le stock des tirages/affiches, puis crée la fiche client. */

app.post("/api/orders", formLimit, (req, res) => {
  const { items, client } = req.body || {};
  if (!Array.isArray(items) || !items.length || !client || !client.email) {
    return res.status(400).json({ error: "commande-invalide" });
  }

  const catalogue = readJSON(CATALOGUE_FILE, { artworks: [] });
  let totalEUR = 0;
  const lines = [];

  for (const it of items.slice(0, 40)) {
    const art = (catalogue.artworks || []).find((a) => a.id === it.id);
    if (!art) continue;
    const produit = (art.produits || []).find((p) => p.key === it.key) ||
      (it.key === "original" ? { key: "original", prixEUR: art.prixEUR, stock: 1 } : null);
    if (!produit) continue;
    const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));

    if (it.key === "original") {
      if (art.statut === "vendu" || art.vendu) continue;
      art.statut = "reserve"; // réservation automatique dès la demande
      lines.push({ id: art.id, titre: art.titre, key: "original", qty: 1, prixEUR: produit.prixEUR });
      totalEUR += produit.prixEUR;
    } else {
      if (typeof produit.stock === "number") {
        if (produit.stock <= 0) continue;
        produit.stock = Math.max(0, produit.stock - qty);
      }
      lines.push({ id: art.id, titre: art.titre, key: it.key, qty, prixEUR: produit.prixEUR });
      totalEUR += produit.prixEUR * qty;
    }
  }

  if (!lines.length) return res.status(409).json({ error: "articles-indisponibles" });

  /* Frais de livraison calculés côté serveur (source de vérité). */
  const ship = catalogue.shipping || DEFAULT_SHIPPING;
  const zoneKey = String((client.zone || "pf")).slice(0, 10);
  const zone = (ship.zones || []).find((z) => z.key === zoneKey) || (ship.zones || [])[0];
  let livraisonEUR = 0;
  if (client.mode !== "retrait" && zone) {
    if (!(ship.freeAbove && totalEUR >= ship.freeAbove)) {
      for (const l of lines) {
        const art = (catalogue.artworks || []).find((a) => a.id === l.id);
        const dim = String((art && art.dimensions) || "").match(/(\d+)\s*[×x]\s*(\d+)/);
        const grand = dim && Math.max(+dim[1], +dim[2]) > 100;
        const tarif = l.key === "original" ? (grand ? zone.grand : zone.original)
          : (zone[l.key] || 0) * l.qty;
        livraisonEUR += tarif || 0;
      }
    }
  }

  writeJSON(CATALOGUE_FILE, catalogue);

  const orders = readJSON(ORDERS_FILE, []);
  const order = {
    id: "PS-" + Date.now().toString(36).toUpperCase(),
    date: new Date().toISOString(),
    lines,
    totalEUR,
    livraisonEUR,
    zone: zone ? zone.fr : "",
    grandTotalEUR: totalEUR + livraisonEUR,
    client: {
      name: String(client.name || "").slice(0, 160),
      email: String(client.email || "").slice(0, 200),
      country: String(client.country || "").slice(0, 120),
      message: String(client.message || "").slice(0, 2000)
    },
    mode: client.mode === "retrait" ? "retrait" : "livraison",
    payment: ["card", "virement", "paypal"].includes(client.payment) ? client.payment : "virement",
    statut: "nouvelle"
  };
  orders.unshift(order);
  writeJSON(ORDERS_FILE, orders);

  upsertContact({ email: order.client.email, name: order.client.name, country: order.client.country, source: "commande", orderTotalEUR: totalEUR });

  // Emails automatiques (si SMTP configuré)
  const { lignes, mode, paiement } = orderEmailText(order);
  sendMail(order.client.email, `Votre commande ${order.id} — Galerie Pascal Sun`,
`Ia ora na ${order.client.name},

Māuruuru pour votre commande ! Elle est bien enregistrée sous la référence ${order.id}.

${lignes}

Total œuvres : ${totalEUR} €
Réception : ${mode}
Total à régler : ${order.grandTotalEUR} €
Paiement choisi : ${paiement}

Votre certificat d'authenticité (à conserver) :
${order.lines.filter((l) => l.key !== "affiche").map((l, i) =>
  `  ${l.titre} → https://pascal-sun.com/certificat.html?c=${order.id}-${i}`).join("\n")}

Pascal vous écrit personnellement sous 48 h pour confirmer le paiement sécurisé
et organiser la réception de votre œuvre (certificat d'authenticité inclus pour
les originaux et tirages numérotés).

À très vite,
Pascal Sun — Tahiti
https://pascal-sun.com`);

  sendPush("🛒 Nouvelle commande !", `${order.client.name} — ${order.grandTotalEUR} € (${order.id})`);
  sendMail(ARTIST_NOTIFY, `🛒 Nouvelle commande ${order.id} — ${totalEUR} €`,
`Nouvelle commande sur la galerie !

${lignes}

Total œuvres : ${totalEUR} € | Livraison : ${order.livraisonEUR} € | À régler : ${order.grandTotalEUR} €
Client : ${order.client.name} <${order.client.email}> ${order.client.country ? "· " + order.client.country : ""}
Réception : ${mode}
Paiement : ${paiement}
${order.client.message ? "\nMessage : « " + order.client.message + " »\n" : ""}
→ Détails et statuts : https://pascal-sun.com/admin (onglet Commandes)`);

  res.json({ ok: true, orderId: order.id, totalEUR });
});

app.get("/api/orders", requireAuth, (_req, res) => res.json(readJSON(ORDERS_FILE, [])));

/* ---------------------------------------- certificat d'authenticité -- */
/* Référence publique : <idCommande>-<n° de ligne>. La page certificat.html
   affiche le document, prêt à imprimer ou à enregistrer en PDF. */

app.get("/api/certificat", (req, res) => {
  const ref = String(req.query.c || "");
  const m = ref.match(/^(.+)-(\d+)$/);
  if (!m) return res.status(400).json({ error: "reference-invalide" });
  const order = readJSON(ORDERS_FILE, []).find((o) => o.id === m[1]);
  const line = order && order.lines[Number(m[2])];
  if (!order || !line || line.key === "affiche") return res.status(404).json({ error: "introuvable" });

  const catalogue = readJSON(CATALOGUE_FILE, { artworks: [] });
  const art = (catalogue.artworks || []).find((a) => a.id === line.id) || {};
  const produit = (art.produits || []).find((p) => p.key === line.key) || {};

  // Numéro d'édition : déduit du stock restant au moment de la commande
  let edition = null;
  if (line.key === "tirage" && produit.edition) {
    const num = Math.max(1, produit.edition - (typeof produit.stock === "number" ? produit.stock : 0));
    edition = `${num} / ${produit.edition}`;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({
    ref,
    date: order.date,
    acheteur: order.client.name,
    titre: line.titre,
    type: line.key,
    edition,
    annee: art.annee || "",
    technique: art.technique_fr || "",
    dimensions: art.dimensions || "",
    image: (art.images && art.images.large) || art.image || ""
  });
});

/* ------------------------------- alerte « nouvelle œuvre » aux abonnés -- */

async function announceNewArtworks(previous, next) {
  if (!mailEnabled()) return;
  const before = new Set((previous || []).map((a) => a.id));
  const fresh = (next || [])
    .filter((a) => !before.has(a.id) && (a.statut || "disponible") === "disponible")
    .slice(0, 3);
  if (!fresh.length) return;

  const contacts = readJSON(NEWSLETTER_FILE, []);
  for (const art of fresh) {
    const sujet = `Nouvelle œuvre à l'atelier : « ${art.titre} » 🌺`;
    const corps = `Ia ora na,

Une nouvelle toile vient de rejoindre la galerie :

  « ${art.titre} »
  ${art.dimensions || ""} · ${art.technique_fr || ""}${art.annee ? " · " + art.annee : ""}

${art.desc_fr || ""}

À découvrir ici :
https://pascal-sun.com/oeuvre.html?id=${art.id}

Belle journée,
Pascal Sun — Tahiti`;
    for (const c of contacts) {
      await sendMail(c.email, sujet, corps + `

—
Vous recevez cet email car vous suivez la galerie Pascal Sun.`);
      await new Promise((r) => setTimeout(r, 200));
    }
    sendPush("🌺 Œuvre annoncée", `« ${art.titre} » envoyée à ${contacts.length} abonné(s)`);
    console.log(`Nouvelle œuvre annoncée : ${art.titre} → ${contacts.length} contacts`);
  }
}

/* -------------------------------------------- rapport mensuel auto -- */

async function monthlyReport(when) {
  const now = when || new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const debut = new Date(prev.getFullYear(), prev.getMonth(), 1);
  const fin = new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
  const mois = debut.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const orders = readJSON(ORDERS_FILE, []).filter((o) => {
    const d = new Date(o.date);
    return d >= debut && d < fin;
  });
  const ca = orders.reduce((s, o) => s + (o.grandTotalEUR || o.totalEUR || 0), 0);
  const vendues = orders.flatMap((o) => o.lines).filter((l) => l.key === "original").length;
  const contacts = readJSON(NEWSLETTER_FILE, []);
  const nouveaux = contacts.filter((c) => new Date(c.createdAt) >= debut && new Date(c.createdAt) < fin).length;
  const idees = readJSON(IDEAS_FILE, []).filter((i) => new Date(i.date) >= debut && new Date(i.date) < fin).length;

  let visites = "—", pays = "—";
  if (UMAMI_URL && UMAMI_WEBSITE_ID) {
    try {
      const q = `startAt=${debut.getTime()}&endAt=${fin.getTime()}`;
      const st = await umami(`stats?${q}`);
      const val = (o) => (o && typeof o === "object" ? o.value : o) || 0;
      visites = `${val(st.visitors)} visiteurs · ${val(st.pageviews)} pages vues`;
      const c = await umami(`metrics?${q}&type=country&limit=5`);
      pays = c.map((x) => `${x.x} (${x.y})`).join(", ") || "—";
    } catch { /* stats indisponibles */ }
  }

  const corps = `Rapport de la galerie — ${mois}

VENTES
  Commandes : ${orders.length}
  Œuvres originales vendues : ${vendues}
  Chiffre d'affaires : ${ca} €  (≈ ${Math.round(ca * 119.33).toLocaleString("fr-FR")} F)

AUDIENCE
  ${visites}
  Top pays : ${pays}

COMMUNAUTÉ
  Nouveaux contacts : ${nouveaux} (total : ${contacts.length})
  Idées reçues : ${idees}

${orders.length ? "Détail des commandes :\n" + orders.map((o) =>
  `  ${o.id} — ${o.client.name} — ${o.grandTotalEUR || o.totalEUR} € — ${o.statut}`).join("\n") : ""}

→ Tableau de bord : https://pascal-sun.com/admin`;

  await sendMail(ARTIST_NOTIFY, `📊 Rapport de la galerie — ${mois}`, corps);
  return { mois, orders: orders.length, ca, vendues, nouveaux, idees, visites, pays, corps };
}

/* Le 1er de chaque mois (vérification horaire, une seule exécution). */
const REPORT_FILE = path.join(DATA_DIR, "last-report.txt");
setInterval(async () => {
  const now = new Date();
  const tag = `${now.getFullYear()}-${now.getMonth()}`;
  if (now.getDate() !== 1) return;
  if (readJSON(REPORT_FILE, null) === tag) return;
  try { if (fs.readFileSync(REPORT_FILE, "utf8") === tag) return; } catch { /* première fois */ }
  fs.writeFileSync(REPORT_FILE, tag);
  if (mailEnabled()) { await monthlyReport(now); sendPush("📊 Rapport mensuel envoyé", "Le bilan du mois vient de partir par email."); }
}, 3600e3);

app.get("/api/rapport", requireAuth, async (_req, res) => {
  try { res.json(await monthlyReport()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/orders/statut", requireAuth, (req, res) => {
  const { id, statut } = req.body || {};
  const orders = readJSON(ORDERS_FILE, []);
  const o = orders.find((x) => x.id === id);
  if (!o) return res.status(404).json({ error: "introuvable" });
  if (["nouvelle", "payee", "expediee", "terminee", "annulee"].includes(statut)) o.statut = statut;
  writeJSON(ORDERS_FILE, orders);
  res.json({ ok: true });
});

/* ------------------------------------------- alerte « prévenez-moi » -- */

app.post("/api/notify", formLimit, (req, res) => {
  const { email, artworkId, titre } = req.body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
    return res.status(400).json({ error: "email-invalide" });
  }
  upsertContact({ email: String(email).slice(0, 200), source: "alerte" });
  const contacts = readJSON(NEWSLETTER_FILE, []);
  const c = contacts.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
  if (c) {
    const note = `Alerte œuvre : ${titre || artworkId} (${new Date().toISOString().slice(0, 10)})`;
    if (!(c.notes || "").includes(note)) c.notes = ((c.notes || "") + "\n" + note).trim();
    writeJSON(NEWSLETTER_FILE, contacts);
  }
  sendPush("🔔 Alerte œuvre", `${email} suit « ${titre || artworkId} »`);
  sendMail(ARTIST_NOTIFY, `🔔 Alerte œuvre — ${titre || artworkId}`,
`${email} souhaite être prévenu(e) au sujet de « ${titre || artworkId} »
(disponibilité, retirage ou œuvre similaire).

Retrouvez ce contact dans l'admin, onglet Clients.`);
  res.json({ ok: true });
});

/* -------------------------------------------- portrait sur commande -- */

const commissionUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const safe = file.originalname.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-60);
      cb(null, `commission-${Date.now()}-${safe || "photo.jpg"}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

app.post("/api/commission", formLimit, commissionUpload.single("photo"), (req, res) => {
  const b = req.body || {};
  if (!b.email || !b.name || !b.description) return res.status(400).json({ error: "champs-manquants" });
  const commissions = readJSON(COMMISSIONS_FILE, []);
  const cm = {
    id: "PC-" + Date.now().toString(36).toUpperCase(),
    date: new Date().toISOString(),
    name: String(b.name).slice(0, 160),
    email: String(b.email).slice(0, 200),
    description: String(b.description).slice(0, 3000),
    format: String(b.format || "").slice(0, 100),
    budget: String(b.budget || "").slice(0, 100),
    photo: req.file ? `/uploads/${req.file.filename}` : null,
    statut: "nouvelle"
  };
  commissions.unshift(cm);
  writeJSON(COMMISSIONS_FILE, commissions);
  upsertContact({ email: cm.email, name: cm.name, source: "commande" });

  sendMail(cm.email, `Votre demande de portrait ${cm.id} — Pascal Sun`,
`Ia ora na ${cm.name},

Merci pour votre demande de portrait sur commande (référence ${cm.id}).
Pascal l'étudie et vous répond personnellement sous 48 h avec sa proposition.

Votre demande :
${cm.description}
${cm.format ? "Format souhaité : " + cm.format : ""}
${cm.budget ? "Budget : " + cm.budget : ""}

À très vite,
Pascal Sun — Tahiti`);
  sendPush("🎨 Demande de portrait", `${cm.name}${cm.budget ? " — budget " + cm.budget : ""}`);
  sendMail(ARTIST_NOTIFY, `🎨 Demande de portrait ${cm.id}`,
`Nouvelle demande de portrait sur commande !

De : ${cm.name} <${cm.email}>
${cm.format ? "Format : " + cm.format : ""}
${cm.budget ? "Budget : " + cm.budget : ""}
${cm.photo ? "Photo de référence : https://pascal-sun.com" + cm.photo : ""}

« ${cm.description} »

→ https://pascal-sun.com/admin (onglet Commandes)`);

  res.json({ ok: true, id: cm.id });
});

app.get("/api/commissions", requireAuth, (_req, res) => res.json(readJSON(COMMISSIONS_FILE, [])));

/* -------------------------------------------- envoi de la newsletter -- */

app.get("/api/mail-status", requireAuth, (_req, res) => res.json({ enabled: mailEnabled() }));

app.post("/api/newsletter/send", requireAuth, async (req, res) => {
  if (!mailEnabled()) return res.status(503).json({ error: "smtp-non-configure" });
  const { subject, message } = req.body || {};
  if (!subject || !message) return res.status(400).json({ error: "sujet-et-message-requis" });
  const contacts = readJSON(NEWSLETTER_FILE, []);
  let sent = 0;
  for (const c of contacts) {
    const ok = await sendMail(c.email, String(subject).slice(0, 200),
`${message}

—
Vous recevez cet email car vous suivez la galerie Pascal Sun.
https://pascal-sun.com`);
    if (ok) sent++;
    await new Promise((r) => setTimeout(r, 200)); // douceur avec le serveur SMTP
  }
  res.json({ ok: true, sent, total: contacts.length });
});

/* ------------------------------------------------ paiement carte (Stripe) -- */
/* Si STRIPE_SECRET_KEY est configurée, crée une session Stripe Checkout ;
   sinon la commande suit le circuit virement / PayPal / lien envoyé par email. */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";

app.post("/api/checkout", async (req, res) => {
  if (!STRIPE_KEY) return res.status(503).json({ error: "paiement-carte-non-configure" });
  try {
    const { items } = req.body || {};
    const catalogue = readJSON(CATALOGUE_FILE, { artworks: [] });
    const params = new URLSearchParams({
      mode: "payment",
      success_url: "https://pascal-sun.com/merci.html?paiement=ok",
      cancel_url: "https://pascal-sun.com/panier.html"
    });
    let i = 0;
    for (const it of (items || []).slice(0, 40)) {
      const art = (catalogue.artworks || []).find((a) => a.id === it.id);
      const produit = art && ((art.produits || []).find((p) => p.key === it.key) ||
        (it.key === "original" ? { prixEUR: art.prixEUR } : null));
      if (!art || !produit) continue;
      params.append(`line_items[${i}][price_data][currency]`, "eur");
      params.append(`line_items[${i}][price_data][product_data][name]`, `${art.titre} — ${it.key}`);
      params.append(`line_items[${i}][price_data][unit_amount]`, String(Math.round(produit.prixEUR * 100)));
      params.append(`line_items[${i}][quantity]`, String(Math.max(1, parseInt(it.qty, 10) || 1)));
      i++;
    }
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
    const session = await r.json();
    if (!r.ok) throw new Error(session.error && session.error.message);
    res.json({ url: session.url });
  } catch (e) {
    console.error("stripe:", e.message);
    res.status(502).json({ error: "paiement-indisponible" });
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

/* Trois tailles WebP par photo, fabriquées ici plutôt que dans le navigateur.
   Le canvas de l'admin retombait silencieusement sur du PNG quand le
   navigateur ne sait pas encoder le WebP : des photos de 3 Mo se retrouvaient
   servies telles quelles, à tout le monde, téléphones compris. */
const TAILLES = { small: 480, medium: 960, large: 1600 };

/* sharp est optionnel : s'il manque (build sans binaire natif), le site
   continue de fonctionner comme avant, sans déclinaisons. */
let sharp = null;
try { sharp = require("sharp"); }
catch { console.warn("sharp indisponible : les photos ne seront pas redimensionnées."); }

async function declinePhoto(fichier) {
  if (!sharp) return null;
  const base = fichier.replace(/\.[a-z0-9]+$/i, "").replace(/-(480|960|1600)$/, "");
  const src = path.join(UPLOADS_DIR, fichier);
  const images = {};
  const image = sharp(src, { failOn: "none" }).rotate();
  const meta = await image.metadata();

  const source = meta.width || Infinity;
  let dernier = null, dernierePlus = 0;

  for (const [cle, largeur] of Object.entries(TAILLES)) {
    // Jamais d'agrandissement, et pas deux fois le même fichier : si la photo
    // fait 900 px de large, « 960 » et « 1600 » pointent sur le même visuel.
    const cible = Math.min(largeur, source);
    if (dernier && cible <= dernierePlus) { images[cle] = dernier; continue; }
    const nom = `${base}-${largeur}.webp`;
    await sharp(src, { failOn: "none" })
      .rotate()
      .resize({ width: cible, withoutEnlargement: true })
      .webp({ quality: 80, effort: 5 })
      .toFile(path.join(UPLOADS_DIR, nom));
    dernier = `/uploads/${nom}`;
    dernierePlus = cible;
    images[cle] = dernier;
  }
  return images;
}

app.post("/api/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file-required" });
  const brut = `/uploads/${req.file.filename}`;
  try {
    const images = await declinePhoto(req.file.filename);
    if (!images) return res.json({ path: brut });
    // l'original envoyé ne sert plus : les trois déclinaisons le remplacent
    fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {});
    res.json({ path: images.medium, images });
  } catch (e) {
    console.warn("redimensionnement impossible :", e.message);
    res.json({ path: brut });
  }
});

/* Reprise des photos déjà en ligne : celles qui n'ont pas de déclinaisons
   (ou qui sont en réalité des PNG déguisés) sont régénérées en trois tailles
   WebP, et le catalogue est mis à jour. */
async function optimiserPhotosExistantes() {
  if (!sharp) return { erreur: "sharp-indisponible" };

  const catalogue = readJSON(CATALOGUE_FILE, null);
  if (!catalogue || !Array.isArray(catalogue.artworks)) {
    return { erreur: "catalogue-introuvable" };
  }

  let traitees = 0, avant = 0, apres = 0;
  const echecs = [];

  for (const a of catalogue.artworks) {
    const img = a.image || "";
    if (!img.startsWith("/uploads/")) continue;      // photos livrées : déjà optimisées
    if (a.images && a.images.large) continue;        // déjà décliné
    const fichier = path.basename(img);
    const src = path.join(UPLOADS_DIR, fichier);
    if (!fs.existsSync(src)) { echecs.push(a.titre); continue; }
    try {
      const poidsAvant = fs.statSync(src).size;
      const images = await declinePhoto(fichier);
      a.images = images;
      a.image = images.medium;
      avant += poidsAvant;
      apres += fs.statSync(path.join(UPLOADS_DIR, path.basename(images.medium))).size;
      fs.unlink(src, () => {});
      traitees++;
    } catch {
      echecs.push(a.titre);
    }
  }

  if (traitees) fs.writeFileSync(CATALOGUE_FILE, JSON.stringify(catalogue, null, 2));
  return { traitees, echecs, avantKo: Math.round(avant / 1024), apresKo: Math.round(apres / 1024) };
}

app.post("/api/images/optimiser", requireAuth, async (_req, res) => {
  const bilan = await optimiserPhotosExistantes();
  if (bilan.erreur) return res.status(bilan.erreur === "sharp-indisponible" ? 503 : 400).json({ error: bilan.erreur });
  res.json(bilan);
});

/* --------------------------------------------------------------- static -- */

app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "7d", immutable: true }));

app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));

app.use(express.static(__dirname, {
  maxAge: "7d",
  setHeaders(res, filePath) {
    // HTML, JS et CSS : revalidation à chaque visite (déploiements pris en
    // compte immédiatement, réponses 304 sinon). Médias : cache long.
    if (/\.(html|js|css|svg|webmanifest)$/.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache");
    }
    // Les visuels des œuvres changent sans changer de nom : on revalide.
    if (/img\/oeuvres\/|img\/atelier\/|signature\.png$/.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

app.listen(PORT, () => {
  console.log(`Galerie Pascal Sun en écoute sur :${PORT}`);
  /* Rattrapage au démarrage : les photos remplacées depuis l'admin avant la
     mise en place du redimensionnement étaient servies en pleine taille (des
     PNG de plusieurs Mo déguisés en .webp). L'opération est sans effet quand
     tout est déjà décliné. */
  setTimeout(() => {
    optimiserPhotosExistantes()
      .then((b) => {
        if (b.erreur) return console.warn("Optimisation des photos ignorée :", b.erreur);
        if (b.traitees) {
          console.log(`Photos optimisées au démarrage : ${b.traitees} — ${b.avantKo} Ko → ${b.apresKo} Ko`);
        }
      })
      .catch((e) => console.warn("Optimisation des photos échouée :", e.message));
  }, 3000);
});
