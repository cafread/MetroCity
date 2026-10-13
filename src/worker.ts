// Cloudflare Workers entry. Static files in public/ are served by the platform; this handles the API.
// The lookup data is bundled with the code, so it is in memory before the first request.

import { route, type Service } from "./api.ts";
import { edit, type EditEnv } from "./edit.ts";
import { createLookup } from "./lookup.ts";
// @ts-ignore: wrangler bundles .bin files as an ArrayBuffer
import bin from "../public/data/lookup.bin";
import names from "../public/data/names.json" with { type: "json" };
import meta from "../public/data/version.json" with { type: "json" };

type Env = EditEnv & { ASSETS: { fetch(request: Request): Promise<Response> }; REQ_LIMIT?: string };

const lookup = createLookup(bin as ArrayBuffer);
let started = 0;

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        try {
            const url = new URL(request.url);
            const read = request.method === "GET" || request.method === "HEAD";
            if (url.protocol === "http:" && read) return Response.redirect(`https://${url.host}${url.pathname}${url.search}`, 301);
            if (url.pathname === "/changelog" && read) return env.ASSETS.fetch(new Request(url.origin + "/data/changelog.json", request));
            const edited = await edit(request, env, { version: meta.version, names, near: lookup.near });
            if (edited) return edited;
            started ||= Date.now();
            const limit = Number(env.REQ_LIMIT);
            const service: Service = { lookup, names, limit: Number.isInteger(limit) && limit > 0 ? limit : 1000, version: `MetroCity, data ${meta.version}`, started };
            return (await route(request, service)) ?? env.ASSETS.fetch(request);
        } catch {
            return new Response("Server error", { status: 500 });
        }
    },
};
