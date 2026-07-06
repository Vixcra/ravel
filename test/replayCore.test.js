const assert = require("assert");
const fs = require("fs");
const path = require("path");
const RC = require("../replayCore.js");

const text = fs.readFileSync(path.join(__dirname, "fixture.evrec.json"), "utf8");

// parse: bon format
(function () {
  var ev = RC.parseEvrec(text);
  assert.strictEqual(ev.format, "evrec/1");
  assert.strictEqual(ev.ticks.length, 3);
  console.log("replayCore: parse OK");
})();

// parse: mauvais format rejeté
(function () {
  assert.throws(function () { RC.parseEvrec('{"format":"nope"}'); }, /bad evrec format/);
  console.log("replayCore: bad format rejected OK");
})();

// sampleFrame: mi-tick = moyenne des deux positions
(function () {
  var ev = RC.parseEvrec(text);
  var f = RC.sampleFrame(ev, 0.5);
  assert.strictEqual(f.player.x, 105);          // (100+110)/2
  assert.strictEqual(f.entities[1].x, 205);     // normal: (200+210)/2
  assert.strictEqual(f.entities[0].x, 500);     // wall immobile
  console.log("replayCore: sampleFrame interpolation OK");
})();

// sampleFrame: clamp hors bornes
(function () {
  var ev = RC.parseEvrec(text);
  assert.strictEqual(RC.sampleFrame(ev, -5).player.x, 100);
  assert.strictEqual(RC.sampleFrame(ev, 99).player.x, 120);
  console.log("replayCore: sampleFrame clamp OK");
})();

// sampleFrame: clamp fractionnaire hors bornes (négatif non-entier) = premier tick exact
(function () {
  var ev = RC.parseEvrec(text);
  assert.strictEqual(RC.sampleFrame(ev, -0.5).player.x, 100); // pas d'interpolation vers tick 1
  assert.strictEqual(RC.sampleFrame(ev, 2.5).player.x, 120);  // au-delà du dernier = dernier tick
  console.log("replayCore: sampleFrame clamp fractionnaire OK");
})();

// readAhead: positions futures de l'ennemi (index 1) sur 2 ticks
(function () {
  var ev = RC.parseEvrec(text);
  var pts = RC.readAhead(ev, 1, 0, 2);
  assert.deepStrictEqual(pts, [ { x: 210, y: 200 }, { x: 220, y: 200 } ]);
  console.log("replayCore: readAhead OK");
})();

// sampleFrame: propage l'origine o, les stats joueur et w/h des murs (evrec 1.1)
(function () {
  var ev = RC.parseEvrec(JSON.stringify({
    format: "evrec/1", meta: { tps: 60 },
    ticks: [
      { t: 0, area: "a:0", o: [10, -62.5],
        player: { x: 100, y: 50, vx: 0, vy: 0, mouse: [0, 0], alive: true, stats: { level: 2, energy: 20 } },
        entities: [ { n: "wall", rawN: "WALL", x: 8.5, y: 15, r: null, w: 2, h: 40 } ] },
      { t: 1, area: "a:0", o: [10, -62.5],
        player: { x: 102, y: 50, vx: 0, vy: 0, mouse: [0, 0], alive: true, stats: { level: 2, energy: 21 } },
        entities: [ { n: "wall", rawN: "WALL", x: 8.5, y: 15, r: null, w: 2, h: 40 } ] }
    ]
  }));
  var f = RC.sampleFrame(ev, 0.5);
  assert.deepStrictEqual(f.o, [10, -62.5]);
  assert.strictEqual(f.player.stats.level, 2);
  assert.strictEqual(f.entities[0].w, 2);
  assert.strictEqual(f.entities[0].h, 40);
  assert.strictEqual(f.entities[0].r, null);
  // ancien format sans o/stats: pas de crash
  var old = RC.sampleFrame(RC.parseEvrec(text), 0);
  assert.strictEqual(old.o, undefined);
  console.log("replayCore: origin+stats+wh OK");
})();

