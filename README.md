# MetroCity

Answers "which metro city is this position in?" for batches of positions, and serves the map editor used to draw the city outlines.

A metro city is the large city with the most influence over a place: a business traveller could stay in a hotel there and reasonably travel to a meeting in the centre of that city, with no strong border, river or mountain range in the way. About 3,700 cities are mapped. A position in none of them gets an empty answer, which is the expected result for remote places.

- API and editor: https://metrocity.colin-read.workers.dev
- Replaces [metrocity_api](https://github.com/cafread/metrocity_api) and [metrocity2024](https://github.com/cafread/metrocity2024), which answered from painted map tiles. The request and the reply are unchanged.

## How to use the API

`POST` to `/mc_api` with a JSON array of positions:

```
curl -X POST https://metrocity.colin-read.workers.dev/mc_api \
  -H "content-type: application/json" \
  -d '[{"id":"hotel-1","lat":51.5072,"lon":-0.1276},
       {"id":2,"lat":22.391,"lon":114.137,"cc":"HK"},
       {"id":3,"lat":22.391,"lon":114.137,"cc":"CN"},
       {"id":"sea","lat":40,"lon":-40}]'
```

```
{"2":"Hong Kong, HK","3":"Shenzhen, (GD), CN","hotel-1":"London, GB","sea":""}
```

### Request

| Field | Type | Notes |
|---|---|---|
| `id` | string or number | Must be unique within the request. It comes back as the key of the answer |
| `lat` | number | -90 to 90. Positions beyond 85.05 degrees are accepted and answer `""`, since the map projection ends there |
| `lon` | number | Any value; it is wrapped into -180 to 180 |
| `cc` | string, optional | ISO 3166-1 alpha-2 country code of the position, if known |

- At most 1,000 positions per request on the hosted service.
- An empty array runs a built-in set of 18 test positions.
- No other fields are accepted.

### Reply

A JSON object keyed on `id`. The value is the metro city name, or `""` where there is none. Names read `City, CC`, or `City, (ST), CC` where the country has states, for example `Springfield, (IL), US`.

### What the country code does

Send `cc` whenever you have it. Outlines stop at closed borders, but a position's coordinates and its real country can disagree: an enclave, a hotel geocoded a few hundred metres off, a territory such as Hong Kong. With `cc`, a city in a country the position cannot belong to is not returned. In the example above the same coordinates answer Hong Kong for `HK` and Shenzhen for `CN`.

Countries with open borders between them, such as the Schengen area, count as one for this purpose, so a position coded `FR` can answer `Geneve, CH`.

### Errors

| Status | Body | Cause |
|---|---|---|
| 400 | `Request is not array` | The body is not a JSON array |
| 400 | `Invalid request data` | The body is not JSON, or an element is not an object |
| 400 | `Invalid request keys` | A missing or mistyped `id`, `lat`, `lon` or `cc`, or an extra field |
| 400 | `Element ids not unique` | Two elements share an `id` |
| 413 | `Limit of 1000 locs` | Too many positions, or too large a body |
| 422 | `Out of bounds latitude` | A latitude beyond 90 |
| 422 | `Null island found` | A position at exactly 0, 0, which is nearly always missing data |

### Other routes

| Route | Returns |
|---|---|
| `GET /status` | Uptime, as text |
| `GET /version` | The data version: the Git commit the data was built from |
| `GET /changelog` | Per city id: name, time of last change, and bounding box; and under `removed`, each city taken out, when, and the city that took its land. Use it to decide which stored answers to refresh |
| `GET /info` | A link to this page |

## How to use the editor

Open https://metrocity.colin-read.workers.dev. Anyone can look, search for a city, and try edits; nothing leaves the browser unless a signed-in editor pushes it.

1. Tick **Edit mode** and click a city. Zoom in to level 8 or more to see its vertices and the country borders.
2. Drag a vertex, or pick the add or delete tool. A vertex shared with a neighbour moves in both cities. Snapping pulls a vertex onto a neighbour's outline or a border.
3. To add a city, choose **New city**, search the GeoNames list, and draw the outline.
4. Edits are kept in the browser as you work. **Undo** and **Revert** take them back.
5. **Commit** accepts a city's current state. **Push** publishes the commits: it needs sign-in.
6. **Export changes** downloads the edited cities as JSON, with or without sign-in.

The terms follow Git. A push is one Git commit on `main`, the service rebuilds from it in about a minute, and the page reloads itself when the new data is live.

### What a push checks

A push is refused whole, with nothing written, when any outline in it:

- overlaps another city or crosses itself;
- has a point more than 250 km from the city's centre;
- belongs to a city that has changed in the published data since the edit was made;
- has a name another city uses, or a name not in the form `City, CC`.

Only one push is in flight at a time: the next waits until the previous one is live.

## Running it locally

There are no dependencies. The code runs on [Deno](https://deno.com) and on Node 22 or later.

```
deno run -A tools/build.ts
deno test -A tests/
deno run --allow-net --allow-read --allow-env src/local.ts
```

The server listens on http://localhost:3000 with the same routes. `PORT` changes the port and `reqLim` caps positions per request (1,000,000 locally, so bulk runs are best done here).

With Node: `node tools/build.ts`, `node --test tests/*.test.ts`.

To let the local editor write to this working tree, start it with `EDIT=1` and add `--allow-write --allow-run`. A push then rewrites `data/cities/` and rebuilds; committing the result to Git is left to you.

## Changing the data by hand

The record is `data/cities/<CC>.ndjson`: one city per line, filed under its country.

```
{"i":2643743,"n":"London, GB","p":8961989,"la":51.50853,"lo":-0.12574,"t":1746086400000,"g":[-3510888,521597967, ...]}
```

`i` is the GeoNames id, `n` the name, `p` the population, `la` and `lo` the centre, `t` the time of the last change in milliseconds, and `g` the outline as `x, y, x, y, ...` in integers of 1e-7 degrees, not closed.

After a change, run the build, the tests, and the checks in [validation/](validation/README.md). The build refuses invalid records and overlapping outlines.

## Layout

| Path | What |
|---|---|
| `data/cities/` | The city records |
| `data/borders.json` | Country borders for the editor, from the U.S. Department of State LSIB lines (a U.S. Government work), thinned to about 100 m |
| `tools/build.ts` | Turns the data into `public/data/`: the lookup, names, changelog, outlines for the editor, and version |
| `public/index.html` | The editor |
| `public/res/` | GeoNames places over 5,000 people and state codes, for adding a city |
| `src/api.ts`, `src/borders.ts`, `src/lookup.ts` | The API, the country-code rules, and the point lookup |
| `src/edit.ts`, `src/push.ts`, `src/github.ts` | Sign-in, applying a push to the data, and writing it to GitHub |
| `src/cities.ts`, `src/geom.ts` | The rules a city record must meet, and exact geometry |
| `src/worker.ts`, `src/local.ts` | Cloudflare Workers entry, and the local server |
| `tests/` | Checks that run in seconds with no outside data |
| `validation/` | Checks to run when outlines change. Not deployed |

## Hosting your own

The service deploys to Cloudflare Workers from `main` (`wrangler.jsonc`). The API needs no settings. The editor's sign-in and push answer only when all of these are set, and only on the host named in `EDIT_HOST`:

| Setting | Kind | What |
|---|---|---|
| `EDIT_HOST`, `EDIT_REPO`, `EDIT_BRANCH` | variable | The host, the GitHub repo and the branch |
| `EDITOR_IDS` | variable | GitHub account ids allowed to push |
| `GITHUB_TOKEN` | secret | Fine-grained token with contents read and write on the repo |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | secret | A GitHub OAuth app, with callback `https://<host>/edit/callback` |
| `SESSION_KEY` | secret | Random value that signs the session; changing it signs everyone out |
| `DEPLOY_HOOK` | secret | A Workers Builds deploy hook for the branch |

## Data sources

City ids, names, populations and centres come from [GeoNames](https://www.geonames.org/), provided under a Creative Commons Attribution licence. The outlines are original to this project. The code is under the MIT licence.
