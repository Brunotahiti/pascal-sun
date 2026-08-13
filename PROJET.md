# Galerie Pascal Sun — dossier de projet

Document de reprise complet. À lire en début de nouvelle conversation pour
reprendre le travail sans rien redemander.

---

## 1. Le projet en une phrase

Galerie-boutique en ligne de **Pascal Sun**, artiste peintre à Tahiti, en
production sur **https://pascal-sun.com** : catalogue de ses toiles, vente
d'originaux, tirages et affiches dans le monde entier, espace d'administration
complet géré par l'artiste lui-même.

**Univers de l'artiste** : scènes de vie polynésiennes, style minimaliste,
noir et blanc au fusain avec **une seule touche de couleur** qui guide le
regard. Sa devise : *« Je ne peins pas pour remplir une toile. Je peins pour
laisser respirer une émotion. »*

---

## 2. Accès et identifiants

| Quoi | Où | Identifiants |
|---|---|---|
| Site public | https://pascal-sun.com | — |
| Espace admin | https://pascal-sun.com/admin | mot de passe `PascalSun-Fenua-793aa3!` |
| Statistiques brutes | https://stats.pascal-sun.com | `admin` + même mot de passe |
| Code source | https://github.com/Brunotahiti/pascal-sun (branche `master`) | compte GitHub `Brunotahiti`, `gh` CLI authentifié |
| Email artiste | contact@pascal-sun.com | mot de passe saisi dans l'admin (jamais dans le code) |
| Contacts directs de Pascal | 87 78 25 78 · sun.pascal09@gmail.com | affichés en pied de page et sur la page Contact (`ARTIST_PHONE`, `ARTIST_EMAIL_PERSO` dans `js/data.js`) |

**Le mot de passe email** est stocké de façon permanente dans
`data/mail.json` sur le volume Docker, saisi via **admin → onglet Sauvegardes
→ « ✉️ Emails automatiques »**. Il survit aux redéploiements. Si les emails
sont inactifs après une mise à jour, c'est qu'il faut le re-saisir là.

---

## 3. Hébergement et déploiement

**VPS Hostinger** `srv1565699` (id API **1565699**, IP **187.127.105.242**),
Ubuntu 24.04 + Docker + Traefik. Pas d'hébergement mutualisé : tout tourne en
conteneurs derrière Traefik (HTTPS Let's Encrypt automatique).

### Déployer une modification

```bash
# 1. bump du cache (indispensable, sinon les navigateurs gardent l'ancien CSS/JS)
for f in *.html; do sed -i '' 's/?v=43/?v=44/g' "$f"; done
# 2. commit + push
git add -A && git commit -m "…" && git push
# 3. recréer le projet Docker via l'API Hostinger (MCP) :
#    VPS_createNewProjectV1 { virtualMachineId: 1565699, project_name: "pascal-sun",
#      content: "https://github.com/Brunotahiti/pascal-sun", environment: … }
# 4. attendre que la nouvelle version soit servie :
#    until curl -s https://pascal-sun.com/ | grep -q "?v=44"; do sleep 8; done
```

### Variables d'environnement à repasser à chaque déploiement

```
ADMIN_PASSWORD=PascalSun-Fenua-793aa3!
APP_SECRET=283d8fc2cd2c3282231e677c06606f5f361d776dfd2fd49c6729a697f96bf961
UMAMI_URL=http://pascal-sun-umami:3000
UMAMI_USER=admin
UMAMI_PASSWORD=PascalSun-Fenua-793aa3!
UMAMI_WEBSITE_ID=56116cc3-d031-4382-9868-905e305b96e5
VAPID_PUBLIC=BHLAm4TpfuaP9EMbgXM2bn5EUGyrwhdnRTLw2qqVI-Mnhu6rz-GNjx7S90lBbICvCxMmKgGGYVbnKWWF-Y3tb_k
VAPID_PRIVATE=D0qUqKRCdLYDdett3-JSH8aEH2JB7wyMYjySn8-KHZw
```

⚠️ **Ne jamais oublier `SMTP_PASS`** : il n'est PAS dans cette liste (il vit
dans `data/mail.json`). Ne pas le remettre en variable d'environnement.