// pellets: ecrits seulement aux ticks de changement -> sampleFrame reporte le dernier set connu
(function () {
  var ev = RC.parseEvrec(JSON.stringify({
    format: "evrec/1", meta: { tps: 60 },
    ticks: [
      { t: 0, area: "a:0", player: null, entities: [], pellets: [ { x: 1, y: 2, r: 0.25 } ] },
      { t: 1, area: "a:0", player: null, entities: [] },
      { t: 2, area: "a:0", player: null, entities: [], pellets: [ { x: 9, y: 9, r: 0.25 } ] },
      { t: 3, area: "a:0", player: null, entities: [] }
    ]
  }));
  assert.strictEqual(RC.sampleFrame(ev, 0).pellets[0].x, 1);
  assert.strictEqual(RC.sampleFrame(ev, 1.5).pellets[0].x, 1);   // report du tick 0
  assert.strictEqual(RC.sampleFrame(ev, 3).pellets[0].x, 9);     // report du tick 2
  // ancien format sans pellets: null
  assert.strictEqual(RC.sampleFrame(RC.parseEvrec(text), 0).pellets, null);
  console.log("replayCore: pellets carry-forward OK");
})();

// sampleFrame: propage rawN (identification des items/projectiles au rendu)
(function () {
  var ev = RC.parseEvrec(JSON.stringify({
    format: "evrec/1", meta: { tps: 60 },
    ticks: [ { t: 0, area: "a:0", player: null,
               entities: [ { n: "unknown", rawN: "SWEET_TOOTH_ITEM", x: 1, y: 2, r: 0.4 } ] } ]
  }));
  assert.strictEqual(RC.sampleFrame(ev, 0).entities[0].rawN, "SWEET_TOOTH_ITEM");
  console.log("replayCore: rawN passthrough OK");
})();

// auras (evrec 1.2) : rayon d'aura ennemi lerpé, type propagé, aura joueur passthrough
(function () {
  var ev = RC.parseEvrec(JSON.stringify({
    format: "evrec/1", meta: { tps: 60 },
    ticks: [
      { t: 0, area: "a:0",
        player: { x: 0, y: 0, vx: 0, vy: 0, mouse: [0, 0], alive: true, aura: { t: 13, r: 5 } },
        entities: [ { n: "slowing", rawN: "SLOWING_ENEMY", x: 1, y: 1, r: 0.5, a: 4, at: 48 } ] },
      { t: 1, area: "a:0",
        player: { x: 2, y: 0, vx: 0, vy: 0, mouse: [0, 0], alive: true, aura: { t: 13, r: 5 } },
        entities: [ { n: "slowing", rawN: "SLOWING_ENEMY", x: 2, y: 1, r: 0.5, a: 6, at: 48 } ] }
    ]
  }));
  var f = RC.sampleFrame(ev, 0.5);
  assert.strictEqual(f.entities[0].a, 5);      // (4+6)/2
  assert.strictEqual(f.entities[0].at, 48);
  assert.deepStrictEqual(f.player.aura, { t: 13, r: 5 });
  // ancien format sans auras : rien ne fuit
  var old = RC.sampleFrame(RC.parseEvrec(text), 0);
  assert.strictEqual(old.entities[0].a, undefined);
  assert.strictEqual(old.player.aura, undefined);
  console.log("replayCore: auras OK");
})();

// evrec 1.3 : appariement par id serveur — le churn AOI réordonne le tableau entre
// ticks ; l'index seul lerperait deux ennemis différents
(function () {
  var ev = RC.parseEvrec(JSON.stringify({
    format: "evrec/1", meta: { tps: 60 },
    ticks: [
      { t: 0, area: "a:0", player: null, entities: [
        { n: "normal", rawN: "NORMAL_ENEMY", x: 0,   y: 0, r: 0.5, i: "7" },
        { n: "normal", rawN: "NORMAL_ENEMY", x: 100, y: 0, r: 0.5, i: "9" } ] },
      { t: 1, area: "a:0", player: null, entities: [
        { n: "normal", rawN: "NORMAL_ENEMY", x: 102, y: 0, r: 0.5, i: "9" },  // réordonné !
        { n: "normal", rawN: "NORMAL_ENEMY", x: 2,   y: 0, r: 0.5, i: "7" } ] }
    ]
  }));
  var f = RC.sampleFrame(ev, 0.5);
  assert.strictEqual(f.entities[0].x, 1);    // id 7 : 0->2, PAS 0->102
  assert.strictEqual(f.entities[1].x, 101);  // id 9 : 100->102
  assert.strictEqual(f.entities[0].i, "7");
  // readAhead par id : suit id 7 malgré le réordonnancement
  assert.deepStrictEqual(RC.readAhead(ev, 0, 0, 2, "7"), [ { x: 2, y: 0 } ]);
  // vieux format sans id : comportement index inchangé
  var old = RC.parseEvrec(text);
  assert.deepStrictEqual(RC.readAhead(old, 1, 0, 2), [ { x: 210, y: 200 }, { x: 220, y: 200 } ]);
  console.log("replayCore: id matching + readAhead OK");
})();

