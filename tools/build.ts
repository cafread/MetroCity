// Turns data/cities/*.ndjson into the files the service serves, under public/data:
//   lookup.bin      geometry and quadtree, read in place by src/lookup.ts
//   names.json      city id -> display name
//   changelog.json  per city: name, last change, bounding box
//   cities.json     the outlines as TopoJSON, read by the editor
//   version.json    data version, bundled into the Worker
// Runs on Deno or Node with no dependencies: deno run -A tools/build.ts | node tools/build.ts

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAGIC, ROOT, ROOT_SIZE, SCALE } from "../src/lookup.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_DEPTH = 10;
const MIN_DEPTH = 8;
const SMALL_LEAF = 2;

type City = { i: number; n: string; p: number; la: number; lo: number; t: number; g: number[] };

const cities: City[] = [];
for (const file of (await readdir(join(root, "data/cities"))).filter((f) => f.endsWith(".ndjson")).sort()) {
    for (const line of (await readFile(join(root, "data/cities", file), "utf8")).split("\n")) {
        if (line.trim()) cities.push(JSON.parse(line));
    }
}
cities.sort((a, b) => a.i - b.i);
const seen = new Set<number>();
for (const c of cities) {
    if (seen.has(c.i)) throw new Error(`city ${c.i} appears twice`);
    if (c.g.length < 6 || c.g.length % 2) throw new Error(`city ${c.i} has a bad outline`);
    seen.add(c.i);
}

const nCity = cities.length;
const nVert = cities.reduce((sum, c) => sum + c.g.length / 2, 0);
const ids = Int32Array.from(cities, (c) => c.i);
const start = new Uint32Array(nCity + 1);
const box = new Int32Array(nCity * 4);
const xy = new Int32Array(nVert * 2);
let v = 0;
cities.forEach((c, k) => {
    start[k] = v;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (let j = 0; j < c.g.length; j += 2) {
        const x = c.g[j], y = c.g[j + 1];
        xy[v * 2] = x; xy[v * 2 + 1] = y; v++;
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
    }
    box.set([w, s, e, n], k * 4);
});
start[nCity] = v;

const inCity = (c: number, x: number, y: number): boolean => {
    if (x < box[c * 4] || x > box[c * 4 + 2] || y < box[c * 4 + 1] || y > box[c * 4 + 3]) return false;
    let inside = false;
    for (let a = start[c], b = start[c + 1] - 1; a < start[c + 1]; b = a++) {
        const ya = xy[a * 2 + 1], yb = xy[b * 2 + 1];
        if ((ya > y) !== (yb > y) && x < ((xy[b * 2] - xy[a * 2]) * (y - ya)) / (yb - ya) + xy[a * 2]) inside = !inside;
    }
    return inside;
};

// An edge is the vertex index of its first point; its second is the next vertex of the same city.
const edgeCity = new Uint16Array(nVert);
const edgeNext = new Uint32Array(nVert);
for (let c = 0; c < nCity; c++) {
    for (let a = start[c]; a < start[c + 1]; a++) {
        edgeCity[a] = c;
        edgeNext[a] = a + 1 === start[c + 1] ? start[c] : a + 1;
    }
}
const edgeHitsCell = (a: number, x0: number, y0: number, x1: number, y1: number): boolean => {
    const b = edgeNext[a];
    const ax = xy[a * 2], ay = xy[a * 2 + 1], bx = xy[b * 2], by = xy[b * 2 + 1];
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) return false;
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
        if (p === 0) {
            if (q < 0) return false;
        } else {
            const t = q / p;
            if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
            else { if (t < t0) return false; if (t < t1) t1 = t; }
        }
    }
    return true;
};

