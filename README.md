# MetroCity
Maps lat/lon to the major city whose orbit it falls in, weighing population, borders and terrain. Editor and API.

A metro city is the large city with the most influence over an area. This service answers "which metro city is this point in?" for batches of points, and will host the editor used to draw the city outlines. It replaces [metrocity_api](https://github.com/cafread/metrocity_api) and [metrocity2024](https://github.com/cafread/metrocity2024), which answered from painted map tiles.

## Status

Phase 0 of [docs/PLAN.md](docs/PLAN.md): the lookup core, the build and the API are here and tested against the tile-based service. Not yet deployed. The editor, sign-in and saving come in later phases.

## API

`POST /mc_api` with a JSON array of `{"id": string | number, "lat": number, "lon": number, "cc"?: string}`, at most 1,000 per call. Returns a JSON object of `id` to city name, or `""` where there is none. `cc` (ISO 3166-1 alpha-2) is optional and resolves border cases. An empty array runs a built-in test set.

`GET /status`, `/info`, `/version` and `/changelog` are also served.

## Layout

| Path | What |
|---|---|
| `data/cities/<CC>.ndjson` | The record: one city per line, per country. Outline coordinates are integers of 1e-7 degrees |
| `tools/build.ts` | Turns the data into `public/data/`: `lookup.bin`, `names.json`, `changelog.json` |
| `src/lookup.ts` | Reads `lookup.bin` in place and finds the city containing a point |
| `src/api.ts`, `src/borders.ts` | The endpoints and country-code rules, independent of any host |
| `src/worker.ts` | Cloudflare Workers entry |
| `src/local.ts` | Local server with the same endpoints |
| `tests/` | Checks against answers recorded from the tile-based service |

There are no dependencies. The code runs unchanged on Deno and on Node 22 or later.

## Running it

```
deno run -A tools/build.ts
deno test -A tests/
deno run --allow-net --allow-read --allow-env src/local.ts
deno run -A tools/bench.ts
```

With Node: `node tools/build.ts`, `node --test tests/api.test.ts`.

`src/local.ts` listens on port 3000. Set `PORT` to change it and `reqLim` to cap points per call (default 1,000,000 locally).

## Data sources

City ids, names, populations and centres come from [GeoNames](https://www.geonames.org/), provided under a Creative Commons Attribution licence. The outlines are original to this project. The code is under the MIT licence.