// statut chronométré : s/st propagés, sl lerpé si même statut, cooldowns dans stats
(function () {
  var ev = RC.parseEvrec(JSON.stringify({
    format: "evrec/1", meta: { tps: 60 },
    ticks: [
      { t: 0, area: "a:0",
        player: { x: 0, y: 0, vx: 0, vy: 0, mouse: [0, 0], alive: true,
                  stats: { level: 1, energy: 10, ab1cd: 500, ab1tcd: 3000 } },
        entities: [ { n: "normal", rawN: "NORMAL_ENEMY", x: 0, y: 0, r: 0.5, i: "1", s: 2, sl: 1000, st: 4000 } ] },
      { t: 1, area: "a:0",
        player: { x: 0, y: 0, vx: 0, vy: 0, mouse: [0, 0], alive: true,
                  stats: { level: 1, energy: 10, ab1cd: 480, ab1tcd: 3000 } },
        entities: [ { n: "normal", rawN: "NORMAL_ENEMY", x: 0, y: 0, r: 0.5, i: "1", s: 2, sl: 900, st: 4000 } ] }
    ]
  }));
  var f = RC.sampleFrame(ev, 0.5);
  assert.strictEqual(f.entities[0].s, 2);
  assert.strictEqual(f.entities[0].sl, 950);   // lerp 1000->900
  assert.strictEqual(f.entities[0].st, 4000);
  assert.strictEqual(f.player.stats.ab1cd, 500); // stats passthrough (tick A)
  console.log("replayCore: statuts + cooldowns OK");
})();

// evrec 1.4 : héros par tick ("/reset <hero>") reporté comme les pellets + death timer lerpé
(function () {
  var ev = RC.parseEvrec(JSON.stringify({
    format: "evrec/1", meta: { tps: 60, hero: "Brute" },
    ticks: [
      { t: 0, area: "a:0", hero: "Brute",
        player: { x: 0, y: 0, vx: 0, vy: 0, mouse: [0, 0], alive: true }, entities: [] },
      { t: 1, area: "a:0",
        player: { x: 0, y: 0, vx: 0, vy: 0, mouse: [0, 0], alive: true, dt: 3000, dtt: 4000 }, entities: [] },
      { t: 2, area: "a:0", hero: "Candy",
        player: { x: 0, y: 0, vx: 0, vy: 0, mouse: [0, 0], alive: true, dt: 2000, dtt: 4000 }, entities: [] },
      { t: 3, area: "a:0",
        player: { x: 0, y: 0, vx: 0, vy: 0, mouse: [0, 0], alive: true }, entities: [] }
    ]
  }));
  assert.strictEqual(RC.sampleFrame(ev, 0).hero, "Brute");
  assert.strictEqual(RC.sampleFrame(ev, 1.5).hero, "Brute");  // report du tick 0
  assert.strictEqual(RC.sampleFrame(ev, 2).hero, "Candy");    // "/reset candy"
  assert.strictEqual(RC.sampleFrame(ev, 3).hero, "Candy");    // report
  assert.strictEqual(RC.sampleFrame(ev, 1.5).player.dt, 2500); // lerp 3000->2000
  assert.strictEqual(RC.sampleFrame(ev, 1.5).player.dtt, 4000);
  assert.strictEqual(RC.sampleFrame(ev, 3).player.dt, undefined); // relevé -> plus de timer
  // vieux fichier sans tick.hero : frame.hero null (le viewer retombe sur meta)
  assert.strictEqual(RC.sampleFrame(RC.parseEvrec(text), 0).hero, null);
  console.log("replayCore: héros par tick + death timer OK");
})();

