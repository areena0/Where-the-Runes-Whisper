export default class Start extends Phaser.Scene {
  constructor() {
    super('Start');

    this.TILE = 32;

    // Objectives
    this.sigilTotal = 3;
    this.sigilsFound = 0;
    this.photoFound = false;
    this.exitUnlocked = false;

    // Player stats (tuned to NOT kill you instantly)
    this.sanity = 100;
    this.stamina = 100;

    // Sanity tuning (per second)
    this.sanityDrainBase = 0.12;     // very slow
    this.sanityDrainChase = 0.75;    // noticeable but fair
    this.sanityRegenShadow = 0.35;   // recover in shadow zones

    this.gameOver = false;
  }

  preload() {
    // Tiles
    this.load.image('floor', 'assets/floor.png');
    this.load.image('wall', 'assets/wall.png');
    this.load.image('shadow', 'assets/shadow.png');
    this.load.image('lodge', 'assets/lodge.png');
    this.load.image('exit_closed', 'assets/exit_closed.png');
    this.load.image('exit_open', 'assets/exit_open.png');

    // Sprites
    this.load.image('player', 'assets/player.png');
    this.load.image('echo', 'assets/echo.png');
    this.load.image('sigil', 'assets/sigil.png');
    this.load.image('photo', 'assets/photo.png');
  }

  create() {
    // ---------------------------------------------------------
    // MAP LEGEND
    // # wall
    // . floor
    // S shadow (safe zone / sanity regen)
    // L lodge (ritual)
    // E exit (locked -> unlock)
    // P player spawn
    // 1 2 3 sigils
    // F photo (secret item)
    // X enemy spawn
    // ---------------------------------------------------------
    this.map = [
      "#########################",
      "#P...S..............S..E#",
      "#.#####.###########.#####",
      "#..F..#.....S.....#.....#",
      "###.#.#####.#####.#.###.#",
      "#...#.....#...#...#...#.#",
      "#.#######.###.#.#####.#.#",
      "#.......#.....#.....#...#",
      "#.#####.#############.###",
      "#...S.#....1..L..2....S.#",
      "###.#########.#########.#",
      "#...#.......#.#.......#.#",
      "#.#.#.#####.#.#.#####.#.#",
      "#.#...#...#...#...#...#.#",
      "#.#####.#.#########.#.#.#",
      "#.......#.....S.....#...#",
      "#####.###############.###",
      "#S....#.....3....X....S.#",
      "#########################"
    ];

    this.mapH = this.map.length;
    this.mapW = this.map[0].length;

    // World bounds
    this.physics.world.setBounds(0, 0, this.mapW * this.TILE, this.mapH * this.TILE);
    this.cameras.main.setBounds(0, 0, this.mapW * this.TILE, this.mapH * this.TILE);
    this.cameras.main.setBackgroundColor('#000000');

    // Static walls
    this.walls = this.physics.add.staticGroup();

    // Track special positions + interactables
    this.walkableTiles = []; // for enemy patrol targets
    this.sigilSprites = [];
    this.photoSprite = null;

    this.lodgeWorld = null;
    this.exitWorld = null;

    let playerSpawn = null;
    let enemySpawn = null;

    // Build map
    for (let r = 0; r < this.mapH; r++) {
      for (let c = 0; c < this.mapW; c++) {
        const ch = this.map[r][c];
        const x = c * this.TILE + this.TILE / 2;
        const y = r * this.TILE + this.TILE / 2;

        if (ch !== '#') {
          this.add.image(x, y, 'floor').setDepth(0);
          this.walkableTiles.push({ r, c });
        }

        if (ch === '#') {
          this.add.image(x, y, 'wall').setDepth(1);
          this.walls.create(x, y, 'wall').refreshBody();
        }

        if (ch === 'S') {
          this.add.image(x, y, 'shadow').setDepth(0.5);
        }

        if (ch === 'L') {
          this.add.image(x, y, 'lodge').setDepth(0.6);
          this.lodgeWorld = { x, y };
        }

        if (ch === 'E') {
          this.exitWorld = { x, y };
          this.exitSprite = this.physics.add.staticImage(x, y, 'exit_closed').setDepth(2);
        }

        if (ch === 'P') playerSpawn = { x, y };
        if (ch === 'X') enemySpawn = { x, y };

        if (ch === '1' || ch === '2' || ch === '3') {
          const s = this.physics.add.staticImage(x, y, 'sigil').setDepth(3);
          this.sigilSprites.push(s);
        }

        if (ch === 'F') {
          this.photoSprite = this.physics.add.staticImage(x, y, 'photo').setDepth(3);
          this.photoCollected = false;
        }
      }
    }

    // Player
    this.player = this.physics.add.sprite(playerSpawn.x, playerSpawn.y, 'player').setDepth(4);
    this.player.setCollideWorldBounds(true);

    // ✅ KEY FIX: smaller hitbox so turning in corridors feels smooth
    this.player.body.setSize(18, 18, true);

    this.physics.add.collider(this.player, this.walls);

    // Camera follow
    this.cameras.main.startFollow(this.player, true, 0.10, 0.10);

    // Controls
    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      up2: Phaser.Input.Keyboard.KeyCodes.UP,
      down2: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left2: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right2: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      interact: Phaser.Input.Keyboard.KeyCodes.E,
      sprint: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      restart: Phaser.Input.Keyboard.KeyCodes.R
    });

    // Enemy (Echo)
    this.echo = this.physics.add.sprite(enemySpawn.x, enemySpawn.y, 'echo').setDepth(4);
    this.echo.setCollideWorldBounds(true);

    // ✅ smaller hitbox helps enemy navigate corridors too
    this.echo.body.setSize(18, 18, true);

    this.physics.add.collider(this.echo, this.walls);

    // Enemy AI parameters
    this.echoState = 'PATROL';
    this.echoDetectRadius = 260;    // pixels
    this.echoSpeedPatrol = 70;
    this.echoSpeedChase = 105;

    // Pathing
    this.echoPath = [];
    this.echoPathIndex = 0;
    this.echoRepathTimer = 0;

    // Lose if touched
    this.physics.add.overlap(this.player, this.echo, () => {
      if (!this.gameOver) this.endGame("BAD", "The Echo found you.");
    });

    // UI
    this.ui = {};
    this.ui.objective = this.add.text(16, 16, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#ffffff"
    }).setScrollFactor(0).setDepth(1000);

    this.ui.stats = this.add.text(16, 56, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#ffffff"
    }).setScrollFactor(0).setDepth(1000);

    this.ui.prompt = this.add.text(16, 560, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#ffd27a"
    }).setScrollFactor(0).setDepth(1000);

    // End overlay
    this.endOverlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.80)
      .setScrollFactor(0).setDepth(2000).setVisible(false);

    this.endText = this.add.text(400, 300, "", {
      fontFamily: "monospace",
      fontSize: "18px",
      color: "#ffffff",
      align: "center"
    }).setScrollFactor(0).setDepth(2001).setOrigin(0.5).setVisible(false);

    // Intro hint
    this.hintText = this.add.text(16, 520, "WASD / Arrow Keys to move • Shift to sprint • E to interact", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#aaaaaa"
    }).setScrollFactor(0).setDepth(1000);
  }

  update(time, delta) {
    const dt = delta / 1000;

    if (this.gameOver) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.restart)) this.scene.restart();
      return;
    }

    // -------------------------
    // Player Movement (smooth)
    // -------------------------
    const baseSpeed = 120;
    const sprintSpeed = 190;

    let vx = 0, vy = 0;

    if (this.keys.left.isDown || this.keys.left2.isDown) vx -= 1;
    if (this.keys.right.isDown || this.keys.right2.isDown) vx += 1;
    if (this.keys.up.isDown || this.keys.up2.isDown) vy -= 1;
    if (this.keys.down.isDown || this.keys.down2.isDown) vy += 1;

    const moving = (vx !== 0 || vy !== 0);
    const sprinting = this.keys.sprint.isDown && moving && this.stamina > 0;

    let speed = sprinting ? sprintSpeed : baseSpeed;

    // Normalize diagonal movement so it isn't faster
    if (vx !== 0 && vy !== 0) {
      const inv = 1 / Math.sqrt(2);
      vx *= inv;
      vy *= inv;
    }

    this.player.setVelocity(vx * speed, vy * speed);

    // stamina
    if (sprinting) {
      this.stamina -= 28 * dt;
      if (this.stamina < 0) this.stamina = 0;
    } else {
      this.stamina += 16 * dt;
      if (this.stamina > 100) this.stamina = 100;
    }

    // -------------------------
    // Sanity (tuned slower)
    // -------------------------
    const inShadow = this.isPlayerInShadow();
    this.sanity -= this.sanityDrainBase * dt;

    if (this.echoState === 'CHASE') this.sanity -= this.sanityDrainChase * dt;
    if (inShadow) this.sanity += this.sanityRegenShadow * dt;

    this.sanity = Phaser.Math.Clamp(this.sanity, 0, 100);

    if (this.sanity <= 0) {
      this.endGame("BAD", "You froze.\nThe whispers became your thoughts.");
      return;
    }

    // -------------------------
    // Interactions (reliable)
    // -------------------------
    const nearest = this.getNearestInteractable();
    this.ui.prompt.setText(nearest.prompt);

    if (Phaser.Input.Keyboard.JustDown(this.keys.interact)) {
      if (nearest.type === 'SIGIL') {
        nearest.obj.destroy();
        this.sigilSprites = this.sigilSprites.filter(s => s.active);
        this.sigilsFound++;
      }

      if (nearest.type === 'PHOTO' && !this.photoCollected) {
        this.photoCollected = true;
        this.photoFound = true;
        if (this.photoSprite) this.photoSprite.destroy();
      }

      if (nearest.type === 'RITUAL' && this.sigilsFound >= this.sigilTotal && !this.exitUnlocked) {
        this.exitUnlocked = true;
        if (this.exitSprite) this.exitSprite.setTexture('exit_open');
      }

      if (nearest.type === 'EXIT' && this.exitUnlocked) {
        if (this.photoFound) this.endGame("GOOD", "You remembered the truth.\nThe Hollow lets you go.");
        else this.endGame("NEUTRAL", "You escaped…\nBut something followed.");
      }
    }

    // -------------------------
    // Enemy AI with pathfinding
    // -------------------------
    this.updateEchoAI(dt);

    // -------------------------
    // UI
    // -------------------------
    this.ui.objective.setText(this.getObjectiveText());
    this.ui.stats.setText(
      `Sigils: ${this.sigilsFound}/${this.sigilTotal}\n` +
      `Sanity: ${Math.round(this.sanity)}\n` +
      `Stamina: ${Math.round(this.stamina)}`
    );
  }

  // -------------------------
  // Interactable detection (distance-based)
  // -------------------------
  getNearestInteractable() {
    const px = this.player.x;
    const py = this.player.y;

    const radius = 36; // interaction range
    let best = { type: 'NONE', obj: null, d: Infinity, prompt: "" };

    // Sigils
    for (const s of this.sigilSprites) {
      if (!s || !s.active) continue;
      const d = Phaser.Math.Distance.Between(px, py, s.x, s.y);
      if (d < radius && d < best.d) best = { type: 'SIGIL', obj: s, d, prompt: "Press [E] to collect a Sigil." };
    }

    // Photo
    if (this.photoSprite && this.photoSprite.active && !this.photoCollected) {
      const d = Phaser.Math.Distance.Between(px, py, this.photoSprite.x, this.photoSprite.y);
      if (d < radius && d < best.d) best = { type: 'PHOTO', obj: this.photoSprite, d, prompt: "Press [E] to collect the Photo." };
    }

    // Ritual at lodge
    if (this.lodgeWorld && this.sigilsFound >= this.sigilTotal && !this.exitUnlocked) {
      const d = Phaser.Math.Distance.Between(px, py, this.lodgeWorld.x, this.lodgeWorld.y);
      if (d < radius + 12 && d < best.d) best = { type: 'RITUAL', obj: null, d, prompt: "Press [E] to perform the Ritual." };
    }

    // Exit
    if (this.exitWorld && this.exitUnlocked) {
      const d = Phaser.Math.Distance.Between(px, py, this.exitWorld.x, this.exitWorld.y);
      if (d < radius + 12 && d < best.d) best = { type: 'EXIT', obj: null, d, prompt: "Press [E] to escape." };
    }

    return best;
  }

  // -------------------------
  // Enemy AI (PATROL ↔ CHASE) + BFS pathing
  // -------------------------
  updateEchoAI(dt) {
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.echo.x, this.echo.y);

    // State switch
    if (this.echoState === 'PATROL' && dist < this.echoDetectRadius) {
      this.echoState = 'CHASE';
      this.echoPath = [];
      this.echoPathIndex = 0;
      this.echoRepathTimer = 0;
    }
    if (this.echoState === 'CHASE' && dist > this.echoDetectRadius * 1.55) {
      this.echoState = 'PATROL';
      this.echoPath = [];
      this.echoPathIndex = 0;
      this.echoRepathTimer = 0;
    }

    // Repath timer (don’t compute every frame)
    this.echoRepathTimer -= dt;

    const echoTile = this.worldToTile(this.echo.x, this.echo.y);
    const playerTile = this.worldToTile(this.player.x, this.player.y);

    if (!echoTile || !playerTile) return;

    // Pick target
    let targetTile = null;

    if (this.echoState === 'CHASE') {
      targetTile = playerTile;

      // Repath frequently while chasing
      if (this.echoRepathTimer <= 0) {
        this.echoPath = this.bfsPath(echoTile, targetTile);
        this.echoPathIndex = 0;
        this.echoRepathTimer = 0.35;
      }
    } else {
      // PATROL: pick random walkable target across the whole map
      if (this.echoPath.length === 0 || this.echoPathIndex >= this.echoPath.length) {
        targetTile = this.pickRandomPatrolTargetFarFrom(echoTile, playerTile);
        this.echoPath = this.bfsPath(echoTile, targetTile);
        this.echoPathIndex = 0;
      }
    }

    // Follow path
    const speed = (this.echoState === 'CHASE') ? this.echoSpeedChase : this.echoSpeedPatrol;

    if (this.echoPath.length > 0 && this.echoPathIndex < this.echoPath.length) {
      const node = this.echoPath[this.echoPathIndex];
      const nodeWorld = this.tileToWorld(node.r, node.c);

      const d = Phaser.Math.Distance.Between(this.echo.x, this.echo.y, nodeWorld.x, nodeWorld.y);
      if (d < 6) {
        this.echoPathIndex++;
      } else {
        // Move toward next node
        this.physics.moveTo(this.echo, nodeWorld.x, nodeWorld.y, speed);
      }
    } else {
      this.echo.setVelocity(0);
    }
  }

  pickRandomPatrolTargetFarFrom(echoTile, playerTile) {
    // Try multiple times to get a target far away so it doesn't "camp" one zone
    for (let i = 0; i < 60; i++) {
      const t = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
      if (!t) continue;
      const distEcho = Math.abs(t.r - echoTile.r) + Math.abs(t.c - echoTile.c);
      const distPlayer = Math.abs(t.r - playerTile.r) + Math.abs(t.c - playerTile.c);

      if (distEcho > 10 && distPlayer > 8) return t;
    }
    // fallback
    return this.walkableTiles[0];
  }

  bfsPath(start, goal) {
    // BFS on grid (4-direction), returns list of tile nodes to follow.
    // If no path, returns empty.
    const key = (r, c) => `${r},${c}`;

    const q = [];
    const cameFrom = new Map();
    const visited = new Set();

    q.push(start);
    visited.add(key(start.r, start.c));
    cameFrom.set(key(start.r, start.c), null);

    const dirs = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 }
    ];

    while (q.length > 0) {
      const cur = q.shift();
      if (cur.r === goal.r && cur.c === goal.c) break;

      for (const d of dirs) {
        const nr = cur.r + d.dr;
        const nc = cur.c + d.dc;
        if (!this.isWalkable(nr, nc)) continue;

        const k = key(nr, nc);
        if (visited.has(k)) continue;

        visited.add(k);
        cameFrom.set(k, cur);
        q.push({ r: nr, c: nc });
      }
    }

    // Reconstruct
    const goalKey = key(goal.r, goal.c);
    if (!cameFrom.has(goalKey)) return [];

    const path = [];
    let cur = goal;
    while (cur) {
      path.push(cur);
      cur = cameFrom.get(key(cur.r, cur.c));
    }
    path.reverse();

    // Small optimization: skip the first node (current position)
    if (path.length > 0) path.shift();

    return path;
  }

  isWalkable(r, c) {
    if (r < 0 || r >= this.mapH || c < 0 || c >= this.mapW) return false;
    const ch = this.map[r][c];
    return ch !== '#';
  }

  isPlayerInShadow() {
    const t = this.worldToTile(this.player.x, this.player.y);
    if (!t) return false;
    return this.map[t.r][t.c] === 'S';
  }

  worldToTile(x, y) {
    const c = Math.floor(x / this.TILE);
    const r = Math.floor(y / this.TILE);
    if (r < 0 || r >= this.mapH || c < 0 || c >= this.mapW) return null;
    return { r, c };
  }

  tileToWorld(r, c) {
    return { x: c * this.TILE + this.TILE / 2, y: r * this.TILE + this.TILE / 2 };
  }

  getObjectiveText() {
    if (!this.exitUnlocked) {
      if (this.sigilsFound < this.sigilTotal) return "Objective: Find 3 Sigils, then return to the Lodge.";
      return "Objective: Return to the Lodge and perform the Ritual.";
    }
    return "Objective: Reach the Exit and escape.";
  }

  endGame(type, reason) {
    this.gameOver = true;
    this.player.setVelocity(0);
    this.echo.setVelocity(0);

    let title = "";
    if (type === "GOOD") title = "GOOD ENDING";
    else if (type === "NEUTRAL") title = "ENDING";
    else title = "BAD ENDING";

    this.endOverlay.setVisible(true);
    this.endText.setVisible(true);
    this.endText.setText(`${title}\n\n${reason}\n`);
  }
}