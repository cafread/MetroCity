// The exact geometry lives in src/geom.ts, where the push check uses it too. This adds reading the data.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { City } from "../src/cities.ts";
import { selfMeets } from "../src/geom.ts";

export { bbox, km, locate, onSegment, orient, overlaps } from "../src/geom.ts";

// Places where an outline crosses or touches itself
export const selfTouches = (g: number[]): number => selfMeets(g).touches;

export async function loadCities(dir: string): Promise<City[]> {
    const cities: City[] = [];
    for (const name of await readdir(dir)) {
        for (const line of (await readFile(join(dir, name), "utf8")).split("\n")) if (line.trim()) cities.push(JSON.parse(line));
    }
    return cities.sort((a, b) => a.i - b.i);
}
