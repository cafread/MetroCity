// Applies the editor's committed changes to the country files. It knows nothing of where the files
// are kept: the caller reads them, and writes back what this returns.

import { type City, cityProblem, MAX_CITIES, MIN_CITIES } from "./cities.ts";
import { bbox, overlaps, selfMeets } from "./geom.ts";
import { SCALE } from "./lookup.ts";

// A city as the editor holds it: one closed ring of [lon, lat] in degrees
export type Snapshot = { name: string; population: number; lat: number; lon: number; coordinates: number[][][] };
// file is the published city the edit was made from, state what it should become; null is no city
export type Change = { id: number; file: Snapshot | null; state: Snapshot | null };
export type Outcome =
    | { status: 200; files: Record<string, string | null> }
    | { status: 409; changed: number[] }
    | { status: 422; problems: string[] };
// What is published at the commit the files are read from: every city's id -> name, the files
// themselves (null when a country has none), and the outlines whose bounding box meets a given one
export type Published = {
    names: Record<string, string>;
    read(cc: string): Promise<string | null>;
    near(x0: number, y0: number, x1: number, y1: number): { id: number; g: number[] }[];
};

export const MAX_CHANGES = 100;
// Each country file is one read from the host, and a Worker on the free plan may make 50 requests
export const MAX_COUNTRIES = 40;
export const MAX_MESSAGE = 500;

const country = (name: string) => /, [A-Z]{2}$/.test(name) ? name.slice(-2) : "";