### Autres projets Docker sur le même VPS

`pascal-sun` (le site), `pascal-sun-stats` (Umami + Postgres), plus une
vingtaine d'autres projets sans rapport (manaprocess, medipac, kaikau…).
**Ne jamais toucher aux autres.**

### DNS (API Hostinger, `DNS_updateDNSRecordsV1`)

- `@` → A 187.127.105.242
- `www` → CNAME pascal-sun.com
- `stats` → A 187.127.105.242
- MX / DKIM / SPF Hostinger pour la boîte mail — **ne pas y toucher**
- TXT de vérification Google Search Console (propriété déjà validée)

---

## 4. Architecture technique

**Aucun framework, aucune étape de build.** HTML + CSS + JavaScript natif,
servis par un petit serveur Node/Express.

```
server.js              serveur Express : site + admin + API + emails + push
package.json           express, multer, compression, nodemailer, web-push, sharp
Dockerfile             node:20-alpine
docker-compose.yml     service web derrière Traefik, volume pascal-sun-data

index.html             accueil
galerie.html           catalogue + filtres + projecteurs
oeuvre.html?id=…       fiche œuvre (3D / AR / en situation)
artiste.html           univers, photo de Pascal, diaporama, vidéos, signature
expositions.html       feuille de route des vernissages
journal.html           journal de l'atelier
portrait.html          portrait sur commande
idees.html             boîte à idées
panier.html            panier + livraison + paiement
merci.html             confirmation de commande
certificat.html?c=…    certificat d'authenticité imprimable (1 page A4)
cgv.html               conditions générales de vente
admin.html             espace d'administration (12 onglets)

css/style.css          identité du site
css/effects.css        curseur, grain, intro, marquee
css/viewer.css         visionneuse 3D / AR / salon
css/certificat.css     certificat A4
css/admin.css          espace admin

js/data.js             DONNÉES : ARTWORKS, EVENTS, SHIPPING, ECLAIRAGE, ATELIER, I18N…
js/app.js              moteur du site public
js/viewer.js           vue 3D, réalité augmentée, mise en situation
js/effects.js          intro « pinceau », curseur, boutons magnétiques
js/certificat.js       rendu + ajustement automatique du certificat
js/admin.js            espace d'administration

img/oeuvres/           toiles, 3 tailles WebP (480/960/1600)
img/atelier/           photos d'atelier + pascal-peint-*.webp
img/signature.png      signature manuscrite détourée
videos/atelier-*.mp4   3 vidéos compressées
sw.js                  service worker (PWA)
manifest.webmanifest   application installable
```

### Données persistantes (volume Docker `pascal-sun-data`, monté sur `/app/data`)

| Fichier | Contenu |
|---|---|
| `catalogue.json` | œuvres, vernissages, journal, avis, Instagram, livraison, atelier, textes |
| `orders.json` | commandes |
| `newsletter.json` | contacts / clients (CRM) |
| `commissions.json` | demandes de portrait |
| `idees.json` | boîte à idées |
| `push.json` | abonnements aux notifications |
| `mail.json` | identifiants SMTP |
| `backups/` | sauvegardes quotidiennes (30 jours) |
| `uploads/` | photos envoyées depuis l'admin |

Au **premier démarrage seulement**, `catalogue.json` est semé depuis
`js/data.js`. Ensuite c'est le fichier qui fait foi : **modifier `js/data.js`
ne change plus rien en production**. Pour changer les données en prod, passer
par l'admin ou par l'API :

```bash
curl -s -c /tmp/ck -X POST https://pascal-sun.com/api/login \
  -H "Content-Type: application/json" -d '{"password":"…"}' -o /dev/null
curl -s https://pascal-sun.com/api/catalogue > /tmp/cat.json
# … modifier /tmp/cat.json …
curl -s -b /tmp/ck -X PUT https://pascal-sun.com/api/catalogue \
  -H "Content-Type: application/json" --data-binary @/tmp/cat.json
```

---

## 5. Fonctionnalités

