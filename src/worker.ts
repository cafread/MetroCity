// Cloudflare Workers entry. Static files in public/ are served by the platform; this handles the API.
// The lookup data is bundled with the code, so it is in memory before the first request.

import { route, type Service } from "./api.ts";
import { createLookup } from "./lookup.ts";
// @ts-ignore: wrangler bundles .bin files as an ArrayBuffer
import bin from "../public/data/lookup.bin";
import names from "../public/data/names.json" with { type: "json" };
import meta from "../public/data/version.json" with { type: "json" };

type Env = { ASSETS: { fetch(request: Request): Promise<Response> }; REQ_LIMIT?: string };

const lookup = createLookup(bin as ArrayBuffer);
let started = 0;

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === "/changelog") return env.ASSETS.fetch(new Request(url.origin + "/data/changelog.json"));
        started ||= Date.now();
        const service: Service = { lookup, names, limit: Number(env.REQ_LIMIT ?? 1000), version: `MetroCity, data ${meta.version}`, started };
        return (await route(request, service)) ?? env.ASSETS.fetch(request);
    },
};
