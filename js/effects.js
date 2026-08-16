/* =========================================================================
   Pascal Sun — effets « nouvelle génération »
   Curseur personnalisé, boutons magnétiques, tilt 3D + reflet sur les
   cartes, barre de progression, grain, textes découpés mot à mot.
   Chargé après app.js ; tout est progressif et respecte reduced-motion.
   ========================================================================= */

(function () {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  document.addEventListener("DOMContentLoaded", () => {
    if (reduced) { decouvre(); return; }

    introCurtain();
    mountChrome();
    splitHeroTitle();
    if (finePointer) {
      customCursor();
      magneticButtons();
      tiltCards();
    }
  });

  /* ----------------------------------- rideau d'ouverture (accueil) -- */

  /* Retire le cache posé en tête de page : soit le vrai rideau prend le
     relais, soit il n'y a pas d'intro et la page doit s'afficher. */
  function decouvre() {
    document.documentElement.classList.remove("intro-pending");
  }

  function introCurtain() {
    /* L'invitation a sa propre ouverture (le lagon, dans app.js) : c'est elle
       qui lève le cache, une fois montée. Ici on ne touche à rien. */
    if (document.body.dataset.page === "invitation") return;
    if (document.body.dataset.page !== "home") return decouvre();
    let dejaVu = false;
    try { dejaVu = !!sessionStorage.getItem("ps_intro_seen"); } catch (e) { /* stockage bloqué */ }
    if (dejaVu) return decouvre();
    try { sessionStorage.setItem("ps_intro_seen", "1"); } catch (e) { /* stockage bloqué */ }

    const intro = document.createElement("div");
    intro.className = "intro";
    const name = "Pascal Sun";
    const letters = [...name].map((c, i) =>
      c === " " ? "<span style='width:.5em'></span>"
        : `<span class="${i >= 7 ? "sun" : ""}" style="--i:${i}">${c}</span>`
    ).join("");
    // Un pinceau dessine la scène : horizon, silhouette de Moorea, soleil,
    // puis le lagon et le reflet — comme une toile qui naît sous nos yeux.
    const POLYNESIE = `<svg class="intro-scene-svg" viewBox="0 0 480 235" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="ihalo" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stop-color="#d4593a" stop-opacity=".35"/>
          <stop offset="100%" stop-color="#d4593a" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="ilagon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2f9aa3" stop-opacity=".85"/>
          <stop offset="55%" stop-color="#5cb8b2" stop-opacity=".55"/>
          <stop offset="100%" stop-color="#8fd0c6" stop-opacity=".22"/>
        </linearGradient>
      </defs>
      <!-- lagon : la couleur monte à la fin, comme un lavis -->
      <path class="i-lagon" d="M14 158 H 466 V 226 H 14 Z" fill="url(#ilagon)"/>
      <!-- soleil derrière l'île -->
      <circle class="i-halo" cx="300" cy="128" r="98" fill="url(#ihalo)"/>
      <circle class="i-sun-fill" cx="300" cy="128" r="46" fill="#d4593a"/>
      <circle class="i-sun-stroke" cx="300" cy="128" r="46" fill="none" stroke="#d4593a" stroke-width="3.5" pathLength="1"/>
      <!-- Moorea : le trait d'abord, l'encre ensuite -->
      <path class="i-moorea-fill" d="M120 158 L200 74 L236 118 L268 96 L330 150 L400 122 L462 158 Z" fill="#16130f"/>
      <path class="i-moorea" d="M120 158 L200 74 L236 118 L268 96 L330 150 L400 122 L462 158" fill="none" stroke="#16130f" stroke-width="3.5" stroke-linejoin="round" pathLength="1"/>
      <!-- horizon -->
      <path class="i-horizon" d="M14 158 H 466" stroke="#16130f" stroke-width="3" stroke-linecap="round" pathLength="1" fill="none"/>
      <!-- reflet du soleil -->
      <g stroke="#d4593a" stroke-width="4" stroke-linecap="round" fill="none">
        <path class="i-r" style="--d:2.15s" d="M272 172 h 56" pathLength="1"/>
        <path class="i-r" style="--d:2.3s" d="M284 186 h 34" pathLength="1"/>
        <path class="i-r" style="--d:2.45s" d="M292 200 h 18" pathLength="1"/>
      </g>
      <!-- écume -->
      <g stroke="#f7f3ec" stroke-width="2.5" stroke-linecap="round" fill="none">
        <path class="i-w" style="--d:1.9s" d="M60 176 Q 72 170 84 176 T 108 176" pathLength="1"/>
        <path class="i-w" style="--d:2.05s" d="M150 192 Q 162 186 174 192 T 198 192" pathLength="1"/>
        <path class="i-w" style="--d:2.2s" d="M370 182 Q 382 176 394 182 T 418 182" pathLength="1"/>
        <path class="i-w" style="--d:2.35s" d="M100 210 Q 112 204 124 210 T 148 210" pathLength="1"/>
        <path class="i-w" style="--d:2.5s" d="M330 208 Q 342 202 354 208 T 378 208" pathLength="1"/>
      </g>
      <!-- le pinceau qui dessine -->
      <g class="i-brush">
        <line x1="8" y1="-14" x2="30" y2="-46" stroke="#16130f" stroke-width="5" stroke-linecap="round"/>
        <path d="M-2 4 Q 2 -10 14 -8 Q 10 2 2 6 Z" fill="#16130f"/>
        <circle cx="-1" cy="5" r="3" fill="#d4593a"/>
      </g>
    </svg>`;
    intro.innerHTML = `
      <div class="intro-scene">
        ${POLYNESIE}
        <div class="intro-name" aria-label="Pascal Sun">${letters}</div>
        <div class="intro-tag">Peintre · Tahiti · Polynésie française</div>
      </div>`;
    document.body.appendChild(intro);
    document.body.classList.add("intro-lock");
    decouvre();   // le rideau animé remplace le cache initial, sans transition

    setTimeout(() => {
      intro.classList.add("done");
      document.body.classList.remove("intro-lock");
      setTimeout(() => intro.remove(), 1300);
    }, 3600);
  }

  /* ------------------------------------------- progrès + grain -- */

  function mountChrome() {
    const bar = document.createElement("div");
    bar.className = "scroll-progress";
    document.body.appendChild(bar);

    const grain = document.createElement("div");
    grain.className = "grain";
    grain.setAttribute("aria-hidden", "true");
    document.body.appendChild(grain);

    let ticking = false;
    function update() {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
      ticking = false;
    }
    addEventListener("scroll", () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* --------------------------------------- titre découpé mot à mot -- */

  function splitHeroTitle() {
    const el = document.querySelector(".hero h1, .page-head .section-title");
    if (!el) return;

    let index = 0;
    function splitNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        node.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(" ")); return; }
          const w = document.createElement("span");
          w.className = "w";
          const wi = document.createElement("span");
          wi.className = "wi";
          wi.style.setProperty("--i", index++);
          wi.textContent = part;
          w.appendChild(wi);
          frag.appendChild(w);
        });
        node.replaceWith(frag);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        [...node.childNodes].forEach(splitNode);
      }
    }
    [...el.childNodes].forEach(splitNode);
    el.classList.add("split-ready");
  }

  /* --------------------------------------------- curseur suiveur -- */

  function customCursor() {
    document.body.classList.add("fx-cursor");
    const dot = document.createElement("div");
    dot.className = "cursor-dot";
    const ring = document.createElement("div");
    ring.className = "cursor-ring";
    document.body.append(dot, ring);

    let mx = innerWidth / 2, my = innerHeight / 2;
    let rx = mx, ry = my;

    addEventListener("mousemove", (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = `translate(${mx}px, ${my}px)`;
      const hover = e.target.closest("a, button, .frame, select, input, textarea, .artwork-visual");
      ring.classList.toggle("is-hover", !!hover);
    }, { passive: true });

    addEventListener("mousedown", () => ring.classList.add("is-down"));
    addEventListener("mouseup", () => ring.classList.remove("is-down"));

    (function follow() {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      ring.style.transform = `translate(${rx}px, ${ry}px)`;
      requestAnimationFrame(follow);
    })();
  }

  /* ------------------------------------------ boutons magnétiques -- */

  function magneticButtons() {
    const STRENGTH = 22;
    document.addEventListener("mousemove", (e) => {
      const btn = e.target.closest(".btn, .cart-btn, .chip");
      document.querySelectorAll(".btn, .cart-btn, .chip").forEach((b) => {
        if (b !== btn) b.style.transform = "";
      });
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      btn.style.transform = `translate(${dx * STRENGTH * 0.4}px, ${dy * STRENGTH * 0.3}px)`;
    }, { passive: true });
  }

  /* ------------------------------------- tilt 3D + reflet cartes -- */

  function tiltCards() {
    const MAX = 7; // degrés
    document.addEventListener("mousemove", (e) => {
      const frame = e.target.closest(".card .frame");
      if (!frame) return;
      const r = frame.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      frame.style.setProperty("--ry", `${(px - 0.5) * MAX * 2}deg`);
      frame.style.setProperty("--rx", `${(0.5 - py) * MAX * 2}deg`);
      frame.style.setProperty("--mx", `${px * 100}%`);
      frame.style.setProperty("--my", `${py * 100}%`);
    }, { passive: true });

    document.addEventListener("mouseout", (e) => {
      const frame = e.target.closest && e.target.closest(".card .frame");
      if (frame && !frame.contains(e.relatedTarget)) {
        frame.style.setProperty("--rx", "0deg");
        frame.style.setProperty("--ry", "0deg");
      }
    }, { passive: true });
  }
})();
