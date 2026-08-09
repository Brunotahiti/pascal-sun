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
    renderTexts();
    wireChrome();
    markClean();
  }

  async function loadCatalogue() {
    const data = await fetch("/api/catalogue").then((r) => r.json()).catch(() => null);
    catalogue = {
      artworks: (data && data.artworks) || JSON.parse(JSON.stringify(ARTWORKS)),
      uiTexts: (data && data.uiTexts) || { fr: {}, en: {} }
    };
    catalogue.uiTexts.fr = catalogue.uiTexts.fr || {};
    catalogue.uiTexts.en = catalogue.uiTexts.en || {};
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
        <button type="button" class="replace-btn" data-act="photo">Remplacer la photo</button>
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
          <label class="flag"><input type="checkbox" data-k="vendu" ${a.vendu ? "checked" : ""}> Œuvre vendue</label>
          <label class="flag"><input type="checkbox" data-k="nouveaute" ${a.nouveaute ? "checked" : ""}> Nouveauté</label>
          <button type="button" class="aw-delete" data-act="delete">Supprimer cette œuvre</button>
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
    const photoBox = $(".aw-photo", card);
    const overlay = document.createElement("div");
    overlay.className = "uploading";
    overlay.textContent = "Optimisation…";
    photoBox.appendChild(overlay);
    try {
      const blob = await shrinkImage(file);
      overlay.textContent = "Envoi…";
      const fd = new FormData();
      const a = catalogue.artworks[+card.dataset.i];
      fd.append("file", blob, `${slugify(a.titre)}.webp`);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      if (!r.ok) throw new Error("upload");
      const { path } = await r.json();
      a.image = path;
      $("img", photoBox).src = path;
      markDirty();
      toast("Photo remplacée — pensez à enregistrer.");
    } catch {
      toast("Échec de l'envoi de la photo.");
    } finally {
      overlay.remove();
    }
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

  /* ---------------------------------------------------------- events -- */

  function wireChrome() {
    document.querySelectorAll(".admin-tabs .tab").forEach((t) =>
      t.addEventListener("click", () => {
        document.querySelectorAll(".admin-tabs .tab").forEach((x) => x.classList.toggle("active", x === t));
        document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === t.dataset.tab));
      }));

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
      const k = e.target.dataset.k;
      if (!card || !k) return;
      const a = catalogue.artworks[+card.dataset.i];
      if (e.target.type === "checkbox") a[k] = e.target.checked;
      else if (e.target.type === "number") a[k] = Number(e.target.value) || 0;
      else a[k] = e.target.value;
      if (k === "titre") a.id = slugify(a.titre);
      markDirty();
    });
    list.addEventListener("click", (e) => {
      const card = e.target.closest(".aw-card");
      if (!card) return;
      const act = e.target.dataset.act;
      if (act === "photo") $("input[type=file]", card).click();
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