### Site public
- **Bilingue FR / EN**, devises **XPF (défaut) / EUR / USD** avec arrondis commerciaux
- **PWA installable** (guide d'installation illustré selon l'appareil)
- Intro « pinceau » à la première visite : un pinceau dessine l'horizon, Moorea, le soleil, le lagon
- **Galerie** : filtres par collection, **projecteurs** avec interrupteur (fondu jour/nuit, 7 dispositions d'éclairage réparties comme dans une vraie salle)
- **Fiche œuvre** : vue 3D (toile qui tourne, tranche et dos), **réalité augmentée** (caméra + photo souvenir), **mise en situation** dans un salon à l'échelle (tableau déplaçable)
- **Boutique** : original / tirage limité / affiche, stocks et statuts automatiques, frais de port par zone, livraison ou retrait, virement ou PayPal
- Vernissages, journal de l'atelier, portraits sur commande, boîte à idées, avis, Instagram, newsletter, CGV

### Espace admin (12 onglets)
Œuvres (photos avec recadrage, prix, stocks, statuts) · Vernissages · Commandes
(+ demandes de portrait, liens certificats) · **Certificats** (ventes hors
site) · Clients (CRM, invitations,
newsletter, export CSV) · Boîte à idées (+ notifications push) · Journal & avis
(+ diaporama atelier, Instagram) · Livraison · **Éclairage** · Textes & boutons · Statistiques
(intégrées, proxy Umami) · Sauvegardes (téléchargement, rapport mensuel, config email)

### Accueil
La toile en tête d'accueil **change à chaque visite** : `oeuvreEnTete()` dans
`js/app.js` avance d'un cran dans `ARTWORKS` et retient le rang dans
`localStorage.ps_hero`, plutôt que de tirer au sort — ainsi toutes les œuvres
passent à leur tour. La sélection « Œuvres récentes » exclut la toile déjà
montrée en tête, pour ne pas afficher deux fois la même image sur la page.

### Images
Toute photo envoyée depuis l'admin est déclinée **côté serveur** (`sharp`) en
trois WebP — 480 / 960 / 1600 px, qualité 80, jamais agrandie — et le site sert
la bonne taille via `srcset`. L'original envoyé est supprimé. Au démarrage, le
serveur rattrape les photos restées en une seule taille (opération sans effet si
tout est déjà décliné) ; le bouton **admin → Sauvegardes → « ⚡ Optimiser les
photos »** relance la même opération à la demande. `sharp` est chargé dans un
`try/catch` : s'il manque, le site fonctionne comme avant, sans déclinaisons.

### Certificats d'authenticité
Deux origines, une seule page publique `certificat.html?c=<réf>` :
- **ventes du site** — référence `<idCommande>-<n° de ligne>`, résolue dans
  `orders.json` ; le lien part dans l'email de confirmation ;
- **ventes hors du site** (atelier, vernissage, galerie) — créées dans
  **admin → onglet « 📜 Certificats »**, stockées dans
  `data/certificats.json`, référence `PS-A-XXXXXXX` tirée au sort. Choisir une
  œuvre du catalogue pré-remplit la fiche ; on peut aussi tout saisir à la main
  avec sa propre photo. `/api/certificat` cherche d'abord dans ce fichier, puis
  dans les commandes.

⚠️ Les **dates de vente** sont stockées en AAAA-MM-JJ et reconstruites en heure
locale à l'affichage (`dateVente()` dans `js/admin.js`, même logique dans
`js/certificat.js`). Passer par `new Date(iso)` ferait reculer la date d'un jour
depuis Tahiti — un certificat daté du 14 s'afficherait « 13 ».

### Automatismes
- Commande → original **réservé**, stock décompté, confirmation au client avec **lien du certificat**, alerte à Pascal (email + push)
- Nouvelle œuvre enregistrée → **annonce automatique** aux abonnés
- **Sauvegarde quotidienne** (30 jours conservés)
- **Rapport mensuel** le 1er du mois (ventes, CA, visiteurs, pays)
- Notifications push : commandes, idées, portraits, alertes œuvre

---

## 6. Décisions de conception à respecter

1. **Un seul cadre** autour des toiles : cadre noir fin + passe-partout crème.
   Aucune bordure ni ombre interne sur les images.
