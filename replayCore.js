(function () {
  function parseEvrec(text) {
    var ev = typeof text === "string" ? JSON.parse(text) : text;
    if (!ev || ev.format !== "evrec/1") throw new Error("bad evrec format");
    if (!Array.isArray(ev.ticks)) throw new Error("bad evrec format");
    // Les pellets ne sont écrits qu'aux ticks de changement : index de report
    // (par tick, référence vers le dernier set connu) pour un scrub O(1).
    var last = null, refs = null;
    for (var i = 0; i < ev.ticks.length; i++) {
      if (ev.ticks[i].pellets) { last = ev.ticks[i].pellets; if (!refs) refs = new Array(ev.ticks.length); }
      if (refs) refs[i] = last;
    }
    ev._pelletsRef = refs; // null si le fichier ne contient aucun pellet (evrec 1.0)
    // Héros par tick (evrec 1.4, "/reset <hero>" mid-run) : même report que les pellets.
    var lastHero = (ev.meta && ev.meta.hero) || null, heroRefs = null;
    for (var hi = 0; hi < ev.ticks.length; hi++) {
      if (ev.ticks[hi].hero) { lastHero = ev.ticks[hi].hero; if (!heroRefs) heroRefs = new Array(ev.ticks.length); }
      if (heroRefs) heroRefs[hi] = lastHero;
    }
    ev._heroRef = heroRefs; // null si aucun tick.hero (vieux fichiers) -> meta.hero seul
    return ev;
  }

  function _lerp(a, b, f) { return a + (b - a) * f; }

  function sampleFrame(ev, tickFloat) {
    var n = ev.ticks.length;
    if (n === 0) return { player: null, entities: [] };
    if (tickFloat < 0) tickFloat = 0;
    if (tickFloat > n - 1) tickFloat = n - 1;
    var i = Math.floor(tickFloat);
    var j = i + 1 <= n - 1 ? i + 1 : i;
    var f = i === j ? 0 : tickFloat - i;
    var A = ev.ticks[i], B = ev.ticks[j];
    var player = null;
    if (A.player) {
      player = {
        x: _lerp(A.player.x, B.player.x, f),
        y: _lerp(A.player.y, B.player.y, f),
        vx: A.player.vx, vy: A.player.vy,
        mouse: A.player.mouse, alive: A.player.alive
      };
      if (A.player.stats) player.stats = A.player.stats;
      if (A.player.st) player.st = A.player.st; // états joueur (evrec 1.6 ; absent = aucun actif)
      // Radius joueur (evrec 1.6.3, tuiles) : lerpé — Enlarging aura, Brute Vigor...
      if (A.player.r != null) {
        player.r = (B.player && B.player.r != null) ? _lerp(A.player.r, B.player.r, f) : A.player.r;
      }
      if (A.player.aura) player.aura = A.player.aura; // {t, r} — aura de pouvoir du héros
      // Down/death timer (ms) : décompte lerpé si présent aux deux ticks
      if (A.player.dt != null) {
        player.dt = (B.player && B.player.dt != null) ? _lerp(A.player.dt, B.player.dt, f) : A.player.dt;
        player.dtt = A.player.dtt || 0;
      }
    }
    // Appariement A->B par id serveur (evrec 1.3, champ i) : le churn AOI réordonne
    // le tableau entre ticks, l'index seul lerpe alors deux ennemis différents.
    var bById = null;
    if (B !== A) {
      for (var bi = 0; bi < B.entities.length; bi++) {
        var be = B.entities[bi];
        if (be && be.i != null) { if (!bById) bById = {}; bById[be.i] = be; }
      }
    }
    var entities = [];
    for (var k = 0; k < A.entities.length; k++) {
      var ea = A.entities[k];
      var eb = (ea.i != null && bById) ? (bById[ea.i] || ea)
             : (B.entities[k] && B.entities[k].n === ea.n) ? B.entities[k] : ea;
      var rec = {
        n: ea.n, rawN: ea.rawN,
        x: _lerp(ea.x, eb.x, f),
        y: _lerp(ea.y, eb.y, f),
        r: ea.r, vx: ea.vx, vy: ea.vy
      };
      if (ea.i != null) rec.i = ea.i;
      if (ea.w != null) rec.w = ea.w;
      if (ea.h != null) rec.h = ea.h;
      // Aura enregistrée (rayon lerpé : les sizing font varier le rayon d'aura)
      if (ea.a != null) { rec.a = eb.a != null ? _lerp(ea.a, eb.a, f) : ea.a; rec.at = ea.at; }
      // Statut chronométré : temps restant lerpé si même statut au tick suivant
      if (ea.s != null) {
        rec.s = ea.s;
        rec.sl = (eb.s === ea.s && eb.sl != null && ea.sl != null) ? _lerp(ea.sl, eb.sl, f) : ea.sl;
        rec.st = ea.st;
      }
      entities.push(rec);
    }
    var frame = { player: player, entities: entities, area: A.area };
    if (A.o) frame.o = A.o; // origine de l'aire (tuiles) pour re-baser au playback
    frame.pellets = ev._pelletsRef ? (ev._pelletsRef[i] || null) : null;
    // Héros courant du tick ("/reset <hero>") ; fallback meta pour les vieux fichiers
    frame.hero = ev._heroRef ? (ev._heroRef[i] || (ev.meta && ev.meta.hero) || null) : null;
    // Heure murale enregistrée (ms depuis tick 0) : sert à afficher la désync entre
    // l'horloge interne (ticks/tps) et le temps réel de la capture.
    if (A.w != null) frame.wall = (B.w != null) ? _lerp(A.w, B.w, f) : A.w;
    return frame;
  }

  // id (optionnel, evrec 1.3) : suit l'entité par id serveur au lieu de l'index —
  // l'index dérive quand l'AOI ajoute/retire des entités entre ticks.
  function readAhead(ev, entityIndex, tick, count, id) {
    var pts = [];
    for (var t = tick + 1; t <= tick + count && t < ev.ticks.length; t++) {
      var ents = ev.ticks[t].entities, e = null;
      if (id != null) {
        for (var j = 0; j < ents.length; j++) { if (ents[j] && ents[j].i === id) { e = ents[j]; break; } }
      } else {
        e = ents[entityIndex];
      }
      if (!e) break;
      pts.push({ x: e.x, y: e.y });
    }
    return pts;
  }

  var api = { parseEvrec: parseEvrec, sampleFrame: sampleFrame, readAhead: readAhead };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.replayCore = api;
})();
