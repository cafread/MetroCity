// Local server with the same endpoints, for debugging and bulk runs.
// deno run --allow-net --allow-read --allow-env src/local.ts     (PORT, reqLim)
// With EDIT=1 and --allow-write --allow-run it also accepts the editor's pushes: they are written to
// data/cities in this working tree and the data is rebuilt. Committing them to Git is left to you.

import { readJson, route, type Service } from "./api.ts";
import { createLookup } from "./lookup.ts";
import { applyChanges } from "./push.ts";

const root = new URL("../", import.meta.url);
const dir = new URL("public/", root);
const read = (path: string) => Deno.readFile(new URL(path, dir));
const types: Record<string, string> = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", topojson: "application/json", txt: "text/plain", bin: "application/octet-stream", tsv: "text/plain", png: "image/png" };

const service = { limit: Number(Deno.env.get("reqLim") ?? 1_000_000), started: Date.now() } as Service;
async function load() {
    const log = JSON.parse(new TextDecoder().decode(await read("data/changelog.json")));
    service.lookup = createLookup((await read("data/lookup.bin")).buffer as ArrayBuffer);
    service.names = JSON.parse(new TextDecoder().decode(await read("data/names.json")));
    service.version = `MetroCity, data ${log.version}`;
    return log.version as string;
}
await load();

const cityFile = (cc: string) => new URL(`data/cities/${cc}.ndjson`, root);
const readCities = (cc: string) => Deno.readTextFile(cityFile(cc)).catch(() => null);
async function writeCities(files: Record<string, string | null>) {
    for (const [cc, text] of Object.entries(files)) {
        if (text === null) await Deno.remove(cityFile(cc)).catch(() => {});
        else await Deno.writeTextFile(cityFile(cc), text);
    }
}
const build = (version: string) => new Deno.Command(Deno.execPath(), { args: ["run", "-A", "--no-lock", "tools/build.ts"], cwd: root, env: { DATA_VERSION: version } }).output();

let busy = false;
async function push(request: Request): Promise<Response> {
    if (busy) return Response.json({ problems: ["another push is in progress"] }, { status: 503 });
    busy = true;
    try {
        const body = await readJson(request, 32_000_000) as { changes?: unknown } | null;
        const result = await applyChanges(body?.changes, service.names, readCities, Date.now());
        if (result.status !== 200) return Response.json(result, { status: result.status });
        const before: Record<string, string | null> = {};
        for (const cc of Object.keys(result.files)) before[cc] = await readCities(cc);
        await writeCities(result.files);
        const built = await build(`local-${Date.now()}`);
        if (!built.success) {
            await writeCities(before);
            return Response.json({ problems: new TextDecoder().decode(built.stderr).trim().split("\n").slice(0, 5) }, { status: 422 });
        }
        return Response.json({ commit: await load() });
    } catch {
        return Response.json({ problems: ["the request could not be read"] }, { status: 400 });
    } finally {
        busy = false;
    }
}

Deno.serve({ port: Number(Deno.env.get("PORT") ?? 3000), hostname: Deno.env.get("HOST") ?? "127.0.0.1" }, async (request) => {
    const url = new URL(request.url);
    const readOnly = request.method === "GET" || request.method === "HEAD";
    if (url.pathname === "/edit/push" && request.method === "POST" && Deno.env.get("EDIT") === "1") return push(request);
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
