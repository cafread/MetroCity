// deno test -A tests/   or   node --test tests/push.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { applyChanges, type Snapshot } from "../src/push.ts";

const square = (x: number, y: number): number[][][] => [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]];
const city = (name: string, x: number): Snapshot => ({ name, population: 1000, lat: 10.5, lon: x + 0.5, coordinates: square(x, 10) });
const line = (id: number, s: Snapshot) => JSON.stringify({ i: id, n: s.name, p: s.population, la: s.lat, lo: s.lon, t: 5, g: s.coordinates[0].slice(0, -1).flatMap(([lon, lat]) => [lon * 1e7, lat * 1e7]) });

const alpha = city("Alpha, AA", 0), beta = city("Beta, AA", 2), gamma = city("Gamma, BB", 4);
const files: Record<string, string> = { AA: `${line(1, alpha)}\n${line(2, beta)}\n`, BB: `${line(3, gamma)}\n` };
const names = { 1: alpha.name, 2: beta.name, 3: gamma.name };
const read = (cc: string) => Promise.resolve(files[cc] ?? null);
const run = (changes: unknown) => applyChanges(changes, names, read, 9);

test("an update replaces the city's line and leaves the others as they were", async () => {
    const moved = { ...alpha, coordinates: square(0.25, 10) };
    const out = await run([{ id: 1, file: alpha, state: moved }]);
    assert.equal(out.status, 200);
    const lines = (out as { files: Record<string, string> }).files.AA.trim().split("\n");
    assert.equal(lines[1], line(2, beta));
    assert.deepEqual(JSON.parse(lines[0]), { ...JSON.parse(line(1, moved)), t: 9 });
});

test("a push is refused whole when a city has changed since its edit was made", async () => {
    const out = await run([{ id: 1, file: { ...alpha, population: 5 }, state: { ...alpha, population: 7 } }, { id: 2, file: beta, state: null }]);
    assert.deepEqual(out, { status: 409, changed: [1] });
});

test("a new city whose id is already published is refused", async () => {
    assert.equal((await run([{ id: 3, file: null, state: city("Delta, AA", 6) }])).status, 409);
});

test("create, delete and a move between countries", async () => {
    const out = await run([{ id: 9, file: null, state: city("Delta, CC", 6) }, { id: 3, file: gamma, state: null }, { id: 2, file: beta, state: { ...beta, name: "Beta, CC" } }]);
    assert.equal(out.status, 200);
    const f = (out as { files: Record<string, string | null> }).files;
    assert.equal(f.BB, null);
    assert.equal(f.AA, `${line(1, alpha)}\n`);
    assert.deepEqual(f.CC!.trim().split("\n").map((l) => JSON.parse(l).i), [9, 2]);
});

test("records the build would reject are refused", async () => {
    const bad = [
        { id: 1, file: alpha, state: { ...alpha, name: beta.name } },
        { id: 1, file: alpha, state: { ...alpha, name: "<b>Alpha</b>, AA" } },
        { id: 1, file: alpha, state: { ...alpha, population: -1 } },
        { id: 1, file: alpha, state: { ...alpha, coordinates: [[[0, 10], [1, 10], [0, 10]]] } },
    ];
    for (const change of bad) assert.equal((await run([change])).status, 422);
    for (const input of [null, [], [{ id: 1 }], [{ id: 1, file: alpha, state: alpha }, { id: 1, file: alpha, state: null }]]) assert.equal((await run(input)).status, 422);
});
