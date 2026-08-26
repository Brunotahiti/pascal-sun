#!/usr/bin/env node
/* =========================================================================
   Exercice de restauration — Galerie Pascal Sun

   Une sauvegarde ne vaut que si l'on sait la remonter. Ce script le prouve,
   sans jamais toucher au site en production :

     1. prend une sauvegarde (fichier local, ou la dernière de la production),
     2. la restaure dans un dossier temporaire,
     3. démarre une copie du site sur un port libre, avec ces données-là,
     4. vérifie que tout est bien là (pages, catalogue, commandes, clients…),
     5. affiche un rapport, arrête la copie et nettoie.

   À faire une fois par trimestre. La production n'est ni arrêtée, ni modifiée :
   elle n'est interrogée qu'en lecture, pour télécharger la sauvegarde.

   Usage :
     node tools/exercice-restauration.js                      (dernière sauvegarde de la production)
     node tools/exercice-restauration.js chemin/sauvegarde.json.gz
     node tools/exercice-restauration.js --garder             (laisse la copie tourner à la fin)

   Le mot de passe de l'admin est demandé par la variable ADMIN_PASSWORD
   lorsqu'il faut télécharger la sauvegarde depuis la production.
   ========================================================================= */

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");

const RACINE = path.join(__dirname, "..");
const SITE = process.env.SITE || "https://pascal-sun.com";
const PORT = Number(process.env.PORT_EXERCICE || 5099);
const args = process.argv.slice(2);
const GARDER = args.includes("--garder");
const SOURCE_ARG = args.find((a) => !a.startsWith("--"));

const gras = (t) => `\x1b[1m${t}\x1b[0m`;
const titre = (t) => console.log(`\n${gras(t)}`);
let echecs = 0;
const ok = (t) => console.log(`  \x1b[32m✓\x1b[0m ${t}`);
const ko = (t) => { echecs++; console.log(`  \x1b[31m✗\x1b[0m ${t}`); };
/* Ce qui mérite l'œil de Pascal sans mettre l'exercice en échec : la
   sauvegarde est fidèle, ce sont les données elles-mêmes qui appellent une
   correction (fiche laissée en brouillon, photo manquante…). */
const attention = [];
const vigie = (t) => { attention.push(t); console.log(`  \x1b[33m!\x1b[0m ${t}`); };

const travail = fs.mkdtempSync(path.join(os.tmpdir(), "exercice-pascal-sun-"));
const donnees = path.join(travail, "data");
fs.mkdirSync(donnees, { recursive: true });
let serveur = null;

function nettoyer() {
  if (serveur) { try { serveur.kill(); } catch { /* déjà parti */ } }
  if (!GARDER) { try { fs.rmSync(travail, { recursive: true, force: true }); } catch { /* rien à faire */ } }
}
process.on("SIGINT", () => { nettoyer(); process.exit(130); });

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 1. la sauvegarde ---- */
async function recupererSauvegarde() {
  titre("1. La sauvegarde");
  if (SOURCE_ARG) {
    if (!fs.existsSync(SOURCE_ARG)) { ko(`fichier introuvable : ${SOURCE_ARG}`); return null; }
    ok(`${path.basename(SOURCE_ARG)} — ${(fs.statSync(SOURCE_ARG).size / 1024).toFixed(0)} Ko`);
    return fs.readFileSync(SOURCE_ARG);
  }
  const motDePasse = process.env.ADMIN_PASSWORD;
  if (!motDePasse) {
    ko("indiquez ADMIN_PASSWORD pour télécharger la sauvegarde de la production, ou passez un fichier en argument");
    return null;
  }
  const login = await fetch(`${SITE}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: motDePasse })
  });
  if (!login.ok) { ko(`connexion refusée par ${SITE} (mot de passe ?)`); return null; }
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const r = await fetch(`${SITE}/api/backup`, { headers: { cookie } });
  if (!r.ok) { ko(`téléchargement refusé (${r.status})`); return null; }
  const buf = Buffer.from(await r.arrayBuffer());
  ok(`sauvegarde téléchargée depuis ${SITE} — ${(buf.length / 1024).toFixed(0)} Ko`);
  return buf;
}

/* ---- 2. restauration ---- */
function restaurer(archive) {
  titre("2. Restauration dans une copie");
  let d;
  try { d = JSON.parse(zlib.gunzipSync(archive)); }
  catch (e) { ko(`sauvegarde illisible : ${e.message}`); return null; }
  const ecrire = (nom, v) => { if (v !== undefined && v !== null) fs.writeFileSync(path.join(donnees, nom), JSON.stringify(v, null, 2)); };
  ecrire("catalogue.json", d.catalogue);
  ecrire("orders.json", d.orders);
  ecrire("certificats.json", d.certificats);
  ecrire("rsvp.json", d.rsvp);
  ecrire("invitations.json", d.invitations);
  ecrire("newsletter.json", d.contacts);
  ecrire("commissions.json", d.commissions);
  ecrire("idees.json", d.idees);
  const c = d.catalogue || {};
  console.log(`  Sauvegarde du ${d.exportedAt ? new Date(d.exportedAt).toLocaleString("fr-FR") : "?"}`);
  console.log(`  ${(c.artworks || []).length} œuvres · ${(d.orders || []).length} commandes · ${(d.contacts || []).length} contacts`
    + ` · ${(d.certificats || []).length} certificats · ${(d.rsvp || []).length} réponses d'invitation`);
  ok("données écrites dans la copie");
  return d;
}

/* ---- 3. démarrage de la copie ---- */
async function demarrer() {
  titre(`3. Démarrage de la copie (port ${PORT})`);
  const journal = fs.openSync(path.join(travail, "serveur.log"), "a");
  serveur = spawn(process.execPath, ["server.js"], {
    cwd: RACINE, stdio: ["ignore", journal, journal],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: donnees, ADMIN_PASSWORD: "exercice", APP_SECRET: "exercice", SCW_ACCESS_KEY: "", SCW_SECRET_KEY: "", SCW_BUCKET: "" }
  });
  for (let i = 0; i < 60; i++) {
    await attendre(500);
    try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) { ok(`copie en ligne sur http://localhost:${PORT}`); return true; } } catch { /* pas encore prêt */ }
  }
  ko("la copie n'a pas démarré");
  console.log(fs.readFileSync(path.join(travail, "serveur.log"), "utf8").split("\n").slice(-15).join("\n"));
  return false;
}