// evrec 1.4 : heure murale par tick (tick.w) lerpée -> frame.wall (désync horloge interne)
(function () {
  var ev = RC.parseEvrec(JSON.stringify({
    format: "evrec/1", meta: { tps: 60 },
    ticks: [
      { t: 0, area: "a:0", w: 0,   player: null, entities: [] },
      { t: 1, area: "a:0", w: 18,  player: null, entities: [] } // paquet en retard (16.7ms attendu)
    ]
  }));
  assert.strictEqual(RC.sampleFrame(ev, 0).wall, 0);
  assert.strictEqual(RC.sampleFrame(ev, 0.5).wall, 9);
  assert.strictEqual(RC.sampleFrame(ev, 1).wall, 18);
  assert.strictEqual(RC.sampleFrame(RC.parseEvrec(text), 0).wall, undefined); // vieux fichiers
  console.log("replayCore: heure murale OK");
})();

// recorderCore : readPlayer dt/dtt (deathTimer -1 = vivant) + buildTick passthrough
(function () {
  var REC = require("../../recorder/recorderCore.js");
  var ctx = { xk: "x", yk: "y", rk: "radius", deadk: "isDead", typek: "entityType", pelletType: 113, selfId: null };
  assert.strictEqual(REC.readPlayer({ x: 1, y: 2, deathTimer: -1 }, null, ctx).dt, undefined);
  var down = REC.readPlayer({ x: 1, y: 2, deathTimer: 2500, deathTimerTotal: 4000 }, null, ctx);
  assert.strictEqual(down.dt, 2500);
  assert.strictEqual(down.dtt, 4000);
  var tick = REC.buildTick(0, "a:0", { x: 0, y: 0, dt: 2500, dtt: 4000 }, [], {}, null);
  assert.strictEqual(tick.player.dt, 2500);  // temps bruts, PAS de /32
  assert.strictEqual(tick.player.dtt, 4000);
  console.log("recorderCore: death timer OK");
})();

// recorderCore.readStatus : chaîne de priorité Goatunn + arrondi
(function () {
  var REC = require("../../recorder/recorderCore.js");
  assert.deepStrictEqual(REC.readStatus({ frozenTimeLeft: 1234.567, frozenTime: 4000 }), { s: 2, sl: 1234.57, st: 4000 });
  assert.deepStrictEqual(REC.readStatus({ sugarRushTimeLeft: 2, sugarRushTime: 5, frozenTimeLeft: 1 }).s, 4); // sugar prime
  assert.deepStrictEqual(REC.readStatus({ petrified: true }), { s: 2, sl: 0, st: 0 });
  assert.strictEqual(REC.readStatus({}), null);
  // buildTick : i + statut passthrough + cooldowns dans stats (non convertis)
  var tick = REC.buildTick(0, "a:0",
    { x: 0, y: 0, stats: { ab1cd: 500, ab1tcd: 3000 } },
    [ { id: "42", type: 1, x: 32, y: 0, r: 16, s: 2, sl: 1000, st: 4000 } ],
    { 1: "NORMAL_ENEMY" }, null);
  assert.strictEqual(tick.entities[0].i, "42");
  assert.strictEqual(tick.entities[0].s, 2);
  assert.strictEqual(tick.entities[0].sl, 1000);
  assert.strictEqual(tick.player.stats.ab1cd, 500);
  console.log("recorderCore: readStatus + buildTick i/statut OK");
})();

// recorderCore.readAura : plus grand rayon retenu, formats radius/currentRadius/range,
// effets sans rayon ignorés ; buildTick convertit en tuiles (÷32)
(function () {
  var REC = require("../../recorder/recorderCore.js");
  var e = { effects: { effects: {
    a: { effectType: 48, radius: 160 },
    b: { type: 21, currentRadius: 96 },
    c: { effectType: 7 },            // sans rayon -> ignoré
    d: null
  } } };
  assert.deepStrictEqual(REC.readAura(e), { t: 48, r: 160 });
  assert.strictEqual(REC.readAura({}), null);
  var tick = REC.buildTick(0, "a:0",
    { x: 0, y: 0, aura: { t: 13, r: 64 } },
    [ { type: 1, x: 32, y: 32, r: 16, ar: 160, at: 48 } ],
    { 1: "NORMAL_ENEMY" }, null);
  assert.strictEqual(tick.entities[0].a, 5);   // 160/32
  assert.strictEqual(tick.entities[0].at, 48);
  assert.deepStrictEqual(tick.player.aura, { t: 13, r: 2 }); // 64/32
  console.log("recorderCore: readAura + buildTick auras OK");
})();
