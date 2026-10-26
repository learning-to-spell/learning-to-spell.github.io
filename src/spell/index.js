// Snake robots spelling words: mounts every [data-spell] figure (see _includes/macros/spell.njk).

import { FONT, makeLetter, Snake, spawn, residuals } from "./model.js";
import { levenbergMarquardt } from "./lm.js";

const COLORS = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93"];
const CELL = { width: 6, height: 9 };  // a 5 × 7 pin letter plus a gap, in pin units
const MARGIN = 1.5;                    // around the drawing, in pin units
const STEP_MS = 50;                    // time per solver iteration on screen
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

document.querySelectorAll("[data-spell]").forEach(mount);

function mount(root) {
  const canvas = root.querySelector("canvas");
  const form   = root.querySelector("form");
  const status = root.querySelector(".spell__status");
  const button = form.querySelector("button");

  let words = [], glyphs = [], snake, frame = 0;

  function settings() {
    const v = Object.fromEntries(new FormData(form));
    return {
      text: v.text,
      rho: Number(v.rho),
      snake: new Snake(Number(v.vertices), Number(v.link), (v.limit * Math.PI) / 180),
      weights: { coverage: Number(v.coverage), overhang: Number(v.overhang) },
    };
  }

  /** Lay fresh, straight robots along the letters of the current text; returns the settings used. */
  function respawn() {
    cancelAnimationFrame(frame);
    const s = settings();
    snake = s.snake;
    words = s.text.toUpperCase().split(/\s+/).map((w) => [...w].filter((c) => c in FONT)).filter((w) => w.length);
    glyphs = words.flat().map((char) => {
      const letter = makeLetter(char);
      return { letter, z: spawn(letter, snake, s.rho) };
    });

    const robots = glyphs.reduce((n, g) => n + snake.count(g.z), 0);
    status.value = glyphs.length ? `${robots} robots on ${glyphs.length} letters.` : "Type some letters A–Z.";
    button.disabled = !glyphs.length;
    draw();
    return s;
  }

  /** Respawn, then let one solver per letter bend its robots into place. */
  function fit() {
    const { weights } = respawn();
    const solvers = new Map(glyphs.map((g) => [g, levenbergMarquardt(residuals(g.letter, snake, weights), g.z, snake.bounds(g.z))]));

    let iterations = 0;
    const step = () => {
      for (const [g, solver] of solvers) {
        const { done, value } = solver.next();
        if (done) solvers.delete(g);
        else [g.z, iterations] = [value.x, Math.max(iterations, value.iteration)];
      }
      return solvers.size > 0;
    };
    const report = (running) => {
      status.value = running ? `Fitting, iteration ${iterations}.` : `Fit in ${iterations} iterations.`;
    };

    if (reducedMotion.matches) {
      while (step());
      draw();
      return report(false);
    }

    let last = -Infinity;
    const tick = (time) => {
      let running = true;
      if (time - last >= STEP_MS) {
        last = time;
        running = step();
        draw();
        report(running);
      }
      if (running) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  function draw() {
    const dpr = devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * dpr);   // also clears the canvas
    canvas.height = Math.round(height * dpr);
    if (!glyphs.length) return;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = ctx.lineJoin = "round";
    const css = getComputedStyle(root);
    const pinColor = css.getPropertyValue("--spell-pin");
    const outlineColor = css.getPropertyValue("--spell-outline");

    // Pin units → pixels, with the drawing centred (y points up in pin units).
    const { cells, size, unit } = layout(words, width, height);
    const left = (width - size.width * unit) / 2;
    const top = (height - size.height * unit) / 2;

    glyphs.forEach((g, i) => {
      const { column, row } = cells[i];
      const at = ([x, y]) => [left + (column * CELL.width + x) * unit, top + (row * CELL.height + 6 - y) * unit];

      ctx.fillStyle = pinColor;
      for (let x = 0; x < 5; x++) for (let y = 0; y < 7; y++) disc(ctx, at([x, y]), Math.max(1, 0.05 * unit));

      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = 0.6 * unit;
      for (const stroke of g.letter.strokes) polyline(ctx, stroke.map(at));

      snake.bodies(g.z).forEach((body, k) => {
        const points = body.map(at);
        ctx.strokeStyle = ctx.fillStyle = COLORS[k % COLORS.length];
        ctx.lineWidth = Math.max(1.5, 0.13 * unit);
        polyline(ctx, points);
        points.forEach((p, j) => disc(ctx, p, Math.max(1.5, (j === 0 ? 0.16 : 0.1) * unit)));
      });
    });
  }

  form.addEventListener("input", ({ target }) => {
    if (target.type === "range") target.nextElementSibling.value = target.value;
    respawn();
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); fit(); });
  new ResizeObserver(draw).observe(canvas);
  respawn();
}

// ── Layout: wrap words onto lines so the letters are drawn as large as possible ──

/** Grid cell of every letter, starting a new line when a word would pass `maxColumns`. */
function wrap(words, maxColumns) {
  const cells = [];
  let column = 0, row = 0;
  words.forEach((word, w) => {
    if (w > 0) [column, row] = column + 1 + word.length > maxColumns ? [0, row + 1] : [column + 1, row];
    for (const _ of word) cells.push({ column: column++, row });
  });
  return cells;
}

/** The wrapping that gives the largest pin spacing (`unit`, in px) in a width × height box. */
function layout(words, width, height) {
  const oneLine = words.reduce((n, w) => n + w.length + 1, -1);
  let best = { unit: 0 };
  for (let maxColumns = 1; maxColumns <= oneLine; maxColumns++) {
    const cells = wrap(words, maxColumns);
    const size = {
      width: (Math.max(...cells.map((c) => c.column)) + 1) * CELL.width - 2,
      height: (cells.at(-1).row + 1) * CELL.height - 3,
    };
    const unit = Math.min(width / (size.width + 2 * MARGIN), height / (size.height + 2 * MARGIN));
    if (unit > best.unit) best = { cells, size, unit };
  }
  return best;
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

function polyline(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

function disc(ctx, [x, y], r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
}
