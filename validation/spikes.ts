// Finds spikes and nearly detached pieces in the outlines. Reports only; exits 0.
//   deno run --allow-read validation/spikes.ts [data/cities] [--all]
// Every point of an outline is tested against every edge it does not touch. Where the two are within
// REACH_KM, the chord between them cuts the outline in two; the smaller side, if it lies inside the
// outline, is a piece that the outline goes out to and comes back from. For that piece:
//   neck d     the chord, km
//   length l   half the piece's outline length, km
//   width w    area / l, km (the mean width)
//   angle      asin(2w / l) in degrees: the apex angle of a wedge with the same l and w
// A wedge corner of angle a gives the same angle at every depth, so a sharp corner and a spike differ
// only by angle; legitimate coast points and border corners are 30 degrees or more and are not listed.
// Spike: angle under SPIKE_DEG and l of SPIKE_KM or more. Ranked by l.
// Neck: d under NECK_KM, the piece at least NECK_AREA km2 and wider than 2d. Ranked by d, then area.
// Nested pieces of the same spike or neck are reported once, by the longest (spike) or narrowest (neck).

import process from "node:process";
import { loadCities } from "./geom.ts";

const REACH_KM = 2, SPIKE_DEG = 25, SPIKE_KM = 1, NECK_KM = 0.5, NECK_AREA = 0.1;
const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--")) ?? "data/cities";
const all = args.includes("--all");
const started = Date.now();
const cities = await loadCities(dir);

type Piece = { slit: boolean; s: number; e: number; d: number; l: number; w: number; deg: number; area: number; x: number; y: number };

// Pieces of one outline; s..e is the piece's run of points, forward and cyclic
function pieces(la: number, g: number[]): Piece[] {
    const n = g.length / 2, kx = Math.cos(la * Math.PI / 180) * 111.32e-7, ky = 111.32e-7;
    const X = new Float64Array(2 * n + 1), Y = new Float64Array(2 * n + 1), C = new Float64Array(2 * n + 1), L = new Float64Array(2 * n + 1);
    for (let k = 0; k <= 2 * n; k++) { X[k] = g[(k % n) * 2] * kx; Y[k] = g[(k % n) * 2 + 1] * ky; }
    for (let k = 1; k <= 2 * n; k++) { C[k] = C[k - 1] + X[k - 1] * Y[k] - X[k] * Y[k - 1]; L[k] = L[k - 1] + Math.hypot(X[k] - X[k - 1], Y[k] - Y[k - 1]); }
    const total = C[n] / 2, sign = Math.sign(total), out: Piece[] = [];
    const inside = (a: number) => a * sign > 0 || Math.abs(a) < 1e-6;
    for (let i = 0; i < n; i++) {
        const px = X[i], py = Y[i];
        for (let j = 0; j < n; j++) {
            if (j === i || (j + 1) % n === i) continue;
            const ax = X[j], ay = Y[j], bx = X[j + 1], by = Y[j + 1];
            if (px < Math.min(ax, bx) - REACH_KM || px > Math.max(ax, bx) + REACH_KM || py < Math.min(ay, by) - REACH_KM || py > Math.max(ay, by) + REACH_KM) continue;
            const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
            const qx = ax + t * vx, qy = ay + t * vy, d = Math.hypot(px - qx, py - qy);
            if (d > REACH_KM) continue;
            // forward side: i .. j, q; back side: q, j+1 .. i
            const jf = j > i ? j : j + n, ib = i >= j + 1 ? i : i + n;
            const fA = (C[jf] - C[i] + X[j] * qy - qx * Y[j] + qx * py - px * qy) / 2;
            const fL = L[jf] - L[i] + Math.hypot(qx - ax, qy - ay);
            const bA = (qx * Y[j + 1] - X[j + 1] * qy + C[ib] - C[j + 1] + px * qy - qx * py) / 2;
            const bL = Math.hypot(bx - qx, by - qy) + L[ib] - L[j + 1];
            // both sides inside: a protrusion (the smaller side); one side outside: a slit cut into the outline
            const fIn = inside(fA), bIn = inside(bA);
            if (!fIn && !bIn) continue;
            const slit = fIn !== bIn;
            const fwd = slit ? !fIn : Math.abs(fA) <= Math.abs(bA);
            const area = Math.abs(fwd ? fA : bA), l = (fwd ? fL : bL) / 2;
            if (l <= d) continue;
            const w = area / l;
            out.push({ slit, s: fwd ? i : (j + 1) % n, e: fwd ? j : i, d, l, w, deg: Math.asin(Math.min(1, 2 * w / l)) * 180 / Math.PI, area, x: g[i * 2] / 1e7, y: g[i * 2 + 1] / 1e7 });
        }
    }
    return out;
}

