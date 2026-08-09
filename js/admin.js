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
    renderTexts();
    wireChrome();
    markClean();
  }

  async function loadCatalogue() {
    const data = await fetch("/api/catalogue").then((r) => r.json()).catch(() => null);
    catalogue = {
      artworks: (data && data.artworks) || JSON.parse(JSON.stringify(ARTWORKS)),
      events: (data && data.events) || JSON.parse(JSON.stringify(typeof EVENTS !== "undefined" ? EVENTS : [])),
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

  /* ----------------------------------------------------------- textes -- */

  function renderTexts() {
    $("#texts-grid").innerHTML = EDITABLE_TEXTS.map(({ key, label, hint }) => `
      <div class="text-row" data-key="${key}">
        <div class="k">${label}${hint ? `<small>${hint}</small>` : ""}</div>
        <input data-lang="fr" placeholder="FR — ${esc(I18N.fr[key] || "")}" value="${esc(catalogue.uiTexts.fr[key] || "")}">
        <input data-lang="en" placeholder="EN — ${esc(I18N.en[key] || "")}" value="${esc(catalogue.uiTexts.en[key] || "")}">
      </div>`).join("");
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
    const max = Math.max(...rows.map((r) => r.y));
    el.innerHTML = rows.map((r) => `
      <div class="metric-row">
        <span class="bar" style="transform: scaleX(${max ? r.y / max : 0})"></span>
        <span class="lbl">${labelFn(r.x)}</span>
        <span class="val">${fmtNum(r.y)}</span>
      </div>`).join("");
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
    metricList($("#m-countries"), d.countries, (c) => `${flagEmoji(c)} ${countryName(c)}`);
    metricList($("#m-pages"), d.pages, (u) => u === "/" ? "/ (accueil)" : u);
    metricList($("#m-referrers"), d.referrers, (r) => r || "Accès direct");
    metricList($("#m-devices"), d.devices, (x) => ({ desktop: "🖥 Ordinateur", laptop: "💻 Portable", mobile: "📱 Mobile", tablet: "📱 Tablette" }[x] || x));

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
      }));

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
