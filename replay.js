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
    replay._metaApplied = false;
    replay._pupArea = null;
    replay._puppets = [];
    replay._origin = [0, 0];
    return replay.ev;
  };

  // Couleurs officielles des héros (Codex Evades, colors.foreground).
  var HERO_COLORS = {
    "Magmax":"#ff0000","Rime":"#3333ff","Morfe":"#00dd00","Aurora":"#ff7f00","Necro":"#FF00FF",
    "Brute":"#9b5800","Nexus":"#29FFC6","Shade":"#826565","Euclid":"#5e4d66","Chrono":"#00b270",
    "Reaper":"#424a59","Rameses":"#989b4a","Jolt":"#e1e100","Ghoul":"#bad7d8","Cent":"#727272",
    "Jötunn":"#5cacff","Candy":"#ff80bd","Mirage":"#020fa2","Boldrock":"#a18446","Glob":"#14a300",
    "Magno":"#ff005d","Ignis":"#cd501f","Stella":"#fffa86","Viola":"#d9b130","Mortuus":"#7fb332",
    "Cybot":"#926be3","Echelon":"#5786de","Demona":"#7d3c9e","Stheno":"#cfa6ec","Factorb":"#6e391e",
    "Leono":"#820b0d","Veydris":"#752656"
  };

  // Applique meta (héros/nom/couleur) au joueur Ravel — une fois par fichier chargé.
  replay._applyMeta = function (game) {
    var m = replay.ev && replay.ev.meta;
    var p = game.players[0];
    if (!m || !p || replay._metaApplied) return;
    if (m.player) p.name = m.player;
    if (m.hero) p.className = m.hero;
    var c = m.hero && HERO_COLORS[m.hero];
    if (c) { p.color = c; p.tempColor = c; }
    replay._metaApplied = true;
  };

  // Marionnette = vraie entité Ravel (couleur/texture de classe via area.createEnemy),
  // pilotée en position par le fichier. La sim est coupée : freeze permanent par sécurité.
  replay._makePuppet = function (area, fe) {
    var pup = null;
    if (fe.r == null && (fe.w != null || fe.h != null)) {
      // rectangle (mur de map) : rendu via le chemin isShield (rect plein)
      pup = new Entity(new Vector(0, 0), 0.5, "#222222");
      pup.isShield = true; pup.rot = 0;
      pup.size = new Vector((fe.w || 1) / 2, (fe.h || 1) / 2);
    } else {
      try { pup = area.createEnemy(fe.n, 0, 0, (fe.r || 0.5) * 32, 0, 0, {}, 0, 0, 1); } catch (e) {}
      if (!pup) {
        var ti = entityTypes.indexOf(fe.n);
        pup = new Enemy(new Vector(0, 0), ti > 0 ? ti : 0, fe.r || 0.5, 0, 0, "#7a4bd6");
      }
    }
    pup._n = fe.n;
    pup.freeze = 1e15;
    return pup;
  };

  // Écrase player + entités de l'aire courante depuis le frame échantillonné.
  // Repères : le fichier est en coords serveur Evades (tuiles) ; tick.o = origine de
  // l'aire -> local = fichier - o. Ravel : entity.pos = LOCAL (le drawer ajoute
  // area.pos), player.pos = MONDE (area.pos + local).
  replay.applyFrame = function (game) {
    if (!replay.active || !replay.ev) return;
    var frame = window.replayCore.sampleFrame(replay.ev, replay.tickFloat);
    var player = game.players[0];
    var world = game.worlds[player.world];
    if (!world) return;                       // I2: garde une transition d'aire mid-replay
    var area = world.areas[player.area];
    if (!area || !area.entities) return;

    replay._applyMeta(game);

    var o = frame.o || [0, 0];
    replay._origin = o;

    if (frame.player) {
      player.pos.x = area.pos.x + (frame.player.x - o[0]);
      player.pos.y = area.pos.y + (frame.player.y - o[1]);
      var st = frame.player.stats;
      if (st) {
        if (st.level != null) player.level = st.level;
        if (st.energy != null) player.energy = st.energy;
        if (st.maxEnergy != null) player.maxEnergy = st.maxEnergy;
        if (st.regen != null) player.regen = st.regen;
        if (st.speed != null) player.speed = st.speed;
        if (st.xp != null) player.experience = st.xp;
      }
    }

    // Marionnettes : remplace entièrement les entités simulées de l'aire.
    if (replay._pupArea !== area) {
      replay._pupArea = area;
      replay._puppets = [];
    }
    var puppets = replay._puppets;
    var buckets = {};
    for (var i = 0; i < frame.entities.length; i++) {
      var fe = frame.entities[i];
      var pup = puppets[i];
      if (!pup || pup._n !== fe.n) { pup = replay._makePuppet(area, fe); puppets[i] = pup; }
      pup.pos.x = fe.x - o[0];
      pup.pos.y = fe.y - o[1];
      if (fe.r != null) pup.radius = fe.r;
      if (!buckets[fe.n]) buckets[fe.n] = [];
      buckets[fe.n].push(pup);
    }
    puppets.length = frame.entities.length;
    area.entities = buckets;

    // Overlays : joueur en coords MONDE (plPt), entités en coords LOCALES (entPt ajoute area.pos).
    var fLocal = { player: null, entities: [] };
    if (frame.player) {
      fLocal.player = {
        x: player.pos.x, y: player.pos.y,
        vx: frame.player.vx, vy: frame.player.vy, mouse: frame.player.mouse
      };
    }
    for (var q = 0; q < frame.entities.length; q++) {
      var fq = frame.entities[q];
      fLocal.entities.push({ n: fq.n, x: fq.x - o[0], y: fq.y - o[1], r: fq.r });
    }
    replay._frame = fLocal;
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
        var o = replay._origin || [0, 0]; // readAhead rend des coords fichier -> re-base local
        ctx.save();
        ctx.strokeStyle = "rgba(255,80,80,0.7)"; ctx.lineWidth = 1.5;
        ctx.beginPath();
        var s0 = entPt(ent.x, ent.y); ctx.moveTo(s0.x, s0.y);
        for (var p = 0; p < pts.length; p++) { var sp = entPt(pts[p].x - o[0], pts[p].y - o[1]); ctx.lineTo(sp.x, sp.y); }
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
