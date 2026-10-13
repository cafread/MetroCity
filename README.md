# MetroCity
Maps lat/lon to the major city whose orbit it falls in, weighing population, borders and terrain. Editor and API.

A metro city is the large city with the most influence over an area. This service answers "which metro city is this point in?" for batches of points, and will host the editor used to draw the city outlines. It replaces [metrocity_api](https://github.com/cafread/metrocity_api) and [metrocity2024](https://github.com/cafread/metrocity2024), which answered from painted map tiles.

## Status

The API and the editor page are deployed at https://metrocity.colin-read.workers.dev from this repo ([docs/PLAN.md](docs/PLAN.md)). The editor is the page from metrocity2024 served as it was: it reads the outlines built from this data, and edits can be exported but not yet saved. Sign-in and saving come next.

## API

`POST /mc_api` with a JSON array of `{"id": string | number, "lat": number, "lon": number, "cc"?: string}`, at most 1,000 per call. Returns a JSON object of `id` to city name, or `""` where there is none. `cc` (ISO 3166-1 alpha-2) is optional and resolves border cases. An empty array runs a built-in test set.

`GET /status`, `/info`, `/version` and `/changelog` are also served.

## Layout

| Path | What |
|---|---|
| `data/cities/<CC>.ndjson` | The record: one city per line, per country. Outline coordinates are integers of 1e-7 degrees |
| `tools/build.ts` | Turns the data into `public/data/`: `lookup.bin`, `names.json`, `changelog.json`, `cities.json` (TopoJSON), `version.json` |
| `public/index.html` | The editor |
| `data/borders.json` | Country borders for the editor, from the U.S. Department of State LSIB lines (a U.S. Government work), thinned to about 100 m by `tools/import_borders.ts`. The build cuts it into one file per degree cell |
| `public/res/` | GeoNames places over 5,000 people (eight columns of `cities5000.txt`) and state codes, for adding a city |
| `src/lookup.ts` | Reads `lookup.bin` in place and finds the city containing a point |
| `src/api.ts`, `src/borders.ts` | The endpoints and country-code rules, independent of any host |
| `src/worker.ts` | Cloudflare Workers entry |
| `src/local.ts` | Local server with the same endpoints |
| `tests/` | Checks against answers recorded from the tile-based service |
| `validation/` | Checks to run when the outlines change: overlaps, GeoNames places, before-and-after comparison. Not deployed |

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
