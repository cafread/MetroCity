// Run by hand when the border source changes; the build only reads the file this writes.
//   deno run --allow-read --allow-write tools/import_borders.ts <path to the LSIB .shp>
// Source: Large Scale International Boundaries, U.S. Department of State, a U.S. Government work
// (https://data.geodata.state.gov/). Lines are thinned to about 100 m and stored at 1e-5 degrees,
// each as [lon, lat, then steps from the point before].

const TOLERANCE = 0.001;
const UNIT = 1e5;
const shp = await Deno.readFile(Deno.args[0]);
const view = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);

const thin = (pts: number[][]): number[][] => {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop()!;
        const scale = Math.cos(pts[a][1] * Math.PI / 180);
        const ax = pts[a][0] * scale, ay = pts[a][1], vx = pts[b][0] * scale - ax, vy = pts[b][1] - ay, len = vx * vx + vy * vy || 1;
        let worst = 0, at = -1;
        for (let k = a + 1; k < b; k++) {
            const px = pts[k][0] * scale - ax, py = pts[k][1] - ay;
            const t = Math.max(0, Math.min(1, (px * vx + py * vy) / len));
            const d = Math.hypot(px - t * vx, py - t * vy);
            if (d > worst) { worst = d; at = k; }
        }
        if (worst > TOLERANCE) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    return pts.filter((_, k) => keep[k]);
};

const lines: number[][] = [];
let read = 0, kept = 0;
for (let at = 100; at < shp.length;) {
    const size = view.getInt32(at + 4, false) * 2;
    const rec = at + 8;
    at = rec + size;
    if (view.getInt32(rec, true) !== 3) continue;
    const parts = view.getInt32(rec + 36, true), points = view.getInt32(rec + 40, true);
    const first = rec + 44 + parts * 4;
    for (let p = 0; p < parts; p++) {
        const from = view.getInt32(rec + 44 + p * 4, true), to = p + 1 < parts ? view.getInt32(rec + 48 + p * 4, true) : points;
        const pts: number[][] = [];
        for (let k = from; k < to; k++) pts.push([view.getFloat64(first + k * 16, true), view.getFloat64(first + k * 16 + 8, true)]);
        read += pts.length;
        if (pts.length < 2) continue;
        const line: number[] = [];
        let px = 0, py = 0;
        for (const [lon, lat] of thin(pts)) {
            const x = Math.round(lon * UNIT), y = Math.round(lat * UNIT);
            if (line.length && x === px && y === py) continue;
            line.push(x - px, y - py);
            px = x; py = y;
        }
        if (line.length >= 4) { lines.push(line); kept += line.length / 2; }
    }
}
const out = new URL("../data/borders.json", import.meta.url);
await Deno.writeTextFile(out, JSON.stringify({ source: "LSIB, U.S. Department of State", unit: UNIT, lines }));
console.log(`${lines.length} lines, ${read} points read, ${kept} kept, ${(await Deno.stat(out)).size} bytes`);
