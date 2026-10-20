// Run after tools/build.ts:  deno test -A tests/   or   node --test tests/api.test.ts

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { route, type Service } from "../src/api.ts";
import { validateBorder } from "../src/borders.ts";
import { cityProblem } from "../src/cities.ts";
import { createLookup } from "../src/lookup.ts";

const file = (path: string) => readFile(new URL(`../${path}`, import.meta.url));
const bin = await file("public/data/lookup.bin");
const svc: Service = {
    lookup: createLookup(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer),
    names: JSON.parse((await file("public/data/names.json")).toString()),
    limit: 1000,
    version: "test",
    started: Date.now(),
};
const DIFFERENT_ROWS = [0,  95,  111,  113,  125,  140,  170,  174,  256,  285,  312,  366,  529,  532,  547,  714,  739,  777,  782,  787,  808,  835,  856,  858,  889,  912,  914,  999,  1076,  1110,  1111,  1201,  1222,  1223,  1229,  1233,  1234,  1236,  1241,  1242,  1265,  1276,  1279,  1283,  1286,  1290,  1303,  1373,  1376,  1438,  1520,  1580,  1596,  1749,  1766,  1794,  1810,  1826,  1892,  1917,  1961,  1962,  1963,  1964];
const call = (method: string, path: string, body?: string, service = svc) =>
    route(new Request(`http://localhost${path}`, { method, body, headers: body ? { "content-type": "application/json" } : undefined }), service);
const post = async (body: unknown, service = svc) => {
    const res = (await call("POST", "/mc_api", typeof body === "string" ? body : JSON.stringify(body), service))!;
    return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() };
};

test("the built-in test points match the tile-based API", async () => {
    const expected = JSON.parse((await file("tests/fixtures/test_points.json")).toString());
    assert.deepEqual((await post([])).body, expected);
});

test("GeoNames places agree with the tile-based API", async () => {
    const rows = (await file("tests/fixtures/places.tsv")).toString().split("\n").slice(1).filter(Boolean).map((l) => l.split("\t"));
    const points = rows.map(([lat, lon, cc], i) => ({ id: i, lat: Number(lat), lon: Number(lon), cc }));
    const got: Record<string, string> = {};
    for (let i = 0; i < points.length; i += 1000) Object.assign(got, (await post(points.slice(i, i + 1000))).body);
    // Known disagreements: eight from simplifying the trace, the rest are places across a closed border from
    // the city that used to cover them, which had no answer and now answer a city in their own country; rows 0
    // and 95 are in Andorra and Aruba, which had no city until Andorra la Vella, AD and Oranjestad, AW were added;
    // row 1766 went from Waco, (TX), US to College Station, (TX), US when that city was added; row 914 had no city
    // until Agartala, (TR), IN was added; rows 1373 (in Huelva, ES on the old tiles) and 1376 answer Faro, PT
    // and the other rows not named above change by design with the city review (new cities, renames, island and shore cuts)
    const different = rows.map((r, i) => (got[i] !== r[3] ? i : -1)).filter((i) => i >= 0);
    assert.deepEqual(different, DIFFERENT_ROWS);
});

test("request validation", async () => {
    const at = { lat: 51.5074, lon: -0.1278 };
    for (const bad of [{ id: {}, ...at }, { id: [1], ...at }, { id: false, ...at }, { id: 1, lat: "51.5", lon: -0.1 }, { id: 1, lat: 51.5, lon: "abc" }, { id: 1, lat: null, lon: null }, { id: 1, ...at, cc: 44 }]) {
        assert.deepEqual(await post([bad]), { status: 400, body: "Invalid request keys" });
    }
    assert.deepEqual(await post([{ id: 1, ...at }, { id: "1", ...at }]), { status: 400, body: "Element ids not unique" });
    assert.deepEqual(await post(JSON.stringify([{ id: "x".repeat(300_000), ...at }])), { status: 413, body: "Limit of 1000 locs" });
    assert.deepEqual((await post([{ id: "lower", ...at, cc: "gb" }])).body, { lower: "London, GB" });
    const london = { lat: 51.5074, lon: -0.1278 };
    assert.deepEqual(await post({ id: 1, ...london }), { status: 400, body: "Request is not array" });
    assert.deepEqual(await post([1]), { status: 400, body: "Invalid request data" });
    assert.deepEqual(await post([{ id: 1, lat: 51.5 }]), { status: 400, body: "Invalid request keys" });
    assert.deepEqual(await post([{ id: "", ...london }]), { status: 400, body: "Invalid request keys" });
    assert.deepEqual(await post([{ id: 1, ...london, cc: "GB", extra: 1 }]), { status: 400, body: "Invalid request keys" });
    assert.deepEqual(await post([{ id: 1, lat: 91, lon: 0 }]), { status: 422, body: "Out of bounds latitude" });
    assert.deepEqual(await post([{ id: 1, lat: 0, lon: 0 }]), { status: 422, body: "Null island found" });
    assert.deepEqual(await post([{ id: 1, ...london }, { id: 1, ...london }]), { status: 400, body: "Element ids not unique" });
    assert.deepEqual(await post("{not json"), { status: 400, body: "Invalid request data" });
    assert.deepEqual(await post([{ id: 1, ...london }, { id: 2, ...london }], { ...svc, limit: 1 }), { status: 413, body: "Limit of 1 locs" });
});

