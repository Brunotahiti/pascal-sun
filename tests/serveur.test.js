/* Scénarios de bout en bout : un vrai serveur, un volume vide, et tout ce
   qu'un visiteur, un acheteur ou l'admin peuvent lui faire — y compris ce
   qu'ils ne devraient pas pouvoir faire. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { demarrer } = require("./_serveur");

let S, cookie;
before(async () => { S = await demarrer(); cookie = await S.connecter(); });
after(() => S && S.arreter());

const catalogue = async () => (await S.appel("/api/catalogue")).json;
const oeuvre = async (id) => (await catalogue()).artworks.find((a) => a.id === id);
const commande = (items, client = {}) => S.appel("/api/orders", { corps: { items, client: {
  name: "Hina Vaitua", email: `hina-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.pf`,
  country: "Polynésie française", mode: "livraison", zone: "pf", payment: "virement", ...client } } });
const publierCatalogue = async (modif) => {
  const c = await catalogue(); modif(c);
  const r = await S.appel("/api/catalogue", { methode: "PUT", corps: c, cookie });
  assert.equal(r.status, 200, "publication du catalogue");
  return c;
};

/* ------------------------------------------------- premier démarrage -- */
test("premier démarrage sur volume vide : le catalogue est semé", async () => {
  const c = await catalogue();
  assert.ok(c.artworks.length >= 10, "des œuvres semées");
  assert.ok(c.artworks.every((a) => a.image && a.titre), "chaque œuvre a un titre et une photo");
  assert.ok(Array.isArray(c.events), "des vernissages");
});

/* ----------------------------------------------------------- sécurité -- */
test("connexion admin : bon mot de passe accepté, mauvais refusé", async () => {
  const bon = await S.appel("/api/login", { corps: { password: S.MOT_DE_PASSE }, ip: "10.8.8.1" });
  assert.equal(bon.status, 200);
  const mauvais = await S.appel("/api/login", { corps: { password: "faux" }, ip: "10.8.8.2" });
  assert.equal(mauvais.status, 401);
  const vide = await S.appel("/api/login", { corps: {}, ip: "10.8.8.3" });
  assert.equal(vide.status, 401);
});

test("force brute : la connexion se ferme après 8 essais depuis la même adresse", async () => {
  let dernier;
  for (let i = 0; i < 9; i++) dernier = await S.appel("/api/login", { corps: { password: "faux" }, ip: "10.7.7.7" });
  assert.equal(dernier.status, 429, "9e essai refusé pour excès");
});

test("toutes les routes de l'admin refusent un visiteur non connecté", async () => {
  const protegees = [
    ["/api/orders"], ["/api/contacts"], ["/api/backup"], ["/api/backups"], ["/api/certificats"],
    ["/api/rsvp"], ["/api/invitation/stats"], ["/api/verifications"], ["/api/sauvegardes/scaleway"],
    ["/api/qrcode.svg"], ["/api/idees"], ["/api/rappels"], ["/api/commissions"], ["/api/stats/overview"],
    ["/api/catalogue", { methode: "PUT", corps: { artworks: [] } }],
    ["/api/orders/statut", { corps: { id: "x", statut: "payee" } }],
    ["/api/verifications", { corps: { quoi: "exercice" } }]
  ];
  for (const [chemin, opt] of protegees) {
    const r = await S.appel(chemin, opt);
    assert.equal(r.status, 401, `${chemin} doit répondre 401, a répondu ${r.status}`);
  }
});

test("un faux cookie de session est rejeté", async () => {
  const r = await S.appel("/api/orders", { cookie: "ps_admin=1700000000000.deadbeef" });
  assert.equal(r.status, 401);
});

test("en-têtes de protection présents sur chaque réponse", async () => {
  const r = await S.appel("/", { brut: true });
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.ok((r.headers.get("permissions-policy") || "").includes("camera=(self)"), "la caméra reste possible pour l'AR");
  assert.equal(r.headers.get("x-powered-by"), null);
});

