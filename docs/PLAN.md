# Metro city: one service to replace metrocity_api and metrocity2024

Draft of 2026-10-12. Phase 0 is in progress on the `phase-0` branch.

## 1. Goal and constraints

Replace two repositories and one host with one repository and one service that:

1. serves the polygon editor,
2. lets one person (you, signed in with GitHub) save edits,
3. answers `POST /mc_api` and the other current endpoints,
4. keeps GitHub as the record of the data.

Constraints you set:

- Deno Deploy stops around 9 April 2027 (six months from the 9 October announcement; no exact date published). The Deno runtime gets about a year of fixes after that.
- Free tier, achieved through data structures and a short hot path, not by buying headroom.
- No Node or npm dependency tree on your machine or in the repo.
- The old API stays up, unchanged, until cut-over.
- Normal load is a few hundred points a day; bulk runs (5M+ points) happen locally.

## 2. What was measured today

| Question | Result |
|---|---|
| Do polygons give the same answer as the tiles? | 99.38% of painted pixels; 99.59% of 489,773 hotels (1,991 change) |
| Is my local copy of the tile logic the same as production? | Yes: 1,991 of 1,991 hotels identical through the hosted API |
| Where are the hotel hotspots? | 9 city pairs with 20+ hotels changing. Largest: Macau to Zhuhai 52, Koeln to Siegen 30, Mumbai to Pune 28 |
| What causes them? | Mostly simplification. Keeping all polygon pieces barely helps (1,871 change). Lighter simplification helps a lot (see section 5) |
| Cost of a polygon lookup | 0.29 microseconds a point: 1,000 points in 0.3 ms on this machine |
| Cost of parsing the 5.5 MB TopoJSON | 36 ms, over the 10 ms a free Worker request gets. So the service must not parse JSON data at run time |
| Best index | Quadtree to depth 10: 314 KB, same speed and identical answers to a dense grid (1,149 KB) on all 490k hotels |
| Cost of today's approach on Workers | About 3 ms of CPU per tile expanded, so it cannot be ported as is |

## 3. Host

Judged against the four needs in section 1, on a free plan.

| Host | Editor files | Login and save | API | Verdict |
|---|---|---|---|---|
| Cloudflare Workers Free | Free, unlimited static files up to 25 MB each | Possible in the Worker | 100,000 requests a day, 10 ms CPU each | **Recommended** |
| Fastly Compute | Yes | Possible | 10M requests a month listed; terms not checked | Fallback candidate |
| Vercel Hobby | Yes | Possible | Fine technically | Excluded: non-commercial use only, and the API has commercial callers |
| Netlify Free | Yes | Possible | Credit-capped; behaviour at the cap not documented | Not recommended |
| GitHub Pages plus Actions | Yes | No server | No `POST` endpoint | Cannot do needs 2 and 3 |
| Free containers (Render, Koyeb) | Yes | Yes | Yes, but sleep after idle, around a minute to wake | Only if Workers fails |

Cloudflare is recommended because static files cost nothing, the API fits the limits with room to spare (section 6), and it is where Deno's own users are being pointed. The design below keeps the host replaceable: the lookup core imports nothing from Cloudflare.

## 4. Architecture

The central decision: **the service holds no state of its own.** GitHub holds the data, a build turns it into the files the service needs, and a deploy publishes code and data together.

```
  edit in browser ──► POST /admin/save ──► commit to GitHub ──► build ──► deploy
                                                 ▲                          │
  git push (code or data) ───────────────────────┘                          ▼
                                                       static files + Worker code, same version
```

Consequences:

- **No KV, no database.** Every job Deno KV does today disappears: the tile cache (data ships with the deploy), the change log (built at deploy time), pending deletions and locks (nothing to invalidate).
- **Two-way sync is one path.** An edit in the UI and a push from your machine both arrive as a commit, and a commit triggers the same build. This also covers your "tell it to pull" idea: a deploy hook URL triggers a build on demand.
- **An edit is live a few minutes after saving**, the length of a build. It is safe in GitHub the moment the save returns. You said minutes are acceptable.
- **Today's webhook class of bug cannot recur.** There is no diff parsing and no cache to invalidate.

How the data is held, step by step:

1. **Record:** the city files in Git.
2. **Build:** a script turns them into binary files laid out to be used as they are.
3. **Ship:** the lookup data travels inside the Worker bundle (limit 64 MiB uncompressed), so an instance has it in memory when it starts, with no fetch and no sub-request, and code and data are always the same version.
4. **In memory:** typed arrays in module-level constants, never written. Cloudflare gives no guarantee that two requests reach the same instance; every instance holds an identical read-only copy, so it does not matter. Login is a signed cookie any instance can verify.
5. **Edits:** unsaved and committed work lives in the browser. On push, the editor stores the hash of the data version it pushed against. If the served version still has the old hash while a push is pending, the editor shows a "waiting" state. That state exists only in the editor and is rarely seen.

At a few hundred lookups a day, most requests will land on a freshly started instance, so start-up cost matters more than steady-state speed. That is the main reason to ship the data in the bundle.

You asked for a "KV manager". In this design its work is done by the build step and the save endpoint, and there is nothing left to manage at run time. If you want instant publishing later, a small key-value overlay for unpublished edits can be added without changing the rest.

## 5. Data

### In the repository (the record)

- `data/cities/<CC>.ndjson`: one city per line, per country. Fields: GeoNames id, name, population, centre, last-changed time, polygons.
- One line per city means a Git diff shows exactly which cities changed, and history gives audit and rollback.
- Coordinates as integers of 1e-7 degrees (about 1 cm), so text, binary and editor all hold identical values and shared borders stay exactly shared.
- One polygon per city, with no holes (the 153 holes the tracer finds are pixel noise: median 1 pixel). The tiles painted 232 cities in several pieces, but the 684 extra pieces are specks: median 2 pixels, 611 under 10 pixels, and only 11 hotels in 490,000 fall inside them. The 11 pieces over 100 pixels were reviewed on 2026-10-12: all are painting errors, sea, or land across a border, and stay dropped. Two outlines are to be redrawn by hand in Phase 1: Haifa, whose borders look wrong, and Dubrovnik, which should cover the part of Croatia it sits in, without the offshore islands.
- `res/cities5000.txt`, `res/admin1CodesASCII.txt`, `res/state_codes.json` as today.

### Built at deploy time (what the service serves)

| File | Size | Used by |
|---|---|---|
| `cities.bin`: city table, then one self-contained record per city | about 850 KB, 500 KB compressed (TopoJSON today: 5.4 MB, 1.35 MB compressed) | editor, read as a stream; API |
| `index.bin`: quadtree over the same geometry | about 300 KB | API only |
| `changelog.json` | about 350 KB | consumers, as a static file |
| `places.tsv`: the GeoNames columns the picker needs | about 2.5 MB, down from 10 MB | editor |
| `borders.bin`: country border lines | small | editor |

### Layout of `cities.bin`

1. **City table first:** id, name, population, centre, bounding box and the byte offset of each record. Once it arrives (about 140 KB compressed) search and statistics work and every city can be shown as a box.
2. **One record per city:** a length, then its outlines as delta-coded integers at 1e-7 degrees. The browser draws each city as its record completes, so the map fills in during the download.
3. **Ordered by population,** so the cities most often wanted appear first.

Per-city records were chosen over shared arcs because they can be drawn as they arrive, they match how the editor already treats a shared vertex (the same coordinate in two cities), and they are no larger (shared arcs: 894 KB). The byte offsets allow loading only the cities in view by range request if the data ever grows several-fold; at this size that is not worth building.

Measured editor load today, on a local server: about 200 ms of processing in total (parse 24 to 49 ms, decode and copy 10 ms, build layers 30 ms, paint 100 ms). The slow parts of a first load were third-party fetches: 4.0 s for the country borders, 0.9 s for Leaflet, 0.7 s for the TopoJSON libraries. In the new service those are served from the same host, pre-converted where possible, and loaded after the cities.

### Level of detail: decided for now

Today's values (largest polygon, simplification 0.0015) were chosen as good enough and stay as the baseline. Chasing agreement with the tiles is the wrong target: lighter simplification mostly reproduces pixel staircases. The share of border segments running exactly north-south or east-west is 24% at 0.0015, 57% at 0.0005 and 96% at 0.0001. Once the build script exists, one A/B against a smoothed trace (through pixel-edge midpoints, 13% staircase at 50 vertices per city) is cheap, judged by eye in the editor.

Border pairs that need better geometry to snap to, which simplification cannot fix: Hong Kong and Macau with China, the US with Canada and Mexico, India with Pakistan and Bangladesh.

The earlier comparison, kept for reference:

Hotel agreement with the tiles, by how much the traced outlines are simplified (all with every polygon piece kept):

