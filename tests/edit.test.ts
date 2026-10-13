// deno test -A tests/   or   node --test tests/edit.test.ts
// GitHub is replaced by a small stand-in that keeps one branch of country files.

import assert from "node:assert/strict";
import test from "node:test";
import { edit, type EditEnv } from "../src/edit.ts";

const host = "editor.test";
const env: EditEnv = { EDIT_HOST: host, EDIT_REPO: "o/r", EDIT_BRANCH: "main", EDITORS: "alice", GITHUB_TOKEN: "t", GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" };
const square = (x: number): number[][][] => [[[x, 10], [x + 1, 10], [x + 1, 11], [x, 11], [x, 10]]];
const alpha = { name: "Alpha, AA", population: 1000, lat: 10.5, lon: 0.5, coordinates: square(0) };
const line = JSON.stringify({ i: 1, n: alpha.name, p: 1000, la: 10.5, lo: 0.5, t: 5, g: square(0)[0].slice(0, -1).flatMap(([lon, lat]) => [lon * 1e7, lat * 1e7]) });

function github(login = "alice") {
    const state = { head: "c1", files: { AA: line + "\n" } as Record<string, string | null>, commits: [] as Record<string, any>[], pending: {} as Record<string, string | null> };
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : null;
        const reply = (data: unknown, status = 200) => new Response(typeof data === "string" ? data : JSON.stringify(data), { status });
        if (url.endsWith("/login/oauth/access_token")) return reply({ access_token: body.code === "good" ? "user-token" : undefined });
        if (url === "https://api.github.com/user") return reply({ login });
        assert.equal((init?.headers as Record<string, string>).authorization, "Bearer t");
        if (url.endsWith("/git/ref/heads/main")) return reply({ object: { sha: state.head } });
        if (url.includes("/contents/data/cities/")) { const text = state.files[url.slice(url.lastIndexOf("/") + 1, url.indexOf(".ndjson"))]; return text ? reply(text) : reply("", 404); }
        if (url.includes("/git/commits/")) return reply({ tree: { sha: "t1" } });
        if (url.endsWith("/git/trees")) { state.pending = Object.fromEntries(body.tree.map((e: Record<string, any>) => [e.path.slice(12, 14), e.sha === null ? null : e.content])); return reply({ sha: "t2" }); }
        if (url.endsWith("/git/commits")) { state.commits.push(body); return reply({ sha: "c2" }); }
        if (url.endsWith("/git/refs/heads/main")) { Object.assign(state.files, state.pending); state.head = body.sha; return reply({}); }
        return reply("", 500);
    }) as typeof globalThis.fetch;
    return { state, fetch };
}

const call = (gh: ReturnType<typeof github>, method: string, path: string, opts: { cookie?: string; origin?: string; body?: unknown; version?: string; host?: string } = {}) =>
    edit(new Request(`https://${opts.host ?? host}${path}`, { method, headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.origin ? { origin: opts.origin } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }),
        env, { version: opts.version ?? "c1", names: { 1: alpha.name }, fetch: gh.fetch }) as Promise<Response>;

async function signIn(gh: ReturnType<typeof github>): Promise<Response> {
    const start = await call(gh, "GET", "/edit/login");
    const state = /mc_state=([0-9a-f]+)/.exec(start.headers.get("set-cookie")!)![1];
    assert.ok(start.headers.get("location")!.includes(`state=${state}`));
    return call(gh, "GET", `/edit/callback?code=good&state=${state}`, { cookie: `mc_state=${state}` });
}
const sessionOf = (res: Response) => /mc_session=[^;]+/.exec(res.headers.get("set-cookie")!)![0];
const moved = { changes: [{ id: 1, file: alpha, state: { ...alpha, population: 2000 } }] };

test("other paths, other hosts and a missing setting are left alone or refused", async () => {
    const gh = github();
    assert.equal(await call(gh, "GET", "/version"), null);
    assert.equal((await call(gh, "GET", "/edit/me", { host: "preview.test" })).status, 501);
    assert.equal((await edit(new Request(`https://${host}/edit/me`), { ...env, GITHUB_TOKEN: undefined }, { version: "c1", names: {} }))!.status, 501);
});

test("sign-in gives a session to an editor and to no one else", async () => {
    const gh = github();
    const cookie = sessionOf(await signIn(gh));
    assert.deepEqual(await (await call(gh, "GET", "/edit/me", { cookie })).json(), { user: "alice" });
    assert.deepEqual(await (await call(gh, "GET", "/edit/me")).json(), { user: null });
    assert.deepEqual(await (await call(gh, "GET", "/edit/me", { cookie: cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0") })).json(), { user: null });
    assert.deepEqual(await (await call(gh, "GET", "/edit/me", { cookie: cookie.replace("alice", "mallory") })).json(), { user: null });
    assert.equal((await signIn(github("mallory"))).status, 403);
    assert.equal((await call(gh, "GET", "/edit/callback?code=good&state=abc", { cookie: "mc_state=abd" })).status, 400);
});

test("push needs a session and this origin", async () => {
    const gh = github();
    const cookie = sessionOf(await signIn(gh));
    assert.equal((await call(gh, "POST", "/edit/push", { origin: `https://${host}`, body: moved })).status, 401);
    assert.equal((await call(gh, "POST", "/edit/push", { cookie, origin: "https://evil.test", body: moved })).status, 403);
    assert.equal((await call(gh, "POST", "/edit/push", { cookie, body: moved })).status, 403);
    assert.equal(gh.state.commits.length, 0);
});

test("a push writes one commit on top of the commit the data was built from", async () => {
    const gh = github();
    const cookie = sessionOf(await signIn(gh));
    const res = await call(gh, "POST", "/edit/push", { cookie, origin: `https://${host}`, body: moved });
    assert.deepEqual([res.status, await res.json()], [200, { commit: "c2" }]);
    assert.equal(JSON.parse(gh.state.files.AA!).p, 2000);
    assert.deepEqual([gh.state.commits[0].parents, gh.state.commits[0].author.name], [["c1"], "alice"]);
    // the branch has moved past what this Worker was built from, so the next push waits for the deploy
    assert.equal((await call(gh, "POST", "/edit/push", { cookie, origin: `https://${host}`, body: moved })).status, 503);
    assert.equal((await call(gh, "POST", "/edit/push", { cookie, origin: `https://${host}`, body: moved, version: "c2" })).status, 409);
    assert.equal(gh.state.commits.length, 1);
});