2. **Aucune inclinaison décorative** — tout est parfaitement droit.
3. Au survol : le cadre ne bouge pas, **la toile s'agrandit** (le passe-partout
   se réduit, 15 % restant visible), avec reflet de vitre.
4. **Proportions réelles** des toiles, jamais de rognage.
5. Charte **« vie douce de Tahiti »** : vagues du lagon, soleil en halo, corail
   / turquoise / sable. **Pas de motifs marquisiens**, pas d'esthétique japonaise.
6. Paiement : **virement + PayPal uniquement** (pas de Stripe pour l'instant,
   le code est prêt via `STRIPE_SECRET_KEY`).
7. Prix ronds, **en francs Pacifique partout par défaut** : le site (déjà),
   mais aussi les emails de commande, les notifications et l'admin, qui
   rappelle le montant en francs à côté de l'euro saisi. L'euro reste la
   valeur **stockée** (`prixEUR`) et figure entre parenthèses dans les emails,
   utile pour un virement international. ⚠️ Les arrondis doivent rester
   identiques des deux côtés — paliers 5000 / 1000 / 500 dans `fmtPrice()`
   (`js/app.js`), `enFrancs()` (`server.js`) et `enFrancs()` (`js/admin.js`) —
   sinon l'email annonce un prix différent de celui vu à l'écran.
8. Le certificat tient **sur une seule page A4** (ajustement automatique mesuré).
9. **Entrée en salle** : projecteurs allumés sur la page Galerie, le menu du haut
   se relève comme un rideau, le titre s'estompe sur place (aucun décalage : le
   texte garde sa place, la signature est en absolu par-dessus) et la signature
   de l'artiste s'éclaire à la sienne. Le menu disparaissant, la rangée de
   filtres se colle en haut pour que l'interrupteur reste toujours atteignable —
   une seule ligne qui glisse du doigt sur téléphone, interrupteur en tête.
   Une fois agrandie, **la signature s'écrit** : `::before` illumine la partie
   déjà parcourue (`clip-path` qui s'ouvre de gauche à droite, `paraphe-encre`)
   pendant que `::after` fait courir un point blanc à halo à la pointe de
   l'écriture (`paraphe-point`). Les deux sont contraints aux traits par le
   masque du paraphe. Le cycle se répète toutes les 8 s — un passage unique
   n'était jamais vu. Puis la braise respire (`paraphe-braise`).
   La signature apparaît d'abord à sa taille, **puis** grandit de 30 % (départ à
   1,15 s, une fois le fondu terminé) : menée en même temps que l'apparition, la
   croissance était invisible — la signature semblait arriver déjà agrandie. Et
   **les prix et
   sous-titres des toiles s'effacent** : en salle, les œuvres ne sont plus des
   articles, il ne reste que leur titre. Tout s'efface en gardant sa place —
   aucune ligne de la grille ne bouge pendant la transition.
10. **Éclairage de la galerie** : sept projecteurs, réglables dans l'admin
   (onglet Éclairage). Une source = trois nombres seulement — `x` et `y` en
   pourcentage du cadre, `angle` en degrés. Le faisceau, le halo sur la toile
   (`--hx` / `--hy`) et l'ombre portée (`--ox` / `--oy`) en sont **déduits**
   par `varsLumiere()` dans `js/data.js` : ne jamais les régler à la main, et
   ne jamais réintroduire de classes CSS `.lit-*` figées.

### Pièges rencontrés (à ne pas refaire)

- **`position: sticky` posé sur le mauvais élément** : la règle collait à la fois
  `figure.portrait` (voulu : la petite photo accompagne la lecture de la bio) et
  `.artist-hero` (le grand bandeau en tête de page). Résultat : sur mobile et
  dans Edge, le bandeau restait à l'écran et toute la page défilait dessous, en
  transparaissant dans son cadre. Le sticky est désormais limité à
  `.split figure.portrait` au-dessus de 900 px. Vérifier une correction de mise
  en page **en largeur mobile aussi**, pas seulement en grand écran.