| Simplification | Hotels changing | Agreement | Vertices | Lookup data |
|---|---|---|---|---|
| 0.0015 (today, largest piece only) | 1,991 | 99.593% | 139,000 | 1.5 MB |
| 0.0015 | 1,871 | 99.618% | 140,000 | 1.5 MB |
| 0.0005 | 1,019 | 99.792% | 324,000 | about 3 MB |
| 0.0001 | 143 | 99.971% | 735,000 | about 6.5 MB |

Every option differs by at most about 1,900 hotels in 490,000, and those sit within roughly a pixel (about 1.2 km) of a border, where either answer is defensible. Memory is not the limit at any of these levels.

### Change log

`GET /changelog` becomes a prebuilt file centred on cities:

```json
{
  "version": "<data commit>",
  "generated": 1791818000000,
  "cities":  { "1793346": { "n": "Tangshan, (HE), CN", "t": 1791817860000, "b": [117.2, 39.1, 119.0, 40.3] } },
  "removed": { "<id>":     { "n": "...",               "t": 1791817860000, "b": [0, 0, 0, 0] } }
}
```

- `t` is when the city last changed in any way: polygon, name, population, creation. A rename stamps it. This is the gap found in production today.
- `b` is the bounding box of the old and new outline together. A consumer re-resolves a stored point when its city's `t` is newer than its last resolution, or when the point lies in any box with a newer `t`. The second rule catches points that had no city and now do, which tile keys did before.
- The tile map is dropped.

This changes the response shape, so consumers of `/changelog` need to move with it. The incremental caller we designed in September keyed on tiles and would key on boxes instead.

### Borders for snapping

Measured on 2026-10-12:

| Source | Compressed | Average point spacing | Points around Macau | Points on Hong Kong / Shenzhen |
|---|---|---|---|---|
| Natural Earth 1:110m | 39 KB | 70 km | 0 | 0 |
| Natural Earth 1:50m (used today) | 237 KB | 10 km | 1 | 10 |
| Natural Earth 1:10m | 963 KB | 2.4 km | 92 | 71 |
| OpenStreetMap boundary | 22 KB for that one box | 44 m | query timed out | 1,501 |

Agreed on 2026-10-12: borders matter only when zoomed in and editing. They are pre-generated, served as a secondary set of static files, fetched on demand by the browser for the box in view, and rarely need regenerating.

Design: nothing about borders is downloaded for the first render, since the basemap already draws them. In edit mode at high zoom the editor fetches small border cells for the area in view, in the background, and snaps to those. Tier 1 is Natural Earth 1:10m cut into cells at build time (public domain, about 1 MB in total). Tier 2, if finer lines are wanted for the difficult pairs, is OpenStreetMap boundaries extracted once offline for those areas only. A public query service is not used at run time: it timed out in this very test. Licensing of polygons snapped to OpenStreetMap lines needs a look before Tier 2.

## 6. The lookup path

`POST /mc_api` keeps its request, response and status codes exactly.

Per request, on an instance that is already warm:

1. Parse the JSON body (0.4 ms per 1,000 points measured locally).
2. For each point: walk the quadtree (at most 10 steps), test the one to six candidate polygons, apply the country rules.
3. Write the JSON response.

On a cold instance, once: fetch `lookup.bin` and `cities.json` from the static files and wrap the bytes in typed arrays. No parsing of geometry and no decompression.

Measured cost is about 1 ms of CPU per 1,000 points on this machine against a 10 ms limit. Workers will be slower by an unknown factor, which Phase 0 measures. The 1,000-point limit per call stays.

Callers no longer need to group by tile for the service's sake, since cost is now per point. Keeping the habit does no harm.

Border rules (`validateBorder`, the open-borders table) move across unchanged, in code.

One behaviour to decide: a request element whose own `id` is 0 is rejected today by a truthiness check. Metro city id 0, meaning no city, is unaffected and stays.

## 7. Endpoints

| Endpoint | Change |
|---|---|
| `POST /mc_api` | Same contract |
| `GET /status`, `/info`, `/version` | Same; `/version` also reports the data commit |
| `GET /changelog` | New shape (section 5), served as a static file |
| `POST /github-webhook` | Removed; the host's Git integration replaces it |
| `GET /` | The editor |
| `GET /auth/login`, `/auth/callback`, `POST /auth/logout`, `GET /auth/me` | New: GitHub sign-in |
| `POST /admin/save` | New: signed-in user only; commits a change set to GitHub |

## 8. Editor, login and save

