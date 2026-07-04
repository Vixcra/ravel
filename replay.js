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
    if (!world) return;                       // I2: garde une transition d'aire mid-replay
    var area = world.areas[player.area];
    if (!area || !area.entities) return;
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

  // view = { fov, W, H, focusX, focusY, areaX, areaY } fourni par main.js. On reproduit EXACTEMENT
  // les deux transforms du drawer.js : entités = width/2 + (areaX + wx - focusX)*fov (avec area.pos),
  // joueur = width/2 + (wx - focusX)*fov (SANS area.pos). Sinon overlays décalés de ~fov (×32).
  replay.drawOverlays = function (ctx, view) {
    if (!replay.active || !replay._frame) return;
    var f = replay._frame;
    var L = replay.layers;
    var fov = view.fov, W = view.W, H = view.H;
    function entPt(wx, wy) { return { x: W / 2 + (view.areaX + wx - view.focusX) * fov, y: H / 2 + (view.areaY + wy - view.focusY) * fov }; }
    function plPt(wx, wy)  { return { x: W / 2 + (wx - view.focusX) * fov,             y: H / 2 + (wy - view.focusY) * fov }; }

    if (f.player) {
      var ps = plPt(f.player.x, f.player.y);

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
        var pe = plPt(f.player.x + f.player.vx * 3, f.player.y + f.player.vy * 3);
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
        var s0 = entPt(ent.x, ent.y); ctx.moveTo(s0.x, s0.y);
        for (var p = 0; p < pts.length; p++) { var sp = entPt(pts[p].x, pts[p].y); ctx.lineTo(sp.x, sp.y); }
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

  replay.play  = function () { if (replay.active) replay.playing = true; };
  replay.pause = function () { replay.playing = false; };
  replay.step  = function (delta) {
    replay.playing = false;
    var last = replay.ev.ticks.length - 1;
    replay.tickFloat = Math.max(0, Math.min(last, Math.round(replay.tickFloat) + delta));
  };
  replay.seek = function (tick) {
    var last = replay.ev.ticks.length - 1;
    replay.tickFloat = Math.max(0, Math.min(last, tick));
  };
  // tps cible (1..60) -> multiplicateur de vitesse de lecture.
  replay.setSpeed = function (tps) { replay.speed = tps / (replay.ev.meta.tps || 60); };
  replay.loadFile = function (file) {
    var reader = new FileReader();
    reader.onload = function () { replay.load(reader.result); };
    reader.readAsText(file);
  };

  // Monte le monde principal (central-core = worlds[0]) si aucune partie n'est en cours, pour qu'un
  // .evrec puisse être rejoué sans passer par le menu. Réplique la séquence de démarrage de
  // listeners.js (loadMain -> new player -> area.load -> startAnimation). Sans ça, applyFrame n'a
  // aucune aire ni entités à repositionner et le canvas reste noir.
  replay.boot = function () {
    try {
      if (typeof game !== "undefined" && game.players.length > 0) return; // déjà en jeu
      // Voie principale : cliquer "Enter game" avec les défauts (world=Original=central-core,
      // hero=Normal). Ça exécute EXACTEMENT le démarrage du menu -> settings/résolution/UI corrects
      // (minimap + herocard + caméra), contrairement à une séquence bricolée à la main.
      var connect = document.getElementById("connect");
      if (connect) { connect.click(); return; }
      // Fallback si le menu a été retiré : séquence minimale (rendu dégradé, sans réglages menu).
      if (typeof inMenu !== "undefined") inMenu = false;
      if (game.worlds.length === 0 && typeof loadMain === "function") loadMain();
      if (game.worlds.length === 0 && typeof missing_world !== "undefined") game.worlds.push(missing_world);
      var p = new Basic(new Vector(6, 6), 5);
      game.players.push(p);
      if (typeof loadImages === "function") loadImages(p.className);
      game.worlds[0].areas[0].load();
      if (typeof startAnimation === "function") startAnimation();
    } catch (e) { console.error("[replay] boot failed:", e); }
  };

  window.replay = replay;
})();
