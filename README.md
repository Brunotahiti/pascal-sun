# Galerie Pascal Sun — pascalsun-art

Galerie d'art en ligne de l'artiste peintre **Pascal Sun** (Tahiti, Polynésie française).
Site 100 % statique (HTML / CSS / JavaScript), sans dépendance ni build — hébergeable
partout (Vercel, Hostinger, Netlify, n'importe quel serveur web).

## Pages

| Fichier | Rôle |
|---|---|
| `index.html` | Accueil — hero, sélection d'œuvres, citation, promesse |
| `galerie.html` | Catalogue complet avec filtres par collection |
| `oeuvre.html?id=…` | Fiche œuvre — grand format, histoire, prix, acquisition |
| `artiste.html` | L'univers artistique de Pascal Sun |
| `panier.html` | Panier et demande d'acquisition |
| `contact.html` | Contact direct avec l'artiste |

Fonctionnalités : bilingue **FR / EN**, prix en **EUR / USD / XPF**, panier persistant
(localStorage), lightbox plein écran, badges « Nouveauté » / « Œuvre vendue »,
responsive mobile.

## Ajouter ou modifier une œuvre

Tout le catalogue vit dans **`js/data.js`** :

1. Déposer la photo de la toile dans `img/` (JPEG recommandé, ~2000 px de large).
2. Ajouter un objet dans le tableau `ARTWORKS` (id, titre, collection, prix en EUR,
   dimensions, descriptions FR/EN, chemin de l'image, `vendu: true/false`).
3. C'est tout — la galerie, les fiches et le panier se mettent à jour seuls.

> **Important** : les visuels actuels dans `img/*.svg` sont des **illustrations
> d'attente** créées dans l'esprit de Pascal (noir & blanc + une touche de couleur).
> Il faut les remplacer par les photographies réelles des toiles avant publication.

## À personnaliser avant mise en ligne

- `ARTIST_EMAIL` dans `js/data.js` — l'adresse réelle de Pascal (les demandes
  d'acquisition et le formulaire de contact partent par email).
- Les prix (`prixEUR`) et les taux de change dans `CURRENCIES`.
- Pour le paiement en ligne direct : créer des *Payment Links* Stripe (un par œuvre)
  et remplacer le `mailto:` du panier par ces liens.

## Lancer en local

```bash
npx serve .
```

puis ouvrir http://localhost:3000
