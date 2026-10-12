// Times a full POST /mc_api (parse, lookup, country rules, response) in this process.
// deno run -A --no-lock tools/bench.ts

import { readFile } from "node:fs/promises";
import { route, type Service } from "../src/api.ts";
import { createLookup } from "../src/lookup.ts";

const file = (path: string) => readFile(new URL(`../${path}`, import.meta.url));
let t = performance.now();
const bin = await file("public/data/lookup.bin");
const namesText = (await file("public/data/names.json")).toString();
const read = performance.now() - t;
t = performance.now();
const svc: Service = { lookup: createLookup(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer), names: JSON.parse(namesText), limit: 1_000_000, version: "bench", started: Date.now() };
const setup = performance.now() - t;
console.log(`read files ${read.toFixed(1)} ms; set up lookup and names ${setup.toFixed(2)} ms`);

const rows = (await file("tests/fixtures/places.tsv")).toString().split("\n").slice(1).filter(Boolean).map((l) => l.split("\t"));
for (const size of [1, 100, 1000, 10000]) {
    const body = JSON.stringify(Array.from({ length: size }, (_, i) => ({ id: `h${i}`, lat: Number(rows[i % rows.length][0]) + (i >= rows.length ? 0.001 : 0), lon: Number(rows[i % rows.length][1]), cc: rows[i % rows.length][2] })));
    const times: number[] = [];
    for (let k = 0; k < 200; k++) {
        const request = new Request("http://localhost/mc_api", { method: "POST", body });
        const t0 = performance.now();
        const res = await route(request, svc);
        await res!.text();
        times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.log(`${String(size).padStart(5)} points (${(body.length / 1024).toFixed(0)} KB body): median ${times[100].toFixed(2)} ms, p95 ${times[190].toFixed(2)} ms, slowest ${times[199].toFixed(2)} ms`);
}