// Quadtree over the 360 x 360 degree square. A node is the index of its four children, or a leaf:
// -1 empty, -(2 + c) wholly inside city c, -(2 + nCity + m) a short list of candidate cities.
const nodes: number[] = [0];
const mixStart: number[] = [0];
const mixItems: number[] = [];
const leaves = { empty: 0, uniform: 0, mixed: 0 };
const split = (x0: number, y0: number, size: number, depth: number, edges: number[], near: number[], slot: number) => {
    const x1 = x0 + size, y1 = y0 + size;
    const here = edges.filter((a) => edgeHitsCell(a, x0, y0, x1, y1));
    const close = near.filter((c) => box[c * 4] <= x1 && box[c * 4 + 2] >= x0 && box[c * 4 + 1] <= y1 && box[c * 4 + 3] >= y0);
    const containing = (x: number, y: number) => close.find((c) => inCity(c, x, y));
    if (here.length === 0) {
        const c = containing(x0 + size / 2, y0 + size / 2);
        if (c === undefined) { nodes[slot] = -1; leaves.empty++; }
        else { nodes[slot] = -(2 + c); leaves.uniform++; }
        return;
    }
    const crossing = new Set(here.map((a) => edgeCity[a]));
    if (depth >= MAX_DEPTH || (crossing.size <= SMALL_LEAF && depth >= MIN_DEPTH)) {
        // A city can cover part of the cell without its outline crossing it, if another city sits inside it
        for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [x0 + size / 2, y0 + size / 2]]) {
            const c = containing(x, y);
            if (c !== undefined) crossing.add(c);
        }
        nodes[slot] = -(2 + nCity + mixStart.length - 1);
        mixItems.push(...[...crossing].sort((a, b) => (start[a + 1] - start[a]) - (start[b + 1] - start[b])));
        mixStart.push(mixItems.length);
        leaves.mixed++;
        return;
    }
    const first = nodes.length;
    nodes[slot] = first;
    nodes.push(0, 0, 0, 0);
    const half = size / 2;
    split(x0, y0, half, depth + 1, here, close, first);
    split(x0 + half, y0, half, depth + 1, here, close, first + 1);
    split(x0, y0 + half, half, depth + 1, here, close, first + 2);
    split(x0 + half, y0 + half, half, depth + 1, here, close, first + 3);
};
split(ROOT, ROOT, ROOT_SIZE, 0, Array.from({ length: nVert }, (_, a) => a), Array.from({ length: nCity }, (_, c) => c), 0);

const sections: ArrayBufferView[] = [
    Uint32Array.from([MAGIC, nCity, nVert, nodes.length, mixStart.length - 1, mixItems.length, 0, 0]),
    ids, start, box, xy, Int32Array.from(nodes), Uint32Array.from(mixStart), Uint16Array.from(mixItems),
];
const padded = (bytes: number) => Math.ceil(bytes / 4) * 4;
const lookup = new Uint8Array(sections.reduce((sum, s) => sum + padded(s.byteLength), 0));
let at = 0;
for (const s of sections) {
    lookup.set(new Uint8Array(s.buffer, s.byteOffset, s.byteLength), at);
    at += padded(s.byteLength);
}

const names = Object.fromEntries(cities.map((c) => [c.i, c.n]));
const round = (n: number) => Math.round(n / (SCALE / 1e4)) / 1e4;
const changelog = {
    version: process.env.DATA_VERSION ?? "dev",
    generated: Date.now(),
    cities: Object.fromEntries(cities.map((c, k) => [c.i, { n: c.n, t: c.t, b: [round(box[k * 4]), round(box[k * 4 + 1]), round(box[k * 4 + 2]), round(box[k * 4 + 3])] }])),
    removed: {},
};

const closed = (g: number[]) => {
    const ring: number[][] = [];
    for (let j = 0; j < g.length; j += 2) ring.push([g[j] / SCALE, g[j + 1] / SCALE]);
    ring.push(ring[0]);
    return ring;
};
const topology = {
    type: "Topology",
    objects: {
        cities: {
            type: "GeometryCollection",
            geometries: cities.map((c, k) => ({ type: "Polygon", arcs: [[k]], properties: { id: c.i, name: c.n, population: c.p, lat: c.la, lon: c.lo } })),
        },
    },
    arcs: cities.map((c) => closed(c.g)),
};

const out = join(root, "public/data");
await mkdir(out, { recursive: true });
await writeFile(join(out, "cities.json"), JSON.stringify(topology));
await writeFile(join(out, "version.json"), JSON.stringify({ version: changelog.version }));
await writeFile(join(out, "lookup.bin"), lookup);
await writeFile(join(out, "names.json"), JSON.stringify(names));
await writeFile(join(out, "changelog.json"), JSON.stringify(changelog));
console.log(`${nCity} cities, ${nVert} vertices, ${nodes.length} nodes (${leaves.empty} empty, ${leaves.uniform} uniform, ${leaves.mixed} mixed leaves)`);
console.log(`lookup.bin ${lookup.length} bytes, names.json ${JSON.stringify(names).length}, changelog.json ${JSON.stringify(changelog).length}`);
