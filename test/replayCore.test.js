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
