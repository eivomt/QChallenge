    import { createGridFont } from './font.js';
    'use strict';


    // CONFIG.initialKick = 12;
    // CONFIG.collisionKick = 15;
    // CONFIG.motionKick = 1.5;
    // CONFIG.contactKick = 20;
    // CONFIG.maxKick = 35;
    // ── Configuration ───────────────────────────────────────────────────────
    const CONFIG = {
      worldWidth: 100,
      goalOffset: 20,
      horizontalSpeed: 17,
      gridSize: 4,
      gridGap: 1,
      paddleWidth: 2,
      paddleHeight: 64,
      paddleSpeed: 256,                 // grid rows / second
      samples: 1024,                    // power of two for FFT
      kinetic: 0.00022,
      initialWidth: 0.025,
      collapseWidth: 0.032,
      initialKick: 18,
      collisionKick: 8,
      motionKick: 40,                   // kick at full paddle speed
      contactKick: 20,
      maxKick: 60,
      substeps: 3,
      maxFrameTime: 0.05,
      winningScore: 5,
      particleRadius: 10,
      measurementFlashDuration: 1.0,
      measurementFlashRadius: 100,
      measurementMinInterval: 17,
      measurementMaxInterval: 25,
      measurementWarning: 6,
      couplingAngle: Math.PI / 4,      // partial mixing maximizes phase-dependent transfer
      goalPhaseStep: Math.PI,
      evolutionSpeed: 4,
      maxMode: 10,
      filterStartMode: 5,
      filterStrength: 3,
      edgeZone: 0.2,
      edgeMomentum: 10,
      edgeRecoveryRate: 1,
      densityGain: 1.4,             // fixed scale exposes probability changes
      colors: {
        background: '#10191f',
        panel: '#17252c',
        foreground: '#e7efdf',
        divider: '#40545c',
        baseline: '#82958e',
        goal: 'rgba(231, 239, 223, 0.45)',
        border: '#536870',
        accent: '#8fe3d1',
        neutralRGB: [231, 239, 223],
        constructiveRGB: [255, 115, 107],
        destructiveRGB: [160, 220, 136],
        flashRGB: [143, 227, 209],
      },
    };

    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const ui = {
      left: document.getElementById('leftScore'),
      center: document.getElementById('centerScore'),
      right: document.getElementById('rightScore'),
      message: document.getElementById('message'),
    };

    const textFonts = new Map();
    function drawGridText(text, x, y, size, color, maxWidth) {
        const columns = Math.max(...String(text).split('\n').map(line => line.length * 6 - 1), 1);
        const gridSize = Math.min(size, maxWidth / columns);
        const key = `${gridSize}:${color}`;
        if (!textFonts.has(key)) {
            textFonts.set(key, createGridFont(ctx, {
                gridSize,
                gap: gridSize * 0.12,
                color,
            }));
        }
        textFonts.get(key).write(text, { x: x / gridSize, y: y / gridSize }, 'center');
    }

    const N = CONFIG.samples;
    const dy = 1 / N;
    const sampleY = j => (j + 0.5) * dy;
    const cellSize = CONFIG.gridSize - CONFIG.gridGap;
    const keys = new Set();

    // Complex wavefunction and absorbed probability density (per sample).
    const psi = {
        re: new Float64Array(N),
        im: new Float64Array(N)
    };

    const psiLeft = {
        re: new Float64Array(N),
        im: new Float64Array(N)
    };

    const psiRight = {
        re: new Float64Array(N),
        im: new Float64Array(N)
    };

    const goals = {
      left: { density: new Float64Array(N), probability: 0 },
      right: { density: new Float64Array(N), probability: 0 },
    };

    const screen = { width: 0, height: 0, scale: 1, rows: 0, cols: 0 };
    const paddles = {
      left: { row: 0, velocity: 0 },
      right: { row: 0, velocity: 0 },
    };
    const game = {
      x: 0,
      vx: CONFIG.horizontalSpeed,
      phase: 0,
      bounces: 0,
      kick: 0,
      paused: false,
      flash: 0,
      measurementSpot: null,
      measurementRemaining: null,
      lastTime: null,
      measure: null,
      scores: { left: 0, right: 0 },
      winner: null,
      mode: 'wave',
      particle: null,
    };

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const worldX = x => screen.width / 2 + x * screen.scale;
    const nearestCol = px => Math.round(px / CONFIG.gridSize - 0.5);
    const sampleRow = j => Math.min(screen.rows - 1, Math.floor(sampleY(j) * screen.rows));
    const paddleLimit = () => Math.max(0, screen.rows - CONFIG.paddleHeight);

    function resize() {
      const oldRows = screen.rows;
      screen.width = window.innerWidth;
      screen.height = window.innerHeight;
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(screen.width * pixelRatio);
      canvas.height = Math.round(screen.height * pixelRatio);
      canvas.style.width = `${screen.width}px`;
      canvas.style.height = `${screen.height}px`;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      screen.scale = screen.width / CONFIG.worldWidth;
      screen.rows = Math.ceil(screen.height / CONFIG.gridSize);
      screen.cols = Math.ceil(screen.width / CONFIG.gridSize);

      if (!oldRows) {
        paddles.left.row = paddles.right.row = Math.floor(paddleLimit() / 2);
      } else {
        for (const paddle of Object.values(paddles)) {
          paddle.row = clamp(paddle.row, 0, paddleLimit());
        }
      }
    }

    // ── One-dimensional wavefunction ────────────────────────────────────────
    function centralProbability() {
      let total = 0;
      for (let j = 0; j < N; j++) {
        total += psi.re[j] ** 2 + psi.im[j] ** 2;
      }
      return total * dy;
    }

    function getProbability(wave) {
        let total = 0;

        for (let j = 0; j < N; j++) {
            total += wave.re[j] ** 2 + wave.im[j] ** 2;
        }

        return total * dy;
    }

    function normalize(target = 1) {
      const current = centralProbability();
      if (current < 1e-15) return;
      const factor = Math.sqrt(target / current);
      for (let j = 0; j < N; j++) {
        psi.re[j] *= factor;
        psi.im[j] *= factor;
      }
    }

    function normalizeAll() {
        const total =
            getProbability(psi) +
            getProbability(psiLeft) +
            getProbability(psiRight);

        if (total < 1e-15) return;

        const factor = 1 / Math.sqrt(total);

        for (const wave of [psi, psiLeft, psiRight]) {
            for (let j = 0; j < N; j++) {
                wave.re[j] *= factor;
                wave.im[j] *= factor;
            }
        }
    }

    function coupleWaves(a, b, j, angle) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);

      const ar = a.re[j];
      const ai = a.im[j];
      const br = b.re[j];
      const bi = b.im[j];

      a.re[j] = c * ar - s * bi;
      a.im[j] = c * ai + s * br;

      b.re[j] = c * br - s * ai;
      b.im[j] = c * bi + s * ar;
  }

    // Gaussian on [0,1], with hard walls enforced by odd FFT extension.
    function gaussian(center, width, momentum) {
      for (let j = 0; j < N; j++) {
        const distance = sampleY(j) - center;
        const envelope = Math.exp(-(distance ** 2) / (4 * width ** 2));
        const angle = momentum * distance;
        psi.re[j] = envelope * Math.cos(angle);
        psi.im[j] = envelope * Math.sin(angle);
      }
      normalize();
      evolve(0, psi);
    }

    // Odd mirror extension makes the existing FFT obey hard-wall boundaries.
    // Original samples sit at y=(j+1/2)/N. The mirrored half has opposite
    // sign, so the periodic FFT on [-1,1] has nodes at y=0 and y=1.
    const fftReal = new Float64Array(2 * N);
    const fftImaginary = new Float64Array(2 * N);

    function fft(real, imaginary, inverse = false) {
      const size = real.length;
      for (let i = 1, j = 0; i < size; i++) {
        let bit = size >> 1;
        while (j & bit) {
          j ^= bit;
          bit >>= 1;
        }
        j ^= bit;
        if (i < j) {
          [real[i], real[j]] = [real[j], real[i]];
          [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
        }
      }

      for (let length = 2; length <= size; length <<= 1) {
        const angle = (inverse ? 2 : -2) * Math.PI / length;
        const stepReal = Math.cos(angle);
        const stepImaginary = Math.sin(angle);

        for (let start = 0; start < size; start += length) {
          let wr = 1;
          let wi = 0;
          for (let j = 0; j < length / 2; j++) {
            const a = start + j;
            const b = a + length / 2;
            const tr = wr * real[b] - wi * imaginary[b];
            const ti = wr * imaginary[b] + wi * real[b];
            real[b] = real[a] - tr;
            imaginary[b] = imaginary[a] - ti;
            real[a] += tr;
            imaginary[a] += ti;
            const nextWr = wr * stepReal - wi * stepImaginary;
            wi = wr * stepImaginary + wi * stepReal;
            wr = nextWr;
          }
        }
      }

      if (inverse) {
        for (let j = 0; j < size; j++) {
          real[j] /= size;
          imaginary[j] /= size;
        }
      }
    }


    function evolve(dt, wave) {
        const size = 2 * N;
        const probabilityBefore = getProbability(wave);

        for (let j = 0; j < N; j++) {
            fftReal[j] = wave.re[j];
            fftImaginary[j] = wave.im[j];

            fftReal[size - 1 - j] = -wave.re[j];
            fftImaginary[size - 1 - j] = -wave.im[j];
        }

        fft(fftReal, fftImaginary);

        for (let j = 0; j < size; j++) {
          const mode = j <= size / 2 ? j : j - size;
          const k = Math.PI * mode;
          const angle = -CONFIG.kinetic * k * k * dt;

          const co = Math.cos(angle);
          const si = Math.sin(angle);

          const a = fftReal[j];
          const b = fftImaginary[j];

          // Hard cap complexity; smoothly damp the upper retained modes.
          const modeMagnitude = Math.abs(mode);
          const taper = Math.max(0, modeMagnitude - CONFIG.filterStartMode)
              / (CONFIG.maxMode - CONFIG.filterStartMode);
          const filter = modeMagnitude > CONFIG.maxMode ? 0 : Math.exp(
              -CONFIG.filterStrength * taper ** 4 * dt
          );

          fftReal[j] = (a * co - b * si) * filter;
          fftImaginary[j] = (a * si + b * co) * filter;
        }

        fft(fftReal, fftImaginary, true);

        for (let j = 0; j < N; j++) {
            wave.re[j] = fftReal[j];
            wave.im[j] = fftImaginary[j];
        }

        // Filtering changes shape without moving probability between regions.
        const probabilityAfter = getProbability(wave);
        if (probabilityAfter > 0) {
            const scale = Math.sqrt(probabilityBefore / probabilityAfter);
            for (let j = 0; j < N; j++) {
                wave.re[j] *= scale;
                wave.im[j] *= scale;
            }
        }
    }

    function boostFromEdge(dt) {
        if (dt <= 0) return;
        const probability = centralProbability();
        if (probability < 1e-12) return;
        let position = 0;
        let momentum = 0;
        for (let j = 0; j < N; j++) {
            position += sampleY(j) * (psi.re[j] ** 2 + psi.im[j] ** 2) * dy;
            if (j > 0 && j < N - 1) {
                momentum += (psi.re[j] * (psi.im[j + 1] - psi.im[j - 1])
                    - psi.im[j] * (psi.re[j + 1] - psi.re[j - 1])) / 2;
            }
        }
        position /= probability;
        momentum /= probability;
        const direction = position < CONFIG.edgeZone ? 1
            : position > 1 - CONFIG.edgeZone ? -1 : 0;
        if (!direction) return;
        // Accelerate only toward the interior; never slow an escaping packet.
        const deficit = CONFIG.edgeMomentum - direction * momentum;
        if (deficit <= 0) return;
        const distance = direction > 0 ? position : 1 - position;
        const strength = 1 - smoothstep(0, CONFIG.edgeZone, distance);
        const kick = direction * deficit
            * (1 - Math.exp(-CONFIG.edgeRecoveryRate * strength * dt));
        applyMomentum(kick, position);
    }

    function evolveAll(dt) {
        boostFromEdge(dt);
        evolve(dt, psi);
        evolve(dt, psiLeft);
        evolve(dt, psiRight);
    }

    function applyMomentum(kick, center) {
      for (let j = 0; j < N; j++) {
        const angle = kick * (sampleY(j) - center);
        const co = Math.cos(angle);
        const si = Math.sin(angle);
        const a = psi.re[j];
        const b = psi.im[j];
        psi.re[j] = a * co - b * si;
        psi.im[j] = a * si + b * co;
      }
    }

    function interferenceAt(goal, j) {
        const ar = psi.re[j];
        const ai = psi.im[j];

        const br = goal.re[j];
        const bi = goal.im[j];

        const magnitudeA = Math.hypot(ar, ai);
        const magnitudeB = Math.hypot(br, bi);

        if (magnitudeA * magnitudeB < 1e-10) return 0;

        return (bi * ar - br * ai) / (magnitudeA * magnitudeB);
    }

    function interferenceColor(value) {
        // Goal coupling adds i * psi: positive cross terms increase goal density.
        const magnitude = clamp(Math.abs(value), 0, 1);
        // Keep the sign readable for weaker interference; exact zero is neutral.
        const strength = magnitude < 0.05 ? magnitude : 0.45 + 0.55 * magnitude;
        const neutral = CONFIG.colors.neutralRGB;
        const target = value >= 0 ? CONFIG.colors.constructiveRGB : CONFIG.colors.destructiveRGB;
        const rgb = neutral.map((channel, i) =>
            Math.round(channel + (target[i] - channel) * strength)
        );
        return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }

    function smoothstep(a, b, x) {
        const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    }

    function captureStrength(row, top, bottom) {
        const feather = 8; // grid rows

        const upper = smoothstep(top - feather, top, row);
        const lower = 1 - smoothstep(bottom, bottom + feather, row);

        const coverage = upper * lower;

        return 1 - coverage;
    }

    const reflectionSound = { enabled: false, utterance: null };
    function playReflectionSound() {
        // Phonetic spelling makes "poonq" end in a crisp k sound.
        playGameSound('poonk!', 1.5);
    }

    function playGameSound(text, rate, priority = false) {
        const speech = window.speechSynthesis;
        if (!reflectionSound.enabled || !speech || !window.SpeechSynthesisUtterance) return;
        if (speech.speaking || speech.pending) {
            if (!priority || !reflectionSound.utterance) return;
            speech.cancel();
        }
        const utterance = new window.SpeechSynthesisUtterance(text);
        utterance.lang = 'en-GB';
        utterance.rate = rate;
        utterance.pitch = 1.15;
        utterance.volume = 0.7;
        const voices = speech.getVoices();
        const voice = voices.find(voice => voice.localService && voice.lang === 'en-GB')
            || voices.find(voice => voice.localService && voice.lang.startsWith('en'));
        if (voice) utterance.voice = voice;
        reflectionSound.utterance = utterance;
        const finish = () => {
            if (reflectionSound.utterance === utterance) reflectionSound.utterance = null;
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        speech.speak(utterance);
    }

    // ── Gameplay ────────────────────────────────────────────────────────────
    function collide(side) {
        const paddle = paddles[side];
        const goal = side === 'left' ? psiLeft : psiRight;
        const top = Math.round(paddle.row);
        const bottom = top + CONFIG.paddleHeight;
        for (let j = 0; j < N; j++) {
            const strength = captureStrength(sampleRow(j), top, bottom);
            coupleWaves(psi, goal, j, CONFIG.couplingAngle * strength);
        }
        reflectWave(side);
    }

function reflectWave(side) {
    const paddle = paddles[side];
    // Reflect horizontal movement
    game.vx = side === 'left'
        ? Math.abs(CONFIG.horizontalSpeed)
        : -Math.abs(CONFIG.horizontalSpeed);

    // Apply vertical momentum kick to the surviving central wave
    const direction = side === 'left' ? 1 : -1;

    const speedFraction = clamp(paddle.velocity / CONFIG.paddleSpeed, -1, 1);
    const kick = clamp(
        direction * CONFIG.collisionKick
        + speedFraction * CONFIG.motionKick,
        -CONFIG.maxKick,
        CONFIG.maxKick
    );

    applyMomentum(kick, 0.5);
    evolveAll(0);

    game.kick = kick;
    game.bounces++;
    playReflectionSound();
}

    function reset(newMatch = false) {
    if (newMatch) {
        game.scores.left = game.scores.right = 0;
        game.winner = null;
    }
    psiLeft.re.fill(0);
    psiLeft.im.fill(0);
    psiRight.re.fill(0);
    psiRight.im.fill(0);

    game.mode = 'wave';
    game.particle = null;
    game.x = 0;
    game.vx = CONFIG.horizontalSpeed;
    game.phase = 0;
    game.bounces = 0;
    game.kick = CONFIG.initialKick;
    game.flash = 0;
    game.measurementSpot = null;
    game.paused = false;
    game.lastTime = null;
    game.message = null

    gaussian(0.5, CONFIG.initialWidth, game.kick);
    scheduleMeasurement();
}

function scoreGoal(player) {
    game.scores[player]++;
    const playerNumber = player === 'left' ? 1 : 2;
    if (game.scores[player] >= CONFIG.winningScore) {
        game.winner = player;
        game.message = `PLAYER ${playerNumber} WINS!`;
    } else {
        game.message = `PLAYER ${playerNumber} SCORES!`;
    }
    game.paused = true;
}

function scheduleMeasurement() {
    game.measurementRemaining = CONFIG.measurementMinInterval
        + Math.random() * (CONFIG.measurementMaxInterval - CONFIG.measurementMinInterval);
}

function updateMeasurementTimer(dt) {
    if (game.paused || game.mode !== 'wave' || game.measurementRemaining === null) return;
    game.measurementRemaining = Math.max(0, game.measurementRemaining - dt);
    if (game.measurementRemaining === 0) measure();
}

function clearWaves() {
    for (const wave of [psi, psiLeft, psiRight]) {
        wave.re.fill(0);
        wave.im.fill(0);
    }
}

function sampleWavePosition(wave, total = getProbability(wave)) {
    const target = Math.random() * total;
    let accumulated = 0;
    for (let j = 0; j < N; j++) {
        accumulated += (wave.re[j] ** 2 + wave.im[j] ** 2) * dy;
        if (accumulated >= target) return sampleY(j);
    }
    return 0.5;
}

function measure() {
    if (game.paused || game.mode !== 'wave') return;
    const left = getProbability(psiLeft);
    const right = getProbability(psiRight);
    const center = centralProbability();
    const total = left + right + center;
    if (total <= 0) return;
    const outcome = Math.random() * total;
    const region = outcome < left ? 'left' : outcome < left + right ? 'right' : 'field';
    const wave = region === 'left' ? psiLeft : region === 'right' ? psiRight : psi;
    const y = sampleWavePosition(wave);
    const j = clamp(Math.floor(y * N), 1, N - 2);
    const density = wave.re[j] ** 2 + wave.im[j] ** 2;
    // Local phase gradient carries the packet's vertical momentum into Pong.
    const momentum = density > 1e-12 ? (
        wave.re[j] * (wave.im[j + 1] - wave.im[j - 1])
        - wave.im[j] * (wave.re[j + 1] - wave.re[j - 1])
    ) / (2 * dy * density) : 0;
    const goalX = CONFIG.worldWidth / 2 - CONFIG.goalOffset / 2;
    game.particle = {
        x: region === 'field' ? game.x : region === 'left' ? -goalX : goalX,
        y,
        vy: 2 * CONFIG.kinetic * CONFIG.evolutionSpeed * clamp(momentum, -CONFIG.maxKick, CONFIG.maxKick),
        region,
    };
    clearWaves();
    game.mode = 'particle';
    game.measurementRemaining = null;
    game.flash = CONFIG.measurementFlashDuration;
    game.measurementSpot = { x: game.particle.x, y: game.particle.y };
    playGameSound('there it is!', 1.2, true);
    game.message = null;
    if (region !== 'field') scoreGoal(region === 'left' ? 'right' : 'left');
}

function moveParticle(dt) {
    const particle = game.particle;
    particle.x += game.vx * dt;
    particle.y += particle.vy * dt;
    const radiusY = CONFIG.particleRadius / screen.height;
    if (particle.y < radiusY) {
        particle.y = 2 * radiusY - particle.y;
        particle.vy = Math.abs(particle.vy);
    } else if (particle.y > 1 - radiusY) {
        particle.y = 2 * (1 - radiusY) - particle.y;
        particle.vy = -Math.abs(particle.vy);
    }
    const bound = CONFIG.worldWidth / 2 - CONFIG.goalOffset;
    const side = game.vx > 0 ? 'right' : 'left';
    if ((game.vx > 0 && particle.x < bound) || (game.vx < 0 && particle.x > -bound)) return;
    const paddle = paddles[side];
    const row = particle.y * screen.rows;
    const radiusRows = CONFIG.particleRadius / CONFIG.gridSize;
    if (!particle.missedPaddle && row >= paddle.row - radiusRows && row <= paddle.row + CONFIG.paddleHeight + radiusRows) {
        // The first paddle return ends classical Pong and starts dispersion.
        game.x = side === 'left' ? -bound : bound;
        gaussian(particle.y, CONFIG.collapseWidth,
            clamp(particle.vy / (2 * CONFIG.kinetic * CONFIG.evolutionSpeed), -CONFIG.maxKick, CONFIG.maxKick));
        reflectWave(side);
        game.mode = 'wave';
        game.particle = null;
        scheduleMeasurement();
    } else {
        particle.missedPaddle = true;
        const goalX = CONFIG.worldWidth / 2 - CONFIG.goalOffset / 2;
        if (Math.abs(particle.x) < goalX) return;
        particle.x = side === 'left' ? -goalX : goalX;
        particle.region = side;
        scoreGoal(side === 'left' ? 'right' : 'left');
    }
}

function easeOutElastic(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 + 2 ** (-10 * t) * Math.sin((10 * t - 0.75) * (2 * Math.PI / 3));
}

function drawMeasurementFlash() {
    if (game.flash <= 0 || !game.measurementSpot) return;
    const spot = game.particle || game.measurementSpot;
    const progress = clamp(1 - game.flash / CONFIG.measurementFlashDuration, 0, 1);
    const expansion = easeOutElastic(progress);
    const radius = CONFIG.particleRadius + 5
        + (CONFIG.measurementFlashRadius - CONFIG.particleRadius - 5) * expansion;
    const pulse = 0.5 + 0.5 * Math.cos(progress * 6 * Math.PI);
    const fade = 1 - progress;
    const x = worldX(spot.x);
    const y = spot.y * screen.height;
    ctx.save();
    ctx.fillStyle = `rgba(${CONFIG.colors.flashRGB.join(", ")}, ${0.65 * pulse * fade})`;
    ctx.beginPath();
    ctx.arc(x, y, radius * (0.55 + 0.08 * pulse), 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = `rgba(${CONFIG.colors.flashRGB.join(", ")}, ${fade * (0.35 + 0.65 * pulse)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
}

function drawParticle() {
    const particle = game.particle;
    ctx.fillStyle = CONFIG.colors.foreground;
    ctx.beginPath();
    ctx.arc(worldX(particle.x), particle.y * screen.height, CONFIG.particleRadius, 0, 2 * Math.PI);
    ctx.fill();
}

function shiftGoalPhase(side) {
    if (game.paused || game.mode !== 'wave') return;
    const wave = side === 'left' ? psiLeft : psiRight;
    const co = Math.cos(CONFIG.goalPhaseStep);
    const si = Math.sin(CONFIG.goalPhaseStep);
    for (let j = 0; j < N; j++) {
        const re = wave.re[j];
        const im = wave.im[j];
        wave.re[j] = re * co - im * si;
        wave.im[j] = re * si + im * co;
    }
}

    // ── Input ───────────────────────────────────────────────────────────────
    const handledKeys = new Set(['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'KeyR', 'KeyA', 'Enter', 'NumpadEnter']);
    window.addEventListener('pointerdown', () => { reflectionSound.enabled = true; });
    window.addEventListener('keydown', event => {
      reflectionSound.enabled = true;
      if (!handledKeys.has(event.code)) return;
      event.preventDefault();
      keys.add(event.code);
      if (event.repeat) return;
      if (event.code === 'KeyA') shiftGoalPhase('left');
      if (event.code === 'Enter' || event.code === 'NumpadEnter') shiftGoalPhase('right');
      if (event.code === 'KeyR') reset(game.winner !== null);
    });
    window.addEventListener('keyup', event => keys.delete(event.code));
    window.addEventListener('blur', () => keys.clear());
    window.addEventListener('resize', resize);

    function movePaddles(dt) {
      paddles.left.velocity = CONFIG.paddleSpeed * (
        Number(keys.has('KeyS')) - Number(keys.has('KeyW'))
      );
      paddles.right.velocity = CONFIG.paddleSpeed * (
        Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'))
      );
      for (const paddle of Object.values(paddles)) {
        const previousRow = paddle.row;
        paddle.row = clamp(previousRow + paddle.velocity * dt, 0, paddleLimit());
        // Use actual movement: pushing against an edge must not add a kick.
        paddle.velocity = dt > 0 ? (paddle.row - previousRow) / dt : 0;
      }
    }

    // ── Fixed-grid rendering ────────────────────────────────────────────────
    function drawCell(col, row, color) {
      if (col < 0 || col >= screen.cols || row < 0 || row >= screen.rows) return;
      ctx.fillStyle = color;
      ctx.fillRect(
        col * CONFIG.gridSize + CONFIG.gridGap / 2,
        row * CONFIG.gridSize + CONFIG.gridGap / 2,
        cellSize,
        cellSize
      );
    }

    function drawPaddle(side, x) {
      const center = nearestCol(worldX(x));
      const startCol = center - Math.floor(CONFIG.paddleWidth / 2);
      const startRow = Math.round(paddles[side].row);
      for (let row = 0; row < CONFIG.paddleHeight; row++) {
        for (let col = 0; col < CONFIG.paddleWidth; col++) {
          drawCell(startCol + col, startRow + row, CONFIG.colors.foreground);
        }
      }
    }

    function drawCenterLine() {
        const centerCol = nearestCol(worldX(0));

        for (let row = 0; row < screen.rows; row++) {
            drawCell(centerCol, row, CONFIG.colors.divider);
        }
    }

    function drawGoals(leftCol, rightCol) {
      const leftRows = new Float64Array(screen.rows);
      const rightRows = new Float64Array(screen.rows);
      for (let j = 0; j < N; j++) {
        const row = sampleRow(j);
        leftRows[row] += goals.left.density[j];
        rightRows[row] += goals.right.density[j];
      }
      let peak = 0.002;
      for (let row = 0; row < screen.rows; row++) {
        peak = Math.max(peak, leftRows[row], rightRows[row]);
      }
      for (let row = 0; row < screen.rows; row++) {
        const leftWidth = Math.min(leftCol, Math.round(leftRows[row] / peak * Math.min(7, leftCol - 1)));
        const rightWidth = Math.min(screen.cols - rightCol - 1, Math.round(rightRows[row] / peak * 7));
        for (let col = 0; col < leftWidth; col++) drawCell(leftCol - 2 - col, row, CONFIG.colors.goal);
        for (let col = 0; col < rightWidth; col++) drawCell(rightCol + 2 + col, row, CONFIG.colors.goal);
      }
    }

  function sampleCentralPosition(total = centralProbability()) {
    const target = Math.random() * total;
    let accumulated = 0;

    for (let j = 0; j < N; j++) {
        accumulated += (
            psi.re[j] ** 2 +
            psi.im[j] ** 2
        ) * dy;

        if (accumulated >= target) {
            return sampleY(j);
        }
    }

    return 0.5;
}

function drawWave(wave, x, side = null) {
    // Draw even for empty goal waves so zero always has a visible reference.
    ctx.strokeStyle = CONFIG.colors.baseline;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(worldX(x), 0);
    ctx.lineTo(worldX(x), screen.height);
    ctx.stroke();
    ctx.setLineDash([]);

    let maximum = 0;
    for (let j = 0; j < N; j++) {
        maximum = Math.max(maximum, wave.re[j] ** 2 + wave.im[j] ** 2);
    }
    if (maximum < 1e-10) return;
    const gain = CONFIG.densityGain;
    // Goals point inward; the moving field points toward its destination.
    const direction = side === 'left' ? 1
        : side === 'right' ? -1
        : game.vx >= 0 ? 1 : -1;
    const pointX = j => worldX(x + direction * (wave.re[j] ** 2 + wave.im[j] ** 2) * gain);
    const pointY = j => sampleY(j) * screen.height;

    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (side === null) {
        ctx.strokeStyle = CONFIG.colors.foreground;
        ctx.beginPath();
        ctx.moveTo(worldX(x), 0);
        for (let j = 0; j < N; j++) ctx.lineTo(pointX(j), pointY(j));
        ctx.lineTo(worldX(x), screen.height);
        ctx.stroke();
    } else {
        // Colored ribbons expose the interference across the full density area.
        ctx.lineWidth = 5;
        let previousX = worldX(x);
        let previousY = 0;
        for (let j = 0; j <= N; j++) {
            const nextX = j < N ? pointX(j) : worldX(x);
            const nextY = j < N ? pointY(j) : screen.height;
            const interference = interferenceAt(wave, Math.min(j, N - 1));
            const color = interferenceColor(interference);
            ctx.save();
            ctx.globalAlpha = 0.18 + 0.32 * Math.abs(interference);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(worldX(x), previousY);
            ctx.lineTo(previousX, previousY);
            ctx.lineTo(nextX, nextY);
            ctx.lineTo(worldX(x), nextY);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(previousX, previousY);
            ctx.lineTo(nextX, nextY);
            ctx.stroke();
            previousX = nextX;
            previousY = nextY;
        }
    }
}

    function render() {
      ctx.fillStyle = CONFIG.colors.background;
      ctx.fillRect(0, 0, screen.width, screen.height);
      const bound = CONFIG.worldWidth / 2 - CONFIG.goalOffset;
      const leftCol = nearestCol(worldX(-bound));
      const rightCol = nearestCol(worldX(bound));
      drawCenterLine()
      drawGoals(leftCol, rightCol);
      const goalX = CONFIG.worldWidth / 2 - CONFIG.goalOffset / 2;

      drawMeasurementFlash();
      if (game.mode === 'particle') {
          drawParticle();
      } else {
          drawWave(psiLeft, -goalX, 'left');
          drawWave(psi, game.x);
          drawWave(psiRight, goalX, 'right');
      }
      drawPaddle('left', -bound);
      drawPaddle('right', bound);

        const percentage = (region, wave) => game.mode === 'particle'
            ? (game.particle.region === region ? 100 : 0)
            : Math.round(getProbability(wave) * 100);
        const percentageY = 76;
        drawGridText(`${percentage('left', psiLeft)}%`, worldX(-goalX), percentageY,
            6, CONFIG.colors.foreground, screen.width * 0.18);
        drawGridText(`${percentage('field', psi)}%`, worldX(0), percentageY,
            6, CONFIG.colors.foreground, screen.width * 0.28);
        drawGridText(`${percentage('right', psiRight)}%`, worldX(goalX), percentageY,
            6, CONFIG.colors.foreground, screen.width * 0.18);

        ctx.fillStyle = CONFIG.colors.panel;
        ctx.fillRect(0, 0, screen.width, 60);
        ctx.fillStyle = CONFIG.colors.border;
        ctx.fillRect(0, 59, screen.width, 1);
        drawGridText(`PLAYER 1: ${game.scores.left}`, screen.width * 0.19, 18,
            3, CONFIG.colors.foreground, screen.width * 0.34);
        drawGridText(`PLAYER 2: ${game.scores.right}`, screen.width * 0.81, 18,
            3, CONFIG.colors.foreground, screen.width * 0.34);
        drawGridText(`FIRST TO ${CONFIG.winningScore}`, screen.width / 2, 20,
            2.5, CONFIG.colors.accent, screen.width * 0.24);

        if (game.mode === 'wave') {
            ctx.fillStyle = CONFIG.colors.panel;
            ctx.fillRect(0, screen.height - 40, screen.width, 40);
            drawGridText('RED: CONSTRUCTIVE', screen.width * 0.25, screen.height - 29,
                2.5, interferenceColor(1), screen.width * 0.46);
            drawGridText('GREEN: DESTRUCTIVE', screen.width * 0.75, screen.height - 29,
                2.5, interferenceColor(-1), screen.width * 0.46);
        }

        if (!game.paused && game.mode === 'wave'
            && game.measurementRemaining !== null
            && game.measurementRemaining <= CONFIG.measurementWarning) {
            const warningWidth = Math.min(screen.width - 24, 440);
            ctx.fillStyle = CONFIG.colors.panel;
            ctx.fillRect((screen.width - warningWidth) / 2, screen.height - 108, warningWidth, 52);
            ctx.strokeStyle = CONFIG.colors.accent;
            ctx.lineWidth = 2;
            ctx.strokeRect((screen.width - warningWidth) / 2, screen.height - 108, warningWidth, 52);
            drawGridText(`MEASUREMENT IN ${Math.ceil(game.measurementRemaining)}S`,
                screen.width / 2, screen.height - 94, 3.5,
                CONFIG.colors.accent, warningWidth - 24);
        }

        if (game.message) {
            const panelWidth = Math.min(screen.width - 32, 640);
            ctx.fillStyle = CONFIG.colors.panel;
            ctx.fillRect((screen.width - panelWidth) / 2, screen.height / 2 - 70, panelWidth, 140);
            ctx.strokeStyle = CONFIG.colors.border;
            ctx.lineWidth = 2;
            ctx.strokeRect((screen.width - panelWidth) / 2, screen.height / 2 - 70, panelWidth, 140);
            drawGridText(game.message, screen.width / 2, screen.height / 2 - 42,
                5, CONFIG.colors.foreground, panelWidth - 32);
            drawGridText(game.winner ? 'PRESS R FOR A NEW MATCH' : 'PRESS R FOR NEXT ROUND',
                screen.width / 2, screen.height / 2 + 20,
                3, CONFIG.colors.accent, panelWidth - 32);
        }

      // ui.left.textContent = `LEFT goal: ${(goals.left.probability * 100).toFixed(1)}%`;
      // ui.center.textContent = `IN PLAY: ${(centralProbability() * 100).toFixed(1)}% · kick ${game.kick.toFixed(0)}`;
      // ui.right.textContent = `RIGHT goal: ${(goals.right.probability * 100).toFixed(1)}%`;

    }

    // ── Main loop ────────────────────────────────────────────────────────────
    function animate(timestamp) {
      const now = timestamp / 1000;
      const dt = game.lastTime === null ? 0 : Math.min(CONFIG.maxFrameTime, now - game.lastTime);
      game.lastTime = now;

      if (!game.paused) {
        movePaddles(dt);
        if (game.mode === 'particle') {
            moveParticle(dt);
        } else {
        for (let step = 0; step < CONFIG.substeps; step++) {
              evolveAll(
                  dt * CONFIG.evolutionSpeed / CONFIG.substeps
              );
        }
        normalizeAll();
        game.x += game.vx * dt;
        const bound = CONFIG.worldWidth / 2 - CONFIG.goalOffset;
        if (game.x >= bound) {
          game.x = bound;
          collide('right');
        } else if (game.x <= -bound) {
          game.x = -bound;
          collide('left');
        }
        }
      }

      updateMeasurementTimer(dt);
      // Measurement feedback continues even when a goal pauses gameplay.
      game.flash = Math.max(0, game.flash - dt);
      render();
      requestAnimationFrame(animate);
    }

    resize();
    reset();
    requestAnimationFrame(animate);


