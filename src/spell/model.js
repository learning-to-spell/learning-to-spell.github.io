// ── Font ──────────────────────────────────────────────────────────────────────
// Each letter is a list of strokes; a stroke is a path through pins on a 5 × 7 grid
// (columns a–e are x = 0..4, rows 0–6 are y, pointing up).

const FONT_SPEC = `
A a0-a5-b6-d6-e5-e0 a3-e3
B a0-a6-d6-e5-e4-d3-a3 d3-e2-e1-d0-a0
C e5-d6-b6-a5-a1-b0-d0-e1
D a0-a6-d6-e5-e1-d0-a0
E e6-a6-a0-e0 a3-d3
F e6-a6-a0 a3-d3
G e5-d6-b6-a5-a1-b0-d0-e1-e3-c3
H a0-a6 e0-e6 a3-e3
I c6-c0
J e6-e1-d0-b0-a1
K a0-a6 e6-a2 b3-e0
L a6-a0-e0
M a0-a6-c4-e6-e0
N a0-a6-e0-e6
O b0-a1-a5-b6-d6-e5-e1-d0-b0
P a0-a6-d6-e5-e4-d3-a3
Q b0-a1-a5-b6-d6-e5-e1-d0-b0 c2-e0
R a0-a6-d6-e5-e4-d3-a3 c3-e0
S e5-d6-b6-a5-a4-b3-d3-e2-e1-d0-b0-a1
T a6-e6 c6-c0
U a6-a1-b0-d0-e1-e6
V a6-c0-e6
W a6-a0-c2-e0-e6
X a6-e0 a0-e6
Y a6-c3-e6 c3-c0
Z a6-e6-a0-e0
`;

const pin = (name) => [name.charCodeAt(0) - 97, Number(name[1])];

export const FONT = Object.fromEntries(
  FONT_SPEC.trim().split("\n").map((line) => [
    line[0],
    line.slice(2).split(" ").map((stroke) => stroke.split("-").map(pin)),
  ])
);

// ── Letters ───────────────────────────────────────────────────────────────────

const SPACING = 0.3;

/** Points exactly `spacing` apart along a polyline, with the leftover length split between its ends. */
function resample(polyline, spacing) {
  const distance = [0];
  for (let i = 1; i < polyline.length; i++) {
    const [x0, y0] = polyline[i - 1], [x1, y1] = polyline[i];
    distance.push(distance[i - 1] + Math.hypot(x1 - x0, y1 - y0));
  }
  const total = distance.at(-1);
  const count = Math.ceil(total / spacing - 1e-9);
  const start = (total - (count - 1) * spacing) / 2;

  const points = [];
  let seg = 0;
  for (let j = 0; j < count; j++) {
    const t = start + j * spacing;
    while (seg < polyline.length - 2 && distance[seg + 1] < t) seg++;
    const u = (t - distance[seg]) / (distance[seg + 1] - distance[seg]);
    const [x0, y0] = polyline[seg], [x1, y1] = polyline[seg + 1];
    points.push([x0 + u * (x1 - x0), y0 + u * (y1 - y0)]);
  }
  return points;
}

/** The segments of some polylines, prepared for closest-point queries. */
function segmentsOf(polylines) {
  const segments = [];
  for (const line of polylines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i], [bx, by] = line[i + 1];
      const dx = bx - ax, dy = by - ay;
      segments.push({ ax, ay, dx, dy, dd: dx * dx + dy * dy });
    }
  }
  return segments;
}

/** Write the offset from the closest point on any segment to (x, y), times `scale`, into r[i], r[i + 1]. */
function writeOffset(r, i, x, y, segments, scale) {
  let best = Infinity, ox = 0, oy = 0;
  for (const s of segments) {
    const t = Math.min(1, Math.max(0, ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / s.dd));
    const ex = x - s.ax - t * s.dx, ey = y - s.ay - t * s.dy;
    const d = ex * ex + ey * ey;
    if (d < best) [best, ox, oy] = [d, ex, ey];
  }
  r[i] = scale * ox;
  r[i + 1] = scale * oy;
}