const isSpike = (p: Piece, deg = SPIKE_DEG, km = SPIKE_KM) => p.deg < deg && p.l >= km;
const isNeck = (p: Piece, km = NECK_KM) => !p.slit && p.d < km && p.area >= NECK_AREA && p.w > 2 * p.d;

// Keeps pieces in priority order, dropping any whose run shares a point with one already kept
function distinct(ps: Piece[], n: number): Piece[] {
    const used = new Uint8Array(n), kept: Piece[] = [];
    for (const p of ps) {
        let free = true;
        for (let k = p.s; ; k = (k + 1) % n) { if (used[k]) { free = false; break; } if (k === p.e) break; }
        if (!free) continue;
        for (let k = p.s; ; k = (k + 1) % n) { used[k] = 1; if (k === p.e) break; }
        kept.push(p);
    }
    return kept;
}

const found = cities.map((c) => ({ c, ps: pieces(c.la, c.g) }));
const scanned = Date.now() - started;

// Trade-off table: outlines flagged at each threshold
const count = (f: (p: Piece) => boolean) => found.filter((r) => r.ps.some(f)).length;
console.log(`${cities.length} outlines scanned in ${(scanned / 1000).toFixed(1)} s`);
console.log("outlines with a spike, by angle (rows) and length (columns):");
console.log("           " + [0.5, 1, 2, 5, 10].map((k) => `>=${k} km`.padStart(9)).join(""));
for (const deg of [10, 15, 20, 25, 30]) console.log(`  < ${String(deg).padStart(2)} deg  ` + [0.5, 1, 2, 5, 10].map((k) => String(count((p) => isSpike(p, deg, k))).padStart(9)).join(""));
console.log("outlines with a neck, by neck width: " + [0, 0.1, 0.25, 0.5, 1].map((k) => `${k ? "<" + k : "=0"} km: ${count((p) => !p.slit && (k ? p.d < k : p.d === 0) && p.area >= NECK_AREA && p.w > 2 * p.d)}`).join(", "));

const spikes: { n: string; p: Piece }[] = [], necks: { n: string; p: Piece }[] = [];
for (const { c, ps } of found) {
    const n = c.g.length / 2;
    for (const p of distinct(ps.filter((p) => isSpike(p)).sort((a, b) => b.l - a.l), n)) spikes.push({ n: c.n, p });
    for (const p of distinct(ps.filter((p) => isNeck(p)).sort((a, b) => a.d - b.d || b.area - a.area), n)) necks.push({ n: c.n, p });
}
spikes.sort((a, b) => b.p.l - a.p.l);
necks.sort((a, b) => a.p.d - b.p.d || b.p.area - a.p.area);
const at = (p: Piece) => `${p.y.toFixed(4)},${p.x.toFixed(4)}`;
const top = all ? Infinity : 40;
console.log(`\nspikes (angle < ${SPIKE_DEG} deg, length >= ${SPIKE_KM} km): ${spikes.length} in ${new Set(spikes.map((s) => s.n)).size} outlines`);
for (const { n, p } of spikes.slice(0, top)) console.log(`  ${p.slit ? "slit " : "spike"} ${p.l.toFixed(1).padStart(6)} km long  ${p.w.toFixed(2).padStart(5)} km wide  ${p.deg.toFixed(1).padStart(4)} deg  base ${p.d.toFixed(2)} km  at ${at(p)}  points ${p.s}-${p.e}  ${n}`);
console.log(`\nnecks (narrower than ${NECK_KM} km, piece >= ${NECK_AREA} km2): ${necks.length} in ${new Set(necks.map((s) => s.n)).size} outlines`);
for (const { n, p } of necks.slice(0, top)) console.log(`  neck ${p.d.toFixed(3).padStart(6)} km  piece ${p.area.toFixed(1).padStart(7)} km2  ${p.w.toFixed(2).padStart(5)} km wide  at ${at(p)}  points ${p.s}-${p.e}  ${n}`);
console.log(`\n${((Date.now() - started) / 1000).toFixed(1)} s in all`);
