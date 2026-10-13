// The editor's routes: sign-in with GitHub, and push. Push writes to the repo, so every route here
// answers only on the production host, and push only for a signed-in user on the editors list.

import { readJson } from "./api.ts";
import { commitCities, head, readCities, type Repo } from "./github.ts";
import { applyChanges } from "./push.ts";

export type EditEnv = {
    EDIT_HOST?: string;            // the only host these routes answer on
    EDIT_REPO?: string;            // owner/name
    EDIT_BRANCH?: string;
    EDITORS?: string;              // GitHub logins allowed to push, comma separated
    GITHUB_TOKEN?: string;         // writes to the repo
    GITHUB_CLIENT_ID?: string;     // the OAuth app used for sign-in
    GITHUB_CLIENT_SECRET?: string;
};
// version is the commit the running data was built from; names is its id -> name. fetch is replaced in tests.
export type EditContext = { version: string; names: Record<string, string>; fetch?: typeof fetch };

const SESSION = "mc_session";
const STATE = "mc_state";
const SESSION_DAYS = 30;
const MAX_BODY = 32_000_000;

const enc = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
async function sign(secret: string, text: string): Promise<string> {
    const key = await crypto.subtle.importKey("raw", enc.encode("session:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text))));
}
// Compares without stopping at the first difference
function equal(a: string, b: string): boolean {
    let diff = a.length ^ b.length;
    for (let k = 0; k < a.length; k++) diff |= a.charCodeAt(k) ^ b.charCodeAt(k % (b.length || 1));
    return diff === 0;
}
const cookie = (request: Request, name: string) => (request.headers.get("cookie") ?? "").split(/; */).find((c) => c.startsWith(name + "="))?.slice(name.length + 1) ?? "";
const setCookie = (name: string, value: string, seconds: number) => `${name}=${value}; Path=/edit; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
const editors = (env: EditEnv) => (env.EDITORS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// The signed-in editor's GitHub login, or ""
async function sessionUser(request: Request, env: EditEnv): Promise<string> {
    const [login, expires, mac] = cookie(request, SESSION).split(".");
    if (!login || !mac || !(Number(expires) > Date.now())) return "";
    if (!equal(mac, await sign(env.GITHUB_CLIENT_SECRET!, `${login}.${expires}`))) return "";
    return editors(env).includes(login.toLowerCase()) ? login : "";
}

async function callback(url: URL, request: Request, env: EditEnv, ctx: EditContext): Promise<Response> {
    const state = url.searchParams.get("state") ?? "", code = url.searchParams.get("code") ?? "";
    if (!code || !state || !equal(state, cookie(request, STATE))) return new Response("Sign-in was not started from this browser, or has expired. Go back and try again.", { status: 400 });
    const doFetch = ctx.fetch ?? fetch;
    const token = await (await doFetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
    })).json() as { access_token?: string };
    if (!token.access_token) return new Response("GitHub did not complete the sign-in.", { status: 502 });
    const who = await (await doFetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json", "user-agent": "metrocity-editor" } })).json() as { login?: string };
    const login = who.login ?? "";
    if (!/^[A-Za-z0-9-]+$/.test(login) || !editors(env).includes(login.toLowerCase())) return new Response(`${login || "This account"} is not an editor of this data.`, { status: 403 });
    const expires = Date.now() + SESSION_DAYS * 86_400_000;
    const headers = new Headers({ location: "/" });
    headers.append("set-cookie", setCookie(SESSION, `${login}.${expires}.${await sign(env.GITHUB_CLIENT_SECRET!, `${login}.${expires}`)}`, SESSION_DAYS * 86_400));
    headers.append("set-cookie", setCookie(STATE, "", 0));
    return new Response(null, { status: 302, headers });
}

async function push(request: Request, user: string, env: EditEnv, ctx: EditContext): Promise<Response> {
    const refuse = (status: number, problem: string) => Response.json({ problems: [problem] }, { status });
    let body: { changes?: unknown } | null;
    try { body = await readJson(request, MAX_BODY) as { changes?: unknown } | null; } catch { return refuse(400, "the request could not be read"); }
    const repo: Repo = { name: env.EDIT_REPO!, branch: env.EDIT_BRANCH!, token: env.GITHUB_TOKEN!, fetch: ctx.fetch };
    try {
        // Only on top of the commit this data was built from: the names and outlines in hand are then
        // the published ones, and a push that is still deploying, or failed to, blocks the next
        const at = await head(repo);
        if (at !== ctx.version) return refuse(503, "a deploy is in progress, or the last one failed; push again once the published data is current");
        const result = await applyChanges(body?.changes, ctx.names, (cc) => readCities(repo, at, cc), Date.now());
        if (result.status !== 200) return Response.json(result, { status: result.status });
        const count = (body!.changes as unknown[]).length;
        const commit = await commitCities(repo, at, result.files, `Editor push by ${user}: ${count} ${count === 1 ? "city" : "cities"}`, { name: user, email: `${user}@users.noreply.github.com` });
        return commit ? Response.json({ commit }) : refuse(503, "the published data moved during the push; nothing was written, push again");
    } catch (err) {
        return refuse(502, (err as Error).message);
    }
}

// Returns null for a path that is not the editor's, so the host carries on
export async function edit(request: Request, env: EditEnv, ctx: EditContext): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/edit/")) return null;
    // Names only, never values, so a half-configured Worker says what it lacks
    const missing = (["EDIT_HOST", "EDIT_REPO", "EDIT_BRANCH", "EDITORS", "GITHUB_TOKEN", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const).filter((k) => !env[k]?.trim());
    if (missing.length) return new Response(`Editing is not set up: missing ${missing.join(", ")}`, { status: 501 });
    if (url.hostname !== env.EDIT_HOST) return new Response("Editing is not available on this host", { status: 501 });
    const route = `${request.method} ${url.pathname}`;
    if (route === "GET /edit/me") return Response.json({ user: await sessionUser(request, env) || null }, { headers: { "cache-control": "no-store" } });
    if (route === "GET /edit/login") {
        const state = hex(crypto.getRandomValues(new Uint8Array(16)));
        const to = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(env.GITHUB_CLIENT_ID!)}&redirect_uri=${encodeURIComponent(url.origin + "/edit/callback")}&state=${state}`;
        return new Response(null, { status: 302, headers: { location: to, "set-cookie": setCookie(STATE, state, 600) } });
    }
    if (route === "GET /edit/callback") return callback(url, request, env, ctx);
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    // A cross-site page cannot send this cookie on a POST, and cannot set this origin
    if (request.headers.get("origin") !== url.origin) return new Response("Wrong origin", { status: 403 });
    if (route === "POST /edit/logout") return new Response(null, { status: 204, headers: { "set-cookie": setCookie(SESSION, "", 0) } });
    if (route === "POST /edit/push") {
        const user = await sessionUser(request, env);
        return user ? push(request, user, env, ctx) : Response.json({ problems: ["not signed in"] }, { status: 401 });
    }
    return new Response("Not found", { status: 404 });
}
