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
const CERTIFICATS_FILE = path.join(DATA_DIR, "certificats.json");
const NEWSLETTER_FILE = path.join(DATA_DIR, "newsletter.json");
const RSVP_FILE = path.join(DATA_DIR, "rsvp.json");
const INVIT_STATS_FILE = path.join(DATA_DIR, "invitations.json");

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

function sendMail(to, subject, text, html) {
  if (!mailer || !to) return Promise.resolve(false);
  const msg = { from: mailer.__from, to, subject, text };
  if (html) msg.html = html;               // invitations : version illustrée
  return mailer.sendMail(msg)
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

/* Le site affiche les prix en francs Pacifique : les emails de commande
   doivent parler la même monnaie. L'euro reste indiqué entre parenthèses,
   utile pour un virement international. */
const TAUX_XPF = 119.33;
function enFrancs(eur) {
  // mêmes paliers d'arrondi que fmtPrice() côté site : l'email doit annoncer
  // exactement le prix que l'acheteur a vu à l'écran
  const v = (Number(eur) || 0) * TAUX_XPF;
  const pas = v >= 100000 ? 5000 : v >= 20000 ? 1000 : 500;
  return (Math.round(v / pas) * pas).toLocaleString("fr-FR")
    .replace(/\u202f|\u00a0/g, " ") + " F";
}
function prix(eur) {
  return `${enFrancs(eur)} (${Math.round(Number(eur) || 0)} €)`;
}

function orderEmailText(order) {
  const lignes = order.lines.map((l) =>
    `  • ${l.titre} — ${PRODUIT_FR[l.key] || l.key}${l.qty > 1 ? ` × ${l.qty}` : ""} — ${prix(l.prixEUR * l.qty)}`).join("\n");
  const mode = order.mode === "galerie"
    ? `Réservée à votre nom — à retirer à ${order.galerie || "la galerie du vernissage"}${order.galerieDate ? " (" + dateLongueFR(order.galerieDate) + ")" : ""}`
    : order.mode === "retrait"
    ? "Retrait à Tahiti (gratuit)"
    : `Livraison — ${order.zone || ""} : ${order.livraisonEUR ? prix(order.livraisonEUR) : "offerte"}`;
  const paiement = { card: "Carte bancaire", virement: "Virement bancaire", paypal: "PayPal", surplace: "Sur place, à la galerie" }[order.payment] || order.payment;
  return { lignes, mode, paiement };
}

/* Consignes de paiement, selon ce que l'artiste a renseigné dans l'admin
   (onglet Livraison & paiement). */
function consignesPaiement(order, catalogue) {
  const P = (catalogue && catalogue.paiement) || {};
  if (order.payment === "surplace") {
    return `Vous réglez l'œuvre directement à la galerie, le soir du vernissage ou pendant l'exposition. Elle est mise de côté à votre nom.`;
  }
  if (order.payment === "paypal" && P.paypal) {
    const lien = /^https?:\/\//i.test(P.paypal) ? P.paypal
      : /^[^@\s]+@[^@\s]+$/.test(P.paypal) ? "" : `https://paypal.me/${P.paypal.replace(/^paypal\.me\//i, "")}`;
    return `Pour régler par PayPal (${prix(order.grandTotalEUR)}) :\n  ${lien || "à l'adresse " + P.paypal}\n  Référence à indiquer : ${order.id}`;
  }
  if (order.payment === "virement" && P.iban) {
    return `Pour régler par virement (${prix(order.grandTotalEUR)}) :\n` +
      (P.titulaire ? `  Titulaire : ${P.titulaire}\n` : "") +
      `  IBAN : ${P.iban}\n` +
      (P.bic ? `  BIC : ${P.bic}\n` : "") +
      (P.banque ? `  Banque : ${P.banque}\n` : "") +
      `  Libellé : ${order.id}`;
  }
  return "";
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
    certificats: readJSON(CERTIFICATS_FILE, []),
    rsvp: readJSON(RSVP_FILE, []),
    invitations: readJSON(INVIT_STATS_FILE, {}),
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
    setTimeout(() => synchroniserDistantes().catch(() => {}), 2000);   // copie chez Scaleway
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

/* --------------------------- copie hors serveur : Scaleway Object Storage -- */
/* Les sauvegardes du disque protègent d'une fausse manœuvre, pas d'une perte
   du serveur. Chaque sauvegarde est aussi déposée dans un bucket Scaleway
   (compatible S3, région Paris), et ce qui manque là-bas est rattrapé à la
   passe suivante. Même mécanique que sur Polynet : signature AWS v4 écrite à
   la main, trois requêtes (déposer, lister, supprimer), pas de SDK. Les clés
   vivent dans data/scaleway.json, sur le volume — jamais dans le code. */

const SCW_FILE = path.join(DATA_DIR, "scaleway.json");
const SCW_PREFIXE = "pascal-sun/";
const SCW_MAX_DISTANTES = 120;

function lireConfigScaleway() {
  const c = readJSON(SCW_FILE, {});
  return {
    accesId: process.env.SCW_ACCESS_KEY || c.accesId || "",
    secret: process.env.SCW_SECRET_KEY || c.secret || "",
    bucket: process.env.SCW_BUCKET || c.bucket || "",
    region: process.env.SCW_REGION || c.region || "fr-par",
    dernier: c.dernier || null
  };
}
function ecrireConfigScaleway(n) {
  const c = readJSON(SCW_FILE, {});
  c.accesId = String(n.accesId || "").trim();
  // secret vide = on garde l'ancien : le formulaire ne le réaffiche jamais
  if (String(n.secret || "").trim()) c.secret = String(n.secret).trim();
  c.bucket = String(n.bucket || "").trim();
  c.region = String(n.region || "fr-par").trim() || "fr-par";
  writeJSON(SCW_FILE, c);
}
const scalewayConfigure = (c = lireConfigScaleway()) => Boolean(c.accesId && c.secret && c.bucket && c.region);
function noterScaleway(ok, envoyees, detail) {
  const c = readJSON(SCW_FILE, {});
  c.dernier = { quand: new Date().toISOString(), ok, envoyees, detail };
  writeJSON(SCW_FILE, c);
}

const sha256 = (d) => crypto.createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
const encoderCle = (cle) => cle.split("/").map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");

/* Requête signée (URL + en-têtes), signature S3 v4. */
function signerRequete(c, methode, cle, options = {}) {
  const hote = options.service ? `s3.${c.region}.scw.cloud` : `${c.bucket}.s3.${c.region}.scw.cloud`;
  const corps = options.corps || Buffer.alloc(0);
  const maintenant = options.maintenant || new Date();
  const dateLongue = maintenant.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateCourte = dateLongue.slice(0, 8);
  const empreinte = sha256(corps);
  const chemin = "/" + encoderCle(cle);
  const requete = Object.entries(options.requete || {}).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const entetes = { host: hote, "x-amz-content-sha256": empreinte, "x-amz-date": dateLongue };
  if (methode === "PUT") entetes["content-type"] = "application/gzip";
  const nomsSignes = Object.keys(entetes).sort().join(";");
  const entetesCanoniques = Object.keys(entetes).sort().map((k) => `${k}:${entetes[k]}\n`).join("");
  const canonique = [methode, chemin, requete, entetesCanoniques, nomsSignes, empreinte].join("\n");
  const portee = `${dateCourte}/${c.region}/s3/aws4_request`;
  const aSigner = ["AWS4-HMAC-SHA256", dateLongue, portee, sha256(canonique)].join("\n");
  const cleSignature = hmac(hmac(hmac(hmac(`AWS4${c.secret}`, dateCourte), c.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", cleSignature).update(aSigner).digest("hex");
  return {
    url: `https://${hote}${chemin}${requete ? `?${requete}` : ""}`,
    entetes: { ...entetes, authorization: `AWS4-HMAC-SHA256 Credential=${c.accesId}/${portee}, SignedHeaders=${nomsSignes}, Signature=${signature}` }
  };
}
async function requeteS3(c, methode, cle, options = {}) {
  const { url, entetes } = signerRequete(c, methode, cle, options);
  return fetch(url, {
    method: methode, headers: entetes,
    body: methode === "PUT" ? new Uint8Array(options.corps || Buffer.alloc(0)) : undefined,
    signal: AbortSignal.timeout(60000)
  });
}
async function expliquerS3(r) {
  const texte = await r.text().catch(() => "");
  const code = (/<Code>([^<]+)<\/Code>/.exec(texte) || [])[1];
  const details = {
    NoSuchBucket: "ce bucket n'existe pas dans cette région",
    InvalidAccessKeyId: "clé d'accès inconnue",
    SignatureDoesNotMatch: "clé secrète incorrecte",
    AccessDenied: "accès refusé — la clé n'a pas les droits sur ce bucket"
  };
  return `${r.status}${code ? ` ${code}` : ""}${code && details[code] ? ` : ${details[code]}` : ""}`;
}

async function listerDistantes(c = lireConfigScaleway()) {
  const r = await requeteS3(c, "GET", "", { requete: { "list-type": "2", prefix: SCW_PREFIXE, "max-keys": "1000" } });
  if (!r.ok) throw new Error(`Liste impossible (${await expliquerS3(r)})`);
  const xml = await r.text();
  const objets = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const bloc = m[1];
    const cle = (/<Key>([^<]+)<\/Key>/.exec(bloc) || [])[1] || "";
    objets.push({
      nom: cle.slice(SCW_PREFIXE.length),
      octets: Number((/<Size>(\d+)<\/Size>/.exec(bloc) || [])[1] || 0),
      modifie: (/<LastModified>([^<]+)<\/LastModified>/.exec(bloc) || [])[1] || ""
    });
  }
  return objets.sort((a, b) => b.nom.localeCompare(a.nom));
}
async function deposerSauvegarde(nom, c = lireConfigScaleway()) {
  const chemin = path.join(BACKUP_DIR, path.basename(nom));
  if (!fs.existsSync(chemin)) throw new Error("Sauvegarde introuvable");
  const r = await requeteS3(c, "PUT", SCW_PREFIXE + nom, { corps: fs.readFileSync(chemin) });
  if (!r.ok) throw new Error(`Dépôt refusé (${await expliquerS3(r)})`);
}
async function supprimerDistante(nom, c = lireConfigScaleway()) {
  const r = await requeteS3(c, "DELETE", SCW_PREFIXE + nom);
  if (!r.ok && r.status !== 404) throw new Error(`Suppression refusée (${await expliquerS3(r)})`);
}

/* Ce que la clé a l'air d'être, sans jamais l'afficher en clair. */
function allureDesCles(c = lireConfigScaleway()) {
  return {
    acces: c.accesId ? `${c.accesId.slice(0, 6)}…${c.accesId.slice(-2)} (${c.accesId.length} car.)` : "—",
    accesOk: /^SCW[A-Z0-9]{17}$/.test(c.accesId),
    secretLongueur: c.secret.length,
    secretOk: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.secret)
  };
}
/* Le bucket refuse : est-ce la clé, ou le bucket ? La liste des buckets que
   la clé voit départage, et le message dit quoi corriger. */
async function diagnostiquerScaleway(c) {
  try {
    const r = await requeteS3(c, "GET", "", { service: true });
    if (!r.ok) {
      const code = (/<Code>([^<]+)<\/Code>/.exec(await r.text().catch(() => "")) || [])[1] || r.status;
      const a = allureDesCles(c);
      const forme = [
        a.accesOk ? null : `la clé d'accès ${a.acces} n'a pas la forme attendue (SCW + 17 caractères, 20 en tout)`,
        a.secretOk ? null : `la clé secrète enregistrée fait ${a.secretLongueur} caractère(s) au lieu des 36 d'un UUID (8-4-4-4-12)`
      ].filter(Boolean);
      return `La clé elle-même est refusée par Scaleway (${code}).` + (forme.length
        ? ` À corriger d'abord : ${forme.join(" ; ")}. Recollez les deux valeurs telles quelles depuis la console Scaleway.`
        : ` Les deux valeurs ont pourtant la bonne forme : il reste le droit IAM — la clé API doit relever d'une politique portant ObjectStorageFullAccess (IAM → Politiques) sur le projet du bucket. Une clé créée sans politique est acceptée par Scaleway mais ne peut rien faire.`);
    }
    const noms = [...(await r.text()).matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
    if (noms.includes(c.bucket)) return `La clé voit bien le bucket « ${c.bucket} » mais ne peut pas lire dedans : le droit IAM manque sur ce projet, ou une politique de bucket le bloque.`;
    return noms.length
      ? `La clé est acceptée, mais elle ne voit pas de bucket « ${c.bucket} » en ${c.region}. Elle voit : ${noms.join(", ")}. Vérifiez le nom exact et la région — ou le projet préféré de la clé (à la création d'une clé API, Scaleway demande le projet à utiliser pour Object Storage : ce doit être celui du bucket).`
      : `La clé est acceptée, mais elle ne voit aucun bucket en ${c.region}. Le bucket est-il dans une autre région, ou dans un autre projet que le projet préféré de la clé ?`;
  } catch (e) { return `Diagnostic impossible : ${e.message}`; }
}
/* Vérifie les accès : liste, dépose un témoin, le retire. */
async function testerScaleway(c) {
  let objets;
  try { objets = (await listerDistantes(c)).length; }
  catch (e) { throw new Error(`${e.message}. ${await diagnostiquerScaleway(c)}`); }
  const temoin = `${SCW_PREFIXE}.temoin-${Date.now()}`;
  const r = await requeteS3(c, "PUT", temoin, { corps: Buffer.from("pascal-sun") });
  if (!r.ok) throw new Error(`Dépôt refusé (${await expliquerS3(r)})`);
  await requeteS3(c, "DELETE", temoin);
  return { objets };
}
/* Met le bucket au niveau du serveur, puis élague au-delà du quota. */
let scwEnCours = false;
async function synchroniserDistantes() {
  const c = lireConfigScaleway();
  if (!scalewayConfigure(c) || scwEnCours) return { envoyees: 0 };
  scwEnCours = true;
  try {
    const distantes = new Set((await listerDistantes(c)).map((o) => o.nom));
    const locales = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".json.gz")).sort();
    const manquantes = locales.filter((f) => !distantes.has(f));
    for (const f of manquantes) await deposerSauvegarde(f, c);
    const apres = await listerDistantes(c);
    for (const o of apres.slice(SCW_MAX_DISTANTES)) await supprimerDistante(o.nom, c);
    // et le programme complet, s'il a changé
    let prog = { depose: false, nb: 0 };
    try { prog = await deposerProgramme(c); }
    catch (e) { noterScaleway(false, manquantes.length, `${apres.length} sauvegarde(s) chez Scaleway, mais programme non déposé : ${e.message}`); throw e; }
    noterScaleway(true, manquantes.length, `${apres.length} sauvegarde(s) et ${prog.nb} archive(s) du programme chez Scaleway${prog.depose ? " — programme redéposé (il avait changé)" : ""}`);
    return { envoyees: manquantes.length, programme: prog };
  } catch (e) {
    const detail = `${e.message}. ${await diagnostiquerScaleway(c)}`;
    noterScaleway(false, 0, detail);
    throw new Error(detail);
  } finally { scwEnCours = false; }
}
/* ---- archive complète du programme ----
   Le code du site (tout ce qui est déployé, sauf node_modules), les photos et
   fichiers envoyés depuis l'admin (data/uploads), et la configuration
   (mail.json, scaleway.json, variables d'environnement) : de quoi remonter le
   site à partir du seul bucket. L'archive n'est refaite et déposée que si
   quelque chose a changé (empreinte des chemins, tailles et dates). Écriture
   tar + gzip en flux, sans binaire externe. */
const SCW_PREFIXE_PROGRAMME = "pascal-sun/programme/";
const SCW_MAX_PROGRAMMES = 8;
const EXCLUS_RACINE = new Set(["node_modules", "data", ".git", ".DS_Store"]);
const ENV_CONFIG = ["ADMIN_PASSWORD", "APP_SECRET", "SITE_URL", "PORT", "UMAMI_URL", "UMAMI_USER", "UMAMI_PASSWORD", "UMAMI_WEBSITE_ID",
  "VAPID_PUBLIC", "VAPID_PRIVATE", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "ARTIST_NOTIFY", "STRIPE_SECRET_KEY",
  "SCW_ACCESS_KEY", "SCW_SECRET_KEY", "SCW_BUCKET", "SCW_REGION"];

function* parcourir(dossier, base, exclus) {
  let entrees = [];
  try { entrees = fs.readdirSync(dossier, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
  for (const e of entrees) {
    if (exclus && exclus.has(e.name)) continue;
    const abs = path.join(dossier, e.name), rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) yield* parcourir(abs, rel, null);
    else if (e.isFile()) yield { abs, rel };
  }
}
function fichiersProgramme() {
  const liste = [...parcourir(__dirname, "", EXCLUS_RACINE)];
  for (const f of parcourir(path.join(DATA_DIR, "uploads"), "data/uploads", null)) liste.push(f);
  for (const n of ["mail.json", "scaleway.json"]) {
    const abs = path.join(DATA_DIR, n);
    if (fs.existsSync(abs)) liste.push({ abs, rel: `data/${n}` });
  }
  return liste;
}
function configurationEnv() {
  return "# Variables d'environnement du conteneur pascal-sun au moment de l'archive\n" +
    "# (à repasser au projet Docker lors d'une remise en route)\n" +
    ENV_CONFIG.filter((k) => process.env[k] !== undefined).map((k) => `${k}=${process.env[k]}`).join("\n") + "\n";
}
function empreinteProgramme() {
  const h = crypto.createHash("sha256");
  for (const f of fichiersProgramme()) {
    try { const st = fs.statSync(f.abs); h.update(`${f.rel}|${st.size}|${Math.floor(st.mtimeMs)}\n`); } catch { /* fichier disparu entre-temps */ }
  }
  h.update(configurationEnv());
  return h.digest("hex").slice(0, 16);
}
/* En-tête tar (ustar) d'un fichier. */
function enteteTar(nom, taille, mtime) {
  const b = Buffer.alloc(512, 0);
  let name = nom, prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const i = name.lastIndexOf("/", 155);
    prefix = name.slice(0, i); name = name.slice(i + 1);
  }
  b.write(name, 0, 100); b.write("0000644\0", 100, 8); b.write("0000000\0", 108, 8); b.write("0000000\0", 116, 8);
  b.write(taille.toString(8).padStart(11, "0") + "\0", 124, 12);
  b.write(Math.floor(mtime / 1000).toString(8).padStart(11, "0") + "\0", 136, 12);
  b.write("        ", 148, 8); b.write("0", 156, 1); b.write("ustar\0", 257, 6); b.write("00", 263, 2);
  b.write("root", 265, 32); b.write("root", 297, 32); b.write(prefix, 345, 155);
  let somme = 0; for (const x of b) somme += x;
  b.write(somme.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return b;
}
async function archiverProgramme(destination) {
  const gz = zlib.createGzip({ level: 6 });
  const sortie = fs.createWriteStream(destination);
  const fini = new Promise((res, rej) => { sortie.on("finish", res); sortie.on("error", rej); gz.on("error", rej); });
  gz.pipe(sortie);
  const ecrire = (buf) => new Promise((res) => { if (!gz.write(buf)) gz.once("drain", res); else res(); });
  const ajouterContenu = async (rel, contenu, mtime) => {
    await ecrire(enteteTar(rel, contenu.length, mtime));
    await ecrire(contenu);
    const reste = contenu.length % 512; if (reste) await ecrire(Buffer.alloc(512 - reste, 0));
  };
  for (const f of fichiersProgramme()) {
    let st; try { st = fs.statSync(f.abs); } catch { continue; }
    await ecrire(enteteTar(f.rel, st.size, st.mtimeMs));
    await new Promise((res, rej) => {
      const lecture = fs.createReadStream(f.abs);
      lecture.on("data", (chunk) => { if (!gz.write(chunk)) { lecture.pause(); gz.once("drain", () => lecture.resume()); } });
      lecture.on("end", res); lecture.on("error", rej);
    });
    const reste = st.size % 512; if (reste) await ecrire(Buffer.alloc(512 - reste, 0));
  }
  await ajouterContenu("configuration.env", Buffer.from(configurationEnv()), Date.now());
  await ajouterContenu("LISEZMOI.txt", Buffer.from(
`Archive complète du site pascal-sun.com — ${new Date().toISOString()}

Contenu :
  • le code du site tel que déployé (server.js, pages HTML, css/, js/, img/, videos/, Dockerfile, docker-compose.yml, package.json…)
  • data/uploads/ : les photos et fichiers envoyés depuis l'admin
  • data/mail.json, data/scaleway.json : mot de passe email et clés Scaleway
  • configuration.env : les variables d'environnement du conteneur

Les données (catalogue, commandes, clients, certificats, réponses aux invitations…)
sont dans les sauvegardes quotidiennes pascal-sun-AAAA-MM-JJ.json.gz, à côté.

Remise en route : décompresser cette archive dans un dossier, y déposer le
contenu de la dernière sauvegarde JSON dans data/ (fichiers catalogue.json,
orders.json… tels qu'exportés), passer les variables de configuration.env au
projet Docker, puis « docker compose up ». Voir PROJET.md.
`), Date.now());
  await ecrire(Buffer.alloc(1024, 0));
  gz.end();
  await fini;
}
async function listerProgrammes(c = lireConfigScaleway()) {
  const r = await requeteS3(c, "GET", "", { requete: { "list-type": "2", prefix: SCW_PREFIXE_PROGRAMME, "max-keys": "1000" } });
  if (!r.ok) throw new Error(`Liste impossible (${await expliquerS3(r)})`);
  const xml = await r.text(); const objets = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const bloc = m[1];
    const cle = (/<Key>([^<]+)<\/Key>/.exec(bloc) || [])[1] || "";
    objets.push({ nom: cle.slice(SCW_PREFIXE_PROGRAMME.length), octets: Number((/<Size>(\d+)<\/Size>/.exec(bloc) || [])[1] || 0), modifie: (/<LastModified>([^<]+)<\/LastModified>/.exec(bloc) || [])[1] || "" });
  }
  return objets.filter((o) => o.nom).sort((a, b) => b.nom.localeCompare(a.nom));
}
/* Dépose l'archive du programme si son empreinte a changé depuis la dernière. */
async function deposerProgramme(c = lireConfigScaleway(), forcer = false) {
  const empreinte = empreinteProgramme();
  const conf = readJSON(SCW_FILE, {});
  const distants = await listerProgrammes(c);
  const dejaLa = distants.some((o) => o.nom.includes(`-${empreinte}.tar.gz`));
  if (dejaLa && !forcer) return { depose: false, empreinte, nb: distants.length };
  const nom = `pascal-sun-programme-${new Date().toISOString().slice(0, 10)}-${empreinte}.tar.gz`;
  const tmp = path.join(require("os").tmpdir(), nom);
  try {
    await archiverProgramme(tmp);
    const r = await requeteS3(c, "PUT", SCW_PREFIXE_PROGRAMME + nom, { corps: fs.readFileSync(tmp) });
    if (!r.ok) throw new Error(`Dépôt du programme refusé (${await expliquerS3(r)})`);
    const taille = fs.statSync(tmp).size;
    conf.programme = { quand: new Date().toISOString(), nom, empreinte, octets: taille };
    writeJSON(SCW_FILE, conf);
    const apres = await listerProgrammes(c);
    for (const o of apres.slice(SCW_MAX_PROGRAMMES)) {
      const rr = await requeteS3(c, "DELETE", SCW_PREFIXE_PROGRAMME + o.nom);
      if (!rr.ok && rr.status !== 404) break;
    }
    return { depose: true, empreinte, nom, octets: taille, nb: Math.min(apres.length, SCW_MAX_PROGRAMMES) };
  } finally { try { fs.unlinkSync(tmp); } catch { /* déjà parti */ } }
}

function etatScaleway() {
  const c = lireConfigScaleway();
  const conf = readJSON(SCW_FILE, {});
  return { configure: scalewayConfigure(c), bucket: c.bucket, region: c.region, accesId: c.accesId, allure: allureDesCles(c), dernier: c.dernier, programme: conf.programme || null };
}
/* Après chaque sauvegarde du jour, et toutes les 30 min en rattrapage. */
setTimeout(() => synchroniserDistantes().catch(() => {}), 60e3);
setInterval(() => synchroniserDistantes().catch(() => {}), 30 * 60e3);

app.get("/api/sauvegardes/scaleway", requireAuth, async (req, res) => {
  const etat = etatScaleway();
  if (req.query.liste === "1" && etat.configure) {
    try { return res.json({ ...etat, distantes: await listerDistantes(), programmes: await listerProgrammes() }); }
    catch (e) { return res.json({ ...etat, distantes: [], programmes: [], erreurListe: e.message }); }
  }
  res.json(etat);
});
app.put("/api/sauvegardes/scaleway", requireAuth, (req, res) => {
  const b = req.body || {};
  const c = { accesId: String(b.accesId || "").trim(), secret: String(b.secret || ""), bucket: String(b.bucket || "").trim(), region: String(b.region || "fr-par").trim() || "fr-par" };
  if (!c.accesId || !c.bucket) return res.status(400).json({ error: "Clé d'accès et nom du bucket requis" });
  if (!/^[a-z0-9.-]{3,63}$/.test(c.bucket)) return res.status(400).json({ error: "Nom de bucket invalide (minuscules, chiffres, tirets)" });
  if (!/^[a-z]{2}-[a-z]{3}$/.test(c.region)) return res.status(400).json({ error: "Région attendue : fr-par, nl-ams ou pl-waw" });
  ecrireConfigScaleway(c);
  res.json({ ok: true, etat: etatScaleway() });
});
app.post("/api/sauvegardes/scaleway", requireAuth, async (req, res) => {
  const b = req.body || {};
  try {
    if (b.action === "tester") {
      const e = lireConfigScaleway();
      const c = { accesId: String(b.accesId || "").trim() || e.accesId, secret: String(b.secret || "").trim() || e.secret, bucket: String(b.bucket || "").trim() || e.bucket, region: String(b.region || "").trim() || e.region };
      if (!scalewayConfigure(c)) return res.status(400).json({ error: "Configuration incomplète" });
      return res.json({ ok: true, ...(await testerScaleway(c)) });
    }
    if (b.action === "programme") {
      if (!scalewayConfigure()) return res.status(400).json({ error: "Scaleway n'est pas configuré" });
      const r = await deposerProgramme(lireConfigScaleway(), true);
      return res.json({ ok: true, ...r, etat: etatScaleway() });
    }
    if (b.action === "synchroniser") {
      if (!scalewayConfigure()) return res.status(400).json({ error: "Scaleway n'est pas configuré" });
      const r = await synchroniserDistantes();
      return res.json({ ok: true, ...r, etat: etatScaleway() });
    }
    res.status(400).json({ error: "Action inconnue" });
  } catch (e) { res.status(502).json({ error: e.message }); }
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
  /* les contacts venus des invitations (rsvp) ont pu être créés sans ces
     champs : on les complète plutôt que de planter */
  if (!Array.isArray(c.sources)) c.sources = c.source ? [c.source] : [];
  c.orders = Number(c.orders) || 0;
  c.totalEUR = Number(c.totalEUR) || 0;
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
      if (art.statut === "vendu" || art.vendu || art.statut === "reserve") continue;  // déjà partie ou mise de côté
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

  /* Réservation à la galerie du vernissage : uniquement si un vernissage à
     venir vend sur place. L'œuvre est mise de côté, réglée à la galerie. */
  const today = new Date().toISOString().slice(0, 10);
  const evGalerie = client.mode === "galerie"
    ? (catalogue.events || []).find((e) => e.id === String(client.event || "") && e.vente_sur_place && e.date >= today)
      || (catalogue.events || []).filter((e) => e.vente_sur_place && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]
    : null;
  const modeCmd = client.mode === "galerie" ? (evGalerie ? "galerie" : "retrait") : client.mode === "retrait" ? "retrait" : "livraison";

  /* Frais de livraison calculés côté serveur (source de vérité). */
  const ship = catalogue.shipping || DEFAULT_SHIPPING;
  const zoneKey = String((client.zone || "pf")).slice(0, 10);
  const zone = (ship.zones || []).find((z) => z.key === zoneKey) || (ship.zones || [])[0];
  let livraisonEUR = 0;
  if (modeCmd === "livraison" && zone) {
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
    mode: modeCmd,
    payment: modeCmd === "galerie" && client.payment === "surplace" ? "surplace"
      : ["card", "virement", "paypal"].includes(client.payment) ? client.payment : "virement",
    statut: "nouvelle"
  };
  if (evGalerie) {
    order.event = evGalerie.id;
    order.galerie = (evGalerie.hote || evGalerie.lieu || "").trim();
    order.galerieDate = evGalerie.date;
    order.galerieVille = evGalerie.hote_sur || evGalerie.ville || "";
  }
  orders.unshift(order);
  writeJSON(ORDERS_FILE, orders);

  upsertContact({ email: order.client.email, name: order.client.name, country: order.client.country, source: "commande", orderTotalEUR: totalEUR });

  // Emails automatiques (si SMTP configuré)
  const { lignes, mode, paiement } = orderEmailText(order);
  sendMail(order.client.email, `Votre commande ${order.id} — Galerie Pascal Sun`,
`Ia ora na ${order.client.name},

Māuruuru pour votre commande ! Elle est bien enregistrée sous la référence ${order.id}.

${lignes}

Total œuvres : ${prix(totalEUR)}
Réception : ${mode}
Total à régler : ${prix(order.grandTotalEUR)}
Paiement choisi : ${paiement}
${consignesPaiement(order, catalogue) ? "\n" + consignesPaiement(order, catalogue) + "\n" : ""}
Votre certificat d'authenticité (à conserver) :
${order.lines.filter((l) => l.key !== "affiche").map((l, i) =>
  `  ${l.titre} → https://pascal-sun.com/certificat.html?c=${order.id}-${i}`).join("\n")}

Pascal vous écrit personnellement sous 48 h pour confirmer le paiement sécurisé
et organiser la réception de votre œuvre (certificat d'authenticité inclus pour
les originaux et tirages numérotés).

À très vite,
Pascal Sun — Tahiti
N° Tahiti ${ARTIST_TAHITI}
https://pascal-sun.com`);

  if (order.mode === "galerie" && evGalerie && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(evGalerie.contact_email || "").trim())) {
    sendMail(String(evGalerie.contact_email).trim(), `Réservation d'une œuvre de Pascal Sun — ${order.lines.map((l) => "« " + l.titre + " »").join(", ")}`,
`Bonjour,

Un visiteur du site de Pascal Sun vient de réserver en ligne une œuvre exposée chez vous, à retirer et régler sur place :

${lignes}

Total : ${prix(order.grandTotalEUR)}
Client : ${order.client.name} <${order.client.email}>${order.client.country ? " · " + order.client.country : ""}
Référence : ${order.id}
${order.client.message ? "\nMessage : « " + order.client.message + " »\n" : ""}
L'œuvre est marquée réservée sur le site. Merci de la mettre de côté à son nom.

Bien cordialement,
Pascal Sun — Peintre, Tahiti
${SITE_URL}`);
  }
  sendPush(order.mode === "galerie" ? "🥂 Réservation pour le vernissage !" : "🛒 Nouvelle commande !", `${order.client.name} — ${enFrancs(order.grandTotalEUR)} (${order.id})`);
  sendMail(ARTIST_NOTIFY, `🛒 Nouvelle commande ${order.id} — ${enFrancs(totalEUR)}`,
`Nouvelle commande sur la galerie !

${lignes}

Total œuvres : ${prix(totalEUR)} | Livraison : ${prix(order.livraisonEUR)} | À régler : ${prix(order.grandTotalEUR)}
Client : ${order.client.name} <${order.client.email}> ${order.client.country ? "· " + order.client.country : ""}
Réception : ${mode}
Paiement : ${paiement}
${order.client.message ? "\nMessage : « " + order.client.message + " »\n" : ""}
→ Détails et statuts : https://pascal-sun.com/admin (onglet Commandes)`);

  res.json({ ok: true, orderId: order.id, totalEUR });
});

app.get("/api/orders", requireAuth, (_req, res) => res.json(readJSON(ORDERS_FILE, [])));

/* -------------------------------------------- invitations & réponses -- */
/* Le lien d'un vernissage est diffusé largement : on compte ses ouvertures,
   on enregistre les réponses, et les personnes qui confirment entrent dans
   les contacts de la lettre de l'atelier. */

app.post("/api/invitation/vue", formLimit, (req, res) => {
  const id = String((req.body || {}).event || "").slice(0, 80);
  if (!id) return res.status(400).json({ error: "event-requis" });
  const stats = readJSON(INVIT_STATS_FILE, {});
  const e = stats[id] || (stats[id] = { vues: 0, visiteurs: [], jours: {}, sources: {} });
  e.vues++;
  const jour = new Date().toISOString().slice(0, 10);
  e.jours[jour] = (e.jours[jour] || 0) + 1;
  const src = String((req.body || {}).source || "direct").slice(0, 60);
  e.sources[src] = (e.sources[src] || 0) + 1;
  // visiteurs distincts, sans cookie ni identification : simple empreinte courte
  const vid = String((req.body || {}).vid || "").slice(0, 40);
  if (vid && !e.visiteurs.includes(vid)) e.visiteurs.push(vid);
  writeJSON(INVIT_STATS_FILE, stats);
  res.json({ ok: true });
});

app.post("/api/rsvp", formLimit, (req, res) => {
  const b = req.body || {};
  const email = String(b.email || "").trim().toLowerCase();
  const nom = String(b.nom || "").trim();
  if (!nom || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
    return res.status(400).json({ error: "nom-et-email-requis" });
  }
  const reponse = b.reponse === "non" ? "non" : "oui";
  const rsvp = {
    id: "R-" + Date.now().toString(36).toUpperCase(),
    event: String(b.event || "").slice(0, 80),
    titre: String(b.titre || "").slice(0, 200),
    nom, email, reponse,
    personnes: Math.min(20, Math.max(1, Number(b.personnes) || 1)),
    date: new Date().toISOString()
  };

  const liste = readJSON(RSVP_FILE, []);
  // une seule réponse par personne et par vernissage : la dernière fait foi
  const i = liste.findIndex((x) => x.event === rsvp.event && x.email === email);
  if (i >= 0) liste[i] = rsvp; else liste.unshift(rsvp);
  writeJSON(RSVP_FILE, liste);

  /* Les personnes qui confirment leur venue rejoignent les contacts de la
     lettre de l'atelier — c'est l'objet même de l'invitation. */
  if (reponse === "oui") upsertContact({ email, name: nom, source: "vernissage" });

  res.json({ ok: true, ref: rsvp.id });

  const quoi = reponse === "oui"
    ? `✅ ${nom} vient (${rsvp.personnes} personne${rsvp.personnes > 1 ? "s" : ""})`
    : `❌ ${nom} ne pourra pas venir`;
  sendPush("🥂 Réponse à une invitation", `${quoi} — ${rsvp.titre}`);
  sendMail(ARTIST_NOTIFY, `🥂 ${quoi} — ${rsvp.titre}`,
`Réponse à l'invitation « ${rsvp.titre} »

${quoi}
Email : ${email}

${reponse === "oui" ? "Cette personne a été ajoutée aux contacts de la lettre de l'atelier." : ""}

Toutes les réponses : https://pascal-sun.com/admin (onglet Vernissages)`);
});

app.get("/api/rsvp", requireAuth, (_req, res) => res.json(readJSON(RSVP_FILE, [])));
app.get("/api/invitation/stats", requireAuth, (_req, res) => res.json(readJSON(INVIT_STATS_FILE, {})));

/* Consignes de paiement d'une commande, pour la page de remerciement. Aucune
   donnée personnelle : la référence est déjà tirée au sort et connue du seul
   acheteur. */
app.get("/api/commande/:id/paiement", (req, res) => {
  const order = readJSON(ORDERS_FILE, []).find((o) => o.id === String(req.params.id || ""));
  if (!order) return res.status(404).json({ error: "commande-introuvable" });
  const P = (readJSON(CATALOGUE_FILE, {}).paiement) || {};
  res.json({
    mode: order.mode, payment: order.payment, grandTotalEUR: order.grandTotalEUR,
    galerie: order.galerie || "", eventDate: order.galerieDate ? dateLongueFR(order.galerieDate) : "",
    paiement: { titulaire: P.titulaire || "", iban: P.iban || "", bic: P.bic || "", banque: P.banque || "", paypal: P.paypal || "" }
  });
});

/* ------------------------------- invitation envoyée par email (admin) -- */
/* Une invitation illustrée, à la charte du site : bandeau lagon dessiné en
   CSS (aucune image à charger), affiche du vernissage si elle existe, les
   informations, et le bouton qui mène à la page d'invitation où l'on répond.
   Les envois sont journalisés dans data/envois-invitations.json. */

const ENVOIS_FILE = path.join(DATA_DIR, "envois-invitations.json");
const SITE_URL = process.env.SITE_URL || "https://pascal-sun.com";
/* Immatriculation de l'artiste en Polynésie française — mentions légales des
   emails de commande, qui valent justificatif d'achat. */
const ARTIST_TAHITI = process.env.ARTIST_TAHITI || "T257691";

function dateLongueFR(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y) return "";
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function gabaritInvitation(ev, motPerso, nom) {
  const lien = `${SITE_URL}/invitation.html?e=${encodeURIComponent(ev.id)}&s=email`;
  const affiche = ev.affiche ? (ev.affiche.startsWith("http") ? ev.affiche : SITE_URL + (ev.affiche.startsWith("/") ? "" : "/") + ev.affiche) : "";
  const hote = (ev.hote || ev.lieu || "").trim();
  const sur = (ev.hote_sur || ev.ville || "").trim();
  const esc = (x) => String(x || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const bonjour = nom ? `Ia ora na ${esc(nom)},` : "Ia ora na,";

  return `<!doctype html><html lang="fr"><body style="margin:0;padding:0;background:#f7f3ec;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3ec;padding:26px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border:1px solid #ddd5c8;border-radius:6px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#16130f;">

    <!-- bandeau : le lagon, en dégradés seulement (aucune image à charger) -->
    <tr><td style="background:#eef4f0;padding:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td height="26" style="background:#f5e0ca;line-height:26px;font-size:0;">&nbsp;</td></tr>
        <tr><td height="14" style="background:#bbe2dc;line-height:14px;font-size:0;">&nbsp;</td></tr>
        <tr><td height="10" style="background:#63b9b3;line-height:10px;font-size:0;">&nbsp;</td></tr>
        <tr><td height="8"  style="background:#2c8683;line-height:8px;font-size:0;">&nbsp;</td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:34px 34px 6px;text-align:center;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:bold;letter-spacing:4px;color:#2f8a86;text-transform:uppercase;">Vous êtes invité</p>
      <h1 style="margin:10px 0 4px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:normal;font-size:30px;line-height:1.2;color:#16130f;">${esc(ev.titre)}</h1>
      ${sur ? `<p style="margin:14px 0 2px;font-size:10px;font-weight:bold;letter-spacing:3px;color:#8c8478;text-transform:uppercase;">${esc(sur)}</p>` : ""}
      ${hote ? `<p style="margin:4px 0 0;font-family:Georgia,serif;font-size:22px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#16130f;">${esc(hote)}</p>` : ""}
      <div style="width:120px;height:2px;background:#d4593a;margin:18px auto 0;font-size:0;">&nbsp;</div>
      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin-top:20px;"><tr><td align="center" bgcolor="#d4593a" style="background:#d4593a;border-radius:999px;">
        <a href="${lien}" style="display:inline-block;background:#d4593a;color:#ffffff;text-decoration:none;font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;padding:14px 28px;border-radius:999px;border:2px solid #d4593a;">Répondre à l'invitation&nbsp;→</a>
      </td></tr></table>
    </td></tr>

    ${affiche ? `<tr><td style="padding:26px 34px 0;text-align:center;">
      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="background:#16130f;border-radius:2px;">
        <tr><td style="padding:9px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#f4efe4;padding:14px;">
          <img src="${esc(affiche)}" alt="${esc(ev.titre)}" width="440" style="display:block;width:100%;max-width:440px;height:auto;">
        </td></tr></table></td></tr>
      </table>
    </td></tr>` : ""}

    <tr><td style="padding:28px 34px 0;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#4a443c;">${bonjour}</p>
      ${motPerso ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#4a443c;white-space:pre-line;">${esc(motPerso)}</p>` : ""}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e7e0d3;border-bottom:1px solid #e7e0d3;margin:6px 0 0;">
        <tr><td style="padding:16px 0;">
          <p style="margin:0 0 4px;font-size:10px;font-weight:bold;letter-spacing:3px;color:#d4593a;text-transform:uppercase;">Quand</p>
          <p style="margin:0 0 16px;font-size:16px;color:#16130f;">${dateLongueFR(ev.date)}${ev.heure ? " · " + esc(ev.heure) : ""}</p>
          <p style="margin:0 0 4px;font-size:10px;font-weight:bold;letter-spacing:3px;color:#d4593a;text-transform:uppercase;">Où</p>
          <p style="margin:0;font-size:16px;color:#16130f;">${esc(ev.lieu)}${ev.ville ? " · " + esc(ev.ville) : ""}</p>
        </td></tr>
      </table>
      ${ev.desc_fr ? `<p style="margin:20px 0 0;font-size:15px;line-height:1.7;color:#4a443c;">${esc(ev.desc_fr)}</p>` : ""}
    </td></tr>

    <tr><td align="center" style="padding:32px 34px 10px;">
      <!-- bouton corail : une couleur franche que le mode sombre des
           messageries n'inverse pas, contrairement au noir sur blanc -->
      <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td align="center" bgcolor="#d4593a" style="background:#d4593a;border-radius:999px;">
        <a href="${lien}" style="display:inline-block;background:#d4593a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;padding:20px 40px;border-radius:999px;border:2px solid #d4593a;">Voir l'invitation et répondre&nbsp;→</a>
      </td></tr></table>
      <p style="margin:16px 0 0;font-size:13px;color:#8c8478;">Un mot suffit : dites-nous si vous serez là.</p>
      <p style="margin:6px 0 0;font-size:12px;color:#8c8478;">Ou copiez ce lien : <a href="${lien}" style="color:#d4593a;">${lien}</a></p>
    </td></tr>

    <tr><td style="padding:26px 34px 30px;text-align:center;border-top:1px solid #e7e0d3;margin-top:20px;">
      <p style="margin:22px 0 4px;font-family:Georgia,serif;font-size:19px;color:#16130f;">Pascal <span style="color:#d4593a;">Sun</span></p>
      <p style="margin:0 0 10px;font-size:11px;letter-spacing:3px;color:#8c8478;text-transform:uppercase;">Peintre · Tahiti</p>
      <p style="margin:0;font-size:12px;color:#8c8478;"><a href="${SITE_URL}" style="color:#2f8a86;text-decoration:none;">pascal-sun.com</a></p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

function texteInvitation(ev, motPerso, nom) {
  const lien = `${SITE_URL}/invitation.html?e=${encodeURIComponent(ev.id)}&s=email`;
  return `${nom ? "Ia ora na " + nom + "," : "Ia ora na,"}

Vous êtes invité : ${ev.titre}
${(ev.hote || ev.lieu || "")}${ev.hote_sur || ev.ville ? " — " + (ev.hote_sur || ev.ville) : ""}

Quand : ${dateLongueFR(ev.date)}${ev.heure ? " · " + ev.heure : ""}
Où : ${ev.lieu}${ev.ville ? " · " + ev.ville : ""}
${motPerso ? "\n" + motPerso + "\n" : ""}${ev.desc_fr ? "\n" + ev.desc_fr + "\n" : ""}
Voir l'invitation et répondre :
${lien}

Pascal Sun — Peintre, Tahiti
${SITE_URL}`;
}

/* Aperçu du message tel qu'il partira (affiché dans l'admin). */
app.post("/api/invitation/apercu", requireAuth, (req, res) => {
  const { eventId, message } = req.body || {};
  const cat = readJSON(CATALOGUE_FILE, { events: [] });
  const ev = (cat.events || []).find((e) => e.id === eventId);
  if (!ev) return res.status(404).json({ error: "vernissage-introuvable" });
  res.json({ ok: true, sujet: `Invitation — ${ev.titre}`, html: gabaritInvitation(ev, message, "") });
});

app.post("/api/invitation/envoyer", requireAuth, async (req, res) => {
  if (!mailEnabled()) return res.status(503).json({ error: "smtp-non-configure" });
  const { eventId, message, emails, tous } = req.body || {};
  const cat = readJSON(CATALOGUE_FILE, { events: [] });
  const ev = (cat.events || []).find((e) => e.id === eventId);
  if (!ev) return res.status(404).json({ error: "vernissage-introuvable" });

  /* Destinataires : tous les contacts du carnet, ou les adresses choisies. */
  const contacts = readJSON(NEWSLETTER_FILE, []);
  const valide = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  let cibles;
  if (tous) {
    cibles = contacts.filter((c) => valide(c.email || "")).map((c) => ({ email: c.email, nom: c.name || "" }));
  } else {
    const voulus = [...new Set((emails || []).map((e) => String(e).trim().toLowerCase()).filter(valide))];
    cibles = voulus.map((e) => {
      const c = contacts.find((x) => (x.email || "").toLowerCase() === e);
      return { email: e, nom: (c && c.name) || "" };
    });
  }
  if (!cibles.length) return res.status(400).json({ error: "aucun-destinataire" });

  const sujet = `Invitation — ${ev.titre}`;
  const mot = String(message || "").slice(0, 4000);
  let envoyes = 0;
  for (const c of cibles) {
    const ok = await sendMail(c.email, sujet, texteInvitation(ev, mot, c.nom), gabaritInvitation(ev, mot, c.nom));
    if (ok) envoyes++;
    await new Promise((r) => setTimeout(r, 200));   // douceur avec le serveur SMTP
  }

  const journal = readJSON(ENVOIS_FILE, []);
  journal.unshift({
    event: ev.id, titre: ev.titre, date: new Date().toISOString(),
    destinataires: cibles.length, envoyes, adresses: cibles.map((c) => c.email)
  });
  writeJSON(ENVOIS_FILE, journal.slice(0, 500));

  sendPush("💌 Invitations envoyées", `${envoyes}/${cibles.length} — ${ev.titre}`);
  res.json({ ok: true, envoyes, total: cibles.length });
});

/* Historique des envois, par vernissage. */
app.get("/api/invitation/envois", requireAuth, (_req, res) => res.json(readJSON(ENVOIS_FILE, [])));

/* ---------------------------------------- certificat d'authenticité -- */
/* Référence publique : <idCommande>-<n° de ligne>. La page certificat.html
   affiche le document, prêt à imprimer ou à enregistrer en PDF. */

/* Certificats émis à la main depuis l'admin : ventes à l'atelier, en
   vernissage ou via une galerie, qui ne passent pas par le site. Ils vivent
   dans leur propre fichier et sont cherchés avant les commandes. */

app.get("/api/certificats", requireAuth, (_req, res) =>
  res.json(readJSON(CERTIFICATS_FILE, [])));

app.post("/api/certificats", requireAuth, (req, res) => {
  const b = req.body || {};
  const titre = String(b.titre || "").trim();
  const acheteur = String(b.acheteur || "").trim();
  if (!titre || !acheteur) return res.status(400).json({ error: "titre-et-acheteur-requis" });

  /* Référence tirée au sort plutôt que dérivée de l'horodatage : la page du
     certificat est publique, et le nom de l'acheteur y figure. */
  const alphabet = "ACDEFGHJKLMNPQRTUVWXY3479";   // sans caractères ambigus
  const tirage = Array.from(crypto.randomBytes(7))
    .map((n) => alphabet[n % alphabet.length]).join("");

  const cert = {
    ref: "PS-A-" + tirage,
    // date de vente conservée telle que saisie (AAAA-MM-JJ) : convertie en
    // horodatage, elle reculerait d'un jour selon le fuseau du lecteur
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : new Date().toISOString(),
    acheteur,
    titre,
    type: b.type === "tirage" ? "tirage" : "original",
    edition: String(b.edition || "").trim() || null,
    annee: String(b.annee || "").trim(),
    technique: String(b.technique || "").trim(),
    dimensions: String(b.dimensions || "").trim(),
    image: String(b.image || "").trim(),
    cree: new Date().toISOString()
  };

  const liste = readJSON(CERTIFICATS_FILE, []);
  liste.unshift(cert);
  writeJSON(CERTIFICATS_FILE, liste);
  res.json(cert);
});

app.delete("/api/certificats/:ref", requireAuth, (req, res) => {
  const liste = readJSON(CERTIFICATS_FILE, []);
  const reste = liste.filter((c) => c.ref !== req.params.ref);
  if (reste.length === liste.length) return res.status(404).json({ error: "introuvable" });
  writeJSON(CERTIFICATS_FILE, reste);
  res.json({ ok: true });
});

app.get("/api/certificat", (req, res) => {
  const ref = String(req.query.c || "");

  // certificat émis à la main : il a la priorité sur les références de commande
  const manuel = readJSON(CERTIFICATS_FILE, []).find((c) => c.ref === ref);
  if (manuel) {
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ref: manuel.ref,
      date: manuel.date,
      acheteur: manuel.acheteur,
      titre: manuel.titre,
      type: manuel.type,
      edition: manuel.edition,
      annee: manuel.annee,
      technique: manuel.technique,
      dimensions: manuel.dimensions,
      image: manuel.image
    });
  }

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
  Chiffre d'affaires : ${enFrancs(ca)}  (${ca} €)

AUDIENCE
  ${visites}
  Top pays : ${pays}

COMMUNAUTÉ
  Nouveaux contacts : ${nouveaux} (total : ${contacts.length})
  Idées reçues : ${idees}

${orders.length ? "Détail des commandes :\n" + orders.map((o) =>
  `  ${o.id} — ${o.client.name} — ${enFrancs(o.grandTotalEUR || o.totalEUR)} — ${o.statut}`).join("\n") : ""}

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

/* ------------------------- être rappelé par la galerie du vernissage -- */
/* Le visiteur laisse ses coordonnées pour qu'on le contacte au sujet d'une
   toile exposée. Le message part à Pascal et à la galerie (si son email est
   renseigné sur le vernissage), et reste archivé dans data/rappels.json. */

const RAPPELS_FILE = path.join(DATA_DIR, "rappels.json");

app.post("/api/rappel", formLimit, (req, res) => {
  const b = req.body || {};
  const nom = String(b.nom || "").trim().slice(0, 120);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
  const tel = String(b.tel || "").trim().slice(0, 40);
  const message = String(b.message || "").trim().slice(0, 2000);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!nom || (!emailOk && !tel)) return res.status(400).json({ error: "nom-et-contact-requis" });

  const cat = readJSON(CATALOGUE_FILE, { events: [], artworks: [] });
  const ev = (cat.events || []).find((e) => e.id === String(b.event || "")) || null;
  const art = (cat.artworks || []).find((a) => a.id === String(b.artworkId || "")) || null;
  const titre = art ? art.titre : String(b.titre || "").slice(0, 200);
  const galerie = ev ? (ev.hote || ev.lieu || "") : "";

  const rappel = {
    id: "C-" + Date.now().toString(36).toUpperCase(),
    date: new Date().toISOString(),
    event: ev ? ev.id : "", galerie,
    artworkId: art ? art.id : "", titre,
    nom, email: emailOk ? email : "", tel, message,
    consentement: true
  };
  const liste = readJSON(RAPPELS_FILE, []);
  liste.unshift(rappel);
  writeJSON(RAPPELS_FILE, liste.slice(0, 2000));

  /* qui laisse ses coordonnées entre dans le carnet de contacts */
  if (emailOk) upsertContact({ email, name: nom, source: "galerie" });

  res.json({ ok: true, ref: rappel.id });

  const corps = `${nom} souhaite être contacté(e) au sujet de la toile « ${titre} »${galerie ? `, exposée à ${galerie}` : ""}.

Téléphone : ${tel || "—"}
Email : ${emailOk ? email : "—"}
${message ? "\nMessage :\n" + message + "\n" : ""}
Cette personne a donné son accord pour être recontactée par la galerie et par l'artiste.
${art ? `\nL'œuvre : ${SITE_URL}/oeuvre.html?id=${art.id}` : ""}`;

  sendPush("📞 Demande de rappel", `${nom} — « ${titre} »${galerie ? " · " + galerie : ""}`);
  sendMail(ARTIST_NOTIFY, `📞 ${nom} souhaite être contacté(e) — « ${titre} »`, corps + `

Toutes les demandes : ${SITE_URL}/admin (onglet Vernissages)`);
  const galerieMail = ev && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(ev.contact_email || "").trim())
    ? String(ev.contact_email).trim() : "";
  if (galerieMail) {
    sendMail(galerieMail, `Un visiteur souhaite être contacté au sujet d'une œuvre de Pascal Sun — « ${titre} »`,
`Bonjour,

Un visiteur du site de Pascal Sun souhaite être contacté au sujet de la toile « ${titre} », exposée chez vous.

${corps}

Bien cordialement,
Pascal Sun — Peintre, Tahiti
${SITE_URL}`);
  }
});

app.get("/api/rappels", requireAuth, (_req, res) => res.json(readJSON(RAPPELS_FILE, [])));

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