/* ---------------------------------------------------------- commandes -- */
test("commande d'un original : réservé, total juste, certificat disponible", async () => {
  const a = await oeuvre("le-retour-de-peche");
  const r = await commande([{ id: a.id, key: "original", qty: 1 }]);
  assert.equal(r.status, 200, r.texte);
  assert.equal(r.json.totalEUR, a.prixEUR, "le total vient du catalogue");
  assert.equal((await oeuvre(a.id)).statut, "reserve", "l'original est mis de côté");
  const cert = await S.appel(`/api/certificat?c=${r.json.orderId}-0`);
  assert.equal(cert.status, 200);
  assert.equal(cert.json.titre, a.titre);
  assert.equal(cert.json.acheteur, "Hina Vaitua");
  const qr = await S.appel(`/api/certificat/qrcode.svg?c=${r.json.orderId}-0`);
  assert.equal(qr.status, 200, "le QR du certificat est public");
  assert.ok(qr.texte.startsWith("<svg"));
});

test("un original réservé ou vendu ne peut plus être commandé", async () => {
  const deja = await commande([{ id: "le-retour-de-peche", key: "original", qty: 1 }]);
  assert.equal(deja.status, 409, "réservé : refusé");
  await publierCatalogue((c) => { const a = c.artworks.find((x) => x.id === "le-tressage"); a.statut = "vendu"; a.vendu = true; });
  const vendu = await commande([{ id: "le-tressage", key: "original", qty: 1 }]);
  assert.equal(vendu.status, 409, "vendu : refusé");
});

test("le prix envoyé par le navigateur est ignoré : seul le catalogue fait foi", async () => {
  const a = await oeuvre("la-vahine-a-la-couronne");
  const r = await commande([{ id: a.id, key: "original", qty: 1, prixEUR: 1 }]);
  assert.equal(r.status, 200);
  assert.equal(r.json.totalEUR, a.prixEUR);
});

test("tirages : le stock se décompte, la quantité est bornée, plus de stock = refus", async () => {
  const avant = (await oeuvre("l-homme-au-coq")).produits.find((p) => p.key === "tirage");
  const r = await commande([{ id: "l-homme-au-coq", key: "tirage", qty: 2 }]);
  assert.equal(r.status, 200);
  const apres = (await oeuvre("l-homme-au-coq")).produits.find((p) => p.key === "tirage");
  assert.equal(apres.stock, avant.stock - 2);
  assert.equal(r.json.totalEUR, avant.prixEUR * 2);
  const trop = await commande([{ id: "l-homme-au-coq", key: "tirage", qty: 999 }]);
  assert.equal(trop.status, 200);
  assert.equal(trop.json.totalEUR, avant.prixEUR * 20, "au plus 20 par commande");
  await publierCatalogue((c) => { c.artworks.find((x) => x.id === "l-homme-au-coq").produits.find((p) => p.key === "tirage").stock = 0; });
  const vide = await commande([{ id: "l-homme-au-coq", key: "tirage", qty: 1 }]);
  assert.equal(vide.status, 409, "stock épuisé : refusé");
});

test("frais de port : zone, grand format, retrait gratuit, offerts au-delà du seuil", async () => {
  const ok = (r) => { assert.equal(r.status, 200, r.texte); return r.json; };
  const ordres = async () => (await S.appel("/api/orders", { cookie })).json;
  // 130 × 97 cm : grand format, reste du monde
  await publierCatalogue((c) => c.artworks.forEach((a) => { if (a.statut === "reserve") a.statut = "disponible"; }));
  const grand = ok(await commande([{ id: "le-retour-de-peche", key: "original", qty: 1 }], { zone: "monde" }));
  const o1 = (await ordres()).find((o) => o.id === grand.orderId);
  assert.ok(o1.livraisonEUR > 0, "livraison facturée hors seuil");
  assert.equal(o1.grandTotalEUR, o1.totalEUR + o1.livraisonEUR);
  // retrait : rien
  await publierCatalogue((c) => c.artworks.forEach((a) => { if (a.statut === "reserve") a.statut = "disponible"; }));
  const retrait = ok(await commande([{ id: "le-retour-de-peche", key: "original", qty: 1 }], { mode: "retrait" }));
  assert.equal((await ordres()).find((o) => o.id === retrait.orderId).livraisonEUR, 0);
  // 4000 € : livraison offerte
  const offerte = ok(await commande([{ id: "le-filet-face-a-moorea", key: "original", qty: 1 }], { zone: "monde" }));
  assert.equal((await ordres()).find((o) => o.id === offerte.orderId).livraisonEUR, 0, "offerte au-delà du seuil");
});