export function makeLetter(char) {
  const strokes = FONT[char];
  const samples = strokes.map((stroke) => resample(stroke, SPACING));
  return { strokes, samples, points: samples.flat(), segments: segmentsOf(strokes) };
}

// ── The robot ─────────────────────────────────────────────────────────────────
// One robot's state is (x, y, heading, ...joint angles): n + 1 numbers for n vertices.
// All robots on a letter sit back to back in one flat array, which is what the solver sees.

export class Snake {
  constructor(n, l, theta) {
    Object.assign(this, { n, l, theta });
  }

  get length() { return (this.n - 1) * this.l; }
  get size() { return this.n + 1; }

  /** Number of robots in the flat state array z. */
  count(z) { return z.length / this.size; }

  /** The n vertices of robot k in z, from its tail. */
  body(z, k) {
    const o = k * this.size;
    let [x, y, heading] = [z[o], z[o + 1], z[o + 2]];
    const vertices = [[x, y]];
    for (let j = 0; j < this.n - 1; j++) {
      if (j > 0) heading += z[o + 2 + j];
      x += this.l * Math.cos(heading);
      y += this.l * Math.sin(heading);
      vertices.push([x, y]);
    }
    return vertices;
  }

  bodies(z) {
    return Array.from({ length: this.count(z) }, (_, k) => this.body(z, k));
  }

  /** State of an unbent robot centred on (x, y), pointing along `heading`. */
  straight(x, y, heading) {
    const half = this.length / 2;
    return [x - half * Math.cos(heading), y - half * Math.sin(heading), heading, ...Array(this.n - 2).fill(0)];
  }

  /** Bounds for z: position and heading are free, joint angles are limited. */
  bounds(z) {
    const one = [Infinity, Infinity, Infinity, ...Array(this.n - 2).fill(this.theta)];
    const upper = Float64Array.from(z, (_, i) => one[i % this.size]);
    return { lower: upper.map((v) => -v), upper };
  }
}

// ── Spawning ──────────────────────────────────────────────────────────────────
// Each stroke gets ⌈ρ · length / robot length⌉ robots, laid straight and centred on
// equal pieces of the stroke.

export function spawn(letter, snake, rho) {
  const z = [];
  for (const samples of letter.samples) {
    const count = Math.ceil((rho * SPACING * samples.length) / snake.length);
    for (let k = 0; k < count; k++) {
      const i = Math.min(Math.floor(((k + 0.5) * samples.length) / count), samples.length - 2);
      const [x, y] = samples[i], [nx, ny] = samples[i + 1];
      z.push(...snake.straight(x, y, Math.atan2(ny - y, nx - x)));
    }
  }
  return Float64Array.from(z);
}

// ── Cost ──────────────────────────────────────────────────────────────────────
//   coverage: offset from each letter point to the closest robot link
//   overhang: offset from each robot vertex to the closest letter stroke
// Each term is scaled by √(weight / count), so the cost ‖r‖² is
//   weight_coverage · mean coverage² + weight_overhang · mean overhang².

export function residuals(letter, snake, weights) {
  return (z) => {
    const bodies = snake.bodies(z);
    const vertices = bodies.flat();
    const terms = [
      [letter.points, segmentsOf(bodies), Math.sqrt(weights.coverage / letter.points.length)],
      [vertices, letter.segments, Math.sqrt(weights.overhang / vertices.length)],
    ];

    const r = new Float64Array(2 * (letter.points.length + vertices.length));
    let i = 0;
    for (const [points, segments, scale] of terms) {
      for (const [x, y] of points) {
        writeOffset(r, i, x, y, segments, scale);
        i += 2;
      }
    }
    return r;
  };
}
