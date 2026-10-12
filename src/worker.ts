// Cloudflare Workers entry. Static files in public/ are served by the platform; this handles the API.

import { route, type Service } from "./api.ts";
import { createLookup } from "./lookup.ts";

type Env = { ASSETS: { fetch(request: Request): Promise<Response> }; REQ_LIMIT?: string };

let service: Promise<Service> | undefined;

async function load(env: Env, origin: string): Promise<Service> {
    const get = (path: string) => env.ASSETS.fetch(new Request(origin + path));
    const [bin, names, log] = await Promise.all([get("/data/lookup.bin"), get("/data/names.json"), get("/data/changelog.json")]);
    if (!bin.ok || !names.ok || !log.ok) throw new Error("data files missing from the deployment");
    return {
        lookup: createLookup(await bin.arrayBuffer()),
        names: await names.json(),
        limit: Number(env.REQ_LIMIT ?? 1000),
        version: `MetroCity, data ${(await log.json() as { version: string }).version}`,
        started: Date.now(),
    };
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === "/changelog") return env.ASSETS.fetch(new Request(url.origin + "/data/changelog.json"));
        service ??= load(env, url.origin).catch((err) => { service = undefined; throw err; });
        return (await route(request, await service)) ?? env.ASSETS.fetch(request);
    },
};
