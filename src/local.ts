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
    const readOnly = request.method === "GET" || request.method === "HEAD";
    const path = url.pathname === "/changelog" && readOnly ? "/data/changelog.json" : url.pathname === "/" ? "/index.html" : url.pathname;
    const res = path === "/data/changelog.json" ? null : await route(request, service);
    if (res) return res;
    try {
        const name = decodeURIComponent(path.slice(1));
        const target = new URL("./" + name, dir);
        if (!/^[\w.-]+(\/[\w.-]+)*$/.test(name) || name.includes("..") || !target.href.startsWith(dir.href)) throw new Error("outside public");
        return new Response(await Deno.readFile(target), { headers: { "content-type": types[path.split(".").pop() ?? ""] ?? "application/octet-stream" } });
    } catch {
        return new Response("Not found", { status: 404 });
    }
});
