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

// The headers Cloudflare adds to static files, from public/_headers, so a policy that breaks the page shows here first.
// Strict-Transport-Security is left out: this server is plain HTTP.
const assetHeaders = Object.fromEntries(new TextDecoder().decode(await read("_headers")).split("\n").filter((l) => l.startsWith("  ") && !/^\s*strict-transport/i.test(l)).map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));

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
const readCities = (cc: string) => Deno.readTextFile(cityFile(cc)).catch((err) => { if (err instanceof Deno.errors.NotFound) return null; throw err; });
async function writeCities(files: Record<string, string | null>) {
    for (const [cc, text] of Object.entries(files)) {
        if (text === null) await Deno.remove(cityFile(cc)).catch(() => {});
        else await Deno.writeTextFile(cityFile(cc), text);
    }
}
const build = (version: string) => new Deno.Command(Deno.execPath(), { args: ["run", "-A", "--no-lock", "tools/build.ts"], cwd: root, env: { DATA_VERSION: version } }).output();

let busy = false;
async function push(request: Request): Promise<Response> {
    const refuse = (status: number, ...problems: string[]) => Response.json({ problems }, { status });
    // Only this page, on this machine: any other site open in the browser could post here too
    const url = new URL(request.url);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || request.headers.get("origin") !== url.origin) return refuse(403, "pushes are accepted from this server's own page only");
    if (busy) return refuse(503, "another push is in progress");
    busy = true;
    let before: Record<string, string | null> | null = null;
    try {
        let body: { changes?: unknown } | null;
        try { body = await readJson(request, 2_000_000) as { changes?: unknown } | null; } catch { return refuse(400, "the request could not be read"); }
        const result = await applyChanges(body?.changes, { names: service.names, near: service.lookup.near, read: readCities }, Date.now());
        if (result.status !== 200) return Response.json(result, { status: result.status });
        const saved: Record<string, string | null> = {};
        for (const cc of Object.keys(result.files)) saved[cc] = await readCities(cc);
        before = saved;
        await writeCities(result.files);
        const built = await build(`local-${Date.now()}`);
        if (!built.success) throw new Error(new TextDecoder().decode(built.stderr).trim().split("\n").slice(0, 5).join("; "));
        const commit = await load();
        before = null;
        return Response.json({ commit });
    } catch (err) {
        // Whatever failed after the files were written, put them back and rebuild from them
        if (before) { await writeCities(before); await build("dev").catch(() => {}); await load().catch(() => {}); }
        return refuse(before ? 422 : 502, (err as Error).message);
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
        if (name === "_headers") throw new Error("not a page");
        return new Response(await Deno.readFile(target), { headers: { ...assetHeaders, "content-type": types[path.split(".").pop() ?? ""] ?? "application/octet-stream" } });
    } catch {
        return new Response("Not found", { status: 404 });
    }
});
