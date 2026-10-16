// deno test -A tests/   or   node --test tests/push.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { applyChanges, commitMessage, MAX_CHANGES, MAX_COUNTRIES, MAX_MESSAGE, type Published, type Snapshot } from "../src/push.ts";

const square = (x: number, y = 10, size = 1): number[][][] => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]];
const city = (name: string, x: number): Snapshot => ({ name, population: 1000, lat: 10.5, lon: x + 0.5, coordinates: square(x) });
const flat = (s: Snapshot) => s.coordinates[0].slice(0, -1).flatMap(([lon, lat]) => [Math.round(lon * 1e7), Math.round(lat * 1e7)]);
const line = (id: number, s: Snapshot) => JSON.stringify({ i: id, n: s.name, p: s.population, la: s.lat, lo: s.lon, t: 5, g: flat(s) });

const alpha = city("Alpha, AA", 0), beta = city("Beta, AA", 2), gamma = city("Gamma, BB", 4);
const cities: [number, Snapshot][] = [[1, alpha], [2, beta], [3, gamma]];
const files: Record<string, string> = { AA: `${line(1, alpha)}\n${line(2, beta)}\n`, BB: `${line(3, gamma)}\n` };
// Enough other cities, in a country no test reads, for the data to pass as whole
const letters = (k: number) => [0, 1, 2].map((d) => String.fromCharCode(97 + Math.floor(k / 26 ** d) % 26)).join("");
const filler = Object.fromEntries(Array.from({ length: 3000 }, (_, k) => [1000 + k, `Filler ${letters(k)}, ZZ`]));
const names: Record<string, string> = { ...filler, 1: alpha.name, 2: beta.name, 3: gamma.name };
const published: Published = {
    names,
    read: (cc) => Promise.resolve(files[cc] ?? null),
    near: (x0, y0, x1, y1) => cities.map(([id, s]) => ({ id, g: flat(s) })).filter(({ g }) => g[0] <= x1 && g[2] >= x0 && g[1] <= y1 && g[5] >= y0),
};
const run = (changes: unknown, from: Published = published) => applyChanges(changes, from, 9);
const problems = async (changes: unknown) => { const out = await run(changes); return out.status === 422 ? out.problems.join("; ") : `status ${out.status}`; };

test("an update replaces the city's line and leaves the others as they were", async () => {
    const moved = { ...alpha, coordinates: square(0.25, 10, 0.5) };
    const out = await run([{ id: 1, file: alpha, state: moved }]);
    assert.equal(out.status, 200);
    const text = (out as { files: Record<string, string> }).files.AA;
    assert.ok(text.endsWith("\n") && !text.endsWith("\n\n"));
    const lines = text.trim().split("\n");
    assert.equal(lines[1], line(2, beta));
    assert.deepEqual(JSON.parse(lines[0]), { ...JSON.parse(line(1, moved)), t: 9 });
});

test("a city as the build publishes it compares equal to its file", async () => {
    // cities.json holds integer / 1e7; these do not all survive as exact decimals
    const awkward = { ...alpha, coordinates: [[[0.1234567, 10.7654321], [0.9999999, 10.0000001], [0.3333333, 10.6666667], [0.1234567, 10.7654321]]] };
    const from = { ...published, read: () => Promise.resolve(line(1, awkward) + "\n") };
    const sent = JSON.parse(JSON.stringify({ ...awkward, coordinates: [flat(awkward).reduce<number[][]>((ring, v, k) => (k % 2 ? (ring[ring.length - 1].push(v / 1e7), ring) : [...ring, [v / 1e7]]), [])] }));
    sent.coordinates[0].push(sent.coordinates[0][0]);
    assert.equal((await run([{ id: 1, file: sent, state: { ...sent, population: 7 } }], from)).status, 200);
});

test("a push is refused whole when a city has changed since its edit was made", async () => {
    const out = await run([{ id: 1, file: { ...alpha, population: 5 }, state: { ...alpha, population: 7 } }, { id: 2, file: beta, state: null }]);
    assert.deepEqual(out, { status: 409, changed: [1] });
    assert.equal((await run([{ id: 3, file: null, state: city("Delta, AA", 6) }])).status, 409, "a new city whose id is published");
    assert.equal((await run([{ id: 77, file: city("Ghost, AA", 8), state: null }])).status, 409, "a city that is not in the file");
});

test("create, delete and a move between countries", async () => {
    const out = await run([{ id: 9, file: null, state: city("Delta, CC", 6) }, { id: 3, file: gamma, state: null }, { id: 2, file: beta, state: { ...beta, name: "Beta, CC" } }]);
    assert.equal(out.status, 200);
    const f = (out as { files: Record<string, string | null> }).files;
    assert.equal(f.BB, null);
    assert.equal(f.AA, `${line(1, alpha)}\n`);
    assert.deepEqual(f.CC!.trim().split("\n").map((l) => JSON.parse(l).i), [9, 2]);
});

