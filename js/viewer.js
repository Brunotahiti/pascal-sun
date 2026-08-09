/* =========================================================================
   Pascal Sun — visionneuse immersive (fiche œuvre)
   1. Vue 3D : la toile sur châssis, on la tourne pour voir la tranche
      et le dos (CSS 3D, aucune dépendance).
   2. Réalité augmentée : caméra du téléphone + œuvre incrustée,
      déplaçable et redimensionnable (pincer ou curseur).
   3. En situation : salon dessiné à l'échelle (canapé 220 cm) pour
      juger la taille réelle de l'œuvre.
   ========================================================================= */

(function () {
  "use strict";

  if (!document.body || document.body.dataset.page !== "artwork") {
    document.addEventListener("DOMContentLoaded", maybeInit);
  } else {
    document.addEventListener("DOMContentLoaded", maybeInit);
  }

  const T = {
    fr: {
      view3d: "Vue 3D — voir de côté",
      viewAR: "Voir chez moi (AR)",
      viewRoom: "Voir en situation",
      tab3d: "Vue 3D",
      tabAR: "Chez moi (AR)",
      tabRoom: "En situation",
      in3d: "Faites glisser pour tourner la toile — tranche et dos du châssis compris.",
      face: "Face", profil: "Profil", dos: "Dos",
      arHint: "Déplacez l'œuvre du doigt · pincez ou utilisez le curseur pour l'échelle",
      arSize: "Taille",
      arErrTitle: "Caméra indisponible",
      arErrText: "Votre navigateur a refusé l'accès à la caméra (ou il n'y en a pas). Essayez sur votre téléphone, ou visualisez l'œuvre en situation dans un salon.",
      arErrBtn: "Voir en situation",
      roomHint: "Échelle réelle : le canapé mesure 220 cm — l'œuvre fait",
      close: "Fermer"
    },
    en: {
      view3d: "3D view — see the side",
      viewAR: "View in my home (AR)",
      viewRoom: "View in a room",
      tab3d: "3D view",
      tabAR: "My home (AR)",
      tabRoom: "In a room",
      in3d: "Drag to rotate the canvas — edges and stretcher back included.",
      face: "Front", profil: "Side", dos: "Back",
      arHint: "Drag the artwork · pinch or use the slider to scale",
      arSize: "Size",
      arErrTitle: "Camera unavailable",
      arErrText: "Your browser denied camera access (or there is none). Try on your phone, or view the artwork in a room instead.",
      arErrBtn: "View in a room",
      roomHint: "True scale: the sofa is 220 cm wide — the artwork is",
      close: "Close"
    }
  };

  let art, dims, tr, modal, stream = null;

  function maybeInit() {
    if (document.body.dataset.page !== "artwork") return;
    if (typeof ARTWORKS === "undefined") return;

    const lang = localStorage.getItem("ps_lang") || "fr";
    tr = T[lang] || T.fr;

    const id = new URLSearchParams(location.search).get("id");
    art = ARTWORKS.find((a) => a.id === id) || ARTWORKS[0];
    dims = parseDims(art.dimensions);

    injectLaunchButtons();
    buildModal();
  }

  function parseDims(str) {
    const m = String(str).match(/(\d+)\s*[×x]\s*(\d+)/);
    return m ? { w: +m[1], h: +m[2] } : { w: 80, h: 60 };
  }

  /* -------------------------------------------------- boutons fiche -- */

  function injectLaunchButtons() {
    const info = document.getElementById("artwork-info");
    if (!info) return;
    const row = document.createElement("div");
    row.className = "viewer-launch";
    row.innerHTML = `
      <button data-open="v3d"><span class="ico">◇</span>${tr.view3d}</button>
      <button data-open="ar"><span class="ico">◉</span>${tr.viewAR}</button>
      <button data-open="room"><span class="ico">⌂</span>${tr.viewRoom}</button>`;
    const anchor = info.querySelector(".btn-row");
    if (anchor) anchor.after(row); else info.appendChild(row);
    row.addEventListener("click", (e) => {
      const b = e.target.closest("[data-open]");
      if (b) openModal(b.dataset.open);
    });
  }

  /* --------------------------------------------------------- modal -- */

  function buildModal() {
    modal = document.createElement("div");
    modal.className = "viewer-modal";
    modal.innerHTML = `
      <div class="viewer-top">
        <h2>${escapeHtml(art.titre)} <span>— ${art.dimensions}</span></h2>
        <button class="viewer-close" aria-label="${tr.close}">✕</button>
      </div>
      <div class="viewer-tabs">
        <button class="viewer-tab" data-tab="v3d">${tr.tab3d}</button>
        <button class="viewer-tab" data-tab="ar">${tr.tabAR}</button>
        <button class="viewer-tab" data-tab="room">${tr.tabRoom}</button>
      </div>
      <div class="viewer-stage">
        <div class="viewer-pane" data-pane="v3d"></div>
        <div class="viewer-pane" data-pane="ar"></div>
        <div class="viewer-pane" data-pane="room"></div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector(".viewer-close").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
    modal.querySelector(".viewer-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (b) activate(b.dataset.tab);
    });
  }

  function openModal(tab) {
    modal.classList.add("open");
    document.documentElement.style.overflow = "hidden";
    activate(tab);
  }

  function closeModal() {
    modal.classList.remove("open");
    document.documentElement.style.overflow = "";
    stopCamera();
  }

  function activate(tab) {
    modal.querySelectorAll(".viewer-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    modal.querySelectorAll(".viewer-pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === tab));
    if (tab !== "ar") stopCamera();
    const pane = modal.querySelector(`[data-pane="${tab}"]`);
    if (tab === "v3d" && !pane.dataset.ready) build3D(pane);
    if (tab === "room" && !pane.dataset.ready) buildRoom(pane);
    if (tab === "ar") buildAR(pane);
  }

  /* -------------------------------------------------------- vue 3D -- */

  function build3D(pane) {
    pane.dataset.ready = "1";
    const maxPx = Math.min(innerHeight * 0.52, innerWidth * 0.6, 460);
    const scale = maxPx / Math.max(dims.w, dims.h);
    const W = dims.w * scale, H = dims.h * scale, D = Math.max(10, 4 * scale);

    pane.innerHTML = `
      <div class="v3d-presets">
        <button data-rot="0,0">${tr.face}</button>
        <button data-rot="0,-78">${tr.profil}</button>
        <button data-rot="0,180">${tr.dos}</button>
      </div>
      <div class="v3d-scene" style="width:${W}px;height:${H}px">
        <div class="canvas3d" style="width:${W}px;height:${H}px">
          <div class="face front" style="width:${W}px;height:${H}px;transform:translateZ(${D / 2}px);background-image:url('${art.image}');background-size:cover;background-position:center"></div>
          <div class="face back" style="width:${W}px;height:${H}px;transform:rotateY(180deg) translateZ(${D / 2}px)"></div>
          <div class="face edge" style="width:${D}px;height:${H}px;left:${W - D / 2}px;transform:translateX(-50%) rotateY(90deg);background-image:url('${art.image}');background-size:${W}px ${H}px;background-position:right center"></div>
          <div class="face edge" style="width:${D}px;height:${H}px;left:${-D / 2}px;transform:translateX(50%) rotateY(-90deg);background-image:url('${art.image}');background-size:${W}px ${H}px;background-position:left center"></div>
          <div class="face edge" style="width:${W}px;height:${D}px;top:${-D / 2}px;transform:translateY(50%) rotateX(90deg);background-image:url('${art.image}');background-size:${W}px ${H}px;background-position:center top"></div>
          <div class="face edge" style="width:${W}px;height:${D}px;top:${H - D / 2}px;transform:translateY(-50%) rotateX(-90deg);background-image:url('${art.image}');background-size:${W}px ${H}px;background-position:center bottom"></div>
        </div>
      </div>
      <div class="viewer-hint">${tr.in3d}</div>`;

    const scene = pane.querySelector(".v3d-scene");
    const box = pane.querySelector(".canvas3d");
    let rx = -6, ry = 22, dragging = false, px = 0, py = 0, idle = null;

    function apply() { box.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`; }
    apply();

    let auto = setInterval(() => { if (!dragging) { ry += 0.25; apply(); } }, 40);

    scene.addEventListener("pointerdown", (e) => {
      dragging = true; px = e.clientX; py = e.clientY;
      scene.setPointerCapture(e.pointerId);
      clearInterval(auto); clearTimeout(idle);
    });
    scene.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      ry += (e.clientX - px) * 0.45;
      rx = Math.max(-80, Math.min(80, rx - (e.clientY - py) * 0.35));
      px = e.clientX; py = e.clientY;
      apply();
    });
    scene.addEventListener("pointerup", () => {
      dragging = false;
      idle = setTimeout(() => { auto = setInterval(() => { if (!dragging) { ry += 0.25; apply(); } }, 40); }, 3500);
    });

    pane.querySelector(".v3d-presets").addEventListener("click", (e) => {
      const b = e.target.closest("[data-rot]");
      if (!b) return;
      const [x, y] = b.dataset.rot.split(",").map(Number);
      rx = x; ry = y; apply();
      clearInterval(auto); clearTimeout(idle);
      idle = setTimeout(() => { auto = setInterval(() => { if (!dragging) { ry += 0.25; apply(); } }, 40); }, 4000);
    });
  }

  /* ------------------------------------------------------------- AR -- */

  function buildAR(pane) {
    if (pane.dataset.live === "1") return;
    pane.innerHTML = "";

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return arFallback(pane);
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s;
        pane.dataset.live = "1";
        const video = document.createElement("video");
        video.className = "ar-video";
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.srcObject = s;
        pane.appendChild(video);

        const ratio = dims.h / dims.w;
        let w = Math.min(innerWidth * 0.45, 320);
        let x = innerWidth / 2 - w / 2;
        let y = innerHeight * 0.32;

        const el = document.createElement("div");
        el.className = "ar-art";
        el.innerHTML = `<img src="${art.image}" alt="">`;
        pane.appendChild(el);

        function apply() {
          el.style.width = w + "px";
          el.style.height = w * ratio + "px";
          el.style.left = x + "px";
          el.style.top = y + "px";
        }
        apply();

        const pointers = new Map();
        let startDist = 0, startW = w;

        el.addEventListener("pointerdown", (e) => {
          el.setPointerCapture(e.pointerId);
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            startDist = Math.hypot(a.x - b.x, a.y - b.y);
            startW = w;
          }
        });
        el.addEventListener("pointermove", (e) => {
          if (!pointers.has(e.pointerId)) return;
          const prev = pointers.get(e.pointerId);
          if (pointers.size === 1) {
            x += e.clientX - prev.x;
            y += e.clientY - prev.y;
          }
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (startDist > 0) w = Math.max(90, Math.min(innerWidth * 0.92, startW * (d / startDist)));
          }
          apply();
          slider.value = w;
        });
        function release(e) { pointers.delete(e.pointerId); }
        el.addEventListener("pointerup", release);
        el.addEventListener("pointercancel", release);

        const controls = document.createElement("div");
        controls.className = "ar-controls";
        controls.innerHTML = `
          <label>${tr.arSize}</label>
          <input type="range" min="90" max="${Math.round(innerWidth * 0.92)}" value="${Math.round(w)}">`;
        pane.appendChild(controls);
        const slider = controls.querySelector("input");
        slider.addEventListener("input", () => { w = +slider.value; apply(); });

        const hint = document.createElement("div");
        hint.className = "viewer-hint";
        hint.textContent = `${tr.arHint} · ${art.dimensions}`;
        pane.appendChild(hint);
      })
      .catch(() => arFallback(pane));
  }

  function arFallback(pane) {
    pane.innerHTML = `
      <div class="ar-fallback">
        <h3>${tr.arErrTitle}</h3>
        <p>${tr.arErrText}</p>
        <button class="btn-light" data-goroom>⌂ ${tr.arErrBtn}</button>
      </div>`;
    pane.querySelector("[data-goroom]").addEventListener("click", () => activate("room"));
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      const pane = modal.querySelector('[data-pane="ar"]');
      if (pane) { pane.dataset.live = ""; pane.innerHTML = ""; }
    }
  }

  /* ----------------------------------------------------- salon réel -- */

  function buildRoom(pane) {
    pane.dataset.ready = "1";

    // Le canapé fait 220 cm pour 380 unités SVG → échelle réelle.
    const SOFA_CM = 220, SOFA_U = 380;
    const pxPerCm = SOFA_U / SOFA_CM;
    const wU = dims.w * pxPerCm;
    const hU = dims.h * pxPerCm;
    const cx = 500, wallY = 262; // centre du mur au-dessus du canapé

    pane.innerHTML = `
      <div class="room-wrap">
        <svg viewBox="0 0 1000 620" xmlns="http://www.w3.org/2000/svg">
          <rect width="1000" height="620" fill="#efe9de"/>
          <rect y="470" width="1000" height="150" fill="#e2d9c9"/>
          <line x1="0" y1="470" x2="1000" y2="470" stroke="#c9bfae" stroke-width="3"/>
          <!-- canapé 220 cm -->
          <g>
            <rect x="${cx - SOFA_U / 2}" y="380" width="${SOFA_U}" height="100" rx="16" fill="#8f8474"/>
            <rect x="${cx - SOFA_U / 2 - 18}" y="350" width="36" height="130" rx="14" fill="#7c7263"/>
            <rect x="${cx + SOFA_U / 2 - 18}" y="350" width="36" height="130" rx="14" fill="#7c7263"/>
            <rect x="${cx - SOFA_U / 2 + 24}" y="352" width="${SOFA_U / 2 - 34}" height="46" rx="12" fill="#a99d8a"/>
            <rect x="${cx + 10}" y="352" width="${SOFA_U / 2 - 34}" height="46" rx="12" fill="#a99d8a"/>
            <rect x="${cx - SOFA_U / 2 + 6}" y="480" width="14" height="26" fill="#5d554a"/>
            <rect x="${cx + SOFA_U / 2 - 20}" y="480" width="14" height="26" fill="#5d554a"/>
            <rect x="${cx - 60}" y="366" width="52" height="34" rx="8" fill="#d4593a" opacity=".92"/>
          </g>
          <!-- plante -->
          <g stroke="#6f7a5e" stroke-width="6" fill="none" stroke-linecap="round">
            <path d="M868 470 q -6 -90 -34 -130 M 868 470 q 4 -100 30 -140 M 868 470 q -30 -60 -66 -74 M 868 470 q 34 -64 62 -70"/>
          </g>
          <path d="M838 470 h 60 l -8 76 h -44 Z" fill="#b9a98e"/>
          <!-- suspension -->
          <line x1="150" y1="0" x2="150" y2="120" stroke="#8c8478" stroke-width="3"/>
          <path d="M110 120 h 80 l -14 46 h -52 Z" fill="#1a1714" opacity=".85"/>
          <!-- repère d'échelle -->
          <g stroke="#8c8478" stroke-width="2">
            <line x1="${cx - SOFA_U / 2}" y1="560" x2="${cx + SOFA_U / 2}" y2="560"/>
            <line x1="${cx - SOFA_U / 2}" y1="552" x2="${cx - SOFA_U / 2}" y2="568"/>
            <line x1="${cx + SOFA_U / 2}" y1="552" x2="${cx + SOFA_U / 2}" y2="568"/>
          </g>
          <text x="${cx}" y="590" text-anchor="middle" font-family="Manrope, sans-serif" font-size="17" fill="#6d6558">220 cm</text>
        </svg>
        <div class="room-art" data-room-art>
          <img src="${art.image}" alt="${escapeHtml(art.titre)}">
        </div>
      </div>
      <div class="viewer-hint">${tr.roomHint} ${art.dimensions}</div>`;

    // Position de l'œuvre en % du viewBox pour rester responsive.
    const artEl = pane.querySelector("[data-room-art]");
    const left = ((cx - wU / 2) / 1000) * 100;
    const top = ((wallY - hU / 2) / 620) * 100;
    artEl.style.left = left + "%";
    artEl.style.top = top + "%";
    artEl.style.width = (wU / 1000) * 100 + "%";
    artEl.style.height = (hU / 620) * 100 + "%";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
})();