test("ids, including 0, come back as given", async () => {
    const london = { lat: 51.5074, lon: -0.1278 };
    assert.deepEqual((await post([{ id: 0, ...london }, { id: "a-1", ...london }])).body, { "0": "London, GB", "a-1": "London, GB" });
});

test("projection limits and longitude wrap", async () => {
    const res = (await post([{ id: "far north", lat: 86, lon: 10 }, { id: "plain", lat: 48.8566, lon: 2.3522 }, { id: "wrapped", lat: 48.8566, lon: 362.3522 }, { id: "sea", lat: 50, lon: -30 }])).body;
    assert.deepEqual(res, { "far north": "", plain: "Paris, FR", wrapped: "Paris, FR", sea: "" });
});

test("country code rules", () => {
    assert.equal(validateBorder("FR", "FR", "Paris, FR"), "Paris, FR");
    assert.equal(validateBorder("DE", "FR", "Strasbourg, FR"), "Strasbourg, FR");
    assert.equal(validateBorder("US", "FR", "Paris, FR"), "");
    assert.equal(validateBorder("SG", "MY", "Johor Bahru, MY"), "Singapore, SG");
    assert.equal(validateBorder("MY", "SG", "Singapore, SG"), "Johor Bahru, MY");
    assert.equal(validateBorder("MX", "US", "San Diego, (CA), US"), "Tijuana, MX");
    assert.equal(validateBorder("US", "CA", "Windsor, (ON), CA"), "Detroit, (MI), US");
    assert.equal(validateBorder("CN", "HK", "Hong Kong, HK"), "Shenzhen, (GD), CN");
    assert.equal(validateBorder("CG", "CD", "Kinshasa, CD"), "Brazzaville, CG");
    assert.equal(validateBorder("CD", "CG", "Brazzaville, CG"), "Kinshasa, CD");
});

test("a city's own centre answers that city", async () => {
    // Centres that sat just outside their outline in the original trace
    const known = ["Al Jadid, LY"]; // PH-2 put Bacolod City's centre inside its outline
    const dir = new URL("../data/cities/", import.meta.url);
    const wrong: string[] = [];
    for (const name of await readdir(dir)) {
        for (const line of (await readFile(new URL(name, dir), "utf8")).split("\n")) {
            if (!line.trim()) continue;
            const c = JSON.parse(line);
            if (svc.names[svc.lookup.cityAt(c.lo, c.la)] !== c.n) wrong.push(c.n);
        }
    }
    assert.deepEqual(wrong.sort(), known);
});

test("city records", () => {
    const ok = { i: 5, n: "Springfield, (IL), US", p: 100, la: 39.8, lo: -89.6, t: 1, g: [-896000000, 398000000, -895000000, 398000000, -895000000, 399000000] };
    assert.equal(cityProblem(ok, "US"), "");
    assert.equal(cityProblem({ ...ok, n: "Al-`Ula, US" }, "US"), "");
    const bad: [string, unknown][] = [
        ["id 0", { ...ok, i: 0 }], ["text id", { ...ok, i: "5" }], ["fraction id", { ...ok, i: 8.5 }], ["id past int32", { ...ok, i: 2147483653 }],
        ["numeric name", { ...ok, n: 12345 }], ["no country", { ...ok, n: "Nowhere" }], ["wrong country", { ...ok, n: "Springfield, CA" }],
        ["markup", { ...ok, n: "<img src=x>, US" }], ["long name", { ...ok, n: "A".repeat(60) + ", US" }], ["text population", { ...ok, p: "100" }],
        ["degrees", { ...ok, g: [10.2, 10.2, 10.9, 10.2, 10.9, 10.9] }], ["past int32", { ...ok, g: [3e9, 0, 10, 0, 10, 10] }], ["past 180", { ...ok, g: [1790000000, 0, 1810000000, 0, 1800000000, 10] }],
        ["text outline", { ...ok, g: "abcdef" }], ["two points", { ...ok, g: [0, 0, 10, 0] }], ["a line", { ...ok, g: [0, 0, 5, 5, 10, 10] }],
        ["closed ring", { ...ok, g: [...ok.g, ok.g[0], ok.g[1]] }], ["repeated point", { ...ok, g: [ok.g[0], ok.g[1], ...ok.g] }], ["far from its centre", { ...ok, la: 30 }],
        ["missing field", { i: 5, n: ok.n, p: 1, la: 1, lo: 1, t: 1 }], ["extra field", { ...ok, x: 1 }], ["array", [ok]],
    ];
    for (const [what, record] of bad) assert.notEqual(cityProblem(record, "US"), "", what);
});

test("other routes", async () => {
    assert.equal((await call("HEAD", "/status"))!.status, 200);
    assert.match(await (await call("GET", "/info"))!.text(), /^https:/);
    assert.equal((await call("GET", "/status"))!.status, 200);
    assert.equal(await (await call("GET", "/version"))!.text(), "test");
    assert.equal((await call("POST", "/nowhere", "[]"))!.status, 501);
    assert.equal((await call("PUT", "/mc_api", "[]"))!.status, 405);
    assert.equal(await call("GET", "/index.html"), null);
});