- **Editor:** today's `viewer.html`, reading `cities.bin` instead of TopoJSON. Leaflet is committed to the repo as a pinned file with an integrity hash. The TopoJSON library is no longer needed in the browser.
- **Login:** GitHub's web sign-in flow, written directly against the two GitHub endpoints with no library. The Worker checks the returned user id against the one allowed id and sets a signed, HTTP-only cookie.
- **Save:** the editor's existing Commit and Push become real. Push sends the committed changes to `/admin/save`, which rewrites the affected country files and makes one Git commit through GitHub's API. The editor then shows "publishing" until `/version` reports that commit.
- **Secrets held by the service:** GitHub client secret, cookie signing key, and a token that can write to this one repository.

## 9. Building and deploying without Node on your machine

- **Source:** TypeScript restricted to syntax that can simply be stripped (no enums or namespaces), with zero runtime dependencies.
- **Preferred deploy route:** Cloudflare's Git integration. A push triggers a build in Cloudflare's own image, which has Node. npm runs there, never on your computer. The build runs one dependency-free script that turns `data/` into the files in section 5.
- **Fallback route:** a GitHub Action that runs the same build script and uploads through Cloudflare's HTTP API in three calls, with no `wrangler` anywhere.
- **Your machine:** Deno, already installed, runs the build script, the tests and the local server. Nothing in the code depends on Deno-only features, so when Deno ends the same files run on another single-binary runtime.

## 10. Local and bulk mode

The lookup core is one module with no host imports. Three thin wrappers use it:

1. the Worker,
2. a local HTTP server with the same endpoints, for debugging and for the Docker image used in bulk runs, with the request limit set by an environment variable as today,
3. a command-line mode that reads and writes TSV with no HTTP in between, for stress tests.

## 11. Phases

| Phase | Work | Done when | Target |
|---|---|---|---|
| 0. Prove the host | Cloudflare account; deploy a Worker with static files from a repo with no `package.json`; time the real lookup on Workers at 1,000 points; GitHub sign-in; a commit made from a Worker | Measured CPU is under 5 ms for 1,000 points, and a deploy needs no local Node. If either fails, switch to the fallback route or host | End of October |
| 1. Data | New repo; convert to `data/cities/*.ndjson` at the agreed detail; build script; fix the remaining hotel hotspots | Hotel and pixel agreement re-measured and accepted; build output is reproducible | Mid November |
| 2. API | Lookup core, Worker, local server, command-line mode, tests | Answers match the tile-based API on the GeoNames places and the hotel file, apart from an agreed list of differences | End of November |
| 3. Editor | Real login, save and publish | An edit made in the browser is live in the API and in the change log within minutes, with a rename stamping its city | Mid December |
| 4. Run both | Old and new side by side; a daily comparison; consumers move to the new address and change log | Two weeks with no unexplained difference | January to February 2027 |
| 5. Cut over | Switch consumers; freeze tile edits; archive the two old repos with pointers | Old service receiving no traffic | By 1 March 2027, five weeks before the shutdown |

## 12. Decisions needed from you

Settled on 2026-10-12:

- **Stateless design:** agreed. Anyone wanting their own edits can download the data from the editor; multi-user is a future task.
- **Level of detail:** today's values as the baseline, with one A/B later.
- **Change log shape:** free to change. No consumer has implemented it yet; they will be built against the new API.

- **One polygon per city:** kept, on the evidence in section 5.

Still open:

1. ~~Caller id 0~~ settled: accept it. Ids are nearly always strings; integers are allowed for test runs and excluding 0 was not intended.
2. **Repository name** for the new service.

## 13. Not yet confirmed, to be tested in Phase 0

- Whether Cloudflare's Git integration builds a repository that has no `package.json`.
- How much slower Workers CPUs are than this machine for the lookup, and what a 1.5 to 3 MB read from static files costs on a cold start.
- Whether reads from static files count against the 50 sub-requests a request may make.
- Whether Cloudflare's local runtime can be obtained as a standalone binary for Windows. Not needed if the local server wrapper is enough.
- Which GitHub credential is best for the save endpoint: a token limited to one repository, or a GitHub App.
- Whether a custom domain is needed. Nothing in this design requires one, but `workers.dev` addresses are described by Cloudflare as not for production use.

## 14. Left behind

- The tile set, the tile painter, the agglomeration and quadtree generation code, `states.html` and its OpenCage key.
- Deno KV, the webhook, cron, locks and the pending-deletions queue.
- The TopoJSON pipeline scripts, once the data has been converted. `tests/audit_tiles.ts` stays until cut-over as the yardstick against the tiles.
