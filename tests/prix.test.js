/* Le même prix doit s'afficher à l'écran, dans l'email et dans l'admin.
   Trois implémentations de l'arrondi en francs Pacifique coexistent — ce
   test les fait travailler côte à côte sur une gamme de prix. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { RACINE } = require("./_serveur");

const source = (f) => fs.readFileSync(path.join(RACINE, f), "utf8");
/* Découpe le texte d'une fonction : de « function nom( » à l'accolade
   fermante posée à la même indentation que le mot-clé — colonne 0 dans
   server.js, deux espaces dans app.js et admin.js (qui vivent dans une IIFE). */
const extraire = (code, nom) => {
  const m = code.match(new RegExp(`^([ \\t]*)function ${nom}\\(`, "m"));
  assert.ok(m, `fonction ${nom} introuvable`);
  const debut = m.index + m[1].length;
  const fin = code.indexOf(`\n${m[1]}}`, debut);
  assert.ok(fin > debut, `fin de ${nom} introuvable`);
  return code.slice(debut, fin + 1 + m[1].length + 1);
};

test("les trois arrondis en francs disent la même chose", () => {
  const donnees = { localStorage: { getItem: () => null } };
  vm.createContext(donnees);
  vm.runInContext(source("js/data.js"), donnees);
  // un const de premier niveau ne monte pas sur l'objet du contexte : on le relit de l'intérieur
  const CURRENCIES = vm.runInContext("CURRENCIES", donnees);
  const TAUX = CURRENCIES.XPF.rate;

  // site : fmtPrice() dépend de store.currency et CURRENCIES
  const fmtPrice = new Function("CURRENCIES", "store", extraire(source("js/app.js"), "fmtPrice") + "; return fmtPrice;")(CURRENCIES, { currency: "XPF" });
  // admin : francs() dépend de TAUX_XPF
  const francs = new Function("TAUX_XPF", extraire(source("js/admin.js"), "francs") + "; return francs;")(TAUX);
  // serveur : enFrancs() dépend de TAUX_XPF
  const enFrancs = new Function("TAUX_XPF", extraire(source("server.js"), "enFrancs") + "; return enFrancs;")(TAUX);

  const nombre = (s) => Number(String(s).replace(/[^\d]/g, ""));
  const prix = [1, 25, 65, 120, 250, 499, 850, 1000, 1234, 2500, 3100, 3400, 3600, 4000, 6500, 9999, 12000];
  for (const p of prix) {
    const site = nombre(fmtPrice(p)), admin = francs(p), serveur = nombre(enFrancs(p));
    assert.equal(admin, site, `admin ≠ site pour ${p} €`);
    assert.equal(serveur, site, `email ≠ site pour ${p} €`);
    assert.equal(site % 500, 0, `${p} € : arrondi à un palier rond`);
  }
});

test("les paliers d'arrondi sont ceux annoncés : 500 / 1 000 / 5 000 F", () => {
  const TAUX = 119.33;
  const francs = new Function("TAUX_XPF", extraire(source("js/admin.js"), "francs") + "; return francs;")(TAUX);
  assert.equal(francs(100) % 500, 0);        // < 20 000 F
  assert.equal(francs(300) % 1000, 0);       // 20 000 – 100 000 F
  assert.equal(francs(1000) % 5000, 0);      // > 100 000 F
});
