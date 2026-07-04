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

  window.replay = replay;
})();
