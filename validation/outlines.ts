// Checks the outlines against each other and against their own records. Exits 1 if any check fails.
//   deno run --allow-read validation/outlines.ts [data/cities] [older data/cities to compare reach with]
// Overlap: no two outlines may share any area. Self-touch: listed; the outlines in KNOWN_SELF_TOUCH came
// that way from the original trace. Reach: a city may not reach past 110 km unless it already did in the
// older data (hand extensions such as London are allowed to stand).

import process from "node:process";
import { bbox, km, loadCities, locate, overlaps, selfTouches } from "./geom.ts";

const KNOWN_SELF_TOUCH = ["Bihac, BA", "Damascus, SY", "Darbhanga, (BR), IN", "Gorzow Wielkopolski, PL", "Leicester, GB", "Mokolo, CM", "Sinop, TR", "Vyborg, RU", "Zhuhai, (GD), CN"];
const [dir = "data/cities", olderDir] = process.argv.slice(2);
const cities = await loadCities(dir);
const boxes = cities.map((c) => bbox(c.g));
const problems: string[] = [];

let pairs = 0;
for (let a = 0; a < cities.length; a++) {
    for (let b = a + 1; b < cities.length; b++) {
        const A = boxes[a], B = boxes[b];
        if (A[2] < B[0] || B[2] < A[0] || A[3] < B[1] || B[3] < A[1]) continue;
        pairs++;
        if (overlaps(cities[a].g, cities[b].g)) problems.push(`overlap: ${cities[a].n} / ${cities[b].n}`);
    }
}
console.log(`${cities.length} outlines, ${pairs} neighbouring pairs tested for overlap`);

const touching = cities.filter((c) => selfTouches(c.g) > 0).map((c) => c.n);
for (const name of touching) if (!KNOWN_SELF_TOUCH.includes(name)) problems.push(`touches or crosses itself: ${name}`);
console.log(`outlines touching themselves: ${touching.length} (${touching.filter((n) => KNOWN_SELF_TOUCH.includes(n)).length} known)`);

const outside = cities.filter((c) => locate(c.g, Math.round(c.lo * 1e7), Math.round(c.la * 1e7)) !== 1).map((c) => c.n);
console.log(`centres not inside their own outline: ${outside.join("; ") || "none"}`);

const reach = (c: { la: number; lo: number; g: number[] }) => { let far = 0; for (let j = 0; j < c.g.length; j += 2) far = Math.max(far, km(c.la, c.lo, c.g[j + 1] / 1e7, c.g[j] / 1e7)); return far; };
const long = cities.map((c) => ({ c, far: reach(c) })).filter((r) => r.far > 110);
console.log(`outlines reaching past 110 km from their centre: ${long.length}`);
if (olderDir) {
    const older = new Map((await loadCities(olderDir)).map((c) => [c.i, reach(c)]));
    for (const r of long) if (r.far > (older.get(r.c.i) ?? 0) + 5) problems.push(`reach grew to ${r.far.toFixed(0)} km: ${r.c.n}`);
}

console.log(problems.length ? problems.join("\n") : "no problems");
process.exit(problems.length ? 1 : 0);
