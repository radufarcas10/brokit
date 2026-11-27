// A tiny sketch pad: pick a color and a brush, draw with the mouse, a pen or a finger.
const canvas = document.querySelector('canvas');
// willReadFrequently: the check reads pixels back with getImageData.
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const state = { color: '#17191f', size: 8, strokes: [], ready: false };
let stroke = null;

function paper() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#dcdad2';
  for (let x = 10; x < canvas.width; x += 20) {
    for (let y = 10; y < canvas.height; y += 20) ctx.fillRect(x, y, 1, 1);
  }
}

function line(from, to) {
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(...from);
  ctx.lineTo(...to);
  ctx.stroke();
}

function dot([x, y]) {
  ctx.fillStyle = stroke.color;
  ctx.beginPath();
  ctx.arc(x, y, stroke.size / 2, 0, 2 * Math.PI);
  ctx.fill();
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  stroke = { color: state.color, size: state.size, points: [[e.offsetX, e.offsetY]] };
  state.strokes.push(stroke);
  dot(stroke.points[0]);
});
canvas.addEventListener('pointermove', (e) => {
  if (!stroke) return;
  const point = [e.offsetX, e.offsetY];
  line(stroke.points.at(-1), point);
  stroke.points.push(point);
});
canvas.addEventListener('pointerup', () => (stroke = null));

function choose(selector, button) {
  for (const b of document.querySelectorAll(selector)) b.setAttribute('aria-pressed', String(b === button));
}
for (const b of document.querySelectorAll('.swatch')) {
  b.addEventListener('click', () => {
    state.color = b.dataset.color;
    choose('.swatch', b);
  });
}
for (const b of document.querySelectorAll('.size')) {
  b.addEventListener('click', () => {
    state.size = Number(b.dataset.size);
    choose('.size', b);
  });
}
document.getElementById('clear').addEventListener('click', () => {
  state.strokes.length = 0;
  paper();
});

paper();
state.ready = true;
window.sketch = state;
