const canvas = document.getElementById("c")
const ctx = canvas.getContext("2d")

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const W = canvas.width;
const H = canvas.height;



const L = 100;

const scale = W / L;

function X(x) {
    return W / 2 + x * scale;
}

function Y(y) {
    return H / 2 - y * scale;
}

function drawX() {
        for (let px = 0; px < W; px++) {
        const x = (px - W / 2) / scale;
        const y = f(x);

        if (px === 0) ctx.moveTo(px, Y(y));
        else ctx.lineTo(px, Y(y));
    }
}

let t = 0;
const omega = 2;
let v = 10
let x0 = 0;
let offset = 10
let phase = 0

const gridSize = 30; // Distance between square centres, in pixels
const gap = 10;       // Space between adjacent squares
const pixelSize = gridSize - gap;

const pW = 2;  // Paddle width in grid cells
const pH = 10;  // Paddle height in grid cells

const paddleColor = "rgb(2, 16, 11)";

const paddleSpeed = 1; // Grid cells per key press

const rows = Math.floor(H / gridSize);

let leftPaddleY = Math.floor((rows - pH) / 2);
let rightPaddleY = Math.floor((rows - pH) / 2);

// nth harmonic
function f(x, n, imaginary = false) {
    const spatial = 0.05 * L * Math.cos(Math.PI * x * n / L);
    const angle = omega * t + phase;

    return spatial * (
        imaginary
            ? -Math.sin(angle)
            : Math.cos(angle)
    );
}

function drawY(x0, imaginary = false) {
    ctx.fillStyle = imaginary ? "rgb(106, 135, 99)" : "rgb(2, 16, 11)";

    const cols = Math.ceil(W / gridSize);
    const rows = Math.ceil(H / gridSize);

    for (let row = 0; row < rows; row++) {
        const py = (row + 0.5) * gridSize;
        const y = (H / 2 - py) / scale;

        // Actual wave position in mathematical coordinates
        const x = x0 + f(y, 6, imaginary);

        // Convert to screen coordinates
        const px = X(x);

        // Find the closest grid column
        const col = Math.round(px / gridSize - 0.5);

        if (col < 0 || col >= cols) continue;

        // Draw the corresponding fixed grid cell
        ctx.fillRect(
            col * gridSize + gap / 2,
            row * gridSize + gap / 2,
            pixelSize,
            pixelSize
        );
    }
    // Draw the standing wave's centre position
    if (!imaginary) {
        const centerCol = Math.round(X(x0) / gridSize - 0.5);

        ctx.fillStyle = "rgb(2, 16, 11,.1)";

        for (let row = 0; row < rows; row++) {
            ctx.fillRect(
                centerCol * gridSize + gap / 2,
                row * gridSize + gap / 2,
                pixelSize,
                pixelSize
            );
        }
    }
}

function drawPaddle(x, startRow) {
    ctx.fillStyle = paddleColor;

    const cols = Math.ceil(W / gridSize);
    const centerCol = Math.round(X(x) / gridSize - 0.5);
    const startCol = centerCol - Math.floor(pW / 2);

    for (let row = 0; row < pH; row++) {
        for (let col = 0; col < pW; col++) {
            const c = startCol + col;
            const r = startRow + row;

            if (c < 0 || c >= cols || r < 0 || r >= rows) {
                continue;
            }

            ctx.fillRect(
                c * gridSize + gap / 2,
                r * gridSize + gap / 2,
                pixelSize,
                pixelSize
            );
        }
    }
}

const keys = new Set();

document.addEventListener("keydown", e => {
    if (["KeyW", "KeyS", "ArrowUp", "ArrowDown"].includes(e.code)) {
        e.preventDefault();
        keys.add(e.code);
    }
});

document.addEventListener("keyup", e => {
    keys.delete(e.code);
});

window.addEventListener("blur", () => keys.clear());



let lastTime = 0;

function animate(timestamp) {
    const now = timestamp / 600;
    const dt = lastTime ? now - lastTime : 0;
    lastTime = now;

    const speed = 10; // Grid cells per second

    if (keys.has("KeyW")) leftPaddleY -= speed * dt;
    if (keys.has("KeyS")) leftPaddleY += speed * dt;

    if (keys.has("ArrowUp")) rightPaddleY -= speed * dt;
    if (keys.has("ArrowDown")) rightPaddleY += speed * dt;

    // Clamp paddle positions
    leftPaddleY = Math.max(0, Math.min(rows - pH, leftPaddleY));
    rightPaddleY = Math.max(0, Math.min(rows - pH, rightPaddleY));

    t += dt;
    x0 += v * dt;

    if (x0 >= (L / 2) - offset) {
        x0 = (L / 2) - offset;
        v = -Math.abs(v);
        phase += Math.PI;
    } else if (x0 <= (-L / 2) + offset) {
        x0 = (-L / 2) + offset;
        v = Math.abs(v);
        phase += Math.PI;
    }

    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 5;
    
    drawY(x0, true); // Imaginary part: green
    drawY(x0);       // Real part: white

    drawPaddle(-L / 2 + offset, Math.round(leftPaddleY));
    drawPaddle( L / 2 - offset, Math.round(rightPaddleY));


    requestAnimationFrame(animate);
}

requestAnimationFrame(animate);