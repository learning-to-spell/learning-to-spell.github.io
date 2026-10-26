// Bounded Levenberg–Marquardt: minimise ‖f(x)‖² subject to lower ≤ x ≤ upper.
// Each iteration solves (JᵀJ + λ·diag(JᵀJ)) δ = −Jᵀr with a finite-difference Jacobian;
// λ shrinks after an accepted step and grows after a rejected one. Variables pushed against
// a bound are held fixed, and every step is clipped to the bounds.
// Yields { x, iteration } after each accepted step.

const MAX_ITERATIONS = 100;
const TOLERANCE = 1e-4;  // converged when a step lowers the cost by less than this fraction

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Forward-difference Jacobian, as one column per variable. */
function jacobian(f, x, r) {
  return Array.from(x, (xi, i) => {
    const h = 1e-6 * Math.max(1, Math.abs(xi));
    const shifted = Float64Array.from(x);
    shifted[i] += h;
    const column = f(shifted);
    for (let k = 0; k < column.length; k++) column[k] = (column[k] - r[k]) / h;
    return column;
  });
}

/** Solve A x = b for a symmetric positive-definite A (array of rows) by Cholesky factorisation. */
function solveSPD(A, b) {
  const n = b.length;
  const L = A.map(() => new Float64Array(n));
  for (let j = 0; j < n; j++) {
    let d = A[j][j];
    for (let k = 0; k < j; k++) d -= L[j][k] ** 2;
    L[j][j] = Math.sqrt(d);
    for (let i = j + 1; i < n; i++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = s / L[j][j];
    }
  }
  const y = new Float64Array(n), x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

export function* levenbergMarquardt(f, x0, { lower, upper }) {
  let x = Float64Array.from(x0, (v, i) => clamp(v, lower[i], upper[i]));
  let r = f(x);
  let cost = dot(r, r);
  let lambda = 1e-3;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const J = jacobian(f, x, r);
    const g = J.map((column) => dot(column, r));
    const pinned = g.map((gi, i) => (x[i] >= upper[i] && gi < 0) || (x[i] <= lower[i] && gi > 0));
    const JtJ = J.map((ci, i) => J.map((cj, j) => (pinned[i] || pinned[j] ? 0 : dot(ci, cj))));
    const rhs = g.map((gi, i) => (pinned[i] ? 0 : -gi));

    let accepted = false;
    for (let attempt = 0; attempt < 12 && !accepted; attempt++) {
      const damped = JtJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const step = solveSPD(damped, rhs);
      const trial = x.map((xi, i) => clamp(xi + step[i], lower[i], upper[i]));
      const trialR = f(trial);
      const trialCost = dot(trialR, trialR);

      if (trialCost < cost) {
        const converged = cost - trialCost < TOLERANCE * cost;
        [x, r, cost, accepted] = [trial, trialR, trialCost, true];
        lambda = Math.max(lambda / 3, 1e-10);
        yield { x, iteration };
        if (converged) return;
      } else {
        lambda *= 4;
      }
    }
    if (!accepted) return;
  }
}
