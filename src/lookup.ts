// Reads lookup.bin (written by tools/build.ts) and answers which city contains a point.
// Coordinates are integers of 1e-7 degrees. Nothing is parsed: the sections are used in place.

export const MAGIC = 0x314c434d; // "MCL1"
export const SCALE = 1e7;
export const ROOT = -180 * SCALE;
export const ROOT_SIZE = 360 * SCALE;

export type Lookup = { cities: number; cityAt(lon: number, lat: number): number };

export function createLookup(buffer: ArrayBuffer): Lookup {
    const head = new Uint32Array(buffer, 0, 8);
    if (head[0] !== MAGIC) throw new Error("not a lookup file");
    const [, nCity, nVert, nNode, nMix, nMixItem] = head;
    let at = 32;
    const section = <T>(make: (offset: number, length: number) => T, length: number, bytes: number): T => {
        const view = make(at, length);
        at += Math.ceil((length * bytes) / 4) * 4;
        return view;
    };
    const ids = section((o, n) => new Int32Array(buffer, o, n), nCity, 4);
    const start = section((o, n) => new Uint32Array(buffer, o, n), nCity + 1, 4);
    const box = section((o, n) => new Int32Array(buffer, o, n), nCity * 4, 4);
    const xy = section((o, n) => new Int32Array(buffer, o, n), nVert * 2, 4);
    const nodes = section((o, n) => new Int32Array(buffer, o, n), nNode, 4);
    const mixStart = section((o, n) => new Uint32Array(buffer, o, n), nMix + 1, 4);
    const mixItems = section((o, n) => new Uint16Array(buffer, o, n), nMixItem, 2);

    const inCity = (c: number, x: number, y: number): boolean => {
        if (x < box[c * 4] || x > box[c * 4 + 2] || y < box[c * 4 + 1] || y > box[c * 4 + 3]) return false;
        let inside = false;
        const first = start[c], end = start[c + 1];
        for (let a = first, b = end - 1; a < end; b = a++) {
            const ya = xy[a * 2 + 1], yb = xy[b * 2 + 1];
            if ((ya > y) !== (yb > y) && x < ((xy[b * 2] - xy[a * 2]) * (y - ya)) / (yb - ya) + xy[a * 2]) inside = !inside;
        }
        return inside;
    };

    return {
        cities: nCity,
        cityAt(lon: number, lat: number): number {
            const x = lon * SCALE, y = lat * SCALE;
            let x0 = ROOT, y0 = ROOT, size = ROOT_SIZE, n = nodes[0];
            while (n >= 0) {
                size /= 2;
                let quad = 0;
                if (x >= x0 + size) { quad = 1; x0 += size; }
                if (y >= y0 + size) { quad += 2; y0 += size; }
                n = nodes[n + quad];
            }
            if (n === -1) return 0;
            const leaf = -n - 2;
            if (leaf < nCity) return ids[leaf];
            for (let i = mixStart[leaf - nCity]; i < mixStart[leaf - nCity + 1]; i++) {
                if (inCity(mixItems[i], x, y)) return ids[mixItems[i]];
            }
            return 0;
        },
    };
}
