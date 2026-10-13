// Exact geometry on outlines as stored: flat integers [x, y, x, y, ...] at 1e-7 degrees, ring not closed.
// Products of two coordinates pass 2^53, so the side tests use BigInt and cannot round the wrong way.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { City } from "../src/cities.ts";

export const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => {
    const v = BigInt(bx - ax) * BigInt(cy - ay) - BigInt(by - ay) * BigInt(cx - ax);
    return v > 0n ? 1 : v < 0n ? -1 : 0;
};
const between = (a: number, b: number, c: number) => Math.min(a, b) <= c && c <= Math.max(a, b);
export const onSegment = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
    orient(ax, ay, bx, by, px, py) === 0 && between(ax, bx, px) && between(ay, by, py);

// 1 inside, 0 on the outline, -1 outside
export function locate(g: number[], px: number, py: number): number {
    const n = g.length / 2;
    let inside = false;
    for (let k = 0; k < n; k++) {
        const ax = g[k * 2], ay = g[k * 2 + 1], bx = g[((k + 1) % n) * 2], by = g[((k + 1) % n) * 2 + 1];
        if (onSegment(ax, ay, bx, by, px, py)) return 0;
        if ((ay > py) !== (by > py) && (by > ay) === (orient(ax, ay, bx, by, px, py) > 0)) inside = !inside;
    }
    return inside ? 1 : -1;
}

export const bbox = (g: number[]): number[] => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j < g.length; j += 2) { x0 = Math.min(x0, g[j]); x1 = Math.max(x1, g[j]); y0 = Math.min(y0, g[j + 1]); y1 = Math.max(y1, g[j + 1]); }
    return [x0, y0, x1, y1];
};

function properCrossings(a: number[], b: number[]): number {
    const na = a.length / 2, nb = b.length / 2;
    let count = 0;
    for (let p = 0; p < na; p++) {
        const ax = a[p * 2], ay = a[p * 2 + 1], bx = a[((p + 1) % na) * 2], by = a[((p + 1) % na) * 2 + 1];
        for (let q = 0; q < nb; q++) {
            const cx = b[q * 2], cy = b[q * 2 + 1], dx = b[((q + 1) % nb) * 2], dy = b[((q + 1) % nb) * 2 + 1];
            if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx) || Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) continue;
            if (orient(ax, ay, bx, by, cx, cy) * orient(ax, ay, bx, by, dx, dy) < 0 && orient(cx, cy, dx, dy, ax, ay) * orient(cx, cy, dx, dy, bx, by) < 0) count++;
        }
    }
    return count;
}

// Edge midpoints of a, doubled so they stay integers, strictly inside b
function midpointsInside(a: number[], b: number[]): number {
    const twice = b.map((v) => v * 2), n = a.length / 2;
    let count = 0;
    for (let k = 0; k < n; k++) if (locate(twice, a[k * 2] + a[((k + 1) % n) * 2], a[k * 2 + 1] + a[((k + 1) % n) * 2 + 1]) === 1) count++;
    return count;
}

// Two outlines overlap when their edges cross, or a point or edge midpoint of one is strictly inside the other
export function overlaps(a: number[], b: number[]): boolean {
    if (properCrossings(a, b)) return true;
    for (let j = 0; j < a.length; j += 2) if (locate(b, a[j], a[j + 1]) === 1) return true;
    for (let j = 0; j < b.length; j += 2) if (locate(a, b[j], b[j + 1]) === 1) return true;
    return midpointsInside(a, b) + midpointsInside(b, a) > 0;
}

// Places where an outline crosses or touches itself
export function selfTouches(g: number[]): number {
    const n = g.length / 2;
    let count = 0;
    for (let p = 0; p < n; p++) {
        for (let q = p + 2; q < n; q++) {
            if (p === 0 && q === n - 1) continue;
            const ax = g[p * 2], ay = g[p * 2 + 1], bx = g[((p + 1) % n) * 2], by = g[((p + 1) % n) * 2 + 1];
            const cx = g[q * 2], cy = g[q * 2 + 1], dx = g[((q + 1) % n) * 2], dy = g[((q + 1) % n) * 2 + 1];
            const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy), o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
            if (o1 * o2 < 0 && o3 * o4 < 0) count++;
            else if (onSegment(ax, ay, bx, by, cx, cy) || onSegment(ax, ay, bx, by, dx, dy) || onSegment(cx, cy, dx, dy, ax, ay) || onSegment(cx, cy, dx, dy, bx, by)) count++;
        }
    }
    return count;
}

export const km = (lat1: number, lon1: number, lat2: number, lon2: number) => Math.hypot((lon1 - lon2) * Math.cos(lat1 * Math.PI / 180), lat1 - lat2) * 111.32;

export async function loadCities(dir: string): Promise<City[]> {
    const cities: City[] = [];
    for (const name of await readdir(dir)) {
        for (const line of (await readFile(join(dir, name), "utf8")).split("\n")) if (line.trim()) cities.push(JSON.parse(line));
    }
    return cities.sort((a, b) => a.i - b.i);
}
