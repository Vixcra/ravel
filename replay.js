(function () {
  var replay = {
    active: false,
    ev: null,
    tickFloat: 0,
    speed: 1,        // multiplicateur de vitesse de lecture (1 = temps réel)
    playing: false
  };

  replay.load = function (text) {
    replay.ev = window.replayCore.parseEvrec(text);
    replay.active = true;
    replay.tickFloat = 0;
    replay.playing = false;
    return replay.ev;
  };

  // Écrase player + entités de l'aire courante depuis le frame échantillonné.
  replay.applyFrame = function (game) {
    if (!replay.active || !replay.ev) return;
    var frame = window.replayCore.sampleFrame(replay.ev, replay.tickFloat);
    replay._frame = frame; // gardé pour les overlays (Task 3)
    var player = game.players[0];
    if (frame.player) { player.pos.x = frame.player.x; player.pos.y = frame.player.y; }

    var world = game.worlds[player.world];
    var area = world.areas[player.area];
    // Reconstruit les buckets d'entités par nom de type.
    var buckets = {};
    for (var i = 0; i < frame.entities.length; i++) {
      var fe = frame.entities[i];
      if (!buckets[fe.n]) buckets[fe.n] = [];
      buckets[fe.n].push(fe);
    }
    for (var typeName in area.entities) {
      if (!area.entities.hasOwnProperty(typeName)) continue;
      var list = area.entities[typeName];
      var src = buckets[typeName] || [];
      for (var j = 0; j < list.length && j < src.length; j++) {
        list[j].pos.x = src[j].x;
        list[j].pos.y = src[j].y;
        if (src[j].r != null) list[j].radius = src[j].r;
      }
    }
  };

  replay.layers = { heroCircle: true, aimCone: true, playerVector: true, enemyPaths: true, hud: true };
  replay.pathAhead = 30;

  // toScreen: {x,y} monde -> {x,y} écran. Fournie par l'appelant (main.js) qui connaît la caméra.
  replay.drawOverlays = function (ctx, toScreen) {
    if (!replay.active || !replay._frame) return;
    var f = replay._frame;
    var L = replay.layers;

    if (f.player) {
      var ps = toScreen(f.player.x, f.player.y);

      if (L.heroCircle) {
        ctx.save();
        ctx.strokeStyle = "#00ff88"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ps.x, ps.y, 24, 0, 2 * Math.PI); ctx.stroke();
        ctx.restore();
      }

      if (L.aimCone && f.player.mouse) {
        var ang = Math.atan2(f.player.mouse[1], f.player.mouse[0]);
        var half = 0.35, len = 120;
        ctx.save();
        ctx.fillStyle = "rgba(0,255,136,0.15)";
        ctx.beginPath();
        ctx.moveTo(ps.x, ps.y);
        ctx.arc(ps.x, ps.y, len, ang - half, ang + half);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      if (L.playerVector && (f.player.vx || f.player.vy)) {
        var pe = toScreen(f.player.x + f.player.vx * 3, f.player.y + f.player.vy * 3);
        ctx.save();
        ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ps.x, ps.y); ctx.lineTo(pe.x, pe.y); ctx.stroke();
        ctx.restore();
      }
    }

    if (L.enemyPaths) {
      var baseTick = Math.floor(replay.tickFloat);
      for (var i = 0; i < f.entities.length; i++) {
        var ent = f.entities[i];
        if (ent.n === "wall") continue; // statiques : pas de trajectoire
        var pts = window.replayCore.readAhead(replay.ev, i, baseTick, replay.pathAhead);
        if (pts.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = "rgba(255,80,80,0.7)"; ctx.lineWidth = 1.5;
        ctx.beginPath();
        var s0 = toScreen(ent.x, ent.y); ctx.moveTo(s0.x, s0.y);
        for (var p = 0; p < pts.length; p++) { var sp = toScreen(pts[p].x, pts[p].y); ctx.lineTo(sp.x, sp.y); }
        ctx.stroke();
        ctx.restore();
      }
    }

    if (L.hud) {
      ctx.save();
      ctx.fillStyle = "#fff"; ctx.font = "14px monospace";
      ctx.fillText("tick " + Math.floor(replay.tickFloat) + " / " + (replay.ev.ticks.length - 1) +
        "  x" + replay.speed.toFixed(2) + (replay.playing ? "  ▶" : "  ⏸"), 12, 20);
      ctx.restore();
    }
  };

  window.replay = replay;
})();