test("commande invalide : sans email, sans article, article inconnu", async () => {
  const sansEmail = await S.appel("/api/orders", { corps: { items: [{ id: "le-tressage", key: "original", qty: 1 }], client: { name: "X" } } });
  assert.equal(sansEmail.status, 400);
  const sansArticle = await commande([]);
  assert.equal(sansArticle.status, 400);
  const inconnu = await commande([{ id: "n-existe-pas", key: "original", qty: 1 }]);
  assert.equal(inconnu.status, 409);
});

test("réservation à la galerie du vernissage : seulement si un vernissage vend sur place", async () => {
  await publierCatalogue((c) => c.artworks.forEach((a) => { if (a.statut === "reserve") a.statut = "disponible"; }));
  // sans vernissage vendeur : le mode retombe en retrait, paiement sur place impossible
  const sans = await commande([{ id: "le-pecheur-au-harpon", key: "original", qty: 1 }], { mode: "galerie", payment: "surplace" });
  assert.equal(sans.status, 200);
  const ordres = async () => (await S.appel("/api/orders", { cookie })).json;
  const o1 = (await ordres()).find((o) => o.id === sans.json.orderId);
  assert.equal(o1.mode, "retrait");
  assert.equal(o1.payment, "virement");
  // avec un vernissage à venir qui vend sur place
  const dans30j = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
  await publierCatalogue((c) => {
    c.events.unshift({ id: "test-vernissage", titre: "Test", lieu: "Galerie de test", ville: "Bora Bora", date: dans30j, heure: "18h00",
      vente_sur_place: true, hote: "Hôtel du Lagon", contact_email: "galerie@example.pf" });
    c.artworks.forEach((a) => { if (a.statut === "reserve") a.statut = "disponible"; });
  });
  const avec = await commande([{ id: "le-pecheur-au-harpon", key: "original", qty: 1 }], { mode: "galerie", payment: "surplace", event: "test-vernissage" });
  assert.equal(avec.status, 200, avec.texte);
  const o2 = (await ordres()).find((o) => o.id === avec.json.orderId);
  assert.equal(o2.mode, "galerie");
  assert.equal(o2.payment, "surplace");
  assert.equal(o2.galerie, "Hôtel du Lagon");
  assert.equal(o2.livraisonEUR, 0);
  const consignes = await S.appel(`/api/commande/${avec.json.orderId}/paiement`);
  assert.equal(consignes.json.mode, "galerie");
  assert.equal(consignes.json.galerie, "Hôtel du Lagon");
});

test("consignes de paiement : RIB et PayPal renseignés dans l'admin, jamais de données personnelles", async () => {
  await publierCatalogue((c) => { c.paiement = { titulaire: "Pascal Sun", iban: "FR76 0000 0000 0000", bic: "ABCDEFGH", banque: "Banque", paypal: "paypal.me/test" };
    c.artworks.forEach((a) => { if (a.statut === "reserve") a.statut = "disponible"; }); });
  const r = await commande([{ id: "la-recolte-des-cocos", key: "original", qty: 1 }], { payment: "paypal" });
  const c = await S.appel(`/api/commande/${r.json.orderId}/paiement`);
  assert.equal(c.status, 200);
  assert.equal(c.json.payment, "paypal");
  assert.equal(c.json.paiement.iban, "FR76 0000 0000 0000");
  assert.equal(JSON.stringify(c.json).includes("Hina"), false, "pas le nom de l'acheteur");
  assert.equal((await S.appel("/api/commande/PS-INVENTE/paiement")).status, 404);
});

