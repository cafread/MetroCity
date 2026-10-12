// Local server with the same endpoints, for debugging and bulk runs.
// deno run --allow-net --allow-read --allow-env src/local.ts     (PORT, reqLim)

import { route, type Service } from "./api.ts";
import { createLookup } from "./lookup.ts";

const dir = new URL("../public/", import.meta.url);
const read = (path: string) => Deno.readFile(new URL(path, dir));
const types: Record<string, string> = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", topojson: "application/json", txt: "text/plain", bin: "application/octet-stream", tsv: "text/plain", png: "image/png" };

const log = JSON.parse(new TextDecoder().decode(await read("data/changelog.json")));
const service: Service = {
    lookup: createLookup((await read("data/lookup.bin")).buffer as ArrayBuffer),
    names: JSON.parse(new TextDecoder().decode(await read("data/names.json"))),
    limit: Number(Deno.env.get("reqLim") ?? 1_000_000),
    version: `MetroCity, data ${log.version}`,
    started: Date.now(),
};

Deno.serve({ port: Number(Deno.env.get("PORT") ?? 3000), hostname: Deno.env.get("HOST") ?? "127.0.0.1" }, async (request) => {
    const url = new URL(request.url);
    const path = url.pathname === "/changelog" ? "/data/changelog.json" : url.pathname === "/" ? "/index.html" : url.pathname;
    const res = url.pathname === "/changelog" ? null : await route(request, service);
    if (res) return res;
    if (path.includes("..")) return new Response("Not found", { status: 404 });
    try {
        return new Response(await read(path.slice(1)), { headers: { "content-type": types[path.split(".").pop() ?? ""] ?? "application/octet-stream" } });
    } catch {
        return new Response("Not found", { status: 404 });
    }
});
