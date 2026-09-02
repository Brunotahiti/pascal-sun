/* Lance un vrai serveur pour les tests : port libre, volume de données vierge
   dans un dossier temporaire, aucun email ni notification (pas de SMTP, pas
   de clés VAPID). Chaque scénario part donc de l'état « premier démarrage » :
   le catalogue semé depuis js/data.js, rien d'autre. */
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");

const RACINE = path.join(__dirname, "..");
const MOT_DE_PASSE = "motdepasse-de-test";

function portLibre() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

async function demarrer() {
  const port = await portLibre();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "pascal-sun-test-"));
  const journal = fs.openSync(path.join(data, "serveur.log"), "a");
  const proc = spawn(process.execPath, ["server.js"], {
    cwd: RACINE,
    stdio: ["ignore", journal, journal],
    env: {
      PATH: process.env.PATH,
      PORT: String(port), DATA_DIR: data,
      ADMIN_PASSWORD: MOT_DE_PASSE, APP_SECRET: "secret-de-test",
      SITE_URL: "https://pascal-sun.com",
      // rien ne sort : ni email, ni notification, ni copie hors serveur
      SMTP_PASS: "", VAPID_PUBLIC: "", VAPID_PRIVATE: "",
      SCW_ACCESS_KEY: "", SCW_SECRET_KEY: "", SCW_BUCKET: ""
    }
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { if ((await fetch(base + "/api/session")).ok) break; } catch { /* pas encore prêt */ }
    if (i === 79) throw new Error("le serveur de test n'a pas démarré :\n" + fs.readFileSync(path.join(data, "serveur.log"), "utf8"));
  }

  /* Les formulaires publics sont limités à 20 appels par heure et par
     adresse : chaque appel de test se présente depuis une adresse distincte
     (le serveur fait confiance au premier mandataire, comme derrière Traefik),
     sauf quand un test veut justement éprouver cette limite. */
  let compteur = 0;
  const appel = async (chemin, options = {}) => {
    const { corps, cookie, ip, methode, brut } = options;
    const entetes = { "X-Forwarded-For": ip || `10.0.${Math.floor(++compteur / 250)}.${compteur % 250 + 1}` };
    if (cookie) entetes.cookie = cookie;
    if (corps !== undefined) entetes["Content-Type"] = "application/json";
    const r = await fetch(base + chemin, { method: methode || (corps !== undefined ? "POST" : "GET"), headers: entetes, body: corps !== undefined ? JSON.stringify(corps) : undefined });
    if (brut) return r;
    const texte = await r.text();
    let json = null; try { json = JSON.parse(texte); } catch { /* pas du JSON */ }
    return { status: r.status, ok: r.ok, json, texte, entetes: r.headers };
  };
  const connecter = async () => {
    const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.9.9.9" }, body: JSON.stringify({ password: MOT_DE_PASSE }) });
    if (!r.ok) throw new Error("connexion admin impossible");
    return (r.headers.get("set-cookie") || "").split(";")[0];
  };
  const arreter = () => { try { proc.kill(); } catch { /* déjà parti */ } try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* rien */ } };
  return { base, data, appel, connecter, arreter, MOT_DE_PASSE };
}

module.exports = { demarrer, RACINE };
