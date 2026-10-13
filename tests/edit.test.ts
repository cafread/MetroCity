// deno test -A tests/   or   node --test tests/edit.test.ts
// GitHub is replaced by a small stand-in that keeps one branch of country files.

import assert from "node:assert/strict";
import test from "node:test";
import { edit, type EditEnv } from "../src/edit.ts";

const host = "editor.test";
const env: EditEnv = { EDIT_HOST: host, EDIT_REPO: "o/r", EDIT_BRANCH: "main", EDITOR_IDS: "7", GITHUB_TOKEN: "t", GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", SESSION_KEY: "key", DEPLOY_HOOK: "https://hook.test/build" };
const square = (x: number): number[][][] => [[[x, 10], [x + 1, 10], [x + 1, 11], [x, 11], [x, 10]]];
const alpha = { name: "Alpha, AA", population: 1000, lat: 10.5, lon: 0.5, coordinates: square(0) };
const line = JSON.stringify({ i: 1, n: alpha.name, p: 1000, la: 10.5, lo: 0.5, t: 5, g: square(0)[0].slice(0, -1).flatMap(([lon, lat]) => [lon * 1e7, lat * 1e7]) });
const letters = (k: number) => [0, 1, 2].map((d) => String.fromCharCode(97 + Math.floor(k / 26 ** d) % 26)).join("");
const names: Record<string, string> = { ...Object.fromEntries(Array.from({ length: 3000 }, (_, k) => [1000 + k, `Filler ${letters(k)}, ZZ`])), 1: alpha.name };

// fail names a step that answers with an error; account is who GitHub says is signing in
function github(account = { login: "alice", id: 7 }, fail: Record<string, number | string> = {}) {
    const state = { builds: 0, head: "c1", files: { AA: line + "\n" } as Record<string, string | null>, commits: [] as Record<string, any>[], trees: [] as Record<string, any>[], pending: {} as Record<string, string | null> };
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : null;
        const reply = (data: unknown, status = 200) => new Response(typeof data === "string" ? data : JSON.stringify(data), { status });
        if (url === "https://hook.test/build") { state.builds++; return fail.hook ? reply("", Number(fail.hook)) : reply({}); }
        if (url.endsWith("/login/oauth/access_token")) return reply({ access_token: body.code === "good" ? "user-token" : undefined });
        if (url === "https://api.github.com/user") return reply(account);
        assert.equal((init?.headers as Record<string, string>).authorization, "Bearer t");
        if (url.endsWith("/git/ref/heads/main")) return reply({ object: { sha: state.head } });
        if (url.includes("/contents/data/cities/")) { const text = state.files[url.slice(url.lastIndexOf("/") + 1, url.indexOf(".ndjson"))]; return fail.read ? reply("", Number(fail.read)) : text ? reply(text) : reply("", 404); }
        if (url.includes("/git/commits/")) return reply({ tree: { sha: "t1" } });
        if (url.endsWith("/git/trees")) { state.trees.push(body); state.pending = Object.fromEntries(body.tree.map((e: Record<string, any>) => [e.path.slice(12, 14), e.sha === null ? null : e.content])); return reply({ sha: "t2" }); }
        if (url.endsWith("/git/commits")) { state.commits.push(body); return reply({ sha: "c2" }); }
        if (url.endsWith("/git/refs/heads/main")) {
            if (fail.ref) return reply({ message: fail.ref }, 422);
            Object.assign(state.files, state.pending);
            state.head = body.sha;
            return fail.lost ? reply("", 500) : reply({});
        }
        return reply("", 500);
    }) as typeof globalThis.fetch;
    return { state, fetch };
}
type Hub = ReturnType<typeof github>;

const call = (gh: Hub, method: string, path: string, opts: { cookie?: string; origin?: string; body?: unknown; raw?: string; version?: string; host?: string; env?: EditEnv } = {}) =>
    edit(new Request(`https://${opts.host ?? host}${path}`, { method, headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.origin ? { origin: opts.origin } : {}) }, body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined) }),
        opts.env ?? env, { version: opts.version ?? "c1", names, near: () => [], fetch: gh.fetch }) as Promise<Response>;

async function signIn(gh: Hub): Promise<Response> {
    const start = await call(gh, "GET", "/edit/login");
    const state = /__Host-mc_state=([0-9a-f]+)/.exec(start.headers.get("set-cookie")!)![1];
    assert.ok(start.headers.get("location")!.includes(`state=${state}`));
    return call(gh, "GET", `/edit/callback?code=good&state=${state}`, { cookie: `__Host-mc_state=${state}` });
}
const sessionOf = (res: Response) => /__Host-mc_session=[^;]+/.exec(res.headers.get("set-cookie")!)![0];
const moved = { changes: [{ id: 1, file: alpha, state: { ...alpha, population: 2000 } }] };
const origin = `https://${host}`;
const pushAs = async (gh: Hub, opts: Parameters<typeof call>[3] = {}) => call(gh, "POST", "/edit/push", { cookie: sessionOf(await signIn(gh)), origin, body: moved, ...opts });