test("statut de commande : les valeurs inconnues sont ignorées", async () => {
  const ordres = (await S.appel("/api/orders", { cookie })).json;
  const o = ordres[0];
  await S.appel("/api/orders/statut", { cookie, corps: { id: o.id, statut: "payee" } });
  assert.equal((await S.appel("/api/orders", { cookie })).json.find((x) => x.id === o.id).statut, "payee");
  await S.appel("/api/orders/statut", { cookie, corps: { id: o.id, statut: "piratee" } });
  assert.equal((await S.appel("/api/orders", { cookie })).json.find((x) => x.id === o.id).statut, "payee", "inchangé");
  assert.equal((await S.appel("/api/orders/statut", { cookie, corps: { id: "PS-NOPE", statut: "payee" } })).status, 404);
});

/* --------------------------------------------------------- certificats -- */
test("certificats : une affiche n'en a pas, une référence inventée non plus, un certificat manuel oui", async () => {
  const r = await commande([{ id: "la-pecheuse-au-chapeau", key: "affiche", qty: 1 }]);
  assert.equal(r.status, 200);
  assert.equal((await S.appel(`/api/certificat?c=${r.json.orderId}-0`)).status, 404, "affiche : pas de certificat");
  assert.equal((await S.appel(`/api/certificat/qrcode.svg?c=${r.json.orderId}-0`)).status, 404);
  assert.equal((await S.appel("/api/certificat?c=PS-INVENTE-0")).status, 404);
  assert.equal((await S.appel("/api/certificat?c=n-importe-quoi")).status, 400);
  const manuel = await S.appel("/api/certificats", { cookie, corps: { titre: "Toile d'atelier", acheteur: "Teva M.", date: "2026-08-14", type: "original" } });
  assert.equal(manuel.status, 200);
  assert.match(manuel.json.ref, /^PS-A-[ACDEFGHJKLMNPQRTUVWXY3479]{7}$/, "référence tirée au sort, sans caractères ambigus");
  const page = await S.appel(`/api/certificat?c=${manuel.json.ref}`);
  assert.equal(page.json.date, "2026-08-14", "la date de vente reste telle que saisie (pas de décalage de fuseau)");
  assert.equal((await S.appel(`/api/certificat/qrcode.svg?c=${manuel.json.ref}`)).status, 200);
  assert.equal((await S.appel("/api/certificats", { cookie, corps: { titre: "", acheteur: "X" } })).status, 400);
});

/* --------------------------------------------------------- invitations -- */
test("invitation : ouvertures, visiteurs distincts et origines", async () => {
  for (const [vid, source] of [["a", "email"], ["a", "email"], ["b", "direct"]]) {
    await S.appel("/api/invitation/vue", { corps: { event: "vernissage-lagon", vid, source } });
  }
  const st = (await S.appel("/api/invitation/stats", { cookie })).json["vernissage-lagon"];
  assert.equal(st.vues, 3);
  assert.equal(st.visiteurs.length, 2);
  assert.equal(st.sources.email, 2);
  assert.equal(st.sources.direct, 1);
  assert.equal((await S.appel("/api/invitation/vue", { corps: {} })).status, 400);
});

test("réponse à l'invitation : qui confirme entre au carnet, et peut ensuite commander sans planter", async () => {
  const email = "invite-confirme@example.pf";
  const oui = await S.appel("/api/rsvp", { corps: { event: "vernissage-lagon", titre: "Vernissage", nom: "Moana T.", email, reponse: "oui", personnes: 3 } });
  assert.equal(oui.status, 200, oui.texte);
  const contacts = (await S.appel("/api/contacts", { cookie })).json;
  assert.ok(contacts.some((c) => c.email === email), "au carnet");
  // c'était un vrai bug : un contact venu du RSVP faisait planter la commande suivante
  await publierCatalogue((c) => c.artworks.forEach((a) => { if (a.statut === "reserve") a.statut = "disponible"; }));
  const cmd = await commande([{ id: "le-retour-de-peche", key: "original", qty: 1 }], { email, name: "Moana T." });
  assert.equal(cmd.status, 200, cmd.texte);
  const apres = (await S.appel("/api/contacts", { cookie })).json.find((c) => c.email === email);
  assert.equal(apres.orders, 1);
  assert.ok(apres.sources.includes("vernissage") && apres.sources.includes("commande"));
  const non = await S.appel("/api/rsvp", { corps: { event: "vernissage-lagon", nom: "Absent", email: "absent@example.pf", reponse: "non" } });
  assert.equal(non.status, 200);
  assert.equal((await S.appel("/api/contacts", { cookie })).json.some((c) => c.email === "absent@example.pf"), false, "qui décline n'entre pas au carnet");
  assert.equal((await S.appel("/api/rsvp", { corps: { nom: "X", email: "pas-un-email" } })).status, 400);
});

