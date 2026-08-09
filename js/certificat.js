/* =========================================================================
   Certificat d'authenticité — page imprimable / enregistrable en PDF.
   Référence transmise dans l'URL : certificat.html?c=PS-XXXX-0
   ========================================================================= */

(function () {
  "use strict";

  const lang = localStorage.getItem("ps_lang") || "fr";
  const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.fr[k] || k;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const SUN = `<svg viewBox="0 0 100 100" width="54" height="54" aria-hidden="true">
    <circle cx="50" cy="50" r="26" fill="#d4593a"/></svg>`;

  document.addEventListener("DOMContentLoaded", async () => {
    document.documentElement.lang = lang;
    document.getElementById("print-btn").textContent = t("cert_print");
    document.getElementById("print-btn").addEventListener("click", () => window.print());

    const ref = new URLSearchParams(location.search).get("c");
    const sheet = document.getElementById("cert-sheet");
    if (!ref) { sheet.innerHTML = `<p class="cert-loading">Référence manquante.</p>`; return; }

    let d;
    try {
      const r = await fetch("/api/certificat?c=" + encodeURIComponent(ref));
      if (!r.ok) throw new Error();
      d = await r.json();
    } catch {
      sheet.innerHTML = `<p class="cert-loading">Certificat introuvable. Vérifiez le lien reçu par email.</p>`;
      return;
    }

    const typeLabel = d.type === "original" ? t("prod_original") : t("prod_tirage");
    const editionLabel = d.edition ? `${t("cert_edition")} ${d.edition}` : t("cert_unique");
    const dateStr = new Date(d.date).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR",
      { day: "numeric", month: "long", year: "numeric" });

    document.title = `${t("cert_title")} — ${d.titre}`;

    sheet.innerHTML = `
      <div class="cert-frame">
        <header class="cert-head">
          <div class="cert-sun">${SUN}</div>
          <div class="cert-brand">Pascal <span>Sun</span><small>Peintre · Tahiti</small></div>
        </header>

        <h1 class="cert-title">${t("cert_title")}</h1>
        <div class="cert-rule"></div>

        <div class="cert-body">
          ${d.image ? `<figure class="cert-visual"><img src="${esc(d.image)}" alt=""></figure>` : ""}
          <div class="cert-facts">
            <div class="cf"><dt>${t("cert_work")}</dt><dd class="cf-title">${esc(d.titre)}</dd></div>
            <div class="cf"><dt>${t("spec_technique")}</dt><dd>${esc(d.technique)}</dd></div>
            <div class="cf"><dt>${t("spec_dimensions")}</dt><dd>${esc(d.dimensions)}</dd></div>
            <div class="cf"><dt>${t("spec_year")}</dt><dd>${esc(d.annee)}</dd></div>
            <div class="cf"><dt>${typeLabel}</dt><dd>${esc(editionLabel)}</dd></div>
            <div class="cf"><dt>${t("cert_for")}</dt><dd class="cf-buyer">${esc(d.acheteur)}</dd></div>
            <div class="cf"><dt>${t("cert_date")}</dt><dd>${dateStr}</dd></div>
            <div class="cf"><dt>${t("cert_ref")}</dt><dd class="cf-ref">${esc(d.ref)}</dd></div>
          </div>
        </div>

        <p class="cert-text">${t("cert_text")}</p>

        <footer class="cert-foot">
          <div class="cert-signature">
            <span class="sig">Pascal Sun</span>
            <span class="sig-line"></span>
            <small>${t("cert_sign")}</small>
          </div>
          <div class="cert-seal">
            <span>Galerie</span><strong>Pascal Sun</strong><span>pascal-sun.com</span>
          </div>
        </footer>
      </div>`;
  });
})();