test("two cities may swap names in one push, and a change that changes nothing writes nothing", async () => {
    assert.equal((await run([{ id: 1, file: alpha, state: { ...alpha, name: beta.name } }, { id: 2, file: beta, state: { ...beta, name: alpha.name } }])).status, 200);
    assert.match(await problems([{ id: 1, file: alpha, state: alpha }]), /nothing in this push differs/);
    const out = await run([{ id: 1, file: alpha, state: alpha }, { id: 2, file: beta, state: { ...beta, population: 2 } }]);
    assert.equal((out as { files: Record<string, string> }).files.AA.split("\n")[0], line(1, alpha));
});

test("records the build would reject are refused", async () => {
    assert.match(await problems([{ id: 1, file: alpha, state: { ...alpha, name: beta.name } }]), /another city has this name/);
    assert.match(await problems([{ id: 9, file: null, state: city(alpha.name, 6) }]), /another city has this name/);
    assert.match(await problems([{ id: 1, file: alpha, state: { ...alpha, name: "<b>Alpha</b>, AA" } }]), /Alpha/);
    assert.match(await problems([{ id: 1, file: alpha, state: { ...alpha, population: -1 } }]), /p must be/);
    assert.match(await problems([{ id: 1, file: alpha, state: { ...alpha, coordinates: [[[0, 10], [1, 10], [0, 10]]] } }]), /3 to 500 points/);
    for (const input of [null, [], [{ id: 1 }], [{ id: 1, file: alpha, state: alpha }, { id: 1, file: alpha, state: null }]]) assert.equal((await run(input)).status, 422);
    assert.equal((await run(Array.from({ length: MAX_CHANGES + 1 }, (_, k) => ({ id: 5000 + k, file: null, state: city(`New ${letters(k)}, AA`, 8) })))).status, 422);
});

test("outlines that would give wrong answers are refused", async () => {
    assert.match(await problems([{ id: 9, file: null, state: { ...city("Delta, AA", 0), coordinates: square(0.4, 10.4, 0.2) } }]), /Delta, AA: overlaps Alpha, AA/);
    assert.match(await problems([{ id: 1, file: alpha, state: { ...alpha, coordinates: [[[0, 10], [2.2, 10], [2.2, 11], [0, 11], [0, 10]]] } }]), /overlaps Beta, AA/);
    assert.match(await problems([{ id: 9, file: null, state: city("Delta, AA", 6) }, { id: 8, file: null, state: { ...city("Epsilon, AA", 6), coordinates: square(6.5) } }]), /overlaps Epsilon, AA/);
    // sharing an edge is not an overlap, and neither is taking the place of a city deleted in the same push
    assert.equal((await run([{ id: 9, file: null, state: city("Delta, AA", 1) }])).status, 200);
    assert.equal((await run([{ id: 1, file: alpha, state: null }, { id: 9, file: null, state: city("Delta, AA", 0) }])).status, 200);
    assert.match(await problems([{ id: 1, file: alpha, state: { ...alpha, coordinates: [[[0, 10], [1, 11], [1, 10], [0.2, 10.6], [0, 10]]] } }]), /crosses itself/);
    // meant as a 1 degree box across the antimeridian; as stored it is 359 degrees wide
    const dateline = { name: "Dateline, FJ", population: 1, lat: -16.5, lon: 180, coordinates: [[[179.5, -17], [-179.5, -17], [-179.5, -16], [179.5, -16], [179.5, -17]]] };
    assert.match(await problems([{ id: 9, file: null, state: dateline }]), /km from the centre/);
    assert.match(await problems([{ id: 1, file: alpha, state: { ...alpha, lat: -80, lon: 170 } }]), /km from the centre/);
});

test("a push may not empty the data, span too many countries, or write a country whose file went missing", async () => {
    const few = { ...published, names: { 1: alpha.name, 2: beta.name, 3: gamma.name } };
    assert.match((await run([{ id: 1, file: alpha, state: { ...alpha, population: 2 } }], few) as { problems: string[] }).problems[0], /would hold 3 cities/);
    const wide = Array.from({ length: MAX_COUNTRIES + 1 }, (_, k) => ({ id: 5000 + k, file: null, state: city(`New ${letters(k)}, ${letters(k).slice(0, 2).toUpperCase()}`, 8 + 2 * k) }));
    assert.match(await problems(wide), /at most 40 countries/);
    await assert.rejects(run([{ id: 9, file: null, state: city("Delta, AA", 6) }], { ...published, read: () => Promise.resolve(null) }), /could not be read/);
});

test("a commit message is trimmed and loses control characters other than newline; one that is not text or too long is refused", () => {
    assert.equal(commitMessage(undefined), "");
    assert.equal(commitMessage(null), "");
    assert.equal(commitMessage("   "), "");
    assert.equal(commitMessage("  Fix\tthe Lyon\u0007 outline\r\n\nsee issue 4 \u009b "), "Fixthe Lyon outline\n\nsee issue 4");
    assert.equal(commitMessage("x".repeat(MAX_MESSAGE)), "x".repeat(MAX_MESSAGE));
    assert.equal(commitMessage(` ${"x".repeat(MAX_MESSAGE)}\u0000 `), "x".repeat(MAX_MESSAGE));
    assert.equal(commitMessage("x".repeat(MAX_MESSAGE + 1)), null);
    for (const input of [42, true, ["a"], { text: "a" }]) assert.equal(commitMessage(input), null);
});