/* ---- 4. vérifications ---- */
async function verifier(sauvegarde) {
  titre("4. Vérifications");
  const page = async (chemin, attendu, nom) => {
    try {
      const t = await (await fetch(`http://localhost:${PORT}${chemin}`)).text();
      t.includes(attendu) ? ok(nom) : ko(`${nom} — « ${attendu} » introuvable`);
    } catch (e) { ko(`${nom} — ${e.message}`); }
  };
  await page("/", "Pascal", "page d'accueil");
  await page("/galerie.html", 'data-page="gallery"', "page galerie");
  await page("/cgv.html", "T257691", "mentions légales (n° Tahiti)");
  await page("/admin", "Espace admin", "espace d'administration");

  try {
    const c = await (await fetch(`http://localhost:${PORT}/api/catalogue`)).json();
    const a = c.artworks || [];
    const attendues = ((sauvegarde.catalogue || {}).artworks || []).length;
    if (a.length !== attendues) ko(`catalogue servi : ${a.length} œuvres au lieu de ${attendues}`);
    else {
      ok(`catalogue servi : ${a.length} œuvres, comme dans la sauvegarde`);
      const sansPhoto = a.filter((x) => !x.image);
      const sansPrix = a.filter((x) => (x.statut || "disponible") === "disponible" && !(x.prixEUR > 0));
      if (sansPhoto.length) vigie(`${sansPhoto.length} œuvre(s) sans photo : ${sansPhoto.map((x) => x.titre).join(", ")}`);
      if (sansPrix.length) vigie(`${sansPrix.length} œuvre(s) proposée(s) sans prix : ${sansPrix.map((x) => x.titre).join(", ")} — à compléter ou à masquer dans l'admin`);
    }
  } catch (e) { ko(`catalogue illisible : ${e.message}`); }

  /* les données sensibles doivent être là, et protégées */
  try {
    const r = await fetch(`http://localhost:${PORT}/api/orders`);
    if (r.status === 401 || r.status === 403) ok("commandes protégées par mot de passe (401)");
    else ko(`les commandes répondent sans connexion (${r.status})`);
  } catch (e) { ko(`commandes : ${e.message}`); }

  try {
    const login = await fetch(`http://localhost:${PORT}/api/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "exercice" })
    });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    const orders = await (await fetch(`http://localhost:${PORT}/api/orders`, { headers: { cookie } })).json();
    const attendues = (sauvegarde.orders || []).length;
    orders.length === attendues
      ? ok(`commandes restaurées : ${orders.length}`)
      : ko(`commandes restaurées : ${orders.length} au lieu de ${attendues}`);
    const contacts = await (await fetch(`http://localhost:${PORT}/api/contacts`, { headers: { cookie } })).json();
    const attendus = (sauvegarde.contacts || []).length;
    (Array.isArray(contacts) ? contacts.length : -1) === attendus
      ? ok(`clients restaurés : ${attendus}`)
      : ko(`clients restaurés : ${Array.isArray(contacts) ? contacts.length : "?"} au lieu de ${attendus}`);
  } catch (e) { ko(`lecture des données : ${e.message}`); }
}

(async () => {
  console.log(gras("\nExercice de restauration — Galerie Pascal Sun"));
  console.log("La production n'est ni arrêtée ni modifiée : tout se passe dans une copie.");
  const archive = await recupererSauvegarde();
  if (!archive) { nettoyer(); process.exit(1); }
  const sauvegarde = restaurer(archive);
  if (!sauvegarde) { nettoyer(); process.exit(1); }
  if (!(await demarrer())) { nettoyer(); process.exit(1); }
  await verifier(sauvegarde);

  titre("Résultat");
  if (attention.length) {
    console.log(`  \x1b[33m${attention.length} point(s) à regarder dans les données\x1b[0m (sans rapport avec la sauvegarde) :`);
    attention.forEach((t) => console.log(`    · ${t}`));
  }
  if (echecs === 0) {
    console.log("  \x1b[32mExercice réussi\x1b[0m — la sauvegarde est exploitable, le site remonte tel quel.");
    console.log("  Notez-le dans l'admin : Sauvegardes → Sécurité & vérifications → « J'ai fait l'exercice ».");
  } else {
    console.log(`  \x1b[31m${echecs} vérification(s) en échec\x1b[0m — journal : ${path.join(travail, "serveur.log")}`);
  }
  if (GARDER) {
    console.log(`\n  La copie reste en ligne sur http://localhost:${PORT} (mot de passe de l'admin : « exercice »).`);
    console.log(`  Données restaurées : ${donnees}`);
    console.log("  Pour tout arrêter : Ctrl+C.");
    await new Promise(() => {});
  }
  nettoyer();
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error(e); nettoyer(); process.exit(1); });
