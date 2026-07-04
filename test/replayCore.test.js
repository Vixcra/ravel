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

// readAhead: positions futures de l'ennemi (index 1) sur 2 ticks
(function () {
  var ev = RC.parseEvrec(text);
  var pts = RC.readAhead(ev, 1, 0, 2);
  assert.deepStrictEqual(pts, [ { x: 210, y: 200 }, { x: 220, y: 200 } ]);
  console.log("replayCore: readAhead OK");
})();
