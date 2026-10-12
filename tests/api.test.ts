// Run after tools/build.ts:  deno test -A tests/   or   node --test tests/api.test.ts

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { route, type Service } from "../src/api.ts";
import { validateBorder } from "../src/borders.ts";
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
    const different = rows.filter((r, i) => got[i] !== r[3]);
    console.log(`${rows.length - different.length} of ${rows.length} places agree; ${different.length} differ`);
    assert.ok(different.length / rows.length < 0.01, `${different.length} places differ`);
});

test("request validation", async () => {
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
});

test("other routes", async () => {
    assert.equal((await call("GET", "/status"))!.status, 200);
    assert.equal(await (await call("GET", "/version"))!.text(), "test");
    assert.equal((await call("POST", "/nowhere", "[]"))!.status, 501);
    assert.equal((await call("PUT", "/mc_api", "[]"))!.status, 405);
    assert.equal(await call("GET", "/index.html"), null);
});
