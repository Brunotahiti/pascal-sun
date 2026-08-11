/* =========================================================================
   Espace admin — Pascal Sun
   Édite le catalogue (œuvres + textes du site), remplace les photos
   (redimensionnées dans le navigateur avant envoi : affichage rapide
   garanti), et sauvegarde le tout via l'API du serveur.
   ========================================================================= */

(function () {
  "use strict";

  /* Libellés modifiables dans l'onglet « Textes & boutons ». */
  const EDITABLE_TEXTS = [
    { key: "hero_title",  label: "Titre d'accueil", hint: "La grande phrase du haut (balise <em> = mot en corail)" },
    { key: "hero_lede",   label: "Sous-titre d'accueil", hint: "Le paragraphe sous le titre" },
    { key: "hero_cta",    label: "Bouton principal", hint: "« Découvrir la galerie »" },
    { key: "hero_cta2",   label: "Bouton secondaire", hint: "« Rencontrer l'artiste »" },
    { key: "see_all",     label: "Lien « toute la galerie »" },
    { key: "add_to_cart", label: "Bouton d'achat", hint: "Sur chaque fiche œuvre" },
    { key: "order_btn",   label: "Bouton du panier", hint: "Envoi de la demande" },
    { key: "contact_btn", label: "Bouton de contact" },
    { key: "quote",       label: "Citation", hint: "La phrase signature (accueil + page artiste)" },
    { key: "gallery_lede", label: "Introduction de la galerie" },
    { key: "contact_lede", label: "Introduction du contact" }
  ];

  let catalogue = { artworks: [], uiTexts: { fr: {}, en: {} } };
  let dirty = false;

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ------------------------------------------------------------ toast -- */
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function markDirty() {
    dirty = true;
    $("#save-btn").disabled = false;
    const st = $("#save-status");
    st.textContent = "Modifications non enregistrées";
    st.classList.add("dirty");
  }
  function markClean() {
    dirty = false;
    $("#save-btn").disabled = true;
    const st = $("#save-status");
    st.textContent = "Tout est enregistré ✓";
    st.classList.remove("dirty");
  }

  /* ---------------------------------------------------------- session -- */

  async function init() {
    const s = await fetch("/api/session").then((r) => r.json()).catch(() => ({ authed: false }));
    if (s.authed) { await enter(); } else { showLogin(); }
  }

  function showLogin() {
    $("#login-screen").style.display = "";
    $("#admin-app").hidden = true;
    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: $("#login-password").value })
      });
      if (r.ok) { await enter(); }
      else { $("#login-error").textContent = "Mot de passe incorrect."; }
    });
  }

  async function enter() {
    $("#login-screen").style.display = "none";
    $("#admin-app").hidden = false;
    await loadCatalogue();
    renderArtworks();
    renderEvents();
    renderPosts();
    renderAvis();
    renderInsta();
    renderAtelier();
    renderShipping();
    renderEclairage();
    renderTexts();
    wireChrome();
    markClean();
  }

  async function loadCatalogue() {
    const data = await fetch("/api/catalogue").then((r) => r.json()).catch(() => null);
    catalogue = {
      artworks: (data && data.artworks) || JSON.parse(JSON.stringify(ARTWORKS)),
      events: (data && data.events) || JSON.parse(JSON.stringify(typeof EVENTS !== "undefined" ? EVENTS : [])),
      posts: (data && data.posts) || [],
      avis: (data && data.avis) || [],
      instagram: (data && data.instagram) || { username: "", posts: [] },
      shipping: (data && data.shipping) || JSON.parse(JSON.stringify(typeof SHIPPING !== "undefined" ? SHIPPING : { zones: [], freeAbove: 0 })),
      eclairage: (data && data.eclairage && Array.isArray(data.eclairage.sources))
        ? data.eclairage
        : JSON.parse(JSON.stringify(ECLAIRAGE_DEFAUT)),
      atelier: (data && data.atelier) || JSON.parse(JSON.stringify(typeof ATELIER !== "undefined" ? ATELIER : [])),
      uiTexts: (data && data.uiTexts) || { fr: {}, en: {} }
    };
    catalogue.uiTexts.fr = catalogue.uiTexts.fr || {};
    catalogue.uiTexts.en = catalogue.uiTexts.en || {};
    /* L'aperçu de l'éclairage réutilise les fonctions du site : on branche
       la configuration en cours d'édition sur la variable globale. */
    ECLAIRAGE = catalogue.eclairage;
    if (typeof normalizeArtworks === "function") normalizeArtworks(catalogue.artworks);
  }

  /* ----------------------------------------------------------- œuvres -- */

  function artworkCard(a, i) {
    const cols = Object.entries(COLLECTIONS)
      .map(([k, v]) => `<option value="${k}" ${a.collection === k ? "selected" : ""}>${v.fr}</option>`)
      .join("");
    return `
    <article class="aw-card" data-i="${i}">
      <div class="aw-photo">
        <img src="${esc(a.image)}" alt="">
        <div class="photo-btns">
          <button type="button" class="replace-btn" data-act="photo">Remplacer</button>
          <button type="button" class="replace-btn crop" data-act="recrop">✂ Recadrer</button>
        </div>
        <input type="file" accept="image/*" hidden>
      </div>
      <div class="aw-fields">
        <div class="f span2"><label>Titre</label><input data-k="titre" value="${esc(a.titre)}"></div>
        <div class="f"><label>Collection</label><select data-k="collection">${cols}</select></div>
        <div class="f"><label>Année</label><input data-k="annee" type="number" value="${esc(a.annee)}"></div>
        <div class="f"><label>Dimensions</label><input data-k="dimensions" value="${esc(a.dimensions)}" placeholder="80 × 60 cm"></div>
        <div class="f"><label>Prix (EUR)</label><input data-k="prixEUR" type="number" value="${esc(a.prixEUR)}"></div>
        <div class="f span2"><label>Technique (FR)</label><input data-k="technique_fr" value="${esc(a.technique_fr)}"></div>
        <div class="f span4"><label>Description (FR)</label><textarea data-k="desc_fr">${esc(a.desc_fr)}</textarea></div>
        <div class="f span4"><label>Description (EN)</label><textarea data-k="desc_en">${esc(a.desc_en)}</textarea></div>
        <div class="aw-flags">
          <label class="flag">Statut
            <select data-k="statut">
              <option value="disponible" ${(a.statut || "disponible") === "disponible" ? "selected" : ""}>Disponible</option>
              <option value="reserve" ${a.statut === "reserve" ? "selected" : ""}>Réservée</option>
              <option value="vendu" ${a.statut === "vendu" || a.vendu ? "selected" : ""}>Vendue</option>
            </select>
          </label>
          <label class="flag"><input type="checkbox" data-k="nouveaute" ${a.nouveaute ? "checked" : ""}> Nouveauté</label>
          <label class="flag">Éclairage
            <select data-k="eclairage">
              <option value="">Automatique</option>
              ${(catalogue.eclairage.sources || []).map((s) =>
                `<option value="${esc(s.key)}" ${a.eclairage === s.key ? "selected" : ""}>${esc(s.nom || s.key)}</option>`).join("")}
            </select>
          </label>
          <button type="button" class="aw-delete" data-act="delete">Supprimer cette œuvre</button>
        </div>
        <div class="produits-rows">
          ${(a.produits || []).map((p, pi) => `
          <div class="prod-row" data-pi="${pi}">
            <label class="flag"><input type="checkbox" data-pk="actif" ${p.actif !== false ? "checked" : ""}>
              ${({ original: "Original", tirage: "Tirage limité", affiche: "Affiche" })[p.key] || p.key}</label>
            <span class="prod-field">Prix € <input type="number" data-pk="prixEUR" value="${p.prixEUR}"></span>
            ${p.key === "original" ? "" : `<span class="prod-field">Stock <input type="number" data-pk="stock" value="${p.stock ?? ""}"></span>`}
            ${p.key === "tirage" ? `<span class="prod-field">Édition de <input type="number" data-pk="edition" value="${p.edition ?? ""}"></span>` : ""}
          </div>`).join("")}
        </div>
      </div>
    </article>`;
  }

  function renderArtworks() {
    $("#artwork-list").innerHTML = catalogue.artworks.map(artworkCard).join("");
  }

  function slugify(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "oeuvre";
  }

  /* ------------------------------------------------------- recadrage -- */
  /* Éditeur de recadrage : cadre déplaçable et redimensionnable par les
     coins, export WebP max 1600 px. Résout avec un Blob, ou null si annulé. */

  function openCropper(src) {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "crop-modal";
      modal.innerHTML = `
        <div class="crop-box">
          <h3>Recadrer la photo</h3>
          <p class="crop-hint">Déplacez le cadre, tirez les coins. Ne gardez que la toile.</p>
          <div class="crop-stage"><img alt=""><div class="crop-rect">
            <span class="ch nw"></span><span class="ch ne"></span><span class="ch sw"></span><span class="ch se"></span>
          </div></div>
          <div class="crop-actions">
            <button class="ghost-btn" data-c="cancel">Annuler</button>
            <button class="ghost-btn" data-c="all">Garder tout</button>
            <button class="solid-btn" data-c="ok">✓ Valider le recadrage</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      const img = modal.querySelector("img");
      const rect = modal.querySelector(".crop-rect");
      const stage = modal.querySelector(".crop-stage");
      let r = { x: 0, y: 0, w: 0, h: 0 };

      function applyRect() {
        rect.style.left = r.x + "px"; rect.style.top = r.y + "px";
        rect.style.width = r.w + "px"; rect.style.height = r.h + "px";
      }

      img.onload = () => {
        const dw = img.clientWidth, dh = img.clientHeight;
        r = { x: dw * 0.05, y: dh * 0.05, w: dw * 0.9, h: dh * 0.9 };
        applyRect();
      };
      img.crossOrigin = "anonymous";
      img.src = src;

      let drag = null;
      rect.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        rect.setPointerCapture(e.pointerId);
        const handle = e.target.classList.contains("ch") ? e.target.className.split(" ")[1] : "move";
        drag = { handle, sx: e.clientX, sy: e.clientY, r0: { ...r } };
      });
      rect.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        const dw = img.clientWidth, dh = img.clientHeight, m = 24;
        let { x, y, w, h } = drag.r0;
        if (drag.handle === "move") { x += dx; y += dy; }
        if (drag.handle === "nw") { x += dx; y += dy; w -= dx; h -= dy; }
        if (drag.handle === "ne") { y += dy; w += dx; h -= dy; }
        if (drag.handle === "sw") { x += dx; w -= dx; h += dy; }
        if (drag.handle === "se") { w += dx; h += dy; }
        w = Math.max(m, w); h = Math.max(m, h);
        x = Math.max(0, Math.min(x, dw - w)); y = Math.max(0, Math.min(y, dh - h));
        w = Math.min(w, dw - x); h = Math.min(h, dh - y);
        r = { x, y, w, h };
        applyRect();
      });
      rect.addEventListener("pointerup", () => { drag = null; });

      function finish(blob) { modal.remove(); resolve(blob); }

      function exportCrop(full) {
        const sc = img.naturalWidth / img.clientWidth;
        const sx = full ? 0 : r.x * sc, sy = full ? 0 : r.y * sc;
        const sw = full ? img.naturalWidth : r.w * sc, sh = full ? img.naturalHeight : r.h * sc;
        const MAX = 1600;
        const out = Math.min(1, MAX / Math.max(sw, sh));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(sw * out); canvas.height = Math.round(sh * out);
        canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => finish(b), "image/webp", 0.86);
      }

      modal.querySelector('[data-c="cancel"]').addEventListener("click", () => finish(null));
      modal.querySelector('[data-c="all"]').addEventListener("click", () => exportCrop(true));
      modal.querySelector('[data-c="ok"]').addEventListener("click", () => exportCrop(false));
    });
  }

  async function uploadBlob(card, blob, name) {
    const fd = new FormData();
    fd.append("file", blob, name);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    if (!r.ok) throw new Error("upload");
    return (await r.json()).path;
  }

  /* Réduction de la photo dans le navigateur : max 1600 px, WebP q.85. */
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("encode")), "image/webp", 0.85);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function uploadPhoto(card, file) {
    const a = catalogue.artworks[+card.dataset.i];
    // Ouvre l'éditeur de recadrage sur la photo choisie
    const url = URL.createObjectURL(file);
    const blob = await openCropper(url);
    URL.revokeObjectURL(url);
    if (!blob) return;
    await applyNewPhoto(card, a, blob);
  }

  async function recropPhoto(card) {
    const a = catalogue.artworks[+card.dataset.i];
    const blob = await openCropper(a.image);
    if (!blob) return;
    await applyNewPhoto(card, a, blob);
  }

  async function applyNewPhoto(card, a, blob) {
    const photoBox = $(".aw-photo", card);
    const overlay = document.createElement("div");
    overlay.className = "uploading";
    overlay.textContent = "Envoi…";
    photoBox.appendChild(overlay);
    try {
      const path = await uploadBlob(card, blob, `${slugify(a.titre)}.webp`);
      a.image = path;
      a.images = null; // la nouvelle photo remplace les variantes responsives
      $("img", photoBox).src = path;
      markDirty();
      toast("Photo mise à jour — pensez à enregistrer.");
    } catch {
      toast("Échec de l'envoi de la photo.");
    } finally {
      overlay.remove();
    }
  }

  /* ------------------------------------------------------ vernissages -- */

  function eventCard(ev, i) {
    return `
    <article class="aw-card" data-ei="${i}" style="grid-template-columns: 1fr;">
      <div class="aw-fields">
        <div class="f span2"><label>Titre de l'événement</label><input data-k="titre" value="${esc(ev.titre)}"></div>
        <div class="f"><label>Date</label><input data-k="date" type="date" value="${esc(ev.date)}"></div>
        <div class="f"><label>Heure</label><input data-k="heure" value="${esc(ev.heure)}" placeholder="18h00"></div>
        <div class="f span2"><label>Lieu</label><input data-k="lieu" value="${esc(ev.lieu)}" placeholder="Galerie, salle…"></div>
        <div class="f span2"><label>Ville / Île</label><input data-k="ville" value="${esc(ev.ville)}" placeholder="Papeete, Tahiti"></div>
        <div class="f span4"><label>Description (FR)</label><textarea data-k="desc_fr">${esc(ev.desc_fr)}</textarea></div>
        <div class="f span4"><label>Description (EN)</label><textarea data-k="desc_en">${esc(ev.desc_en)}</textarea></div>
        <div class="aw-flags">
          <button type="button" class="aw-delete" data-act="delete-event">Supprimer cet événement</button>
        </div>
      </div>
    </article>`;
  }

  function renderEvents() {
    $("#event-list").innerHTML = catalogue.events.map(eventCard).join("");
  }

  /* ---------------------------------------------------- journal & avis -- */

  function postCard(p, i) {
    return `
    <article class="aw-card" data-pi2="${i}" style="grid-template-columns: 180px 1fr;">
      <div class="aw-photo">
        <img src="${esc(p.image || "img/oeuvres/le-retour-de-peche-480.webp")}" alt="" style="aspect-ratio: 4/3;">
        <button type="button" class="replace-btn" data-act="post-photo">Photo</button>
        <input type="file" accept="image/*" hidden>
      </div>
      <div class="aw-fields" style="grid-template-columns: 1fr 1fr;">
        <div class="f"><label>Titre</label><input data-pk2="titre" value="${esc(p.titre)}"></div>
        <div class="f"><label>Date</label><input data-pk2="date" type="date" value="${esc(p.date)}"></div>
        <div class="f span2"><label>Texte (FR)</label><textarea data-pk2="texte">${esc(p.texte)}</textarea></div>
        <div class="f span2"><label>Texte (EN — optionnel)</label><textarea data-pk2="texte_en">${esc(p.texte_en || "")}</textarea></div>
        <div class="aw-flags"><button type="button" class="aw-delete" data-act="post-del">Supprimer ce billet</button></div>
      </div>
    </article>`;
  }

  function avisCard(av, i) {
    return `
    <article class="aw-card" data-ai="${i}" style="grid-template-columns: 1fr;">
      <div class="aw-fields" style="grid-template-columns: 1fr 1fr;">
        <div class="f"><label>Nom</label><input data-ak="nom" value="${esc(av.nom)}"></div>
        <div class="f"><label>Lieu (ville, pays)</label><input data-ak="lieu" value="${esc(av.lieu || "")}"></div>
        <div class="f span2"><label>Avis (FR)</label><textarea data-ak="texte">${esc(av.texte)}</textarea></div>
        <div class="f span2"><label>Avis (EN — optionnel)</label><textarea data-ak="texte_en">${esc(av.texte_en || "")}</textarea></div>
        <div class="aw-flags"><button type="button" class="aw-delete" data-act="avis-del">Supprimer cet avis</button></div>
      </div>
    </article>`;
  }

  function renderAtelier() {
    $("#atelier-list").innerHTML = catalogue.atelier.map((src, i) => `
      <div class="atelier-cell" data-ati="${i}">
        <img src="${esc(src)}" alt="">
        <button type="button" class="aw-delete" data-act="atelier-del">retirer</button>
      </div>`).join("");
  }

  function renderPosts() { $("#post-list").innerHTML = catalogue.posts.map(postCard).join(""); }
  function renderAvis() { $("#avis-list").innerHTML = catalogue.avis.map(avisCard).join(""); }

  function renderInsta() {
    $("#insta-user").value = catalogue.instagram.username || "";
    $("#insta-list").innerHTML = (catalogue.instagram.posts || []).map((p, i) => `
      <article class="aw-card" data-ii="${i}" style="grid-template-columns: 150px 1fr;">
        <div class="aw-photo">
          <img src="${esc(p.image || "img/oeuvres/le-tressage-480.webp")}" alt="" style="aspect-ratio:1;">
          <div class="photo-btns"><button type="button" class="replace-btn" data-act="insta-photo">Photo</button></div>
          <input type="file" accept="image/*" hidden>
        </div>
        <div class="aw-fields" style="grid-template-columns: 1fr;">
          <div class="f"><label>Lien du post Instagram</label><input data-ik="url" value="${esc(p.url || "")}" placeholder="https://instagram.com/p/…"></div>
          <div class="f"><label>Légende courte</label><input data-ik="legende" value="${esc(p.legende || "")}"></div>
          <div class="aw-flags"><button type="button" class="aw-delete" data-act="insta-del">Retirer</button></div>
        </div>
      </article>`).join("");
  }

  /* --------------------------------------------------------- livraison -- */

  function renderShipping() {
    const zones = catalogue.shipping.zones || [];
    $("#ship-table").innerHTML = `
      <div class="ship-row ship-head">
        <span>Zone</span><span>Original</span><span>Grand format</span><span>Tirage</span><span>Affiche</span>
      </div>
      ${zones.map((z, i) => `
        <div class="ship-row" data-zi="${i}">
          <span class="ship-name">${esc(z.fr)}</span>
          ${["original", "grand", "tirage", "affiche"].map((k) =>
            `<span><input type="number" min="0" step="5" data-sk="${k}" value="${z[k] ?? 0}"> €</span>`).join("")}
        </div>`).join("")}`;
    $("#ship-free").value = catalogue.shipping.freeAbove || 0;
  }

  /* --------------------------------------------------------- éclairage -- */
  /* Trois réglages par projecteur : où il est sur le mur, à quelle hauteur,
     et de quel côté il vise. Le reste (faisceau, halo, ombre du cadre) en
     découle — voir varsLumiere() dans data.js. */

  const ECLR_CHAMPS = [
    { k: "x",     label: "Position horizontale", min: -30,  max: 130, step: 1, unite: " %" },
    { k: "y",     label: "Hauteur",              min: -30,  max: 130, step: 1, unite: " %" },
    { k: "angle", label: "Orientation",          min: -180, max: 180, step: 2, unite: "°"  }
  ];

  function renderEclairage() {
    const e = catalogue.eclairage;
    $("#eclr-actif").checked = e.actif !== false;
    $("#eclr-intensite").value = e.intensite ?? 100;
    $("#eclr-portee").value = e.portee ?? 100;

    /* Chaque projecteur : son aperçu à gauche, ses trois curseurs juste à
       côté. On règle en regardant, sans faire l'aller-retour haut/bas. */
    const art = catalogue.artworks || [];
    $("#eclr-list").innerHTML = (e.sources || []).map((s, i) => {
      const img = (art[i % (art.length || 1)] || {}).image || "";
      return `
      <article class="eclr-row" data-si="${i}">
        <figure class="eclr-apercu">
          <div class="pv-card" style="${styleLumiere(s)}">
            <span class="pv-spot" aria-hidden="true"><span class="pv-beam"></span></span>
            <div class="pv-frame"><img src="${esc(img)}" alt=""><span class="pv-wash" aria-hidden="true"></span></div>
          </div>
        </figure>
        <div class="eclr-fields">
          <input class="eclr-nom" data-ek="nom" value="${esc(s.nom || s.key)}" aria-label="Nom du projecteur">
          ${ECLR_CHAMPS.map((c) => `
            <label class="eclr-range">${c.label}
              <input type="range" data-ek="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${Number(s[c.k]) || 0}">
              <output>${Number(s[c.k]) || 0}${c.unite}</output>
            </label>`).join("")}
        </div>
        <button type="button" class="eclr-undo" data-act="eclr-row-reset" title="Position d'origine de ce projecteur">↺</button>
      </article>`;
    }).join("");

    majEclairageGlobal();
  }

  /* Intensité, portée, projecteurs visibles : appliqués à tous les aperçus. */
  function majEclairageGlobal() {
    const e = catalogue.eclairage;
    const list = $("#eclr-list");
    list.classList.toggle("pv-hidden", e.actif === false);
    appliqueEclairageGlobal(list);
    $("#eclr-intensite").nextElementSibling.textContent = (e.intensite ?? 100) + " %";
    $("#eclr-portee").nextElementSibling.textContent = (e.portee ?? 100) + " %";
  }

  /* Un seul aperçu se rafraîchit pendant qu'on tire le curseur. */
  function majApercuSource(i) {
    const card = $(`#eclr-list [data-si="${i}"] .pv-card`);
    if (card) card.setAttribute("style", styleLumiere(catalogue.eclairage.sources[i]));
  }

  function wireEclairage() {
    $("#eclr-list").addEventListener("input", (ev) => {
      const row = ev.target.closest("[data-si]");
      const k = ev.target.dataset.ek;
      if (!row || !k) return;
      const i = +row.dataset.si;
      const s = catalogue.eclairage.sources[i];

      if (k === "nom") {
        s.nom = ev.target.value;
      } else {
        s[k] = Number(ev.target.value) || 0;
        const champ = ECLR_CHAMPS.find((c) => c.k === k);
        const out = ev.target.parentElement.querySelector("output");
        if (out) out.textContent = s[k] + champ.unite;
        majApercuSource(i);
      }
      markDirty();
    });

    /* Nom modifié : les listes déroulantes des fiches d'œuvres suivent. */
    $("#eclr-list").addEventListener("change", (ev) => {
      if (ev.target.dataset.ek === "nom") renderArtworks();
    });

    $("#eclr-list").addEventListener("click", (ev) => {
      if (ev.target.dataset.act !== "eclr-row-reset") return;
      const i = +ev.target.closest("[data-si]").dataset.si;
      const origine = (ECLAIRAGE_DEFAUT.sources || []).find(
        (s) => s.key === catalogue.eclairage.sources[i].key);
      if (!origine) return;
      catalogue.eclairage.sources[i] = JSON.parse(JSON.stringify(origine));
      renderEclairage();
      markDirty();
    });

    $("#eclr-actif").addEventListener("change", (ev) => {
      catalogue.eclairage.actif = ev.target.checked;
      majEclairageGlobal();
      markDirty();
    });

    [["#eclr-intensite", "intensite"], ["#eclr-portee", "portee"]].forEach(([sel, key]) => {
      $(sel).addEventListener("input", (ev) => {
        catalogue.eclairage[key] = Number(ev.target.value) || 100;
        majEclairageGlobal();
        markDirty();
      });
    });

    $("#eclr-reset").addEventListener("click", () => {
      if (!confirm("Remettre tous les projecteurs à leur position d'origine ?")) return;
      catalogue.eclairage = JSON.parse(JSON.stringify(ECLAIRAGE_DEFAUT));
      ECLAIRAGE = catalogue.eclairage;
      renderEclairage();
      renderArtworks();
      markDirty();
    });
  }

  /* ------------------------------------------------ sauvegardes/rapport -- */

  async function renderBackups() {
    const el = $("#backup-list");
    const list = await fetch("/api/backups").then((r) => r.json()).catch(() => []);
    el.innerHTML = list.length
      ? `<div class="contacts-table">${list.map((b) => `
          <div class="ct-row" style="grid-template-columns: 1fr auto;">
            <span>${esc(b.file.replace("pascal-sun-", "").replace(".json.gz", ""))}</span>
            <span>${(b.size / 1024).toFixed(0)} Ko</span>
          </div>`).join("")}</div>`
      : `<p class="metric-empty">La première sauvegarde automatique sera créée dans quelques minutes.</p>`;
  }

  async function showReport() {
    const box = $("#report-box");
    box.hidden = false;
    box.textContent = "Calcul du rapport…";
    try {
      const d = await fetch("/api/rapport").then((r) => r.json());
      box.textContent = d.corps || JSON.stringify(d, null, 2);
    } catch { box.textContent = "Rapport indisponible."; }
  }

  /* ----------------------------------------------------------- textes -- */

  function renderTexts() {
    $("#texts-grid").innerHTML = EDITABLE_TEXTS.map(({ key, label, hint }) => `
      <div class="text-row" data-key="${key}">
        <div class="k">${label}${hint ? `<small>${hint}</small>` : ""}</div>
        <input data-lang="fr" placeholder="FR — ${esc(I18N.fr[key] || "")}" value="${esc(catalogue.uiTexts.fr[key] || "")}">
        <input data-lang="en" placeholder="EN — ${esc(I18N.en[key] || "")}" value="${esc(catalogue.uiTexts.en[key] || "")}">
      </div>`).join("");
  }

  /* -------------------------------------------------------- commandes -- */

  const STATUTS_CMD = { nouvelle: "🆕 Nouvelle", payee: "💰 Payée", expediee: "📦 Expédiée", terminee: "✅ Terminée", annulee: "✖ Annulée" };
  const PRODUIT_NOMS = { original: "Original", tirage: "Tirage limité", affiche: "Affiche" };

  async function renderOrders() {
    const el = $("#orders-list");
    el.innerHTML = `<p class="stats-note">Chargement…</p>`;
    const orders = await fetch("/api/orders").then((r) => r.json()).catch(() => []);
    if (!orders.length) { el.innerHTML = `<p class="metric-empty">Aucune commande pour le moment — elles apparaîtront ici dès la première demande.</p>`; return; }
    el.innerHTML = orders.map((o) => `
      <article class="aw-card order-card" data-oid="${esc(o.id)}" style="grid-template-columns: 1fr;">
        <div>
          <div class="order-head">
            <strong>${esc(o.id)}</strong>
            <span>${new Date(o.date).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span>
            <select class="order-statut">
              ${Object.entries(STATUTS_CMD).map(([k, v]) => `<option value="${k}" ${o.statut === k ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </div>
          <div class="order-lines">
            ${o.lines.map((l, li) => `<div>• ${esc(l.titre)} — ${PRODUIT_NOMS[l.key] || l.key}${l.qty > 1 ? ` × ${l.qty}` : ""} — ${l.prixEUR * l.qty} €
              ${l.key !== "affiche" ? ` <a class="cert-link" href="/certificat.html?c=${esc(o.id)}-${li}" target="_blank">📜 certificat</a>` : ""}</div>`).join("")}
            ${o.livraisonEUR !== undefined ? `<div>• Livraison ${o.zone ? "(" + esc(o.zone) + ")" : ""} — ${o.livraisonEUR ? o.livraisonEUR + " €" : "offerte"}</div>` : ""}
          </div>
          <div class="order-client">
            <strong>${esc(o.client.name)}</strong> · <a href="mailto:${esc(o.client.email)}">${esc(o.client.email)}</a>
            ${o.client.country ? " · " + esc(o.client.country) : ""}
            · ${o.mode === "retrait" ? "Retrait à Tahiti" : "Livraison"}
            · ${({ card: "Carte", virement: "Virement", paypal: "PayPal" })[o.payment] || o.payment}
            — <strong>${o.grandTotalEUR || o.totalEUR} €</strong>
            ${o.client.message ? `<div class="order-msg">« ${esc(o.client.message)} »</div>` : ""}
          </div>
        </div>
      </article>`).join("");

    el.querySelectorAll(".order-statut").forEach((sel) =>
      sel.addEventListener("change", async () => {
        await fetch("/api/orders/statut", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sel.closest(".order-card").dataset.oid, statut: sel.value })
        });
        toast("Statut de commande mis à jour ✓");
      }));

    // Demandes de portrait sur commande
    const commissions = await fetch("/api/commissions").then((r) => r.json()).catch(() => []);
    if (commissions.length) {
      el.insertAdjacentHTML("beforeend", `
        <h3 style="font-family: var(--serif); font-size: 26px; font-weight: 500; margin: 30px 0 6px;">🎨 Demandes de portrait</h3>
        ${commissions.map((cm) => `
        <article class="aw-card" style="grid-template-columns: 1fr;">
          <div>
            <div class="order-head"><strong>${esc(cm.id)}</strong>
              <span>${new Date(cm.date).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span></div>
            <div class="order-client">
              <strong>${esc(cm.name)}</strong> · <a href="mailto:${esc(cm.email)}">${esc(cm.email)}</a>
              ${cm.format ? " · Format : " + esc(cm.format) : ""}${cm.budget ? " · Budget : " + esc(cm.budget) : ""}
              <div class="order-msg">« ${esc(cm.description)} »</div>
              ${cm.photo ? `<a href="${esc(cm.photo)}" target="_blank" style="color:var(--accent);">Voir la photo de référence ↗</a>` : ""}
            </div>
          </div>
        </article>`).join("")}`);
    }
  }

  /* ---------------------------------------------------------- clients -- */

  let contactsCache = [];

  async function renderClients() {
    const el = $("#contacts-list");
    el.innerHTML = `<p class="stats-note">Chargement…</p>`;
    contactsCache = await fetch("/api/contacts").then((r) => r.json()).catch(() => []);
    if (!contactsCache.length) { el.innerHTML = `<p class="metric-empty">Aucun contact pour le moment. Les acheteurs et abonnés à la newsletter apparaîtront ici automatiquement.</p>`; return; }
    const badge = { commande: "🛒 client", newsletter: "💌 newsletter", manuel: "✍️ ajouté" };
    el.innerHTML = `
      <div class="contacts-table">
        <div class="ct-row ct-head">
          <span><input type="checkbox" id="ct-all"></span>
          <span>Nom</span><span>Email</span><span>Pays</span><span>Source</span><span>Cmd.</span><span></span>
        </div>
        ${contactsCache.map((c, i) => `
        <div class="ct-row" data-ci="${i}">
          <span><input type="checkbox" class="ct-check" data-email="${esc(c.email)}"></span>
          <span>${esc(c.name || "—")}</span>
          <span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></span>
          <span>${esc(c.country || "—")}</span>
          <span class="ct-src">${(c.sources || []).map((s) => badge[s] || s).join(" ")}</span>
          <span>${c.orders || 0}${c.totalEUR ? ` (${c.totalEUR} €)` : ""}</span>
          <span><button class="aw-delete ct-del" data-email="${esc(c.email)}">retirer</button></span>
        </div>`).join("")}
      </div>`;

    $("#ct-all").addEventListener("change", (e) =>
      el.querySelectorAll(".ct-check").forEach((c) => { c.checked = e.target.checked; }));
    el.querySelectorAll(".ct-del").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm(`Retirer ${b.dataset.email} des contacts ?`)) return;
        await fetch("/api/contacts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: b.dataset.email }) });
        renderClients();
      }));
  }

  function inviteSelection() {
    const emails = [...document.querySelectorAll(".ct-check:checked")].map((c) => c.dataset.email);
    if (!emails.length) { toast("Cochez d'abord des contacts à inviter."); return; }
    const today = new Date().toISOString().slice(0, 10);
    const next = (catalogue.events || []).filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const sujet = next ? `Invitation — ${next.titre}` : "Invitation — Galerie Pascal Sun";
    const corps = next
      ? `Ia ora na,\n\nJ'ai le plaisir de vous inviter à « ${next.titre} »\n${next.lieu} · ${next.ville}\nle ${new Date(next.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${next.heure ? " à " + next.heure : ""}.\n\n${next.desc_fr || ""}\n\nAu plaisir de vous y retrouver,\nPascal Sun\nhttps://pascal-sun.com`
      : `Ia ora na,\n\nDécouvrez les nouvelles œuvres de la galerie :\nhttps://pascal-sun.com\n\nPascal Sun`;
    location.href = `mailto:?bcc=${encodeURIComponent(emails.join(","))}&subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
  }

  /* ----------------------------------------------------- boîte à idées -- */

  async function renderIdees() {
    const el = $("#idees-list");
    el.innerHTML = `<p class="stats-note">Chargement…</p>`;
    const idees = await fetch("/api/idees").then((r) => r.json()).catch(() => []);
    if (!idees.length) { el.innerHTML = `<p class="metric-empty">La boîte est vide pour l'instant — les idées des visiteurs apparaîtront ici.</p>`; return; }
    el.innerHTML = idees.map((i) => `
      <article class="aw-card idee-card ${i.statut === "nouvelle" ? "is-new" : ""}" data-iid="${esc(i.id)}" style="grid-template-columns: 1fr;">
        <div>
          <div class="order-head">
            ${i.statut === "nouvelle" ? '<span class="idee-new">Nouvelle</span>' : ""}
            <strong>${esc(i.name || "Visiteur anonyme")}</strong>
            ${i.email ? `· <a href="mailto:${esc(i.email)}" style="color:var(--accent)">${esc(i.email)}</a>` : ""}
            <span>${new Date(i.date).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          <div class="order-msg" style="margin-top:4px;">« ${esc(i.message)} »</div>
          <div style="display:flex; gap:14px; margin-top:12px;">
            ${i.statut === "nouvelle" ? `<button class="ghost-btn" data-iact="lue">✓ Marquer comme lue</button>` : ""}
            ${i.email ? `<a class="ghost-btn" href="mailto:${esc(i.email)}?subject=${encodeURIComponent("Votre idée pour la galerie — Pascal Sun")}">Répondre</a>` : ""}
            <button class="aw-delete" data-iact="supprimee">Supprimer</button>
          </div>
        </div>
      </article>`).join("");

    el.querySelectorAll("[data-iact]").forEach((b) =>
      b.addEventListener("click", async () => {
        await fetch("/api/idees/statut", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: b.closest(".idee-card").dataset.iid, statut: b.dataset.iact })
        });
        renderIdees();
      }));
  }

  function b64ToU8(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function enablePush() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;

    // iOS n'autorise le push que depuis l'app ajoutée à l'écran d'accueil.
    if (ios && !standalone) {
      showPushHelp(`Sur iPhone, les notifications ne fonctionnent que depuis l'application installée :
1. Touchez le bouton Partager <span style="font-size:16px">􀈂</span> en bas de Safari
2. Choisissez « Sur l'écran d'accueil »
3. Ouvrez l'application Pascal Sun depuis votre écran d'accueil
4. Revenez ici (onglet Boîte à idées) et touchez de nouveau « Activer les notifications ».`);
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      showPushHelp("Ce navigateur ne gère pas les notifications. Utilisez Chrome, Edge, Firefox, ou l'application installée sur iPhone.");
      return;
    }
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      showPushHelp("Les notifications nécessitent une connexion sécurisée (https).");
      return;
    }

    try {
      const { key } = await fetch("/api/push/key").then((r) => r.json());
      if (!key) { showPushHelp("Notifications non configurées côté serveur."); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm === "denied") {
        showPushHelp("Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages de votre navigateur (Réglages du site → Notifications), puis réessayez.");
        return;
      }
      if (perm !== "granted") return;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub)
      });
      const d = await r.json();
      $("#push-help") && ($("#push-help").hidden = true);
      toast(`Notifications activées sur cet appareil ✓ (${d.devices} appareil${d.devices > 1 ? "s" : ""})`);
    } catch (e) {
      showPushHelp("Impossible d'activer les notifications ici : " + (e && e.message ? e.message : "erreur inconnue") +
        ". Essayez depuis l'application installée, ou depuis un ordinateur (Chrome).");
    }
  }

  function showPushHelp(html) {
    let box = $("#push-help");
    if (!box) {
      box = document.createElement("div");
      box.id = "push-help";
      box.className = "push-help";
      $("#idees-list").before(box);
    }
    box.hidden = false;
    box.innerHTML = `<strong>🔔 Notifications</strong><p>${html.replace(/\n/g, "<br>")}</p>`;
  }

  /* ------------------------------------------------------ statistiques -- */

  let statsLoadedDays = null;

  function fmtNum(n) { return (Number(n) || 0).toLocaleString("fr-FR"); }

  function flagEmoji(code) {
    if (!code || code.length !== 2 || code === "XX") return "🌐";
    return [...code.toUpperCase()].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join("");
  }

  function countryName(code) {
    try { return new Intl.DisplayNames(["fr"], { type: "region" }).of(code.toUpperCase()) || code; }
    catch { return code; }
  }

  function metricList(el, rows, labelFn) {
    if (!rows || !rows.length) { el.innerHTML = `<p class="metric-empty">Pas encore de données sur cette période.</p>`; return; }
    const total = rows.reduce((s, r) => s + r.y, 0) || 1;
    const max = Math.max(...rows.map((r) => r.y)) || 1;
    el.innerHTML = rows.map((r) => {
      const pct = Math.round((r.y / total) * 100);
      return `
      <div class="metric-row">
        <div class="metric-top">
          <span class="lbl">${labelFn(r.x)}</span>
          <span class="val">${fmtNum(r.y)}<em>${pct}%</em></span>
        </div>
        <div class="gauge"><span style="width:${Math.max(3, (r.y / max) * 100)}%"></span></div>
      </div>`;
    }).join("");
  }

  const PAGE_NAMES = {
    "/": "Accueil",
    "/index.html": "Accueil",
    "/galerie.html": "Galerie",
    "/artiste.html": "L'artiste",
    "/contact.html": "Contact",
    "/panier.html": "Panier",
    "/expositions.html": "Vernissages",
    "/admin": "Espace admin"
  };

  function pageName(u) {
    const [path, query] = String(u).split("?");
    if (path === "/oeuvre.html") {
      const id = new URLSearchParams(query || "").get("id");
      return id ? `Œuvre — ${id.replace(/-/g, " ")}` : "Fiche œuvre";
    }
    return PAGE_NAMES[path] || u;
  }

  function drawChart(series, unit) {
    const box = $("#stats-chart");
    const pts = (series && series.sessions && series.sessions.length ? series.sessions : (series && series.pageviews) || []);
    if (!pts.length) { box.innerHTML = `<p class="chart-empty">Le graphique apparaîtra dès les premières visites.</p>`; return; }

    const W = 640, H = 170, PAD = 8, BOT = 24;
    const max = Math.max(1, ...pts.map((p) => p.y));
    const step = (W - PAD * 2) / Math.max(1, pts.length - 1);
    const X = (i) => PAD + i * step;
    const Y = (v) => PAD + (H - BOT - PAD) * (1 - v / max);

    const line = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
    const area = `${line} L${X(pts.length - 1).toFixed(1)},${H - BOT} L${X(0).toFixed(1)},${H - BOT} Z`;

    const labels = pts.map((p, i) => {
      if (pts.length > 10 && i % Math.ceil(pts.length / 8)) return "";
      const d = new Date(p.x);
      const txt = unit === "hour"
        ? `${String(d.getHours()).padStart(2, "0")}h`
        : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
      return `<text x="${X(i).toFixed(1)}" y="${H - 6}" font-size="10" fill="#8c8478" text-anchor="middle" font-family="Manrope,sans-serif">${txt}</text>`;
    }).join("");

    const dots = pts.map((p, i) =>
      `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3" fill="#d4593a"><title>${fmtNum(p.y)} visites</title></circle>`).join("");

    box.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#d4593a" stop-opacity=".28"/>
          <stop offset="1" stop-color="#d4593a" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="${area}" fill="url(#ag)"/>
        <path d="${line}" fill="none" stroke="#d4593a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}${labels}
      </svg>`;
  }

  async function loadStats(days) {
    statsLoadedDays = days;
    $("#stats-loading").hidden = false;
    $("#stats-error").hidden = true;
    $("#stats-board").hidden = true;

    let d;
    try {
      const r = await fetch(`/api/stats/overview?days=${days}`);
      if (!r.ok) throw new Error();
      d = await r.json();
    } catch {
      $("#stats-loading").hidden = true;
      $("#stats-error").hidden = false;
      return;
    }
    if (statsLoadedDays !== days) return; // une autre période a été demandée entre-temps

    const st = d.stats || {};
    const val = (o) => (o && typeof o === "object" ? o.value : o) || 0;
    const visits = val(st.visits);
    const totaltime = val(st.totaltime);
    const avg = visits ? Math.round(totaltime / visits) : 0;

    let activeN = 0;
    if (Array.isArray(d.active)) activeN = d.active.length ? (d.active[0].x ?? d.active[0].y ?? d.active.length) : 0;
    else if (d.active && typeof d.active === "object") activeN = d.active.x ?? d.active.visitors ?? 0;
    else activeN = Number(d.active) || 0;

    $("#k-active").textContent = fmtNum(activeN);
    $("#k-visitors").textContent = fmtNum(val(st.visitors));
    $("#k-visits").textContent = fmtNum(visits);
    $("#k-pageviews").textContent = fmtNum(val(st.pageviews));
    $("#k-time").textContent = avg >= 60 ? `${Math.floor(avg / 60)} min ${avg % 60} s` : `${avg} s`;

    drawChart(d.series, d.unit);
    metricList($("#m-countries"), d.countries, (c) => `<span class="flag">${flagEmoji(c)}</span> ${countryName(c)}`);
    metricList($("#m-pages"), d.pages, pageName);
    metricList($("#m-referrers"), d.referrers, (r) => r ? String(r).replace(/^www\./, "") : "Accès direct");
    metricList($("#m-devices"), d.devices, (x) => ({ desktop: "Ordinateur", laptop: "Ordinateur portable", mobile: "Mobile", tablet: "Tablette" }[x] || x));

    $("#stats-loading").hidden = true;
    $("#stats-board").hidden = false;
  }

  /* ---------------------------------------------------------- events -- */

  function wireChrome() {
    document.querySelectorAll(".admin-tabs .tab").forEach((t) =>
      t.addEventListener("click", () => {
        document.querySelectorAll(".admin-tabs .tab").forEach((x) => x.classList.toggle("active", x === t));
        document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === t.dataset.tab));
        if (t.dataset.tab === "stats" && statsLoadedDays === null) loadStats(7);
        if (t.dataset.tab === "commandes") renderOrders();
        if (t.dataset.tab === "clients") renderClients();
        if (t.dataset.tab === "idees") renderIdees();
        if (t.dataset.tab === "donnees") { renderBackups(); refreshMailNote(); }
      }));

    async function refreshMailNote() {
      const st = await fetch("/api/mail-status").then((r) => r.json()).catch(() => ({ enabled: false }));
      $("#mail-note").textContent = st.enabled
        ? "✅ Les emails automatiques sont actifs (confirmations, alertes, newsletter, rapport mensuel)."
        : "⚠️ Emails inactifs : saisissez le mot de passe de la boîte contact@pascal-sun.com pour tout activer.";
    }
    $("#mail-save").addEventListener("click", async () => {
      const pass = $("#mail-pass").value;
      if (!pass) { toast("Saisissez le mot de passe de la boîte email."); return; }
      $("#mail-save").disabled = true;
      try {
        const r = await fetch("/api/mail-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pass })
        });
        const d = await r.json();
        if (!r.ok) throw new Error();
        $("#mail-pass").value = "";
        toast(d.testSent ? "Emails activés — un message de test vient d'arriver dans la boîte ✓" : "Enregistré, mais l'envoi de test a échoué : vérifiez le mot de passe.");
        refreshMailNote();
      } catch { toast("Échec : vérifiez le mot de passe et réessayez."); }
      finally { $("#mail-save").disabled = false; }
    });

    $("#report-btn").addEventListener("click", showReport);
    $("#ship-free").addEventListener("input", (e) => {
      catalogue.shipping.freeAbove = Number(e.target.value) || 0;
      markDirty();
    });
    $("#ship-table").addEventListener("input", (e) => {
      const row = e.target.closest("[data-zi]");
      const k = e.target.dataset.sk;
      if (row && k) {
        catalogue.shipping.zones[+row.dataset.zi][k] = Number(e.target.value) || 0;
        markDirty();
      }
    });

    wireEclairage();

    $("#push-btn").addEventListener("click", enablePush);

    $("#invite-btn").addEventListener("click", inviteSelection);
    $("#add-contact").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = new FormData(e.target);
      const r = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: d.get("email"), name: d.get("name"), country: d.get("country") })
      });
      if (r.ok) { e.target.reset(); toast("Contact ajouté ✓"); renderClients(); }
      else toast("Email invalide.");
    });

    $("#period-chips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-days]");
      if (!b) return;
      document.querySelectorAll("#period-chips button").forEach((x) => x.classList.toggle("active", x === b));
      loadStats(+b.dataset.days);
    });

    $("#logout-btn").addEventListener("click", async () => {
      await fetch("/api/logout", { method: "POST" });
      location.reload();
    });

    $("#add-artwork").addEventListener("click", () => {
      catalogue.artworks.unshift({
        id: "nouvelle-oeuvre-" + Date.now().toString(36),
        titre: "Nouvelle œuvre",
        collection: "ocean",
        annee: new Date().getFullYear(),
        technique_fr: "Acrylique sur toile",
        technique_en: "Acrylic on canvas",
        dimensions: "80 × 60 cm",
        orientation: "landscape",
        prixEUR: 1000,
        vendu: false,
        nouveaute: true,
        image: "img/retour-du-pecheur.svg",
        desc_fr: "",
        desc_en: ""
      });
      renderArtworks();
      markDirty();
    });

    const list = $("#artwork-list");
    list.addEventListener("input", (e) => {
      const card = e.target.closest(".aw-card");
      if (!card) return;
      const a = catalogue.artworks[+card.dataset.i];

      const pk = e.target.dataset.pk;
      if (pk) {
        const row = e.target.closest(".prod-row");
        const p = (a.produits || [])[+row.dataset.pi];
        if (!p) return;
        if (e.target.type === "checkbox") p[pk] = e.target.checked;
        else p[pk] = e.target.value === "" ? null : Number(e.target.value);
        markDirty();
        return;
      }

      const k = e.target.dataset.k;
      if (!k) return;
      if (e.target.type === "checkbox") a[k] = e.target.checked;
      else if (e.target.type === "number") a[k] = Number(e.target.value) || 0;
      else a[k] = e.target.value;
      if (k === "titre") a.id = slugify(a.titre);
      if (k === "statut") a.vendu = e.target.value === "vendu";
      markDirty();
    });
    list.addEventListener("click", (e) => {
      const card = e.target.closest(".aw-card");
      if (!card) return;
      const act = e.target.dataset.act;
      if (act === "photo") $("input[type=file]", card).click();
      if (act === "recrop") recropPhoto(card);
      if (act === "delete" && confirm("Supprimer définitivement cette œuvre du site ?")) {
        catalogue.artworks.splice(+card.dataset.i, 1);
        renderArtworks();
        markDirty();
      }
    });
    list.addEventListener("change", (e) => {
      if (e.target.type === "file" && e.target.files[0]) {
        uploadPhoto(e.target.closest(".aw-card"), e.target.files[0]);
      }
    });

    $("#add-event").addEventListener("click", () => {
      catalogue.events.unshift({
        id: "vernissage-" + Date.now().toString(36),
        titre: "Nouveau vernissage",
        lieu: "",
        ville: "",
        date: new Date().toISOString().slice(0, 10),
        heure: "18h00",
        desc_fr: "",
        desc_en: ""
      });
      renderEvents();
      markDirty();
    });

    const evList = $("#event-list");
    evList.addEventListener("input", (e) => {
      const card = e.target.closest("[data-ei]");
      const k = e.target.dataset.k;
      if (!card || !k) return;
      catalogue.events[+card.dataset.ei][k] = e.target.value;
      markDirty();
    });
    evList.addEventListener("click", (e) => {
      if (e.target.dataset.act === "delete-event") {
        const card = e.target.closest("[data-ei]");
        if (confirm("Supprimer cet événement ?")) {
          catalogue.events.splice(+card.dataset.ei, 1);
          renderEvents();
          markDirty();
        }
      }
    });

    /* ------ journal & avis ------ */
    $("#add-post").addEventListener("click", () => {
      catalogue.posts.unshift({ titre: "Nouveau billet", date: new Date().toISOString().slice(0, 10), texte: "", texte_en: "", image: "" });
      renderPosts(); markDirty();
    });
    $("#add-avis").addEventListener("click", () => {
      catalogue.avis.unshift({ nom: "", lieu: "", texte: "", texte_en: "" });
      renderAvis(); markDirty();
    });

    const postList = $("#post-list");
    postList.addEventListener("input", (e) => {
      const card = e.target.closest("[data-pi2]"); const k = e.target.dataset.pk2;
      if (card && k) { catalogue.posts[+card.dataset.pi2][k] = e.target.value; markDirty(); }
    });
    postList.addEventListener("click", (e) => {
      const card = e.target.closest("[data-pi2]");
      if (!card) return;
      if (e.target.dataset.act === "post-photo") $("input[type=file]", card).click();
      if (e.target.dataset.act === "post-del" && confirm("Supprimer ce billet ?")) {
        catalogue.posts.splice(+card.dataset.pi2, 1); renderPosts(); markDirty();
      }
    });
    postList.addEventListener("change", async (e) => {
      if (e.target.type !== "file" || !e.target.files[0]) return;
      const card = e.target.closest("[data-pi2]");
      try {
        const blob = await shrinkImage(e.target.files[0]);
        const fd = new FormData();
        fd.append("file", blob, "journal.webp");
        const r = await fetch("/api/upload", { method: "POST", body: fd });
        const { path } = await r.json();
        catalogue.posts[+card.dataset.pi2].image = path;
        $("img", card).src = path;
        markDirty();
      } catch { toast("Échec de l'envoi de la photo."); }
    });

    $("#avis-list").addEventListener("input", (e) => {
      const card = e.target.closest("[data-ai]"); const k = e.target.dataset.ak;
      if (card && k) { catalogue.avis[+card.dataset.ai][k] = e.target.value; markDirty(); }
    });
    $("#avis-list").addEventListener("click", (e) => {
      if (e.target.dataset.act === "avis-del" && confirm("Supprimer cet avis ?")) {
        catalogue.avis.splice(+e.target.closest("[data-ai]").dataset.ai, 1); renderAvis(); markDirty();
      }
    });

    /* ------ diaporama atelier ------ */
    const atFile = document.createElement("input");
    atFile.type = "file"; atFile.accept = "image/*"; atFile.multiple = true; atFile.hidden = true;
    document.body.appendChild(atFile);
    $("#add-atelier").addEventListener("click", () => atFile.click());
    atFile.addEventListener("change", async () => {
      for (const file of atFile.files) {
        try {
          const blob = await shrinkImage(file);
          const fd = new FormData();
          fd.append("file", blob, "atelier.webp");
          const { path } = await (await fetch("/api/upload", { method: "POST", body: fd })).json();
          catalogue.atelier.push(path);
        } catch { toast("Échec d'envoi d'une photo."); }
      }
      atFile.value = "";
      renderAtelier(); markDirty();
    });
    $("#atelier-list").addEventListener("click", (e) => {
      if (e.target.dataset.act === "atelier-del") {
        catalogue.atelier.splice(+e.target.closest("[data-ati]").dataset.ati, 1);
        renderAtelier(); markDirty();
      }
    });

    /* ------ Instagram ------ */
    $("#insta-user").addEventListener("input", (e) => {
      catalogue.instagram.username = e.target.value.trim().replace(/^@/, "");
      markDirty();
    });
    $("#add-insta").addEventListener("click", () => {
      catalogue.instagram.posts = catalogue.instagram.posts || [];
      if (catalogue.instagram.posts.length >= 6) { toast("6 publications maximum sur l'accueil."); return; }
      catalogue.instagram.posts.push({ image: "", url: "", legende: "" });
      renderInsta(); markDirty();
    });
    const instaList = $("#insta-list");
    instaList.addEventListener("input", (e) => {
      const card = e.target.closest("[data-ii]"); const k = e.target.dataset.ik;
      if (card && k) { catalogue.instagram.posts[+card.dataset.ii][k] = e.target.value; markDirty(); }
    });
    instaList.addEventListener("click", (e) => {
      const card = e.target.closest("[data-ii]");
      if (!card) return;
      if (e.target.dataset.act === "insta-photo") $("input[type=file]", card).click();
      if (e.target.dataset.act === "insta-del") {
        catalogue.instagram.posts.splice(+card.dataset.ii, 1); renderInsta(); markDirty();
      }
    });
    instaList.addEventListener("change", async (e) => {
      if (e.target.type !== "file" || !e.target.files[0]) return;
      const card = e.target.closest("[data-ii]");
      try {
        const blob = await shrinkImage(e.target.files[0]);
        const fd = new FormData();
        fd.append("file", blob, "instagram.webp");
        const { path } = await (await fetch("/api/upload", { method: "POST", body: fd })).json();
        catalogue.instagram.posts[+card.dataset.ii].image = path;
        $("img", card).src = path;
        markDirty();
      } catch { toast("Échec de l'envoi de la photo."); }
    });

    /* ------ newsletter ------ */
    $("#compose-btn").addEventListener("click", async () => {
      const panel = $("#compose-panel");
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        const st = await fetch("/api/mail-status").then((r) => r.json()).catch(() => ({ enabled: false }));
        $("#compose-note").textContent = st.enabled
          ? "L'email partira de contact@pascal-sun.com à tous les contacts, un par un."
          : "⚠ L'envoi direct n'est pas encore activé (mot de passe email à configurer). En attendant, utilisez « Inviter la sélection » qui passe par votre application mail.";
        $("#compose-send").disabled = !st.enabled;
      }
    });
    $("#compose-send").addEventListener("click", async () => {
      const subject = $("#compose-subject").value.trim();
      const message = $("#compose-message").value.trim();
      if (!subject || !message) { toast("Sujet et message requis."); return; }
      if (!confirm(`Envoyer « ${subject} » à tous les contacts ?`)) return;
      $("#compose-send").disabled = true;
      $("#compose-status").textContent = "Envoi en cours…";
      try {
        const r = await fetch("/api/newsletter/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, message })
        });
        const d = await r.json();
        if (!r.ok) throw new Error();
        $("#compose-status").textContent = `Envoyé à ${d.sent}/${d.total} contacts ✓`;
      } catch { $("#compose-status").textContent = "Échec de l'envoi."; }
      finally { $("#compose-send").disabled = false; }
    });

    $("#texts-grid").addEventListener("input", (e) => {
      const row = e.target.closest(".text-row");
      if (!row) return;
      const lang = e.target.dataset.lang;
      const v = e.target.value.trim();
      if (v) catalogue.uiTexts[lang][row.dataset.key] = v;
      else delete catalogue.uiTexts[lang][row.dataset.key];
      markDirty();
    });

    $("#save-btn").addEventListener("click", async () => {
      const r = await fetch("/api/catalogue", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(catalogue)
      });
      if (r.ok) { markClean(); toast("Modifications publiées sur le site ✓"); }
      else if (r.status === 401) { toast("Session expirée — reconnectez-vous."); location.reload(); }
      else { toast("Erreur d'enregistrement."); }
    });

    window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