/* ------------------------------------------------ formulaires publics -- */
test("newsletter, alerte œuvre, boîte à idées : validations et doublons", async () => {
  assert.equal((await S.appel("/api/newsletter", { corps: { email: "abonne@example.pf", name: "A" } })).status, 200);
  assert.equal((await S.appel("/api/newsletter", { corps: { email: "ABONNE@example.pf" } })).status, 200);
  const contacts = (await S.appel("/api/contacts", { cookie })).json.filter((c) => c.email.toLowerCase() === "abonne@example.pf");
  assert.equal(contacts.length, 1, "pas de doublon à la casse près");
  assert.equal((await S.appel("/api/newsletter", { corps: { email: "nope" } })).status, 400);
  assert.equal((await S.appel("/api/notify", { corps: { email: "abonne@example.pf", artworkId: "le-tressage", titre: "Le tressage" } })).status, 200);
  assert.equal((await S.appel("/api/idees", { corps: { message: "ok" } })).status, 400, "trop court");
  assert.equal((await S.appel("/api/idees", { corps: { message: "Une belle idée pour la galerie" } })).status, 200);
});

test("formulaires : 20 envois par heure et par adresse, pas plus", async () => {
  let dernier;
  for (let i = 0; i < 21; i++) dernier = await S.appel("/api/newsletter", { corps: { email: `spam${i}@example.pf` }, ip: "10.6.6.6" });
  assert.equal(dernier.status, 429);
});

/* -------------------------------------------------------- fiches en ligne -- */
test("fiches inachevées : hors du plan du site, jamais annoncées", async () => {
  await publierCatalogue((c) => {
    c.artworks.push({ id: "brouillon-test", titre: "Nouvelle œuvre", statut: "brouillon", prixEUR: 0, image: "" });
    c.artworks.push({ id: "sans-prix-test", titre: "Sans prix", statut: "disponible", prixEUR: 0, image: "img/x.webp" });
  });
  const sm = (await S.appel("/sitemap.xml")).texte;
  assert.ok(sm.includes("<urlset"), "XML de plan de site");
  assert.ok(sm.includes("oeuvre.html?id=le-retour-de-peche"), "une œuvre finie y est");
  assert.equal(sm.includes("brouillon-test"), false, "un brouillon n'y est pas");
  assert.equal(sm.includes("sans-prix-test"), false, "une œuvre sans prix n'y est pas");
});

test("collections : renommées dans l'admin, servies au site", async () => {
  await publierCatalogue((c) => { c.collections = [{ key: "ocean", fr: "Lagon", en: "Lagoon" }, { key: "vahine", fr: "Vahine", en: "Vahine" }]; });
  const c = await catalogue();
  assert.equal(c.collections[0].fr, "Lagon");
});

/* -------------------------------------------------------- sauvegardes -- */
test("sauvegarde : complète, relisible, et le registre des vérifications y est", async () => {
  const r = await S.appel("/api/backup", { cookie, brut: true });
  assert.equal(r.status, 200);
  const zlib = require("zlib");
  const d = JSON.parse(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())));
  for (const cle of ["catalogue", "orders", "contacts", "certificats", "rsvp", "invitations", "verifications"]) assert.ok(cle in d, `clé ${cle}`);
  assert.ok(d.orders.length >= 5, "les commandes du test y sont");
  assert.ok(d.catalogue.artworks.length >= 10);
});

test("écriture atomique : aucun fichier temporaire ne traîne après les commandes", async () => {
  const restes = fs.readdirSync(S.data).filter((f) => f.includes(".tmp-"));
  assert.deepEqual(restes, []);
});

