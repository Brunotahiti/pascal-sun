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
app.post("/api/newsletter", (req, res) => {
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

app.post("/api/orders", (req, res) => {
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

  writeJSON(CATALOGUE_FILE, catalogue);

  const orders = readJSON(ORDERS_FILE, []);
  const order = {
    id: "PS-" + Date.now().toString(36).toUpperCase(),
    date: new Date().toISOString(),
    lines,
    totalEUR,
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

  res.json({ ok: true, orderId: order.id, totalEUR });
});

app.get("/api/orders", requireAuth, (_req, res) => res.json(readJSON(ORDERS_FILE, [])));

app.post("/api/orders/statut", requireAuth, (req, res) => {
  const { id, statut } = req.body || {};
  const orders = readJSON(ORDERS_FILE, []);
  const o = orders.find((x) => x.id === id);
  if (!o) return res.status(404).json({ error: "introuvable" });
  if (["nouvelle", "payee", "expediee", "terminee", "annulee"].includes(statut)) o.statut = statut;
  writeJSON(ORDERS_FILE, orders);
  res.json({ ok: true });
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
    // HTML, JS et CSS : revalidation à chaque visite (déploiements pris en
    // compte immédiatement, réponses 304 sinon). Médias : cache long.
    if (/\.(html|js|css|svg|webmanifest)$/.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

app.listen(PORT, () => console.log(`Galerie Pascal Sun en écoute sur :${PORT}`));
