#!/bin/bash
# =============================================================================
# Optimisation des photos des toiles — Galerie Pascal Sun
#
# Usage :
#   1. Déposer les photos originales (JPEG/PNG haute résolution) dans
#      img-originales/  (nom du fichier = id de l'œuvre, ex. la-vague.jpg)
#   2. Lancer :  bash tools/optimiser-images.sh
#   3. Le script génère dans img/ trois variantes WebP par photo :
#        <id>-480.webp   (vignettes mobiles)
#        <id>-960.webp   (grilles desktop)
#        <id>-1600.webp  (fiche œuvre, lightbox)
#   4. Dans js/data.js, ajouter à l'œuvre :
#        images: { small: "img/<id>-480.webp",
#                  medium: "img/<id>-960.webp",
#                  large: "img/<id>-1600.webp" }
#      → le site sert alors automatiquement la bonne taille (srcset).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

SRC_DIR="img-originales"
OUT_DIR="img"

if [ ! -d "$SRC_DIR" ]; then
  echo "Créez le dossier $SRC_DIR/ et déposez-y les photos des toiles."
  exit 1
fi

command -v npx >/dev/null || { echo "Node.js/npx requis (https://nodejs.org)"; exit 1; }

shopt -s nullglob nocaseglob
for f in "$SRC_DIR"/*.{jpg,jpeg,png}; do
  name="$(basename "${f%.*}")"
  for size in 480 960 1600; do
    out="$OUT_DIR/${name}-${size}.webp"
    echo "→ $out"
    npx --yes sharp-cli --input "$f" --output "$out" --format webp --quality 82 resize "$size" >/dev/null
  done
done

echo "✓ Terminé. Pensez à renseigner le champ « images » dans js/data.js."
