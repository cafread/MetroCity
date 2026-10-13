// The public endpoints, independent of any host. Same contract as metrocity_api.

import { validateBorder } from "./borders.ts";
import type { Lookup } from "./lookup.ts";

export type Service = { lookup: Lookup; names: Record<string, string>; limit: number; version: string; started: number };
type Point = { id: string | number; lat: number; lon: number; cc?: string };

const MAX_MERCATOR_LAT = 85.0511287798066;
const BYTES_PER_POINT = 256;
const text = (body: string, status: number) => new Response(body, { status });

// Reads the body as JSON, or returns null once it passes max bytes
export async function readJson(request: Request, max: number): Promise<unknown> {
    if (Number(request.headers.get("content-length")) > max) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of request.body ?? []) {
        size += chunk.length;
        if (size > max) return null;
        chunks.push(chunk);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { all.set(chunk, at); at += chunk.length; }
    return JSON.parse(new TextDecoder().decode(all));
}

export const testData: Point[] = [
    { id: 1, lat: 37.945522, lon: 23.66879, cc: "GR" },
    { id: 2, lat: 59.506506, lon: 17.921503, cc: "SE" },
    { id: 3, lat: 39.18671, lon: -77.252235, cc: "US" },
    { id: 4, lat: 41.687879, lon: -91.611682, cc: "US" },
    { id: 5, lat: 54.935841, lon: -1.369136, cc: "GB" },
    { id: 6, lat: 13.870685, lon: 100.558653, cc: "TH" },
    { id: 7, lat: 28.995286, lon: -13.49131, cc: "ES" },
    { id: 8, lat: -33.91088, lon: 151.2075, cc: "AU" },
    { id: 9, lat: -33.788149, lon: 151.285844, cc: "AU" },
    { id: 10, lat: 24.481564, lon: 118.12503, cc: "CN" },
    { id: 11, lat: 42.350116, lon: -77.669345, cc: "US" },
    { id: 12, lat: 9.537782, lon: 100.069772, cc: "TH" },
    { id: 13, lat: 36.639637, lon: -93.269216, cc: "US" },
    { id: 14, lat: 38.485672, lon: -107.868173, cc: "US" },
    { id: 15, lat: 22.391, lon: 114.137, cc: "HK" },
    { id: 16, lat: 1.472, lon: 103.887, cc: "SG" },
    { id: 17, lat: 32.602, lon: -115.214, cc: "US" },
    { id: 18, lat: 48.473, lon: 8.13, cc: "DE" },
];

export function resolve(points: Point[], svc: Service): Record<string, string> {
    const result: Record<string, string> = Object.create(null);
    for (const p of points) {
        let city = "";
        if (Math.abs(p.lat) <= MAX_MERCATOR_LAT) {
            const lon = ((p.lon % 360) + 540) % 360 - 180;
            city = svc.names[svc.lookup.cityAt(lon, p.lat)] ?? "";
        }
        const cc = (p.cc || "").toUpperCase();
        result[p.id] = city && cc ? validateBorder(cc, city.slice(-2), city) : city;
    }
    return result;
}

async function mcApi(request: Request, svc: Service): Promise<Response> {
    try {
        const input = await readJson(request, Math.max(svc.limit, 1000) * BYTES_PER_POINT);
        if (input === null) return text(`Limit of ${svc.limit} locs`, 413);
        if (!Array.isArray(input)) return text("Request is not array", 400);
        if (input.length > svc.limit) return text(`Limit of ${svc.limit} locs`, 413);
        if (!input.every((e) => typeof e === "object" && !Array.isArray(e) && e !== null)) return text("Invalid request data", 400);
        const hasId = (e: Point) => (typeof e.id === "string" && e.id !== "") || Number.isFinite(e.id);
        const hasCc = (e: Point) => e.cc === undefined || e.cc === null || typeof e.cc === "string";
        if (!input.every((e) => hasId(e) && Number.isFinite(e.lat) && Number.isFinite(e.lon) && hasCc(e) && Object.keys(e).length <= 4)) return text("Invalid request keys", 400);
        if (!input.every((e) => Math.abs(e.lat) <= 90)) return text("Out of bounds latitude", 422);
        if (!input.every((e) => !(e.lat === 0 && e.lon === 0))) return text("Null island found", 422);
        if (input.length > new Set(input.map((e) => String(e.id))).size) return text("Element ids not unique", 400);
        return Response.json(resolve(input.length > 0 ? input : testData, svc));
    } catch {
        return text("Invalid request data", 400);
    }
}

function status(svc: Service): string {
    const up = Math.floor((Date.now() - svc.started) / 1000);
    return `Server has been up for ${Math.floor(up / 86400)} days, ${Math.floor(up / 3600) % 24} hours, ${Math.floor(up / 60) % 60} minutes, ${up % 60} seconds.`;
}

// Returns null for anything that is not an API route, so the host can serve a static file instead.
export function route(request: Request, svc: Service): Response | Promise<Response> | null {
    const path = new URL(request.url).pathname;
    if (request.method === "POST") {
        if (path === "/mc_api") return mcApi(request, svc);
        return text("Unknown post route", 501);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return text("Request type not accepted", 405);
    if (path === "/status") return text(status(svc), 200);
    if (path === "/info") return text("https://github.com/cafread/MetroCity", 200);
    if (path === "/version") return text(svc.version, 200);
    return null;
}
