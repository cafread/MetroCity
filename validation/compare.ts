// Compares the answers of two built lookups over a file of real positions, to see what a change to the
// outlines does. Country codes in such files can be wrong, so read the groups, not just the totals.
//   deno run --allow-read validation/compare.ts <positions.tsv> <before folder> <after folder> [--all]
// positions.tsv has a header row and columns id, lat, lon, country_code. Each folder holds lookup.bin
// and names.json, as tools/build.ts writes them to public/data.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { createLookup } from "../src/lookup.ts";

const [file, before, after, flag] = process.argv.slice(2);
const load = async (dir: string) => {
    const bin = await readFile(join(dir, "lookup.bin"));
    return { lookup: createLookup(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer), names: JSON.parse(await readFile(join(dir, "names.json"), "utf8")) as Record<string, string> };
};
const a = await load(before), b = await load(after);
const countryOf = (city: string) => (city.startsWith("Macau,") ? "MO" : city.slice(-2));

const kinds = new Map<string, Map<string, number>>();
let total = 0;
for (const line of (await readFile(file, "utf8")).split("\n").slice(1)) {
    const r = line.split("\t");
    if (r.length < 4) continue;
    total++;
    const from = a.names[a.lookup.cityAt(Number(r[2]), Number(r[1]))] ?? "", to = b.names[b.lookup.cityAt(Number(r[2]), Number(r[1]))] ?? "";
    if (from === to) continue;
    const cc = r[3], wasOwn = from !== "" && countryOf(from) === cc, isOwn = to !== "" && countryOf(to) === cc;
    const kind = !to ? (wasOwn ? "lost a city of its own country" : "left a foreign city, now in none")
        : !from ? (isOwn ? "gained a city of its own country" : "gained a foreign city")
        : isOwn ? (wasOwn ? "moved between cities of its own country" : "moved from a foreign city to one of its own country")
        : wasOwn ? "moved from its own country's city to a foreign one" : "moved between two foreign cities";
    const group = kinds.get(kind) ?? new Map<string, number>();
    const key = `${from || "(none)"} -> ${to || "(none)"} [${cc}]`;
    group.set(key, (group.get(key) ?? 0) + 1);
    kinds.set(kind, group);
}
console.log(`${total} positions; ${[...kinds.values()].reduce((sum, g) => sum + [...g.values()].reduce((s, n) => s + n, 0), 0)} change city`);
for (const [kind, group] of [...kinds].sort()) {
    console.log(`${[...group.values()].reduce((s, n) => s + n, 0)}  ${kind}`);
    for (const [key, n] of [...group].sort((x, y) => y[1] - x[1]).slice(0, flag === "--all" ? 1000 : 8)) console.log(`      ${n}  ${key}`);
}