function isSnapshot(s: unknown): s is Snapshot {
    if (typeof s !== "object" || s === null) return false;
    const r = s as Record<string, unknown>;
    const ring = Array.isArray(r.coordinates) && r.coordinates.length === 1 ? r.coordinates[0] : null;
    return typeof r.name === "string" && typeof r.population === "number" && typeof r.lat === "number" && typeof r.lon === "number" &&
        Array.isArray(ring) && ring.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function toRecord(id: number, s: Snapshot, t: number): City {
    const g: number[] = [];
    for (const [lon, lat] of s.coordinates[0]) {
        const x = Math.round(lon * SCALE), y = Math.round(lat * SCALE);
        if (g.length && g[g.length - 2] === x && g[g.length - 1] === y) continue;
        g.push(x, y);
    }
    if (g.length > 2 && g[0] === g[g.length - 2] && g[1] === g[g.length - 1]) g.length -= 2;
    return { i: id, n: s.name, p: s.population, la: s.lat, lo: s.lon, t, g };
}

const same = (a: City, b: City) => a.n === b.n && a.p === b.p && a.la === b.la && a.lo === b.lo && a.g.length === b.g.length && a.g.every((v, k) => v === b.g[k]);
const boxesMeet = (a: number[], b: number[]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// The editor's own words for the commit, with control characters other than newline removed:
// "" when there are none, null when they are not text or are too long
export function commitMessage(input: unknown): string | null {
    if (input === undefined || input === null) return "";
    if (typeof input !== "string") return null;
    const text = input.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "").trim();
    return text.length <= MAX_MESSAGE ? text : null;
}

// In the files returned, null means the country is left with no cities and its file should go.
export async function applyChanges(input: unknown, published: Published, now: number): Promise<Outcome> {
    const refuse = (problem: string): Outcome => ({ status: 422, problems: [problem] });
    if (!Array.isArray(input) || input.length === 0 || input.length > MAX_CHANGES) return refuse(`expected 1 to ${MAX_CHANGES} changes`);
    const changes: Change[] = [];
    for (const c of input) {
        const ok = typeof c === "object" && c !== null && Number.isInteger(c.id) && (c.file === null || isSnapshot(c.file)) && (c.state === null || isSnapshot(c.state)) && (c.file || c.state);
        if (!ok) return refuse("a change must be { id, file, state } with a city or null for each of file and state");
        changes.push(c);
    }
    if (new Set(changes.map((c) => c.id)).size < changes.length) return refuse("a city appears in more than one change");

    const countries = new Set<string>();
    for (const c of changes) {
        for (const s of [c.file, c.state]) {
            if (!s) continue;
            if (!country(s.name)) return refuse(`"${s.name}" does not end with a country code`);
            countries.add(country(s.name));
        }
    }
    if (countries.size > MAX_COUNTRIES) return refuse(`a push may touch at most ${MAX_COUNTRIES} countries; this one touches ${countries.size}`);

    const { names } = published;
    const hasCities = new Set<string>();
    for (const name of Object.values(names)) hasCities.add(name.slice(-2));
    // Untouched records keep their line as it is in the file
    const files = new Map<string, { r: City; line: string }[]>();
    for (const cc of countries) {
        const text = await published.read(cc);
        // A missing file would otherwise be written back holding only this push's cities
        if (text === null && hasCities.has(cc)) throw new Error(`the file for ${cc} could not be read although it has published cities`);
        files.set(cc, (text ?? "").split("\n").filter((l) => l.trim()).map((line) => ({ r: JSON.parse(line), line })));
    }

    // Cities that are no longer as they were when the edit was made
    const changed: number[] = [];
    for (const c of changes) {
        const current = c.file ? files.get(country(c.file.name))!.find((e) => e.r.i === c.id)?.r : undefined;
        const unchanged = c.file ? current !== undefined && same(current, toRecord(c.id, c.file, current.t)) : !(c.id in names);
        if (!unchanged) changed.push(c.id);
    }
    if (changed.length) return { status: 409, changed };

    // Names in use once the changes are applied, counted without copying the whole list
    const taken = new Map<string, number>();
    const count = (name: string, by: number) => taken.set(name, (taken.get(name) ?? 0) + by);
    let total = Object.keys(names).length;
    for (const c of changes) {
        if (c.state) count(c.state.name, 1);
        total += (c.state ? 1 : 0) - (c.file ? 1 : 0);
    }
    const mine = new Set(changes.map((c) => String(c.id)));
    for (const id in names) if (!mine.has(id) && taken.has(names[id])) count(names[id], 1);
    if (total < MIN_CITIES || total > MAX_CITIES) return refuse(`the data would hold ${total} cities; it must hold ${MIN_CITIES} to ${MAX_CITIES}`);

    const problems: string[] = [];
    const written: City[] = [];
    for (const c of changes) {
        const from = c.file ? files.get(country(c.file.name))! : null;
        const at = from ? from.findIndex((e) => e.r.i === c.id) : -1;
        if (!c.state) { from!.splice(at, 1); continue; }
        const cc = country(c.state.name);
        const record = toRecord(c.id, c.state, now);
        if (from && same(from[at].r, record)) continue; // nothing to write for this city
        const problem = cityProblem(record, cc) || (taken.get(record.n)! > 1 ? "another city has this name" : "") || (selfMeets(record.g).crossings ? "the outline crosses itself" : "");
        if (problem) problems.push(`${c.state.name}: ${problem}`);
        written.push(record);
        const entry = { r: record, line: JSON.stringify(record) };
        const to = files.get(cc)!;
        if (from === to) to[at] = entry;
        else { from?.splice(at, 1); to.push(entry); }
    }
    if (problems.length) return { status: 422, problems };
    if (written.length === 0 && changes.every((c) => c.state)) return refuse("nothing in this push differs from the published data");

    // No written outline may share area with another city's: the published ones outside this push, and each other
    const boxes = written.map((r) => bbox(r.g));
    written.forEach((r, k) => {
        const others = published.near(boxes[k][0], boxes[k][1], boxes[k][2], boxes[k][3]).filter((o) => !mine.has(String(o.id))).map((o) => ({ name: names[o.id], g: o.g }));
        for (let j = k + 1; j < written.length; j++) if (boxesMeet(boxes[k], boxes[j])) others.push({ name: written[j].n, g: written[j].g });
        for (const o of others) if (overlaps(r.g, o.g)) problems.push(`${r.n}: overlaps ${o.name}`);
    });
    if (problems.length) return { status: 422, problems };

    const out: Record<string, string | null> = {};
    for (const [cc, list] of files) out[cc] = list.length ? list.map((e) => e.line).join("\n") + "\n" : null;
    return { status: 200, files: out };
}
