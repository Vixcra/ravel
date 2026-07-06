(function () {
  var replay = {
    active: false,
    ev: null,
    tickFloat: 0,
    speed: 1,        // multiplicateur de vitesse de lecture (1 = temps réel)
    playing: false
  };

  // Ids de héros serveur = rang alphabétique (table HS-mod _HERO_NAMES) : rattrape les
  // fichiers dont meta.hero est resté "unknown" (F9 avant d'entrer en partie) mais qui
  // ont un heroType.
  var HERO_BY_TYPE = {
    0: "Aurora", 1: "Boldrock", 2: "Brute", 3: "Candy", 4: "Cent",
    5: "Chrono", 6: "Cybot", 7: "Demona", 8: "Echelon", 9: "Euclid",
    10: "Factorb", 11: "Ghoul", 12: "Glob", 13: "Ignis", 14: "Jolt",
    15: "Jötunn", 16: "Leono", 17: "Magmax", 18: "Magno", 19: "Mirage",
    20: "Morfe", 21: "Mortuus", 22: "Necro", 23: "Nexus", 24: "Rameses",
    25: "Reaper", 26: "Rime", 27: "Shade", 28: "Stella", 29: "Stheno",
    30: "Veydris", 31: "Viola"
  };

  replay.load = function (text) {
    replay.ev = window.replayCore.parseEvrec(text);
    var m = replay.ev.meta;
    if (m && (!m.hero || m.hero === "unknown") && m.heroType != null && HERO_BY_TYPE[m.heroType]) {
      m.hero = HERO_BY_TYPE[m.heroType];
    }
    replay.active = true;
    replay.tickFloat = 0;
    replay.playing = false;
    replay._pupArea = null;
    replay._puppets = [];
    replay._origin = [0, 0];
    replay._lastAreaStr = null;
    replay._lastPellets = null;
    replay._pelletsCleared = false;
    replay._heroLoaded = null;
    replay._warnedRegions = {};
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

  // Applique meta (héros/nom/couleur) au joueur Ravel — CHAQUE frame : le démarrage
  // menu (#connect) recrée le joueur après coup et écraserait une application unique.
  replay._applyMeta = function (game) {
    var m = replay.ev && replay.ev.meta;
    var p = game.players[0];
    if (!m || !p) return;
    if (m.player) p.name = m.player;
    if (m.hero) p.className = m.hero;
    var c = m.hero && HERO_COLORS[m.hero];
    if (c) { p.color = c; p.tempColor = c; }
    // Icônes d'abilités du héros (loadImages change les src globaux ; une fois par héros)
    if (m.hero && replay._heroLoaded !== m.hero && typeof loadImages === "function") {
      replay._heroLoaded = m.hero;
      try { loadImages(m.hero); } catch (e) {}
    }
  };

  // Le menu ne charge qu'UN jeu de mondes (loadMain OU loadHard OU loadSecondary) ;
  // une run peut warper n'importe où -> on charge les trois et on dédoublonne par nom.
  // On ne retire que les doublons ajoutés en FIN de tableau : les index de mondes
  // existants (player.world) restent valides.
  replay._ensureAllWorlds = function (game) {
    if (replay._worldsLoaded) return;
    replay._worldsLoaded = true;
    try {
      var before = game.worlds.length, have = {}, i;
      for (i = 0; i < before; i++) have[String(game.worlds[i].name)] = true;
      if (typeof loadMain === "function") loadMain();
      if (typeof loadHard === "function") loadHard();
      if (typeof loadSecondary === "function") loadSecondary();
      for (i = game.worlds.length - 1; i >= before; i--) {
        var nm = String(game.worlds[i].name);
        if (have[nm]) game.worlds.splice(i, 1);
        else have[nm] = true;
      }
      console.log("[replay] mondes chargés pour le replay:", game.worlds.length);
    } catch (e) { console.warn("[replay] ensureAllWorlds:", e); }
  };

  // Charge les 62 YAML officiels (maps/, copies de Jotun/Map_files_config) et crée les
  // mondes ABSENTS des jeux intégrés de Ravel — une run peut warper n'importe où.
  replay._loadYamlWorlds = function (game) {
    if (replay._yamlKicked) return;
    replay._yamlKicked = true;
    fetch("maps/index.json").then(function (r) { return r.json(); }).then(function (files) {
      var added = 0, failed = [];
      var chain = Promise.resolve();
      files.forEach(function (f) {
        chain = chain.then(function () {
          return fetch("maps/" + f).then(function (r) { return r.text(); }).then(function (txt) {
            var doc = jsyaml.load(txt);
            if (!doc || !doc.name) return;
            for (var i = 0; i < game.worlds.length; i++) {
              if (String(game.worlds[i].name).toLowerCase() === String(doc.name).toLowerCase()) return; // déjà présent
            }
            game.worlds.push(new World(new Vector(0, 0), game.worlds.length, doc));
            added++;
          })["catch"](function () { failed.push(f); });
        });
      });
      return chain.then(function () {
        console.log("[replay] YAML officiels: +" + added + " mondes (total " + game.worlds.length + ")" +
          (failed.length ? " — échecs: " + failed.join(", ") : ""));
      });
    })["catch"](function (e) { console.warn("[replay] maps/index.json introuvable:", e); });
  };

  // Suit les changements d'aire/région de la run : tous les mondes sont chargés,
  // on bascule player.world/area sur le monde du même nom. Région pas encore
  // chargée (YAML en vol) -> on ré-essaie au frame suivant.
  replay._switchArea = function (game, areaStr) {
    if (!areaStr || areaStr === replay._lastAreaStr) return;
    replay._lastAreaStr = areaStr;
    var ci = areaStr.lastIndexOf(":");
    var region = ci >= 0 ? areaStr.slice(0, ci) : areaStr;
    var areaName = ci >= 0 ? areaStr.slice(ci + 1) : "";
    var player = game.players[0];
    var wi = -1;
    for (var i = 0; i < game.worlds.length; i++) {
      if (game.worlds[i] && String(game.worlds[i].name).toLowerCase() === region.toLowerCase()) { wi = i; break; }
    }
    if (wi < 0) {
      // "unknown" = ticks pré-partie (écran d'accueil) : normal, on attend la vraie région.
      replay._warnedRegions = replay._warnedRegions || {};
      if (region !== "unknown" && !replay._warnedRegions[region]) {
        replay._warnedRegions[region] = true;
        console.warn("[replay] région pas (encore) chargée:", region);
      }
      replay._lastAreaStr = null; // ré-essaie au prochain frame (YAML peut être en chargement)
      return;
    }
    var world = game.worlds[wi];
    var ai = -1;
    for (var a = 0; a < world.areas.length; a++) {
      var nm = String(world.areas[a].name);
      if (nm === areaName || nm.toLowerCase() === areaName.toLowerCase()) { ai = a; break; }
    }
    if (ai < 0) { // nom numérique ("3") ou suffixe ("Area 3")
      var num = parseInt(String(areaName).replace(/[^0-9]/g, ""), 10);
      if (!isNaN(num) && num >= 1 && num <= world.areas.length) ai = num - 1;
    }
    if (ai < 0) ai = 0;
    if (player.world !== wi || player.area !== ai) {
      var pw = player.world, pa = player.area;
      player.world = wi;
      player.area = ai;
      try { world.areas[ai].load(); }
      catch (e) {
        // aire cassée (YAML exotique ?) : on revient en arrière plutôt qu'un canvas noir
        console.warn("[replay] area.load a échoué pour", region, areaName, "- on reste:", e);
        player.world = pw; player.area = pa;
        return;
      }
      console.log("[replay] switch →", region + ":" + areaName, "(monde", wi + ", aire", ai + ")");
      replay._logPosOnce = true; // trace la géométrie au prochain frame (diagnostic caméra/vide)
      replay._pupArea = null;       // marionnettes à reconstruire dans la nouvelle aire
      replay._lastPellets = null;   // area.load a respawné des pellets aléatoires -> re-remplacer
      replay._pelletsCleared = false;
    }
  };

  // Couleurs d'aura par effectType serveur (table rus.js, vérifiée sur le bundle live).
  // Sert quand la classe Ravel du puppet n'a pas d'auraColor (type "unknown").
  var AURA_COLORS = {
    0:"rgba(255, 80, 10, 0.15)",1:"rgba(200, 70, 0, 0.15)",2:"rgba(77, 233, 242, 0.2)",
    3:"rgba(255, 0, 0, 0.2)",4:"rgba(255, 255, 0, 0.2)",5:"rgba(153, 62, 6, 0.2)",
    6:"rgba(76, 240, 161, 0.25)",7:"rgba(142, 129, 38, 0.15)",8:"rgba(174, 137, 185, 0.25)",
    9:"rgba(225, 225, 0, 0.1)",10:"rgba(0, 0, 0, 0.2)",13:"rgba(255, 128, 189, 0.25)",
    14:"rgba(161, 132, 70, 0.2)",16:"rgba(109, 109, 255, 0.2)",18:"rgba(255, 250, 134, 0.15)",
    19:"rgba(146, 107, 227, 0.15)",20:"rgba(97, 97, 97, 0.2)",21:"rgba(228, 0, 0, 0.15)",
    22:"rgba(254, 0, 0, 0.15)",23:"rgba(0, 200, 255, 0.15)",24:"rgba(60, 0, 114, 0.15)",
    25:"rgba(210, 228, 238, 0.2)",26:"rgba(58, 116, 112, 0.3)",27:"rgba(33, 161, 164, 0.3)",
    28:"rgba(254, 191, 206, 0.5)",29:"rgba(77, 1, 98, 0.3)",30:"rgba(0, 198, 0, 0.2)",
    31:"rgba(189, 103, 209, 0.25)",32:"rgba(100, 35, 115, 0.3)",33:"rgba(246, 131, 6, 0.3)",
    34:"rgba(107, 84, 30, 0.3)",35:"rgba(152, 153, 153, 0.2)",36:"rgba(41, 254, 198, 0.3)",
    37:"rgba(45, 50, 54, 0.15)",38:"rgba(59, 0, 0, 0.2)",39:"rgba(190, 82, 19, 0.3)",
    41:"rgba(38, 18, 53, 0.15)",42:"rgba(117, 38, 86, 0.15)",43:"rgba(60, 189, 152, 0.2)",
    44:"rgba(207, 166, 236, 0.25)",45:"rgba(99, 93, 110, 0.35)",46:"rgba(110, 57, 30, 0.15)",
    47:"rgba(0, 225, 225, 0.1)",48:"rgba(255, 0, 0, 0.15)",49:"rgba(0, 0, 255, 0.15)",
    50:"rgba(60, 0, 115, 0.15)",51:"rgba(210, 228, 239, 0.2)",52:"rgba(58, 117, 112, 0.3)",
    53:"rgba(33, 161, 165, 0.3)",54:"rgba(255, 191, 206, 0.5)",55:"rgba(60, 0, 0, 0.2)",
    56:"rgba(77, 1, 99, 0.3)",57:"rgba(0, 199, 0, 0.2)",58:"rgba(189, 103, 210, 0.25)",
    59:"rgba(100, 35, 116, 0.3)",60:"rgba(247, 131, 6, 0.3)",61:"rgba(146, 107, 227, 0.3)",
    62:"rgba(214, 0, 57, 0.3)",63:"rgba(108, 84, 30, 0.3)",64:"rgba(153, 153, 153, 0.2)",
    65:"rgba(41, 255, 198, 0.3)",66:"rgba(45, 50, 55, 0.15)",67:"rgba(191, 82, 19, 0.3)",
    68:"rgba(170, 47, 47, 0.48)",69:"rgba(70, 65, 66, 0.17)",70:"rgba(117, 38, 86, 0.15)",
    71:"rgba(38, 18, 53, 0.15)",72:"rgba(255, 128, 0, 0.15)",73:"rgba(0, 255, 0, 0.6)"
  };
  var AURA_FALLBACK = "rgba(150, 100, 255, 0.15)";
  function auraColorFor(effectType) {
    return (effectType != null && AURA_COLORS[effectType]) || AURA_FALLBACK;
  }

  // Items/projectiles texturés que renderTexturedEntity sait dessiner, par enum Evades.
  var RAW_TEXTURES = {
    SWEET_TOOTH_ITEM: "sweet_tooth_item", SOUR_CANDY_ITEM: "sour_candy_item",
    CANDY_ITEM: "sweet_tooth_item",
    VENGEANCE_PROJECTILE: "vengeance_projectile",
    NINJA_STAR_SNIPER_PROJECTILE: "ninja_star_sniper_projectile"
  };

  // Marionnette = vraie entité Ravel (couleur/texture de classe via area.createEnemy),
  // pilotée en position par le fichier. La sim est coupée : freeze permanent par sécurité.
  replay._makePuppet = function (area, fe) {
    var pup = null;
    var isItem = fe.rawN && fe.rawN.indexOf("ITEM") >= 0;
    var tex = fe.rawN && RAW_TEXTURES[fe.rawN];
    if (tex || isItem) {
      // item/projectile : PAS le chemin rect noir. Texturé si connu, sinon cercle rose.
      pup = new Entity(new Vector(0, 0), fe.r || 0.4, "#ff80bd");
      if (tex) pup.texture = tex;
      pup.isEnemy = false;
      pup.outline = false;
    } else if (fe.n === "wall" && fe.r == null && (fe.w != null || fe.h != null)) {
      // rectangle (mur de map) : rendu via le chemin isShield (rect plein)
      pup = new Entity(new Vector(0, 0), 0.5, "#222222");
      pup.isShield = true; pup.rot = 0;
      pup.size = new Vector((fe.w || 1) / 2, (fe.h || 1) / 2);
    } else {
      // auraRadius : rayon enregistré (px) si le fichier en a un, sinon undefined ->
      // défaut de la classe Ravel (150 etc.) pour les vieux fichiers sans auras.
      var auraPx = fe.a != null ? fe.a * 32 : undefined;
      try { pup = area.createEnemy(fe.n, 0, 0, (fe.r || 0.5) * 32, 0, 0, {}, auraPx, 0, 1); } catch (e) {}
      if (!pup) {
        var ti = entityTypes.indexOf(fe.n);
        pup = new Enemy(new Vector(0, 0), ti > 0 ? ti : 0, fe.r || 0.5, 0, 0, "#7a4bd6");
      }
    }
    pup._n = fe.n;
    pup._raw = fe.rawN;
    pup.freeze = 1e15;
    return pup;
  };

  // Écrase player + entités de l'aire courante depuis le frame échantillonné.
  // Repères : le fichier est en coords serveur Evades (tuiles) ; tick.o = origine de
  // l'aire -> local = fichier - o. Ravel : entity.pos = LOCAL (le drawer ajoute
  // area.pos), player.pos = MONDE (area.pos + local).
  replay.applyFrame = function (game) {
    if (!replay.active || !replay.ev) return;
    try { replay._applyFrameInner(game); }
    catch (e) { console.warn("[replay] applyFrame:", e); } // ne JAMAIS tuer la frame de rendu
  };

  replay._applyFrameInner = function (game) {
    var frame = window.replayCore.sampleFrame(replay.ev, replay.tickFloat);
    var player = game.players[0];
    if (!player) return;
    // DÈS LE DÉBUT : tous les jeux de mondes intégrés + les YAML officiels manquants,
    // pour qu'un warp vers n'importe quelle région trouve son monde.
    replay._ensureAllWorlds(game);
    replay._loadYamlWorlds(game);
    replay._switchArea(game, frame.area);
    var world = game.worlds[player.world];
    if (!world) return;                       // I2: garde une transition d'aire mid-replay
    var area = world.areas[player.area];
    if (!area || !area.entities) return;

    replay._applyMeta(game);

    var o = frame.o || [0, 0];
    replay._origin = o;

    if (frame.player && isFinite(frame.player.x) && isFinite(frame.player.y)) {
      // Repère MONDE de Ravel = world.pos (grille des mondes) + area.pos + local.
      // Oublier world.pos marche sur Central Core (0,0) et met la caméra dans le
      // vide partout ailleurs (canvas noir).
      player.pos.x = world.pos.x + area.pos.x + (frame.player.x - o[0]);
      player.pos.y = world.pos.y + area.pos.y + (frame.player.y - o[1]);
      if (replay._logPosOnce) {
        replay._logPosOnce = false;
        console.log("[replay] pos: local=(" + (frame.player.x - o[0]).toFixed(1) + "," + (frame.player.y - o[1]).toFixed(1) +
          ") monde Ravel=(" + world.pos.x + "," + world.pos.y + ") aire=(" + area.pos.x + "," + area.pos.y + ")");
      }
      var st = frame.player.stats;
      if (st) {
        if (st.level != null) player.level = st.level;
        if (st.energy != null) player.energy = st.energy;
        if (st.maxEnergy != null) player.maxEnergy = st.maxEnergy;
        if (st.regen != null) player.regen = st.regen;
        if (st.speed != null) player.speed = st.speed;
        if (st.xp != null) player.experience = st.xp;
        // Bornes de niveau : sans elles la barre d'xp déborde au lieu de repartir à zéro
        if (st.prevXp != null) player.previousLevelExperience = st.prevXp;
        if (st.nextXp != null) player.nextLevelExperience = st.nextXp;
        else if (st.xp != null) player.nextLevelExperience = st.xp + 1; // vieux fichiers: clamp
        if (st.points != null) player.points = st.points;
        // Niveaux d'abilities (cavités 1..5 de la herocard). Le jeu MASQUE .level
        // pendant l'usage d'une ability (indistinguable d'un niveau 0 dans le fichier) ;
        // les niveaux ne baissent jamais en cours de run -> on affiche le max vu.
        if (st.ab1 != null) { player.ab1L = Math.max(player.ab1L || 0, st.ab1); player.hasAB = true; }
        if (st.ab2 != null) { player.ab2L = Math.max(player.ab2L || 0, st.ab2); player.hasAB = true; }
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
      if (!pup || pup._n !== fe.n || pup._raw !== fe.rawN) { pup = replay._makePuppet(area, fe); puppets[i] = pup; }
      pup.pos.x = fe.x - o[0];
      pup.pos.y = fe.y - o[1];
      if (fe.r != null) pup.radius = fe.r;
      // Aura enregistrée : rayon par frame (les sizing la font varier) ; couleur de la
      // classe Ravel si elle en a une, sinon table effectType.
      if (fe.a != null) {
        pup.aura = true;
        pup.auraSize = fe.a;
        if (!pup.auraColor) pup.auraColor = auraColorFor(fe.at);
      }
      if (!buckets[fe.n]) buckets[fe.n] = [];
      buckets[fe.n].push(pup);
    }
    puppets.length = frame.entities.length;
    area.entities = buckets;

    // Aura de pouvoir du héros : pseudo-entité isEffect dans area.effects — la passe
    // effets du drawer la rend SOUS les entités (un overlay la peindrait par-dessus).
    if (frame.player && frame.player.aura && area.effects) {
      area.effects["replay_hero_aura"] = [{
        isEffect: true,
        color: auraColorFor(frame.player.aura.t),
        radius: frame.player.aura.r,
        pos: { x: frame.player.x - o[0], y: frame.player.y - o[1] }
      }];
    } else if (area.effects && area.effects["replay_hero_aura"]) {
      delete area.effects["replay_hero_aura"];
    }

    // Pellets réels : remplace ceux que Ravel a spawné au hasard (area.load).
    // frame.pellets = référence stable entre changements -> rebuild seulement au changement.
    if (frame.pellets && replay._lastPellets !== frame.pellets) {
      replay._lastPellets = frame.pellets;
      var plist = [];
      for (var pi = 0; pi < frame.pellets.length; pi++) {
        var fp = frame.pellets[pi];
        var pel = new Pellet(new Vector(fp.x - o[0], fp.y - o[1]), 1, []);
        pel.freeze = 1e15;
        plist.push(pel);
      }
      area.static_entities["pellet"] = plist;
    } else if (frame.pellets === null && !replay._pelletsCleared && area.static_entities) {
      // Vieux fichier sans pellets : on retire ceux de Ravel (positions aléatoires trompeuses).
      area.static_entities["pellet"] = [];
      replay._pelletsCleared = true;
    }

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

  // enemyPaths/playerVector (lignes de prédiction) coupés par défaut — code conservé,
  // réactivables à la console via replay.layers.
  replay.layers = { heroCircle: true, aimCone: true, playerVector: false, enemyPaths: false, hud: true, cursor: true };
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

      // Curseur du joueur : le vecteur mouse est un offset px depuis le joueur (échelle
      // à valider sur données réelles — seul point de réglage : le /32).
      if (L.cursor && f.player.mouse && (f.player.mouse[0] || f.player.mouse[1])) {
        var cu = plPt(f.player.x + f.player.mouse[0] / 32, f.player.y + f.player.mouse[1] / 32);
        ctx.save();
        // halo gradient rouge -> orange
        var cg = ctx.createRadialGradient(cu.x, cu.y, 0, cu.x, cu.y, 18);
        cg.addColorStop(0, "rgba(255,30,0,0.85)");
        cg.addColorStop(0.6, "rgba(255,140,0,0.45)");
        cg.addColorStop(1, "rgba(255,140,0,0)");
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(cu.x, cu.y, 18, 0, 2 * Math.PI); ctx.fill();
        // croix
        ctx.strokeStyle = "#ff3c00"; ctx.lineWidth = 3; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cu.x - 12, cu.y); ctx.lineTo(cu.x + 12, cu.y);
        ctx.moveTo(cu.x, cu.y - 12); ctx.lineTo(cu.x, cu.y + 12);
        ctx.stroke();
        // anneau orange
        ctx.strokeStyle = "#ff9500"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cu.x, cu.y, 7, 0, 2 * Math.PI); ctx.stroke();
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

  // Clavier en mode replay : listeners.js nous délègue TOUT keydown (les raccourcis
  // sandbox — cheats T/R/E/V/N..., reset End — casseraient l'état piloté par le fichier).
  // Espace = play/pause, flèches = frame ±1 (±10 avec Shift), H/M = herocard/minimap.
  replay.handleKey = function (e, player) {
    switch (e.code) {
      case "Space":
        e.preventDefault();
        // Un bouton de la replay-bar resté focus serait AUSSI activé par Espace (keyup)
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        replay.playing ? replay.pause() : replay.play();
        break;
      case "ArrowRight":
        e.preventDefault();
        replay.step(e.shiftKey ? 10 : 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        replay.step(e.shiftKey ? -10 : -1);
        break;
      case "KeyH":
        if (player) player.herocard = !player.herocard;
        break;
      case "KeyM":
        if (player) player.minimap = !player.minimap;
        break;
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