- **Collision de classe CSS** : les images portent la classe `portrait` /
  `landscape` (orientation). Ne jamais styler `.portrait` sans le préfixer
  (`figure.portrait`), sinon toutes les toiles portrait héritent du style.
- **`height: auto` obligatoire** sur les images qui ont des attributs
  `width`/`height`, sinon elles sont écrasées.
- **Cache** : les visuels d'œuvres sont en `no-cache` (serveur + service
  worker les ignore) pour que les remplacements soient visibles tout de suite.
- **Safari ≠ Chrome** pour la pagination à l'impression : toujours vérifier en
  générant un vrai PDF (`chrome --headless --print-to-pdf`) et compter les pages.
- Toujours **bumper `?v=`** dans les HTML, sinon les navigateurs gardent l'ancien CSS/JS.
- **L'attribut `hidden` ne masque plus rien** dès qu'une règle d'auteur donne un
  `display` à l'élément — le `display:none` du navigateur pour `[hidden]` est une
  règle d'agent utilisateur, battue par n'importe quelle règle d'auteur. Le
  panneau newsletter (`.compose-panel`, en grille) restait ainsi ouvert en
  permanence. `[hidden] { display: none !important; }` en tête de `admin.css`
  règle le cas une fois pour toutes.
- **`canvas.toBlob()` retombe silencieusement sur le PNG** quand le navigateur ne
  sait pas encoder le format demandé. C'est ainsi que 11 photos « .webp » de 1 à
  3 Mo (des PNG en réalité) se sont retrouvées en ligne, servies en pleine taille
  à tout le monde : 18 Mo pour la page galerie. Toujours vérifier `blob.type`
  après encodage (`encodeCanvas()` dans `js/admin.js`), et ne jamais se fier au
  navigateur pour produire les images du site — c'est `sharp`, côté serveur, qui
  fabrique les trois tailles.
- **Les captures en `--virtual-time-budget` ne pilotent pas les animations CSS**
  composées (transform/opacity) : elles tournent sur le fil du compositeur, en
  temps réel. Une série de captures headless montre donc des images identiques
  et fait croire qu'une animation ne bouge pas. Pour vérifier une animation,
  figer son `currentTime` par script dans la page (`getAnimations()`, `pause()`)
  puis capturer — c'est ce que fait la page de test `_salle.html?t=…`.
- **Rien ne doit apparaître avant l'animation d'ouverture** : le rideau est monté
  par `effects.js` au DOMContentLoaded, bien trop tard. Un script en tête de
  `index.html` pose `html.intro-pending`, dont le `::before` couvre l'écran dès
  la première image ; `decouvre()` le retire quand le vrai rideau prend le
  relais, avec un filet de sécurité à 5 s. Ne jamais retirer ce script.
- **Caméra AR** : `getUserMedia` exige un contexte sécurisé (https) et l'en-tête
  `Permissions-Policy` doit contenir `camera=(self)` (`server.js`). Les
  navigateurs intégrés d'Instagram et Facebook la bloquent sans rien demander —
  d'où la panne la plus fréquente signalée par les visiteurs. Ne jamais avaler
  l'erreur dans un `catch` muet : `causeCamera()` la traduit en message clair.

---

## 7. Méthode de travail attendue

- Vérifier visuellement dans le navigateur avant de déployer (serveur local
  `PORT=5000 ADMIN_PASSWORD=t APP_SECRET=t node server.js`).
- Mesurer plutôt que supposer (dimensions, luminosité des bords, nombre de
  pages PDF, en-têtes HTTP).
- Déployer, puis **confirmer en production** avant d'annoncer que c'est fait.
- Écrire en français, dans un langage clair et non technique.
- Commits en français, signés `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## 8. Reste à faire / idées non réalisées

- Compléter les **mentions légales** dans les CGV (numéro Tahiti, adresse) —
  marquées entre crochets dans `cgv.html`.
- Vérifier avec Pascal les **dimensions et prix** que j'ai estimés.
- Soumettre le **sitemap** dans Google Search Console (propriété déjà vérifiée).
- Idées en réserve : paiement carte (Stripe), alerte « nouvelle œuvre » par
  SMS, version en reo Tahiti, avis clients vérifiés, page presse.
