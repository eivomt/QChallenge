//  * Grid-aligned 5×7 bitmap font.
//  *
//  * position is { x, y } in GRID CELLS, not canvas pixels.
//  * Each font pixel occupies one game cell, using the same gap.
//  *
//  * Usage:
//  *   import { createGridFont } from './grid-font.js';
//  *   const { write, measure } = createGridFont(ctx, {
//  *     gridSize: CONFIG.gridSize,
//  *     gap: CONFIG.gridGap,
//  *     color: CONFIG.colors.real
//  *   });
//  *   write('LEFT 42%', { x: 3, y: 3 });
//  *   write('QUANTUM PONG', { x: screen.cols / 2, y: 3 }, 'center');
//  */

const FONT = {
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01111','10000','10000','10000','10000','10000','01111'],
  D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01111','10000','10000','10111','10001','10001','01111'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  I: ['11111','00100','00100','00100','00100','00100','11111'],
  J: ['00111','00010','00010','00010','10010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'],
  L: ['10000','10000','10000','10000','10000','10000','11111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
  N: ['10001','11001','10101','10011','10001','10001','10001'],
  O: ['01110','10001','10001','10001','10001','10001','01110'],
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','10101','01010'],
  X: ['10001','10001','01010','00100','01010','10001','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'],
  Z: ['11111','00001','00010','00100','01000','10000','11111'],
  0: ['01110','10011','10101','10101','11001','10001','01110'],
  1: ['00100','01100','00100','00100','00100','00100','01110'],
  2: ['01110','10001','00001','00010','00100','01000','11111'],
  3: ['11110','00001','00001','01110','00001','00001','11110'],
  4: ['00010','00110','01010','10010','11111','00010','00010'],
  5: ['11111','10000','10000','11110','00001','00001','11110'],
  6: ['01111','10000','10000','11110','10001','10001','01110'],
  7: ['11111','00001','00010','00100','01000','01000','01000'],
  8: ['01110','10001','10001','01110','10001','10001','01110'],
  9: ['01110','10001','10001','01111','00001','00001','11110'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  '.': ['00000','00000','00000','00000','00000','01100','01100'],
  ':': ['00000','01100','01100','00000','01100','01100','00000'],
  '%': ['11001','11010','00100','00100','01011','10011','00000'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '/': ['00001','00001','00010','00100','01000','10000','10000'],
  '!': ['00100','00100','00100','00100','00100','00000','00100'],
  '?': ['01110','10001','00001','00010','00100','00000','00100'],
  '+': ['00000','00100','00100','11111','00100','00100','00000'],
  '(': ['00010','00100','01000','01000','01000','00100','00010'],
  ')': ['01000','00100','00010','00010','00010','00100','01000'],
  '=': ['00000','11111','00000','11111','00000','00000','00000']
};

const LETTER_WIDTH = 5;
const LETTER_HEIGHT = 7;

export function createGridFont(ctx, {
  gridSize,
  gap = 0,
  color = '#02100b',
  letterSpacing = 1
}) {
  if (!ctx || !(gridSize > 0) || gap < 0 || gap >= gridSize ||
      !Number.isInteger(letterSpacing) || letterSpacing < 0) {
    throw new Error('Invalid grid font configuration');
  }

  const advance = LETTER_WIDTH + letterSpacing;

  // Width is in game grid cells; trailing letter spacing is excluded.
  function measure(string) {
    const lines = String(string).split('\n');
    return {
      width: Math.max(0, ...lines.map(line =>
        line.length ? line.length * advance - letterSpacing : 0)),
      height: lines.length * LETTER_HEIGHT + (lines.length - 1)
    };
  }

  function write(string, position, positioning = 'left') {
    if (positioning !== 'left' && positioning !== 'center') {
      throw new Error('positioning must be "left" or "center"');
    }

    const { x, y } = position;
    const cellSize = gridSize - gap;
    const lines = String(string).toUpperCase().split('\n');
    ctx.fillStyle = color;

    lines.forEach((line, lineIndex) => {
      const width = line.length ? line.length * advance - letterSpacing : 0;
      // Round the START position once so every glyph stays grid-locked.
      const startX = Math.round(positioning === 'center' ? x - width / 2 : x);
      const startY = Math.round(y) + lineIndex * (LETTER_HEIGHT + 1);

      for (let i = 0; i < line.length; i++) {
        const glyph = FONT[line[i]] || FONT['?'];
        for (let row = 0; row < LETTER_HEIGHT; row++) {
          for (let col = 0; col < LETTER_WIDTH; col++) {
            if (glyph[row][col] !== '1') continue;
            const cellX = startX + i * advance + col;
            const cellY = startY + row;
            ctx.fillRect(
              cellX * gridSize + gap / 2,
              cellY * gridSize + gap / 2,
              cellSize,
              cellSize
            );
          }
        }
      }
    });
  }

  return { write, measure };
}