test("other paths, other hosts and a missing setting are left alone or refused", async () => {
    const gh = github();
    assert.equal(await call(gh, "GET", "/version"), null);
    assert.equal((await call(gh, "GET", "/edit/me", { host: "preview.test" })).status, 501);
    const partial = await call(gh, "GET", "/edit/me", { env: { ...env, GITHUB_TOKEN: undefined, DEPLOY_HOOK: " " } });
    assert.deepEqual([partial.status, await partial.text()], [501, "Editing is not set up: missing GITHUB_TOKEN, DEPLOY_HOOK"]);
});

test("sign-in gives a session to an editor's account and to no one else", async () => {
    const gh = github();
    const signedIn = await signIn(gh);
    assert.match(signedIn.headers.get("set-cookie")!, /__Host-mc_session=[^;]+; Path=\/; Max-Age=604800; HttpOnly; Secure; SameSite=Strict/);
    const cookie = sessionOf(signedIn);
    assert.deepEqual(await (await call(gh, "GET", "/edit/me", { cookie })).json(), { user: "alice" });
    assert.deepEqual(await (await call(gh, "GET", "/edit/me")).json(), { user: null });
    assert.deepEqual(await (await call(gh, "GET", "/edit/me", { cookie: cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0") })).json(), { user: null });
    assert.deepEqual(await (await call(gh, "GET", "/edit/me", { cookie: cookie.replace("=7.", "=8.") })).json(), { user: null });
    assert.deepEqual(await (await call(gh, "GET", "/edit/me", { cookie, env: { ...env, SESSION_KEY: "rotated" } })).json(), { user: null }, "a new key ends the session");
    assert.deepEqual(await (await call(gh, "GET", "/edit/me", { cookie, env: { ...env, EDITOR_IDS: "9" } })).json(), { user: null }, "so does leaving the list");
    // the same login under another account is not the editor
    assert.equal((await signIn(github({ login: "alice", id: 8 }))).status, 403);
    assert.equal((await call(gh, "GET", "/edit/callback?code=good&state=abc", { cookie: "__Host-mc_state=abd" })).status, 400);
});

test("push and build need a session and this origin", async () => {
    const gh = github();
    const cookie = sessionOf(await signIn(gh));
    for (const path of ["/edit/push", "/edit/build"]) {
        assert.equal((await call(gh, "POST", path, { origin, body: moved })).status, 401);
        assert.equal((await call(gh, "POST", path, { cookie, origin: "https://evil.test", body: moved })).status, 403);
        assert.equal((await call(gh, "POST", path, { cookie, body: moved })).status, 403);
    }
    assert.deepEqual([gh.state.commits.length, gh.state.builds], [0, 0]);
});

test("a push writes one commit on top of the commit the data was built from, then asks for the build", async () => {
    const gh = github();
    const res = await pushAs(gh);
    assert.deepEqual([res.status, await res.json()], [200, { commit: "c2", build: "requested" }]);
    assert.equal(JSON.parse(gh.state.files.AA!).p, 2000);
    assert.deepEqual([gh.state.commits[0].parents, gh.state.commits[0].author.name, gh.state.trees[0].base_tree, gh.state.builds], [["c1"], "alice", "t1", 1]);
    // the branch has moved past what this Worker was built from, so the next push waits for the deploy
    assert.equal((await pushAs(gh)).status, 503);
    assert.equal((await pushAs(gh, { version: "c2" })).status, 409);
    assert.equal(gh.state.commits.length, 1);
});

test("a build can be asked for again while the branch is ahead of the published data", async () => {
    const gh = github();
    const cookie = sessionOf(await signIn(gh));
    assert.match((await (await call(gh, "POST", "/edit/build", { cookie, origin })).json()).build, /^not needed/);
    gh.state.head = "c9";
    assert.deepEqual([await (await call(gh, "POST", "/edit/build", { cookie, origin })).json(), gh.state.builds], [{ build: "requested" }, 1]);
});

test("failures along the way write nothing, or still ask for the build once the branch has moved", async () => {
    const moving = github(undefined, { ref: "Update is not a fast forward" });
    assert.equal((await pushAs(moving)).status, 503);
    const protectedBranch = github(undefined, { ref: "Protected branch update failed" });
    const refused = await pushAs(protectedBranch);
    assert.deepEqual([refused.status, (await refused.json()).problems[0]], [502, "GitHub branch update: HTTP 422, Protected branch update failed"]);
    const unreadable = github(undefined, { read: 500 });
    assert.equal((await pushAs(unreadable)).status, 502);
    // a file that reads as missing although the country has published cities
    assert.equal((await pushAs(github(undefined, { read: 404 }))).status, 502);
    for (const gh of [moving, protectedBranch, unreadable]) assert.deepEqual([gh.state.head, gh.state.builds], ["c1", 0]);

    const lost = github(undefined, { lost: 1 });
    const landed = await pushAs(lost);
    assert.deepEqual([landed.status, await landed.json()], [200, { commit: "c2", build: "requested" }]);
    const noHook = await pushAs(github(undefined, { hook: 500 }));
    assert.deepEqual([noHook.status, await noHook.json()], [200, { commit: "c2", build: "refused, HTTP 500" }]);
});

test("a body that is too large or not JSON is refused before anything is read from the repo", async () => {
    const gh = github();
    assert.equal((await pushAs(gh, { raw: "x".repeat(2_000_001) })).status, 413);
    assert.equal((await pushAs(gh, { raw: "{" })).status, 400);
});
