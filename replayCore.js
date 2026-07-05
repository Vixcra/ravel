(function () {
  function parseEvrec(text) {
    var ev = typeof text === "string" ? JSON.parse(text) : text;
    if (!ev || ev.format !== "evrec/1") throw new Error("bad evrec format");
    if (!Array.isArray(ev.ticks)) throw new Error("bad evrec format");
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
    }
    var entities = [];
    for (var k = 0; k < A.entities.length; k++) {
      var ea = A.entities[k];
      var eb = (B.entities[k] && B.entities[k].n === ea.n) ? B.entities[k] : ea;
      var rec = {
        n: ea.n,
        x: _lerp(ea.x, eb.x, f),
        y: _lerp(ea.y, eb.y, f),
        r: ea.r, vx: ea.vx, vy: ea.vy
      };
      if (ea.w != null) rec.w = ea.w;
      if (ea.h != null) rec.h = ea.h;
      entities.push(rec);
    }
    var frame = { player: player, entities: entities, area: A.area };
    if (A.o) frame.o = A.o; // origine de l'aire (tuiles) pour re-baser au playback
    return frame;
  }

  function readAhead(ev, entityIndex, tick, count) {
    var pts = [];
    for (var t = tick + 1; t <= tick + count && t < ev.ticks.length; t++) {
      var e = ev.ticks[t].entities[entityIndex];
      if (!e) break;
      pts.push({ x: e.x, y: e.y });
    }
    return pts;
  }

  var api = { parseEvrec: parseEvrec, sampleFrame: sampleFrame, readAhead: readAhead };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.replayCore = api;
})();