test("fichier de données corrompu : mis de côté, signalé, jamais avalé en silence", async () => {
  const f = path.join(S.data, "idees.json");
  fs.writeFileSync(f, "{ ceci n'est pas du JSON");
  const r = await S.appel("/api/idees", { corps: { message: "Après la corruption, ça tourne encore" } });
  assert.equal(r.status, 200, "le site continue de répondre");
  const copies = fs.readdirSync(S.data).filter((x) => x.startsWith("idees.json.corrompu-"));
  assert.equal(copies.length, 1, "l'original abîmé est conservé de côté");
  assert.ok(fs.readFileSync(copies[0] && path.join(S.data, copies[0]), "utf8").startsWith("{ ceci"), "tel quel");
  const journal = fs.readFileSync(path.join(S.data, "serveur.log"), "utf8");
  assert.ok(journal.includes("DONNÉES ILLISIBLES"), "crié dans le journal");
});

/* ------------------------------------------------------ vérifications -- */
test("registre des vérifications : échéances, historique, refus de l'inconnu", async () => {
  const avant = (await S.appel("/api/verifications", { cookie })).json;
  assert.equal(avant.exercice.jamais, true);
  assert.equal(avant.secrets.length, 5);
  const r = await S.appel("/api/verifications", { cookie, corps: { quoi: "exercice", note: "test" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.etat.exercice.jamais, false);
  assert.ok(new Date(r.json.etat.exercice.du) > new Date(), "prochaine échéance dans le futur");
  assert.equal((await S.appel("/api/verifications", { cookie, corps: { quoi: "nimporte" } })).status, 400);
});

test("copie hors serveur : la clé secrète enregistrée n'est jamais renvoyée", async () => {
  const r = await S.appel("/api/sauvegardes/scaleway", { cookie, methode: "PUT", corps: { accesId: "SCWABCDEFGHJKLMNPQRS", secret: "12345678-1234-1234-1234-123456789abc", bucket: "test-bucket", region: "fr-par" } });
  assert.equal(r.status, 200);
  const etat = (await S.appel("/api/sauvegardes/scaleway", { cookie })).json;
  assert.equal(etat.configure, true);
  assert.equal(JSON.stringify(etat).includes("12345678-1234"), false);
  assert.equal((await S.appel("/api/sauvegardes/scaleway", { cookie, methode: "PUT", corps: { accesId: "x", bucket: "MAJUSCULES" } })).status, 400);
});

/* ---------------------------------------------------------- QR codes -- */
test("QR codes : SVG valide, PNG décodable, cible marquée « venu du QR »", async () => {
  const cible = (await S.appel("/api/qrcode/cible?oeuvre=le-tressage", { cookie })).json.url;
  assert.equal(cible, "https://pascal-sun.com/oeuvre.html?id=le-tressage&s=qr");
  const svg = (await S.appel("/api/qrcode.svg?oeuvre=le-tressage", { cookie })).texte;
  assert.ok(svg.startsWith("<svg") && svg.includes("&amp;s=qr") && !svg.includes("&s=qr\""), "XML bien échappé");
  let jsQR, sharp;
  try { jsQR = require("jsqr"); sharp = require("sharp"); } catch { return; }   // décodeur absent : on s'arrête là
  const png = Buffer.from(await (await S.appel("/api/qrcode.png?oeuvre=le-tressage&taille=400", { cookie, brut: true })).arrayBuffer());
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lu = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  assert.ok(lu, "le PNG se décode");
  assert.equal(lu.data, cible);
});

/* ------------------------------------------------------------- pages -- */
test("les pages du site répondent, l'admin est hors index, le plan du site est déclaré", async () => {
  for (const p of ["/", "/galerie.html", "/oeuvre.html?id=le-tressage", "/expositions.html", "/panier.html", "/cgv.html", "/invitation.html?e=vernissage-lagon", "/certificat.html?c=x"]) {
    assert.equal((await S.appel(p)).status, 200, p);
  }
  assert.ok((await S.appel("/admin")).texte.includes("noindex"));
  assert.ok((await S.appel("/robots.txt")).texte.includes("Sitemap: https://pascal-sun.com/sitemap.xml"));
  assert.ok((await S.appel("/cgv.html")).texte.includes("T257691"), "le numéro Tahiti est dans les mentions légales");
});
