// The rules a city record must meet. Used by the build, and by anything that accepts an edit.

import { SCALE } from "./lookup.ts";

export type City = { i: number; n: string; p: number; la: number; lo: number; t: number; g: number[] };

export const MAX_NAME = 48;
export const MAX_VERTICES = 500;
export const MAX_CITIES = 65535;
const MAX_X = 180 * SCALE;
const MAX_Y = 850511287;
const KEYS = ["g", "i", "la", "lo", "n", "p", "t"];
const NAME = /^[A-Za-z`][A-Za-z '`.&/()-]*?(, \([A-Z]{2,3}\))?, ([A-Z]{2})$/;

const int = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const num = (v: unknown, limit: number): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;

// Twice the signed area, exact
export function area2(g: number[]): bigint {
    let sum = 0n;
    for (let j = 0; j < g.length; j += 2) {
        const k = (j + 2) % g.length;
        sum += BigInt(g[j]) * BigInt(g[k + 1]) - BigInt(g[k]) * BigInt(g[j + 1]);
    }
    return sum;
}

// Returns what is wrong with a record, or "" when it is valid. cc is the country the record is filed under.
export function cityProblem(c: unknown, cc: string): string {
    if (typeof c !== "object" || c === null || Array.isArray(c)) return "not an object";
    const r = c as Record<string, unknown>;
    if (Object.keys(r).sort().join() !== KEYS.join()) return `fields must be exactly ${KEYS.join(", ")}`;
    if (!int(r.i, 1, 2147483647)) return "i must be an integer from 1 to 2147483647";
    if (typeof r.n !== "string" || r.n.length > MAX_NAME) return `n must be text of at most ${MAX_NAME} characters`;
    const name = NAME.exec(r.n);
    if (!name) return "n must be letters, spaces and ' ` . & / ( ) -, then an optional state as \", (ST)\", then \", CC\"";
    if (name[2] !== cc) return `n must end with the country it is filed under, ${cc}`;
    if (!int(r.p, 0, 100_000_000)) return "p must be an integer from 0 to 100000000";
    if (!num(r.la, 90) || !num(r.lo, 180)) return "la and lo must be numbers within 90 and 180";
    if (!int(r.t, 1, Number.MAX_SAFE_INTEGER)) return "t must be a positive integer";
    const g = r.g;
    if (!Array.isArray(g) || g.length < 6 || g.length % 2 || g.length > MAX_VERTICES * 2) return `g must hold 3 to ${MAX_VERTICES} points`;
    for (let j = 0; j < g.length; j += 2) {
        if (!int(g[j], -MAX_X, MAX_X) || !int(g[j + 1], -MAX_Y, MAX_Y)) return `g point ${j / 2} is not an integer position on the map`;
    }
    if (area2(g) === 0n) return "g encloses no area";
    return "";
}
