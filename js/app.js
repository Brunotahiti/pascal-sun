/* =========================================================================
   Galerie Pascal Sun — moteur de l'application
   Pages : accueil, galerie, œuvre, artiste, panier, contact.
   Tout est rendu côté client depuis js/data.js (aucune dépendance).
   ========================================================================= */

(function () {
  "use strict";

  /* ------------------------------------------------------------ état -- */

  const store = {
    get lang()     { return localStorage.getItem("ps_lang") || "fr"; },
    set lang(v)    { localStorage.setItem("ps_lang", v); },
    get currency() { return localStorage.getItem("ps_currency") || "XPF"; },
    set currency(v){ localStorage.setItem("ps_currency", v); },
    get cart() {
      try {
        const raw = JSON.parse(localStorage.getItem("ps_cart")) || [];
        // migration : ancien format = tableau d'ids
        return raw.map((x) => typeof x === "string" ? { id: x, key: "original", qty: 1 } : x)
          .filter((x) => x && x.id && x.key);
      } catch { return []; }
    },
    set cart(v)    { localStorage.setItem("ps_cart", JSON.stringify(v)); }
  };

  const t = (key) => (I18N[store.lang] && I18N[store.lang][key]) || I18N.fr[key] || key;
  const byId = (id) => ARTWORKS.find((a) => a.id === id);
  const produitOf = (a, key) => (a.produits || []).find((p) => p.key === key) ||
    (key === "original" ? { key: "original", prixEUR: a.prixEUR, stock: 1, certificat: true } : null);
  const produitLabel = (key) => t(({ original: "prod_original", tirage: "prod_tirage", affiche: "prod_affiche" })[key] || key);
  const imgLarge = (a) => (a.images && a.images.large) || a.image;
  const colName = (key) => (COLLECTIONS[key] ? COLLECTIONS[key][store.lang] || COLLECTIONS[key].fr : key);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* Balise <img> optimisée : lazy + décodage asynchrone, et srcset
     automatique si l'œuvre fournit des variantes responsives
     (a.images = { small, medium, large } générées par tools/optimiser-images.sh). */
  function imgTag(a, { eager = false, sizes = "(max-width: 620px) 92vw, (max-width: 980px) 46vw, 30vw", className = "" } = {}) {
    const loading = eager ? 'fetchpriority="high"' : 'loading="lazy"';
    const srcset = a.images
      ? `srcset="${a.images.small} 480w, ${a.images.medium} 960w, ${a.images.large} 1600w" sizes="${sizes}"`
      : "";
    const src = a.images ? a.images.medium : a.image;
    // width/height : proportions réelles de la toile, pour réserver la place
    // sans jamais rogner l'œuvre.
    const m = String(a.dimensions || "").match(/(\d+)\s*[×x]\s*(\d+)/);
    let dim = "";
    if (m) {
      let w = +m[1], h = +m[2];
      if (a.orientation === "portrait" && w > h) [w, h] = [h, w];
      if (a.orientation === "landscape" && h > w) [w, h] = [h, w];
      dim = `width="${w}" height="${h}"`;
    }
    return `<img class="${className}" src="${src}" ${srcset} ${dim} alt="${esc(a.titre)} — Pascal Sun" ${loading} decoding="async">`;
  }

  /* Prix « jolis » : arrondis commerciaux propres à chaque devise. */
  function fmtPrice(eur) {
    const c = CURRENCIES[store.currency];
    const value = eur * c.rate;
    let pas;
    if (store.currency === "XPF") pas = value >= 100000 ? 5000 : value >= 20000 ? 1000 : 500;
    else pas = value >= 1000 ? 50 : value >= 200 ? 10 : 5;
    const rounded = Math.round(value / pas) * pas;
    const num = rounded.toLocaleString(c.locale);
    return c.position === "before" ? `${c.symbol}${num}` : `${num} ${c.symbol}`;
  }

  /* -------------------------------------------- installation de l'app -- */

  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
  });

  function installApp() {
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) { toast(t("app_done")); return; }
    if (deferredInstall) {
      deferredInstall.prompt();
      deferredInstall.userChoice.finally(() => { deferredInstall = null; });
      return;
    }
    showInstallGuide();
  }

  /* Guide d'installation illustré, pas à pas, selon l'appareil. */
  function showInstallGuide() {
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua);
    const android = /android/i.test(ua);
    const steps = ios ? [
      [`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V3"/><path d="m8 7 4-4 4 4"/><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/></svg>`,
       t("g_ios_1")],
      [`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`,
       t("g_ios_2")],
      [`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>`,
       t("g_ios_3")],
      [`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
       t("g_ios_4")]
    ] : android ? [
      [`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>`,
       t("g_and_1")],
      [`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v13"/><path d="m8 12 4 4 4-4"/><path d="M4 21h16"/></svg>`,
       t("g_and_2")],
      [`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>`,
       t("g_and_3")]
    ] : [
      [`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8"/></svg>`,
       t("g_desk_1")],
      [`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v13"/><path d="m8 12 4 4 4-4"/><path d="M4 21h16"/></svg>`,
       t("g_desk_2")]
    ];

    let m = document.getElementById("install-guide");
    if (m) m.remove();
    m = document.createElement("div");
    m.id = "install-guide";
    m.className = "install-modal";
    m.innerHTML = `
      <div class="install-box">
        <button class="install-close" aria-label="Fermer">✕</button>
        <div class="install-icon"><img src="/img/icon-192.png" alt=""></div>
        <h3>${t("g_title")}</h3>
        <p class="install-sub">${t("g_sub")}</p>
        <ol class="install-steps">
          ${steps.map(([ico, txt], i) => `
            <li><span class="istep">${i + 1}</span><span class="iico">${ico}</span><span>${txt}</span></li>`).join("")}
        </ol>
        <p class="install-note">${t("g_note")}</p>
        <button class="btn install-ok">${t("g_ok")}</button>
      </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector(".install-close").addEventListener("click", close);
    m.querySelector(".install-ok").addEventListener("click", close);
    m.addEventListener("click", (e) => { if (e.target === m) close(); });
  }

  /* --------------------------------------------------- header / footer -- */

  function renderHeader() {
    const page = document.body.dataset.page || "";
    const el = document.getElementById("site-header");
    if (!el) return;
    el.innerHTML = `
      <div class="wrap bar">
        <a class="brand" href="index.html">Pascal <span class="sun">Sun</span>
          <small>Peintre · Tahiti</small>
        </a>
        <nav class="nav" id="main-nav" aria-label="Navigation principale">
          <a class="nav-link ${page === "home" ? "active" : ""}" href="index.html">${t("nav_home")}</a>
          <a class="nav-link ${page === "gallery" || page === "artwork" ? "active" : ""}" href="galerie.html">${t("nav_gallery")}</a>
          <a class="nav-link ${page === "expos" ? "active" : ""}" href="expositions.html">${t("nav_expos")}</a>
          <a class="nav-link ${page === "journal" ? "active" : ""}" href="journal.html">${t("nav_journal")}</a>
          <a class="nav-link ${page === "artist" ? "active" : ""}" href="artiste.html">${t("nav_artist")}</a>
          <a class="nav-link ${page === "contact" ? "active" : ""}" href="contact.html">${t("nav_contact")}</a>
        </nav>
        <div class="header-tools">
          <select class="tool-select" id="lang-select" aria-label="Langue / Language">
            <option value="fr">FR</option><option value="en">EN</option>
          </select>
          <select class="tool-select" id="currency-select" aria-label="Devise / Currency">
            <option value="EUR">EUR €</option><option value="USD">USD $</option><option value="XPF">XPF F</option>
          </select>
          <a class="cart-btn" href="panier.html" id="cart-link">
            ${t("nav_cart")} <span class="cart-count" id="cart-count">0</span>
          </a>
          <button class="burger" id="burger" aria-label="Menu"><span></span><span></span><span></span></button>
        </div>
      </div>`;

    el.querySelector("#lang-select").value = store.lang;
    el.querySelector("#currency-select").value = store.currency;
    el.querySelector("#lang-select").addEventListener("change", (e) => { store.lang = e.target.value; location.reload(); });
    el.querySelector("#currency-select").addEventListener("change", (e) => { store.currency = e.target.value; location.reload(); });
    el.querySelector("#burger").addEventListener("click", () => {
      el.querySelector("#main-nav").classList.toggle("open");
    });
    updateCartCount();
  }

  function renderFooter() {
    const el = document.getElementById("site-footer");
    if (!el) return;
    el.innerHTML = `
      <div class="wrap top">
        <div>
          <a class="brand" href="index.html">Pascal <span class="sun">Sun</span><small>Peintre · Tahiti</small></a>
          <p>${t("footer_tag")}</p>
        </div>
        <div>
          <h4>${t("footer_nav")}</h4>
          <ul>
            <li><a href="index.html">${t("nav_home")}</a></li>
            <li><a href="galerie.html">${t("nav_gallery")}</a></li>
            <li><a href="expositions.html">${t("nav_expos")}</a></li>
            <li><a href="journal.html">${t("nav_journal")}</a></li>
            <li><a href="portrait.html">${t("portrait_home_btn")}</a></li>
            <li><a href="idees.html">${t("nav_idees")}</a></li>
            <li><a href="artiste.html">${t("nav_artist")}</a></li>
            <li><a href="contact.html">${t("nav_contact")}</a></li>
          </ul>
        </div>
        <div>
          <h4>${t("footer_info")}</h4>
          <ul>
            <li>${t("footer_ship")}</li>
            <li>${t("footer_cert")}</li>
            <li>${t("footer_secure")}</li>
            <li><a href="mailto:${ARTIST_EMAIL}">${ARTIST_EMAIL}</a></li>
            <li><a href="cgv.html">${t("footer_cgv")}</a></li>
          </ul>
          <button class="app-install-btn" id="pwa-install">${t("app_install")}</button>
          <div class="newsletter">
            <h4>${t("news_t")}</h4>
            <p class="news-p">${t("news_p")}</p>
            <form id="newsletter-form" class="news-form">
              <input type="email" name="email" placeholder="${t("news_ph")}" required>
              <button type="submit">${t("news_btn")}</button>
            </form>
            <p class="news-msg" id="news-msg"></p>
          </div>
        </div>
      </div>
      <div class="wrap bottom">
        <span>${t("footer_rights")}</span>
        <span>
          ${t("footer_made")} ·
          <a class="made-by" href="https://manaprocess.com" target="_blank" rel="noopener">Réalisé par Manaprocess.com</a> ·
          <a href="/admin" rel="nofollow">Admin</a>
        </span>
      </div>`;

    const ib = document.getElementById("pwa-install");
    if (ib) ib.addEventListener("click", installApp);

    const nf = document.getElementById("newsletter-form");
    if (nf) nf.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("news-msg");
      try {
        const r = await fetch("/api/newsletter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: new FormData(nf).get("email") })
        });
        if (!r.ok) throw new Error();
        msg.textContent = t("news_ok");
        nf.reset();
      } catch { msg.textContent = t("news_err"); }
    });
  }

  /* ----------------------------------------------------------- panier -- */

  function updateCartCount() {
    const el = document.getElementById("cart-count");
    if (!el) return;
    const n = store.cart.length;
    el.textContent = n;
    el.classList.toggle("empty", n === 0);
  }

  function addToCart(id, key) {
    key = key || "original";
    const cart = store.cart;
    const line = cart.find((x) => x.id === id && x.key === key);
    const a = byId(id);
    const p = produitOf(a, key);
    if (line) {
      if (key === "original") return;
      if (typeof p.stock === "number" && line.qty >= p.stock) return;
      line.qty += 1;
    } else {
      cart.push({ id, key, qty: 1 });
    }
    store.cart = cart;
    updateCartCount();
    toast(`<span class="hl">« ${esc(a.titre)} »</span> ${t("toast_added")}`);
  }

  function removeFromCart(id, key) {
    store.cart = store.cart.filter((x) => !(x.id === id && x.key === key));
    updateCartCount();
    toast(`« ${esc(byId(id).titre)} » ${t("toast_removed")}`);
  }

  let toastTimer;
  function toast(html) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.innerHTML = html;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  /* ------------------------------------------------------------ cartes -- */

  /* Répartition des éclairages, comme dans une salle réelle :
     jamais deux voisines éclairées pareil. */
  const ECLAIRAGES = ["lit-haut", "lit-haut-gauche", "lit-droite", "lit-bas",
                      "lit-haut-droite", "lit-gauche", "lit-haut", "lit-bas-gauche"];

  function cardHTML(a, index) {
    const badge = a.statut === "vendu"
      ? `<span class="badge-sold">${t("statut_vendu")}</span>`
      : a.statut === "reserve"
        ? `<span class="badge-reserved">${t("statut_reserve")}</span>`
        : a.nouveaute ? `<span class="badge-new">${t("new")}</span>` : "";
    const price = a.statut === "vendu"
      ? `<span class="price sold">${t("statut_vendu")}</span>`
      : `<span class="price">${fmtPrice(a.prixEUR)}</span>`;
    const lumiere = ECLAIRAGES[(index || 0) % ECLAIRAGES.length];
    return `
      <article class="card reveal ${lumiere}">
        <span class="spot" aria-hidden="true"><span class="spot-beam"></span></span>
        <a href="oeuvre.html?id=${a.id}" aria-label="${esc(a.titre)}">
          ${badge}
          <div class="frame">${imgTag(a, { className: a.orientation })}<span class="lightwash" aria-hidden="true"></span><span class="glass" aria-hidden="true"></span></div>
          <div class="card-meta">
            <div>
              <h3>${esc(a.titre)}</h3>
              <div class="sub">${colName(a.collection)} · ${a.dimensions}</div>
            </div>
            ${price}
          </div>
        </a>
      </article>`;
  }

  function observeReveals() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { threshold: 0.08 });
    document.querySelectorAll(".reveal:not(.is-in)").forEach((el) => io.observe(el));
  }

  /* ------------------------------------------------------------- i18n -- */

  function applyI18n() {
    document.documentElement.lang = store.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  }

  /* ------------------------------------------------------------ pages -- */

  function pageHome() {
    const featured = ARTWORKS.filter((a) => !a.vendu).slice(0, 3);
    const grid = document.getElementById("featured-grid");
    if (grid) grid.innerHTML = featured.map(cardHTML).join("");

    const hero = ARTWORKS.find((a) => a.id === "retour-du-pecheur") || ARTWORKS[0];
    const heroFig = document.getElementById("hero-art");
    if (heroFig) {
      heroFig.innerHTML = `
        <a href="oeuvre.html?id=${hero.id}">
          ${imgTag(hero, { eager: true, sizes: "(max-width: 900px) 92vw, 45vw" })}
          <span class="glass" aria-hidden="true"></span>
          <figcaption><strong>${esc(hero.titre)}</strong><span>${hero.dimensions} — ${hero.annee}</span></figcaption>
        </a>`;
    }
  }

  function pageGallery() {
    const grid = document.getElementById("gallery-grid");
    const filters = document.getElementById("filters");
    if (!grid || !filters) return;

    const keys = ["all", ...Object.keys(COLLECTIONS)];
    filters.innerHTML = keys.map((k) =>
      `<button class="chip ${k === "all" ? "active" : ""}" data-filter="${k}">
        ${k === "all" ? t("filter_all") : colName(k)}
      </button>`).join("") +
      `<button class="lights-switch" id="lights-switch" aria-pressed="false">
        <span class="bulb"></span><span class="lbl">${t("lights_on")}</span>
      </button>`;

    /* Interrupteur des projecteurs : la salle se tamise, les spots s'allument.
       Le choix est mémorisé d'une visite à l'autre. */
    const sw = document.getElementById("lights-switch");
    function setLights(on) {
      document.body.classList.toggle("lights-on", on);
      sw.setAttribute("aria-pressed", String(on));
      sw.querySelector(".lbl").textContent = on ? t("lights_off") : t("lights_on");
      localStorage.setItem("ps_lights", on ? "1" : "0");
    }
    setLights(localStorage.getItem("ps_lights") === "1");
    sw.addEventListener("click", () => setLights(!document.body.classList.contains("lights-on")));

    function draw(filter) {
      const list = filter === "all" ? ARTWORKS : ARTWORKS.filter((a) => a.collection === filter);
      grid.innerHTML = list.map(cardHTML).join("");
      const count = document.getElementById("gallery-count");
      if (count) count.textContent = `${list.length} ${list.length > 1 ? t("works_count") : t("work_count")}`;
      observeReveals();
    }

    filters.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      filters.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      draw(btn.dataset.filter);
    });

    draw("all");
  }

  function pageArtwork() {
    const id = new URLSearchParams(location.search).get("id");
    const a = byId(id) || ARTWORKS[0];
    document.title = `${a.titre} — Pascal Sun`;

    const visual = document.getElementById("artwork-visual");
    const info = document.getElementById("artwork-info");
    if (!visual || !info) return;

    visual.innerHTML = imgTag(a, { eager: true, sizes: "(max-width: 900px) 94vw, 55vw" }) + '<span class="glass" aria-hidden="true"></span>';
    visual.addEventListener("click", () => {
      const lb = document.getElementById("lightbox");
      lb.innerHTML = `<img src="${imgLarge(a)}" alt="${esc(a.titre)}">`;
      lb.classList.add("open");
    });
    document.getElementById("lightbox").addEventListener("click", function () { this.classList.remove("open"); });

    const desc = store.lang === "en" ? a.desc_en : a.desc_fr;
    const technique = store.lang === "en" ? a.technique_en : a.technique_fr;
    const statutTxt = t("statut_" + (a.statut || "disponible"));

    // Déclinaisons disponibles à l'achat
    const produits = (a.produits || []).filter((p) => p.actif !== false);
    function prodDispo(p) {
      if (p.key === "original") return a.statut === "disponible";
      return typeof p.stock !== "number" || p.stock > 0;
    }
    function prodNote(p) {
      if (p.key === "original") return a.statut === "disponible" ? t("statut_disponible") : statutTxt;
      if (typeof p.stock === "number") {
        if (p.stock <= 0) return t("sold_out");
        if (p.stock === 1) return t("last_one");
        if (p.key === "tirage" && p.edition) return `${p.stock} / ${p.edition} ${t("stock_left")}`;
        return `${p.stock} ${t("stock_left")}`;
      }
      return "";
    }
    const firstOk = produits.find(prodDispo);
    let selectedKey = firstOk ? firstOk.key : null;

    const optionsHTML = produits.map((p) => {
      const ok = prodDispo(p);
      return `
      <label class="prod-option ${ok ? "" : "off"} ${p.key === selectedKey ? "on" : ""}">
        <input type="radio" name="prod" value="${p.key}" ${p.key === selectedKey ? "checked" : ""} ${ok ? "" : "disabled"}>
        <span class="prod-info">
          <span class="prod-name">${produitLabel(p.key)}</span>
          <span class="prod-note">${prodNote(p)}${p.certificat ? ` · ${t("cert_included")}` : ""}</span>
        </span>
        <span class="prod-price">${fmtPrice(p.prixEUR)}</span>
      </label>`;
    }).join("");

    info.innerHTML = `
      <span class="eyebrow">${colName(a.collection)}</span>
      <h1>${esc(a.titre)}</h1>
      <div class="price-line" id="price-line">${a.statut === "vendu"
        ? `<span class="sold-label">${t("statut_vendu")}</span>`
        : fmtPrice((firstOk || { prixEUR: a.prixEUR }).prixEUR)}</div>
      <p class="story">${desc}</p>
      <div class="prod-options" id="prod-options">
        <div class="eyebrow" style="margin-bottom:12px;">${t("choose_format")}</div>
        ${optionsHTML}
      </div>
      <dl class="spec-list">
        <div><dt>${t("spec_year")}</dt><dd>${a.annee}</dd></div>
        <div><dt>${t("spec_technique")}</dt><dd>${technique}</dd></div>
        <div><dt>${t("spec_dimensions")}</dt><dd>${a.dimensions}</dd></div>
        <div><dt>${t("spec_collection")}</dt><dd>${colName(a.collection)}</dd></div>
        <div><dt>${t("spec_availability")}</dt><dd>${statutTxt}</dd></div>
      </dl>
      <div class="btn-row">
        <button class="btn" id="acquire-btn" ${selectedKey ? "" : "disabled"}>${selectedKey ? t("add_to_cart") : t("sold_out")}</button>
        <a class="btn ghost" href="galerie.html">${t("back_gallery")}</a>
      </div>
      ${a.statut !== "disponible" ? `
      <div class="notify-box">
        <p>${t("notify_hint")}</p>
        <form id="notify-form" class="news-form notify-form">
          <input type="email" name="email" placeholder="${t("notify_ph")}" required>
          <button type="submit">${t("notify_send")}</button>
        </form>
        <p class="news-msg" id="notify-msg"></p>
      </div>` : ""}
      <ul class="assurances">
        <li><span class="dot">●</span>${t("assur1")}</li>
        <li><span class="dot">●</span>${t("assur2")}</li>
        <li><span class="dot">●</span>${t("assur3")}</li>
      </ul>`;

    const nform = document.getElementById("notify-form");
    if (nform) nform.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const r = await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: new FormData(nform).get("email"), artworkId: a.id, titre: a.titre })
        });
        if (!r.ok) throw new Error();
        document.getElementById("notify-msg").textContent = t("notify_ok");
        nform.reset();
      } catch { document.getElementById("notify-msg").textContent = t("news_err"); }
    });

    // Données structurées Product pour Google (prix, disponibilité)
    const availability = a.statut === "disponible" ? "https://schema.org/InStock"
      : a.statut === "reserve" ? "https://schema.org/PreOrder" : "https://schema.org/SoldOut";
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: a.titre,
      image: "https://pascal-sun.com/" + imgLarge(a),
      description: a.desc_fr,
      brand: { "@type": "Person", name: "Pascal Sun" },
      offers: (a.produits || []).filter((p) => p.actif !== false).map((p) => ({
        "@type": "Offer",
        price: p.prixEUR,
        priceCurrency: "EUR",
        availability: p.key === "original" ? availability
          : (typeof p.stock === "number" && p.stock <= 0 ? "https://schema.org/SoldOut" : "https://schema.org/InStock"),
        url: `https://pascal-sun.com/oeuvre.html?id=${a.id}`
      }))
    });
    document.head.appendChild(ld);

    const btn = document.getElementById("acquire-btn");
    const options = document.getElementById("prod-options");
    if (options) {
      options.addEventListener("change", (e) => {
        if (e.target.name !== "prod") return;
        selectedKey = e.target.value;
        options.querySelectorAll(".prod-option").forEach((l) =>
          l.classList.toggle("on", l.querySelector("input").value === selectedKey));
        const p = produitOf(a, selectedKey);
        document.getElementById("price-line").textContent = fmtPrice(p.prixEUR);
        btn.removeAttribute("disabled");
        btn.textContent = t("add_to_cart");
      });
    }
    if (btn && selectedKey) {
      btn.addEventListener("click", () => {
        addToCart(a.id, selectedKey);
        if (selectedKey === "original") { btn.textContent = t("in_cart"); btn.setAttribute("disabled", ""); }
      });
    }

    const related = ARTWORKS.filter((x) => x.id !== a.id && x.collection === a.collection).slice(0, 3);
    const pool = related.length ? related : ARTWORKS.filter((x) => x.id !== a.id).slice(0, 3);
    const relGrid = document.getElementById("related-grid");
    if (relGrid) relGrid.innerHTML = pool.map(cardHTML).join("");
  }

  function pageCart() {
    const listEl = document.getElementById("cart-list");
    const panel = document.getElementById("order-panel");
    const emptyEl = document.getElementById("cart-empty");
    if (!listEl) return;

    function cartLines() {
      return store.cart
        .map((l) => ({ ...l, art: byId(l.id), produit: byId(l.id) && produitOf(byId(l.id), l.key) }))
        .filter((l) => l.art && l.produit);
    }

    /* Frais de livraison : même calcul que le serveur (source de vérité). */
    function shippingEUR(lines) {
      const mode = (form && new FormData(form).get("mode")) || "livraison";
      if (mode === "retrait") return 0;
      const zoneKey = (document.getElementById("of-zone") || {}).value || "pf";
      const zone = (SHIPPING.zones || []).find((z) => z.key === zoneKey) || SHIPPING.zones[0];
      const total = lines.reduce((s, l) => s + l.produit.prixEUR * l.qty, 0);
      if (SHIPPING.freeAbove && total >= SHIPPING.freeAbove) return 0;
      return lines.reduce((s, l) => {
        const d = String(l.art.dimensions || "").match(/(\d+)\s*[×x]\s*(\d+)/);
        const grand = d && Math.max(+d[1], +d[2]) > 100;
        return s + (l.key === "original" ? (grand ? zone.grand : zone.original) : (zone[l.key] || 0) * l.qty);
      }, 0);
    }

    function draw() {
      const lines = cartLines();
      const has = lines.length > 0;
      listEl.parentElement.style.display = has ? "" : "none";
      emptyEl.style.display = has ? "none" : "";
      if (!has) return;

      listEl.innerHTML = lines.map((l) => `
        <div class="cart-item">
          <a class="thumb" href="oeuvre.html?id=${l.art.id}"><img src="${l.art.image}" alt="${esc(l.art.titre)}"></a>
          <div>
            <h3>${esc(l.art.titre)}</h3>
            <div class="sub">${produitLabel(l.key)} · ${l.art.dimensions}</div>
            ${l.key === "original" ? "" : `
            <div class="qty-row">
              <button class="qty-btn" data-qty="-1" data-id="${l.art.id}" data-key="${l.key}">−</button>
              <span class="qty-val">${l.qty}</span>
              <button class="qty-btn" data-qty="1" data-id="${l.art.id}" data-key="${l.key}">+</button>
            </div>`}
            <button class="remove-btn" data-remove="${l.art.id}" data-key="${l.key}">${t("remove")}</button>
          </div>
          <div class="price">${fmtPrice(l.produit.prixEUR * l.qty)}</div>
        </div>`).join("");

      const total = lines.reduce((s, l) => s + l.produit.prixEUR * l.qty, 0);
      const mode = (form && new FormData(form).get("mode")) || "livraison";
      const port = shippingEUR(lines);
      document.getElementById("order-subtotal").textContent = fmtPrice(total);
      document.getElementById("order-shipping").textContent =
        mode === "retrait" ? t("ship_pickup_free") : (port === 0 ? t("ship_free") : fmtPrice(port));
      document.getElementById("order-total").textContent = fmtPrice(total + port);
      const zf = document.getElementById("zone-field");
      if (zf) zf.style.display = mode === "retrait" ? "none" : "";
      document.getElementById("ship-note").textContent =
        mode === "retrait" ? "" : `${t("ship_note")} ${SHIPPING.freeAbove ? t("ship_free_note") + " " + fmtPrice(SHIPPING.freeAbove) + "." : ""}`;
    }

    listEl.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-remove]");
      if (rm) { removeFromCart(rm.dataset.remove, rm.dataset.key); draw(); return; }
      const qb = e.target.closest("[data-qty]");
      if (qb) {
        const cart = store.cart;
        const line = cart.find((x) => x.id === qb.dataset.id && x.key === qb.dataset.key);
        if (!line) return;
        const p = produitOf(byId(line.id), line.key);
        line.qty = Math.max(1, line.qty + Number(qb.dataset.qty));
        if (typeof p.stock === "number") line.qty = Math.min(line.qty, Math.max(1, p.stock));
        store.cart = cart;
        updateCartCount();
        draw();
      }
    });

    // Zones de livraison + recalcul à chaque changement
    const zoneSel = document.getElementById("of-zone");
    if (zoneSel) {
      zoneSel.innerHTML = (SHIPPING.zones || [])
        .map((z) => `<option value="${z.key}">${store.lang === "en" ? (z.en || z.fr) : z.fr}</option>`).join("");
      zoneSel.addEventListener("change", draw);
    }
    document.querySelectorAll('#order-form input[name="mode"]').forEach((r) =>
      r.addEventListener("change", draw));

    const form = document.getElementById("order-form");
    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const lines = cartLines();
      if (!lines.length) return;
      const data = new FormData(form);
      const payment = data.get("payment") || "virement";
      const payload = {
        items: lines.map((l) => ({ id: l.id, key: l.key, qty: l.qty })),
        client: {
          name: data.get("name"), email: data.get("email"),
          country: data.get("country"), message: data.get("message"),
          mode: data.get("mode") || "livraison", zone: data.get("zone") || "pf", payment
        }
      };
      const submitBtn = form.querySelector("button[type=submit]");
      submitBtn.setAttribute("disabled", "");
      try {
        const r = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!r.ok) throw new Error();
        const { orderId } = await r.json();
        if (payment === "card") {
          const c = await fetch("/api/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: payload.items })
          });
          if (c.ok) {
            const { url } = await c.json();
            store.cart = [];
            location.href = url;
            return;
          }
        }
        store.cart = [];
        location.href = `merci.html?cmd=${encodeURIComponent(orderId)}`;
      } catch {
        submitBtn.removeAttribute("disabled");
        toast(t("news_err"));
      }
    });

    draw();
  }

  function pageExpos() {
    const up = document.getElementById("expos-upcoming");
    const past = document.getElementById("expos-past");
    if (!up || !past) return;

    const today = new Date().toISOString().slice(0, 10);
    const months = store.lang === "en"
      ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
      : ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];

    function itemHTML(ev, isPast) {
      const [y, m, d] = ev.date.split("-").map(Number);
      const desc = store.lang === "en" ? (ev.desc_en || ev.desc_fr) : ev.desc_fr;
      const rsvp = isPast ? "" : `
        <a class="btn" href="mailto:${ARTIST_EMAIL}?subject=${encodeURIComponent(t("expos_rsvp_subject") + " — " + ev.titre)}">
          ${t("expos_rsvp")}</a>`;
      return `
        <div class="tl-item reveal">
          <div class="tl-date">
            <div class="day">${String(d).padStart(2, "0")}</div>
            <div class="my">${months[m - 1]} ${y}</div>
            ${ev.heure ? `<div class="hour">${esc(ev.heure)}</div>` : ""}
          </div>
          <div class="tl-card">
            <h3>${esc(ev.titre)}</h3>
            <div class="place">${esc(ev.lieu)} · ${esc(ev.ville)}</div>
            <p>${esc(desc || "")}</p>
            ${rsvp}
          </div>
        </div>`;
    }

    const sorted = [...EVENTS].filter((e) => e && e.date);
    const upcoming = sorted.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const gone = sorted.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));

    up.innerHTML = upcoming.length ? upcoming.map((e) => itemHTML(e, false)).join("")
      : `<p class="empty">${t("expos_empty")}</p>`;
    past.innerHTML = gone.map((e) => itemHTML(e, true)).join("");
  }

  /* Diaporama élégant de l'atelier : fondu croisé, flèches, points,
     défilement automatique qui se met en pause au survol. */
  function pageArtist() {
    const track = document.getElementById("diapo-track");
    if (!track || !ATELIER.length) return;
    const wrap = document.getElementById("atelier-diapo");
    let index = 0, timer = null;

    track.innerHTML = ATELIER.map((src, i) => `
      <div class="diapo-slide ${i === 0 ? "on" : ""}">
        <img src="${esc(src)}" alt="L'atelier de Pascal Sun" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
      </div>`).join("");
    document.getElementById("diapo-dots").innerHTML = ATELIER.map((_, i) =>
      `<button class="diapo-dot ${i === 0 ? "on" : ""}" data-i="${i}" aria-label="Photo ${i + 1}"></button>`).join("");

    const slides = track.querySelectorAll(".diapo-slide");
    const dots = document.querySelectorAll(".diapo-dot");

    function go(n) {
      index = (n + ATELIER.length) % ATELIER.length;
      slides.forEach((s, i) => s.classList.toggle("on", i === index));
      dots.forEach((d, i) => d.classList.toggle("on", i === index));
    }
    function auto() { clearInterval(timer); timer = setInterval(() => go(index + 1), 4500); }

    document.getElementById("diapo-prev").addEventListener("click", () => { go(index - 1); auto(); });
    document.getElementById("diapo-next").addEventListener("click", () => { go(index + 1); auto(); });
    document.getElementById("diapo-dots").addEventListener("click", (e) => {
      const d = e.target.closest(".diapo-dot");
      if (d) { go(+d.dataset.i); auto(); }
    });
    wrap.addEventListener("mouseenter", () => clearInterval(timer));
    wrap.addEventListener("mouseleave", auto);
    // balayage tactile
    let sx = null;
    wrap.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
    wrap.addEventListener("touchend", (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 40) { go(index + (dx < 0 ? 1 : -1)); auto(); }
      sx = null;
    }, { passive: true });
    auto();
  }

  function pageJournal() {
    const list = document.getElementById("journal-list");
    if (!list) return;
    const posts = [...POSTS].filter((p) => p && p.date).sort((a, b) => b.date.localeCompare(a.date));
    if (!posts.length) { list.innerHTML = `<p class="empty" style="padding:30px 0; color:var(--ink-faint); font-style:italic;">${t("journal_empty")}</p>`; return; }
    list.innerHTML = posts.map((p) => `
      <article class="post-card reveal">
        ${p.image ? `<a class="post-img" href="${esc(p.image)}" target="_blank"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async"></a>` : ""}
        <div class="post-body">
          <div class="post-date">${new Date(p.date + (p.date.length === 10 ? "T00:00:00" : "")).toLocaleDateString(store.lang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric" })}</div>
          <h2>${esc(p.titre)}</h2>
          <p>${esc(store.lang === "en" ? (p.texte_en || p.texte) : p.texte).replace(/\n/g, "<br>")}</p>
        </div>
      </article>`).join("");
    observeReveals();
  }

  function pagePortrait() {
    const form = document.getElementById("portrait-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      btn.setAttribute("disabled", "");
      try {
        const r = await fetch("/api/commission", { method: "POST", body: new FormData(form) });
        if (!r.ok) throw new Error();
        form.reset();
        toast(t("portrait_ok"));
        document.getElementById("portrait-msg").textContent = t("portrait_ok");
      } catch {
        document.getElementById("portrait-msg").textContent = t("news_err");
      } finally { btn.removeAttribute("disabled"); }
    });
  }

  function homeExtras() {
    // Avis de collectionneurs (si renseignés dans l'admin)
    const avisWrap = document.getElementById("avis-section");
    if (avisWrap && AVIS.length) {
      avisWrap.hidden = false;
      document.getElementById("avis-grid").innerHTML = AVIS.map((av) => `
        <blockquote class="avis-card reveal">
          <p>« ${esc(store.lang === "en" ? (av.texte_en || av.texte) : av.texte)} »</p>
          <footer>${esc(av.nom)}${av.lieu ? ` · ${esc(av.lieu)}` : ""}</footer>
        </blockquote>`).join("");
    }

    // Instagram : compte connecté depuis l'admin
    const ig = document.getElementById("insta-section");
    if (ig && INSTA.username) {
      const user = String(INSTA.username).replace(/^@/, "");
      ig.hidden = false;
      const link = document.getElementById("insta-link");
      link.href = `https://instagram.com/${user}`;
      link.textContent = `@${user} — ${t("insta_follow")} ↗`;
      const posts = (INSTA.posts || []).filter((p) => p && p.image).slice(0, 6);
      document.getElementById("insta-grid").innerHTML = posts.length
        ? posts.map((p) => `
          <a class="insta-cell reveal" href="${esc(p.url || `https://instagram.com/${user}`)}" target="_blank" rel="noopener">
            <img src="${esc(p.image)}" alt="${esc(p.legende || "Instagram")}" loading="lazy" decoding="async">
            ${p.legende ? `<span class="insta-cap">${esc(p.legende)}</span>` : ""}
          </a>`).join("")
        : `<a class="insta-empty reveal" href="https://instagram.com/${user}" target="_blank" rel="noopener">
             <span>📷</span> @${user} — ${t("insta_follow")} ↗
           </a>`;
      observeReveals();
    }
  }

  function pageIdees() {
    const form = document.getElementById("idees-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = new FormData(form);
      try {
        const r = await fetch("/api/idees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: d.get("name"), email: d.get("email"), message: d.get("message") })
        });
        if (!r.ok) throw new Error();
        form.reset();
        document.getElementById("idees-msg").textContent = t("idees_ok");
        toast(t("idees_ok"));
      } catch { document.getElementById("idees-msg").textContent = t("news_err"); }
    });
  }

  function pageContact() {
    const form = document.getElementById("contact-form");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const body = `${data.get("message")}\n\n—\n${data.get("name")} · ${data.get("email")}`;
      location.href = `mailto:${ARTIST_EMAIL}?subject=${encodeURIComponent(data.get("subject") || "Message — pascalsun-art")}&body=${encodeURIComponent(body)}`;
    });
  }

  /* ------------------------------------------------------------- init -- */

  /* Catalogue dynamique : les modifications faites dans l'espace admin
     (photos, textes, œuvres) remplacent les données embarquées. */
  async function loadCatalogue() {
    try {
      const r = await fetch("/api/catalogue", { cache: "no-cache" });
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.artworks) && data.artworks.length) ARTWORKS = data.artworks;
      if (Array.isArray(data.events)) EVENTS = data.events;
      if (Array.isArray(data.posts)) POSTS = data.posts;
      if (Array.isArray(data.avis)) AVIS = data.avis;
      if (data.instagram) INSTA = Object.assign({ username: "", posts: [] }, data.instagram);
      if (data.shipping && Array.isArray(data.shipping.zones)) SHIPPING = data.shipping;
      if (Array.isArray(data.atelier) && data.atelier.length) ATELIER = data.atelier;
      if (data.uiTexts) {
        ["fr", "en"].forEach((l) => {
          if (data.uiTexts[l]) I18N[l] = Object.assign({}, I18N[l], data.uiTexts[l]);
        });
      }
    } catch { /* hors ligne ou serveur statique : données embarquées */ }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    // Rendu immédiat (données embarquées) : aucun saut de mise en page,
    // puis rafraîchissement silencieux une fois le catalogue chargé.
    renderHeader();
    renderFooter();
    applyI18n();

    await loadCatalogue();
    if (typeof normalizeArtworks === "function") normalizeArtworks(ARTWORKS);

    renderHeader();
    renderFooter();
    applyI18n();

    switch (document.body.dataset.page) {
      case "home":    pageHome(); homeExtras(); break;
      case "artist":  pageArtist(); break;
      case "journal": pageJournal(); break;
      case "portrait": pagePortrait(); break;
      case "idees":   pageIdees(); break;
      case "gallery": pageGallery(); break;
      case "artwork": pageArtwork(); break;
      case "cart":    pageCart(); break;
      case "contact": pageContact(); break;
      case "expos":   pageExpos(); break;
    }

    observeReveals();
    document.dispatchEvent(new CustomEvent("ps-ready"));
    window.PS_READY = true;

    // PWA : enregistrement du service worker (hors admin)
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  });
})();
