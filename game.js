    import { createGridFont } from './font.js';
    'use strict';

    // ── Configuration ───────────────────────────────────────────────────────
    const CONFIG = {
      worldWidth: 100,
      goalOffset: 20,
      horizontalSpeed: 17,
      gridSize: 6,
      gridGap: 1,
      paddleWidth: 2,
      paddleHeight: 64,
      paddleSpeed: 128,                 // grid rows / second
      samples: 256,                    // power of two for FFT
      kinetic: 0.00022,
      initialWidth: 0.025,
      collapseWidth: 0.032,
      initialKick: 26,
      collisionKick: 66,
      motionKick: 3.5,
      contactKick: 95,
      maxKick: 145,
      substeps: 3,
      maxFrameTime: 0.05,
      colors: {
        background: '#c3d5af',
        real: 'rgb(2, 16, 11)',
        imaginary: 'rgb(106, 135, 99)',
        goal: 'rgba(2, 16, 11, 0.45)',
        center: 'rgba(2, 16, 11, 0.10)',
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

    const {write} = createGridFont(ctx, {
    gridSize: CONFIG.gridSize,
    gap: CONFIG.gridGap,
    color: CONFIG.colors.real
    });

    const N = CONFIG.samples;
    const dy = 1 / N;
    const sampleY = j => (j + 0.5) * dy;
    const cellSize = CONFIG.gridSize - CONFIG.gridGap;
    const keys = new Set();

    // Complex wavefunction and absorbed probability density (per sample).
    const psi = { re: new Float64Array(N), im: new Float64Array(N) };
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
      lastTime: null,
    };

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const worldX = x => screen.width / 2 + x * screen.scale;
    const nearestCol = px => Math.round(px / CONFIG.gridSize - 0.5);
    const sampleRow = j => Math.min(screen.rows - 1, Math.floor(sampleY(j) * screen.rows));
    const paddleLimit = () => Math.max(0, screen.rows - CONFIG.paddleHeight);

    function resize() {
      const oldRows = screen.rows;
      screen.width = canvas.width = window.innerWidth;
      screen.height = canvas.height = window.innerHeight;
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

    function normalize(target = 1) {
      const current = centralProbability();
      if (current < 1e-15) return;
      const factor = Math.sqrt(target / current);
      for (let j = 0; j < N; j++) {
        psi.re[j] *= factor;
        psi.im[j] *= factor;
      }
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


    function evolve(dt) {
      const size = 2 * N;

      for (let j = 0; j < N; j++) {
        fftReal[j] = psi.re[j];
        fftImaginary[j] = psi.im[j];
        fftReal[size - 1 - j] = -psi.re[j];
        fftImaginary[size - 1 - j] = -psi.im[j];
      }

      fft(fftReal, fftImaginary);

      for (let j = 0; j < size; j++) {
        const mode = j <= size / 2 ? j : j - size;
        const k = Math.PI * mode; // mirrored domain length = 2
        const angle = -CONFIG.kinetic * k * k * dt;
        const co = Math.cos(angle);
        const si = Math.sin(angle);
        const a = fftReal[j];
        const b = fftImaginary[j];
        fftReal[j] = a * co - b * si;
        fftImaginary[j] = a * si + b * co;
      }

      fft(fftReal, fftImaginary, true);

      for (let j = 0; j < N; j++) {
        psi.re[j] = fftReal[j];
        psi.im[j] = fftImaginary[j];
      }
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

    // ── Gameplay ────────────────────────────────────────────────────────────
    function collide(side) {
      const paddle = paddles[side];
      const top = Math.round(paddle.row);
      const goal = goals[side];
      let captured = 0;
      let remaining = 0;
      let centroid = 0;

      for (let j = 0; j < N; j++) {
        const row = sampleRow(j);
        const probability = (psi.re[j] ** 2 + psi.im[j] ** 2) * dy;
        const covered = row >= top && row < top + CONFIG.paddleHeight;

        if (covered) {
          remaining += probability;
          centroid += probability * sampleY(j);
        } else {
          captured += probability;
          goal.density[j] += probability;
          psi.re[j] = 0;
          psi.im[j] = 0;
        }
      }
      goal.probability += captured;

      if (remaining > 1e-12) {
        centroid /= remaining;
        game.bounces++;
        const paddleCenter = (top + CONFIG.paddleHeight / 2) / screen.rows;
        const contact = clamp(centroid - paddleCenter, -0.5, 0.5);
        const baseline = (game.bounces % 2 ? 1 : -1) * CONFIG.collisionKick;
        game.kick = clamp(
          baseline + paddle.velocity * CONFIG.motionKick + contact * CONFIG.contactKick,
          -CONFIG.maxKick,
          CONFIG.maxKick
        );
        applyMomentum(game.kick, centroid);
      }

      game.vx = side === 'left' ? Math.abs(game.vx) : -Math.abs(game.vx);
      game.phase += Math.PI;
    }

    function reset() {
      for (const goal of Object.values(goals)) {
        goal.density.fill(0);
        goal.probability = 0;
      }
      game.x = 0;
      game.vx = CONFIG.horizontalSpeed;
      game.phase = 0;
      game.bounces = 0;
      game.kick = CONFIG.initialKick;
      game.flash = 0;
      game.paused = false;
      gaussian(0.5, CONFIG.initialWidth, game.kick);
    }

    function sampleCentralPosition(total) {
      const target = Math.random() * total;
      let accumulated = 0;
      for (let j = 0; j < N; j++) {
        accumulated += (psi.re[j] ** 2 + psi.im[j] ** 2) * dy;
        if (accumulated >= target) return sampleY(j);
      }
      return 0.5;
    }

    function measure() {
      if (game.paused) return;
      const center = centralProbability();
      const total = goals.left.probability + goals.right.probability + center;
      if (total <= 0) return;
      const outcome = Math.random() * total;

      if (outcome < goals.left.probability) {
        // ui.message.textContent = 'Particle in LEFT goal — right player scores! Press R';
        game.paused = true;
        return;
      }
      if (outcome < goals.left.probability + goals.right.probability) {
        // ui.message.textContent = 'Particle in RIGHT goal — left player scores! Press R';
        game.paused = true;
        return;
      }

      // A central outcome rules out both goals: reset them and localize the wave.
      const position = sampleCentralPosition(center);
      for (const goal of Object.values(goals)) {
        goal.density.fill(0);
        goal.probability = 0;
      }
      game.bounces = 0;
      game.kick = (Math.random() < 0.5 ? -1 : 1) * (65 + Math.random() * 35);
      gaussian(position, CONFIG.collapseWidth, game.kick);
      game.x = 0;
      game.vx = (Math.random() < 0.5 ? -1 : 1) * CONFIG.horizontalSpeed;
      game.flash = 0.45;
      // ui.message.textContent = 'Central measurement: localized, new vertical momentum';
    }

    // ── Input ───────────────────────────────────────────────────────────────
    const handledKeys = new Set(['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'Space', 'KeyR']);
    window.addEventListener('keydown', event => {
      if (!handledKeys.has(event.code)) return;
      event.preventDefault();
      keys.add(event.code);
      if (event.repeat) return;
      if (event.code === 'Space') measure();
      if (event.code === 'KeyR') reset();
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
        paddle.row = clamp(paddle.row + paddle.velocity * dt, 0, paddleLimit());
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
          drawCell(startCol + col, startRow + row, CONFIG.colors.real);
        }
      }
    }

    function drawCenterLine() {
        const centerCol = nearestCol(worldX(0));

        for (let row = 0; row < screen.rows; row++) {
            drawCell(centerCol, row, CONFIG.colors.imaginary);
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

    function drawWave() {
      const centerCol = nearestCol(worldX(game.x));
      for (let row = 0; row < screen.rows; row++) {
        drawCell(centerCol, row, CONFIG.colors.center);
      }

      // Normalize only the visual scale; do not renormalize physical probability.
      let maximum = 0;
      for (let j = 0; j < N; j++) {
        maximum = Math.max(maximum, Math.hypot(psi.re[j], psi.im[j]));
      }
      const gain = maximum > 1e-10 ? Math.min(6, 4 / maximum) : 0;

      for (let row = 0; row < screen.rows; row++) {
        const j = Math.min(N - 1, Math.floor((row + 0.5) / screen.rows * N));
        drawCell(nearestCol(worldX(game.x + psi.im[j] * gain)), row, CONFIG.colors.imaginary);
        drawCell(nearestCol(worldX(game.x + psi.re[j] * gain)), row, CONFIG.colors.real);
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
      drawWave();
      drawPaddle('left', -bound);
      drawPaddle('right', bound);

        write(
            `${Math.round(goals.left.probability * 100)}%`,
            {
                x: worldX(-CONFIG.worldWidth / 2 + CONFIG.goalOffset / 2)
                / CONFIG.gridSize,
                y: ((CONFIG.goalOffset / 4) * screen.scale) / CONFIG.gridSize - 3.5
            },
            "center"
        );

        write(
            `${Math.round(goals.right.probability * 100)}%`,
            {
                x: worldX(CONFIG.worldWidth / 2 - CONFIG.goalOffset / 2)
                / CONFIG.gridSize,
                y: ((CONFIG.goalOffset / 4) * screen.scale) / CONFIG.gridSize - 3.5
            },
            "center"
        );

        write(
            `${Math.round(centralProbability() * 100)}%`,
            {
                x: worldX(0) / CONFIG.gridSize,
                y: ((CONFIG.goalOffset / 4) * screen.scale)
                / CONFIG.gridSize - 3.5
            },
            "center"
        );

      // ui.left.textContent = `LEFT goal: ${(goals.left.probability * 100).toFixed(1)}%`;
      // ui.center.textContent = `IN PLAY: ${(centralProbability() * 100).toFixed(1)}% · kick ${game.kick.toFixed(0)}`;
      // ui.right.textContent = `RIGHT goal: ${(goals.right.probability * 100).toFixed(1)}%`;

      if (game.flash > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.55, game.flash)})`;
        ctx.fillRect(0, 0, screen.width, screen.height);
      }
    }

    // ── Main loop ────────────────────────────────────────────────────────────
    function animate(timestamp) {
      const now = timestamp / 1000;
      const dt = game.lastTime === null ? 0 : Math.min(CONFIG.maxFrameTime, now - game.lastTime);
      game.lastTime = now;

      if (!game.paused) {
        movePaddles(dt);
        for (let step = 0; step < CONFIG.substeps; step++) {
          evolve(dt / CONFIG.substeps);
        }
        game.x += game.vx * dt;
        const bound = CONFIG.worldWidth / 2 - CONFIG.goalOffset;
        if (game.x >= bound) {
          game.x = bound;
          collide('right');
        } else if (game.x <= -bound) {
          game.x = -bound;
          collide('left');
        }
        game.flash = Math.max(0, game.flash - dt);
      }

      render();
      requestAnimationFrame(animate);
    }

    resize();
    reset();
    requestAnimationFrame(animate);


