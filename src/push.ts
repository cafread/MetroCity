// Applies the editor's committed changes to the country files. It knows nothing of where the files
// are kept: the caller reads them, and writes back what this returns.

import { type City, cityProblem } from "./cities.ts";
import { SCALE } from "./lookup.ts";

// A city as the editor holds it: one closed ring of [lon, lat] in degrees
export type Snapshot = { name: string; population: number; lat: number; lon: number; coordinates: number[][][] };
// file is the published city the edit was made from, state what it should become; null is no city
export type Change = { id: number; file: Snapshot | null; state: Snapshot | null };
export type Outcome =
    | { status: 200; files: Record<string, string | null> }
    | { status: 409; conflicts: { id: number; theirs: Snapshot | null }[] }
    | { status: 422; problems: string[] };

export const MAX_CHANGES = 500;

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

function toSnapshot(c: City): Snapshot {
    const ring: number[][] = [];
    for (let j = 0; j < c.g.length; j += 2) ring.push([c.g[j] / SCALE, c.g[j + 1] / SCALE]);
    ring.push(ring[0]);
    return { name: c.n, population: c.p, lat: c.la, lon: c.lo, coordinates: [ring] };
}

const same = (a: City, b: City) => a.n === b.n && a.p === b.p && a.la === b.la && a.lo === b.lo && a.g.length === b.g.length && a.g.every((v, k) => v === b.g[k]);

// names is every published city's id -> name. read returns a country's file, or null when it has none.
// In the files returned, null means the country is left with no cities and its file should go.
export async function applyChanges(input: unknown, names: Record<string, string>, read: (cc: string) => Promise<string | null>, now: number): Promise<Outcome> {
    if (!Array.isArray(input) || input.length === 0 || input.length > MAX_CHANGES) return { status: 422, problems: [`expected 1 to ${MAX_CHANGES} changes`] };
    const changes: Change[] = [];
    for (const c of input) {
        const ok = typeof c === "object" && c !== null && Number.isInteger(c.id) && (c.file === null || isSnapshot(c.file)) && (c.state === null || isSnapshot(c.state)) && (c.file || c.state);
        if (!ok) return { status: 422, problems: ["a change must be { id, file, state } with a city or null for each of file and state"] };
        changes.push(c);
    }
    if (new Set(changes.map((c) => c.id)).size < changes.length) return { status: 422, problems: ["a city appears in more than one change"] };

    // Untouched records keep their line as it is in the file
    const files = new Map<string, { r: City; line: string }[]>();
    for (const c of changes) {
        for (const s of [c.file, c.state]) {
            const cc = s ? country(s.name) : "";
            if (s && !cc) return { status: 422, problems: [`"${s.name}" does not end with a country code`] };
            if (!cc || files.has(cc)) continue;
            const text = await read(cc);
            files.set(cc, (text ?? "").split("\n").filter((l) => l.trim()).map((line) => ({ r: JSON.parse(line), line })));
        }
    }

    const conflicts: { id: number; theirs: Snapshot | null }[] = [];
    for (const c of changes) {
        const current = c.file ? files.get(country(c.file.name))!.find((e) => e.r.i === c.id)?.r : undefined;
        const unchanged = c.file ? current !== undefined && same(current, toRecord(c.id, c.file, current.t)) : !(c.id in names);
        if (!unchanged) conflicts.push({ id: c.id, theirs: current ? toSnapshot(current) : null });
    }
    if (conflicts.length) return { status: 409, conflicts };

    const problems: string[] = [];
    const after: Record<string, string> = { ...names };
    for (const c of changes) {
        if (c.state) after[c.id] = c.state.name;
        else delete after[c.id];
    }
    const users = new Map<string, number>();
    for (const name of Object.values(after)) users.set(name, (users.get(name) ?? 0) + 1);
    for (const c of changes) {
        const from = c.file ? files.get(country(c.file.name))! : null;
        const at = from ? from.findIndex((e) => e.r.i === c.id) : -1;
        if (!c.state) { from!.splice(at, 1); continue; }
        const cc = country(c.state.name);
        const record = toRecord(c.id, c.state, now);
        const problem = cityProblem(record, cc) || (users.get(record.n)! > 1 ? "another city has this name" : "");
        if (problem) problems.push(`${c.state.name}: ${problem}`);
        const entry = { r: record, line: JSON.stringify(record) };
        const to = files.get(cc)!;
        if (from === to) to[at] = entry;
        else { from?.splice(at, 1); to.push(entry); }
    }
    if (problems.length) return { status: 422, problems };
    const out: Record<string, string | null> = {};
    for (const [cc, list] of files) out[cc] = list.length ? list.map((e) => e.line).join("\n") + "\n" : null;
    return { status: 200, files: out };
}
