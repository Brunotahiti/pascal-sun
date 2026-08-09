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
    if (reduced) return;

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

  function introCurtain() {
    if (document.body.dataset.page !== "home") return;
    if (sessionStorage.getItem("ps_intro_seen")) return;
    sessionStorage.setItem("ps_intro_seen", "1");

    const intro = document.createElement("div");
    intro.className = "intro";
    const name = "Pascal Sun";
    const letters = [...name].map((c, i) =>
      c === " " ? "<span style='width:.5em'></span>"
        : `<span class="${i >= 7 ? "sun" : ""}" style="--i:${i}">${c}</span>`
    ).join("");
    // Lever de soleil sur Moorea : soleil pur (sans rayons), silhouette de
    // l'île, cocotiers penchés et vague du lagon.
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
      <g class="intro-sunrise">
        <circle cx="300" cy="128" r="98" fill="url(#ihalo)"/>
        <circle cx="300" cy="128" r="46" fill="#d4593a"/>
      </g>
      <!-- silhouette de Moorea -->
      <path d="M120 158 L200 74 L236 118 L268 96 L330 150 L400 122 L462 158 Z" fill="#16130f" opacity=".9"/>
      <!-- cocotiers penchés -->
      <g stroke="#16130f" stroke-linecap="round" fill="none">
        <path d="M60 158 Q 58 110 84 84" stroke-width="5"/>
        <path d="M84 84 q -30 -14 -52 -2 M84 84 q -2 -26 -22 -36 M84 84 q 28 -14 48 -2 M84 84 q 22 -22 16 -42 M84 84 q -8 22 -30 26" stroke-width="3.5"/>
        <path d="M30 158 Q 34 128 22 112" stroke-width="4"/>
        <path d="M22 112 q -18 -8 -30 0 M22 112 q 2 -16 -10 -24 M22 112 q 18 -10 30 -2 M22 112 q 12 -14 8 -26" stroke-width="3"/>
      </g>
      <!-- le lagon -->
      <g class="intro-lagon">
        <path d="M14 158 H 466 V 226 H 14 Z" fill="url(#ilagon)"/>
        <!-- reflet du soleil -->
        <g stroke="#d4593a" stroke-width="4" stroke-linecap="round" opacity=".65">
          <path d="M272 172 h 56"/><path d="M284 186 h 34"/><path d="M292 200 h 18"/>
        </g>
        <!-- écume -->
        <g stroke="#f7f3ec" stroke-width="2.5" stroke-linecap="round" fill="none" opacity=".8">
          <path d="M60 176 Q 72 170 84 176 T 108 176"/>
          <path d="M150 192 Q 162 186 174 192 T 198 192"/>
          <path d="M370 182 Q 382 176 394 182 T 418 182"/>
          <path d="M100 210 Q 112 204 124 210 T 148 210"/>
          <path d="M330 208 Q 342 202 354 208 T 378 208"/>
        </g>
      </g>
      <!-- ligne d'horizon -->
      <path d="M14 158 H 466" stroke="#16130f" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
    intro.innerHTML = `
      <div class="intro-scene">
        ${POLYNESIE}
        <div class="intro-name" aria-label="Pascal Sun">${letters}</div>
        <div class="intro-tag">Peintre · Tahiti · Polynésie française</div>
      </div>`;
    document.body.appendChild(intro);
    document.body.classList.add("intro-lock");

    setTimeout(() => {
      intro.classList.add("done");
      document.body.classList.remove("intro-lock");
      setTimeout(() => intro.remove(), 1300);
    }, 2300);
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
