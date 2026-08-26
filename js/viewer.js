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

  /* Attend le rendu du catalogue par app.js (événement ps-ready). */
  if (window.PS_READY) { maybeInit(); }
  else { document.addEventListener("ps-ready", maybeInit); }

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
      arErrHttp: "Les navigateurs n'autorisent la caméra que sur une adresse sécurisée en https. Ouvrez la page depuis https://pascal-sun.com.",
      arErrInApp: "Le navigateur intégré à Instagram ou Facebook n'ouvre pas la caméra. Touchez le menu « ⋯ » en haut de l'écran, puis « Ouvrir dans le navigateur » (Safari ou Chrome).",
      arErrDenied: "L'accès à la caméra a été refusé pour ce site. Autorisez-le dans les réglages du navigateur — sur iPhone : Réglages ▸ Safari ▸ Caméra ▸ Demander ou Autoriser — puis réessayez.",
      arErrNone: "Aucune caméra n'a été trouvée sur cet appareil. Ouvrez la page depuis votre téléphone pour poser l'œuvre sur votre mur.",
      arErrBusy: "La caméra est déjà utilisée par une autre application. Fermez-la, puis réessayez.",
      arErrRetry: "Réessayer",
      arErrBtn: "Voir en situation",
      roomHint: "Faites glisser le tableau pour le placer · canapé 220 cm — l'œuvre fait",
      arShot: "Prendre une photo",
      arShotErr: "La photo n'a pas pu être prise. Réessayez dans un instant.",
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
      arErrHttp: "Browsers only allow the camera over a secure https address. Please open the page from https://pascal-sun.com.",
      arErrInApp: "Instagram's and Facebook's built-in browsers cannot open the camera. Tap the “⋯” menu at the top of the screen, then “Open in browser” (Safari or Chrome).",
      arErrDenied: "Camera access was denied for this site. Allow it in your browser settings — on iPhone: Settings ▸ Safari ▸ Camera ▸ Ask or Allow — then try again.",
      arErrNone: "No camera was found on this device. Open the page on your phone to hang the artwork on your own wall.",
      arErrBusy: "The camera is already in use by another app. Close it, then try again.",
      arErrRetry: "Try again",
      arErrBtn: "View in a room",
      roomHint: "Drag the artwork to place it · sofa 220 cm — the artwork is",
      arShot: "Take a photo",
      arShotErr: "The photo could not be taken. Please try again in a moment.",
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
    art = Object.assign({}, art, { imageHD: (art.images && art.images.large) || art.image });
    dims = parseDims(art.dimensions, art.orientation);

    injectLaunchButtons();
    buildModal();
    /* La photo est l'œuvre : c'est elle qui donne le rapport de la toile.
       Les dimensions saisies servent à l'échelle (taille apparente au mur),
       mais si leur rapport ne colle pas à celui de la photo — orientation
       oubliée, hauteur et largeur inversées — la toile serait rognée ou
       étirée. On recale donc les proportions sur l'image dès qu'elle est
       mesurée, en gardant sa plus grande dimension en centimètres. */
    mesurerImage();
  }

  function parseDims(str, orientation) {
    const m = String(str).match(/(\d+)\s*[×x]\s*(\d+)/);
    if (!m) return { w: 80, h: 60 };
    let w = +m[1], h = +m[2];
    // Convention artistique : hauteur × largeur. On aligne sur l'orientation
    // de la photo pour que la toile 3D soit dans le bon sens.
    if (orientation === "portrait" && w > h) [w, h] = [h, w];
    if (orientation === "landscape" && h > w) [w, h] = [h, w];
    return { w, h };
  }

  /* Recale dims sur le rapport réel de la photo (au-delà de 2 % d'écart). */
  function mesurerImage() {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const rImage = img.naturalWidth / img.naturalHeight;
      const rDims = dims.w / dims.h;
      if (Math.abs(rImage - rDims) / rDims <= 0.02) return;   // déjà d'accord
      const grand = Math.max(dims.w, dims.h);
      dims = rImage >= 1
        ? { w: grand, h: Math.round(grand / rImage) }
        : { w: Math.round(grand * rImage), h: grand };
      /* si une vue est déjà ouverte, on la redessine avec les bonnes
         proportions plutôt que de la laisser fausse */
      document.querySelectorAll("[data-pane]").forEach((p) => { if (p.dataset.ready) p.dataset.ready = ""; });
      const actif = document.querySelector(".viewer-tab.active");
      if (actif) actif.click();
    };
    img.src = art.imageHD;
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
    // Cadre en bois noir fin : ~0,75 cm à l'échelle, minimum 3 px.
    const F = Math.max(3, 0.75 * scale);
    const W = dims.w * scale + 2 * F, H = dims.h * scale + 2 * F;
    const D = Math.max(12, 4.5 * scale);
    const WOOD = "linear-gradient(135deg,#26201a 0%,#15100c 55%,#1d1712 100%)";

    pane.innerHTML = `
      <div class="v3d-presets">
        <button data-rot="0,0">${tr.face}</button>
        <button data-rot="0,-78">${tr.profil}</button>
        <button data-rot="0,180">${tr.dos}</button>
      </div>
      <div class="v3d-scene" style="width:${W}px;height:${H}px">
        <div class="canvas3d" style="width:${W}px;height:${H}px">
          <div class="face front" style="width:${W}px;height:${H}px;transform:translateZ(${D / 2}px);background:${WOOD}">
            <div class="frame-inner" style="position:absolute;inset:${F}px;background-image:linear-gradient(112deg, rgba(255,255,255,0) 34%, rgba(255,255,255,.16) 44%, rgba(255,255,255,0) 54%), url('${art.imageHD}');background-size:contain;background-repeat:no-repeat;background-position:center;box-shadow:inset 0 0 ${F * 2}px rgba(0,0,0,.3), 0 0 0 1px rgba(247,243,236,.18)"></div>
          </div>
          <div class="face back" style="width:${W}px;height:${H}px;transform:rotateY(180deg) translateZ(${D / 2}px)"></div>
          <div class="face edge" style="width:${D}px;height:${H}px;left:${W - D / 2}px;transform:translateX(-50%) rotateY(90deg);background:${WOOD}"></div>
          <div class="face edge" style="width:${D}px;height:${H}px;left:${-D / 2}px;transform:translateX(50%) rotateY(-90deg);background:${WOOD}"></div>
          <div class="face edge" style="width:${W}px;height:${D}px;top:${-D / 2}px;transform:translateY(50%) rotateX(90deg);background:${WOOD}"></div>
          <div class="face edge" style="width:${W}px;height:${D}px;top:${H - D / 2}px;transform:translateY(-50%) rotateX(-90deg);background:${WOOD}"></div>
        </div>
      </div>
      <div class="viewer-hint">${tr.in3d}</div>`;

    const scene = pane.querySelector(".v3d-scene");
    const box = pane.querySelector(".canvas3d");
    /* une vue reconstruite (proportions recalées sur la photo) laissait
       tourner l'ancienne rotation dans le vide : on l'arrête d'abord */
    if (pane._auto) { clearInterval(pane._auto); clearTimeout(pane._idle); }
    let rx = -6, ry = 22, dragging = false, px = 0, py = 0, idle = null;

    function apply() { box.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`; }
    apply();

    let auto = setInterval(() => { if (!dragging) { ry += 0.25; apply(); } }, 40);
    pane._auto = auto;

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
      idle = setTimeout(() => { auto = setInterval(() => { if (!dragging) { ry += 0.25; apply(); } }, 40); pane._auto = auto; }, 3500);
      pane._idle = idle;
    });

    pane.querySelector(".v3d-presets").addEventListener("click", (e) => {
      const b = e.target.closest("[data-rot]");
      if (!b) return;
      const [x, y] = b.dataset.rot.split(",").map(Number);
      rx = x; ry = y; apply();
      clearInterval(auto); clearTimeout(idle);
      idle = setTimeout(() => { auto = setInterval(() => { if (!dragging) { ry += 0.25; apply(); } }, 40); pane._auto = auto; }, 4000);
      pane._idle = idle;
    });
  }

  /* ------------------------------------------------------------- AR -- */

  function buildAR(pane) {
    if (pane.dataset.live === "1") return;
    pane.innerHTML = "";

    /* Sans https, aucun navigateur n'ouvre la caméra : on le dit clairement
       plutôt que de laisser croire à un refus de l'utilisateur. */
    if (!window.isSecureContext) return arFallback(pane, "https");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return arFallback(pane, estNavigateurIntegre() ? "inapp" : "aucune");
    }

    demandeCamera()
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
        el.innerHTML = `<img src="${art.imageHD}" alt="">`;
        pane.appendChild(el);

        function apply() {
          el.style.width = w + "px";
          el.style.height = w * ratio + "px";
          el.style.left = x + "px";
          el.style.top = y + "px";
          // cadre bois noir 2 cm à l'échelle de l'œuvre
          el.style.borderWidth = Math.max(2, 1.7 * (w / dims.w)) + "px";
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
          <input type="range" min="90" max="${Math.round(innerWidth * 0.92)}" value="${Math.round(w)}">
          <button class="ar-shot" title="${tr.arShot}">\u{1F4F7}</button>`;
        pane.appendChild(controls);
        const slider = controls.querySelector("input");
        slider.addEventListener("input", () => { w = +slider.value; apply(); });

        /* Photo souvenir : la vidéo et l'œuvre sont dessinées sur un canvas,
           puis l'image part dans la feuille de partage (iPhone : « Enregistrer
           dans Photos ») ou, à défaut, en téléchargement. */
        const shot = controls.querySelector(".ar-shot");
        shot.addEventListener("click", () => {
          const vw = video.videoWidth, vh = video.videoHeight;
          const img = el.querySelector("img");
          if (!vw || !img.complete || !img.naturalWidth) return arPhotoRatee(pane);

          let cv;
          try {
            cv = document.createElement("canvas");
            cv.width = vw; cv.height = vh;
            const ctx = cv.getContext("2d");
            const scale = Math.max(pane.clientWidth / vw, pane.clientHeight / vh);
            const offX = (pane.clientWidth - vw * scale) / 2;
            const offY = (pane.clientHeight - vh * scale) / 2;
            ctx.drawImage(video, 0, 0, vw, vh);
            const bw = parseFloat(getComputedStyle(el).borderWidth) || 0;
            const X = (x - offX) / scale, Y = (y - offY) / scale;
            const Wp = w / scale, Hp = (w * ratio) / scale, B = bw / scale;
            ctx.fillStyle = "#17120e";
            ctx.fillRect(X, Y, Wp, Hp);
            ctx.drawImage(img, X + B, Y + B, Math.max(1, Wp - 2 * B), Math.max(1, Hp - 2 * B));
            ctx.font = Math.round(vh * 0.022) + "px Manrope, sans-serif";
            ctx.fillStyle = "rgba(255,255,255,.9)";
            ctx.fillText("pascal-sun.com", vw * 0.03, vh - vh * 0.03);
          } catch { return arPhotoRatee(pane); }

          const nom = "pascal-sun-" + art.id + ".jpg";
          cv.toBlob((blob) => {
            if (!blob) return arPhotoRatee(pane);
            const fichier = new File([blob], nom, { type: "image/jpeg" });

            /* iPhone : le téléchargement d'un lien ne mène nulle part, c'est la
               feuille de partage qui permet d'enregistrer dans Photos. */
            if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
              navigator.share({ files: [fichier], title: art.titre })
                .catch(() => { /* partage annulé par le visiteur */ });
              return;
            }

            /* Ailleurs : téléchargement classique. Le lien doit être dans la
               page, sinon Safari ignore le clic. */
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = nom;
            a.rel = "noopener";
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
          }, "image/jpeg", 0.92);
        });

        const hint = document.createElement("div");
        hint.className = "viewer-hint";
        hint.textContent = `${tr.arHint} · ${art.dimensions}`;
        pane.appendChild(hint);
      })
      .catch((err) => arFallback(pane, causeCamera(err)));
  }

  /* Caméra arrière si l'appareil en a une, sinon n'importe laquelle :
     sur un ordinateur portable, exiger « environment » fait tout échouer. */
  function demandeCamera() {
    const gum = (c) => navigator.mediaDevices.getUserMedia(c);
    return gum({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .catch((err) => {
        if (err && (err.name === "OverconstrainedError" || err.name === "NotFoundError")) {
          return gum({ video: true, audio: false });
        }
        throw err;
      });
  }

  /* Navigateurs intégrés à Instagram, Facebook, LinkedIn… : ils bloquent la
     caméra sans jamais poser la question. Beaucoup de visiteurs arrivent
     par un lien Instagram, c'est la panne la plus fréquente. */
  function estNavigateurIntegre() {
    return /Instagram|FBAN|FBAV|FB_IAB|LinkedInApp|Line\/|MicroMessenger|Snapchat/i
      .test(navigator.userAgent);
  }

  function causeCamera(err) {
    const nom = (err && err.name) || "";
    if (nom === "NotFoundError" || nom === "OverconstrainedError" || nom === "DevicesNotFoundError") return "aucune";
    if (nom === "NotReadableError" || nom === "TrackStartError" || nom === "AbortError") return "occupee";
    if (estNavigateurIntegre()) return "inapp";
    if (nom === "NotAllowedError" || nom === "SecurityError" || nom === "PermissionDeniedError") return "refus";
    return "";
  }

  /* La prise de vue a échoué : le dire, plutôt que de ne rien faire. */
  function arPhotoRatee(pane) {
    let msg = pane.querySelector(".ar-shot-error");
    if (!msg) {
      msg = document.createElement("div");
      msg.className = "ar-shot-error";
      pane.appendChild(msg);
    }
    msg.textContent = tr.arShotErr;
    msg.classList.add("show");
    clearTimeout(msg.dataset.t);
    msg.dataset.t = setTimeout(() => msg.classList.remove("show"), 4000);
  }

  function arFallback(pane, cause) {
    const texte = {
      https: tr.arErrHttp,
      inapp: tr.arErrInApp,
      refus: tr.arErrDenied,
      aucune: tr.arErrNone,
      occupee: tr.arErrBusy
    }[cause] || tr.arErrText;

    /* Réessayer n'a de sens que si la situation peut changer sans quitter
       la page : autorisation à redonner, ou caméra à libérer. */
    const rejouable = cause === "refus" || cause === "occupee";

    pane.dataset.live = "";
    pane.innerHTML = `
      <div class="ar-fallback">
        <h3>${tr.arErrTitle}</h3>
        <p>${texte}</p>
        <div class="ar-fallback-btns">
          ${rejouable ? `<button class="btn-light" data-retry>↺ ${tr.arErrRetry}</button>` : ""}
          <button class="btn-light" data-goroom>⌂ ${tr.arErrBtn}</button>
        </div>
      </div>`;
    pane.querySelector("[data-goroom]").addEventListener("click", () => activate("room"));
    const retry = pane.querySelector("[data-retry]");
    if (retry) retry.addEventListener("click", () => buildAR(pane));
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
          <img src="${art.imageHD}" alt="${escapeHtml(art.titre)}">
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

    // cadre bois noir 2 cm à l'échelle du salon
    const wrap = pane.querySelector(".room-wrap");
    function setFrame() {
      artEl.style.borderWidth = Math.max(2, wrap.clientWidth * (2 * pxPerCm / 1000)) + "px";
    }
    setFrame();
    addEventListener("resize", setFrame);

    /* L'œuvre se déplace librement sur le mur (souris ou doigt). */
    artEl.classList.add("movable");
    let drag = null;
    artEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      artEl.setPointerCapture(e.pointerId);
      const r = wrap.getBoundingClientRect();
      drag = {
        dx: e.clientX - (r.left + (parseFloat(artEl.style.left) / 100) * r.width),
        dy: e.clientY - (r.top + (parseFloat(artEl.style.top) / 100) * r.height)
      };
      artEl.classList.add("grabbing");
    });
    artEl.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = wrap.getBoundingClientRect();
      const lw = (artEl.offsetWidth / r.width) * 100;
      const lh = (artEl.offsetHeight / r.height) * 100;
      let nl = ((e.clientX - drag.dx - r.left) / r.width) * 100;
      let nt = ((e.clientY - drag.dy - r.top) / r.height) * 100;
      nl = Math.max(0, Math.min(nl, 100 - lw));
      nt = Math.max(0, Math.min(nt, 100 - lh));
      artEl.style.left = nl + "%";
      artEl.style.top = nt + "%";
    });
    const stop = () => { drag = null; artEl.classList.remove("grabbing"); };
    artEl.addEventListener("pointerup", stop);
    artEl.addEventListener("pointercancel", stop);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
})();
