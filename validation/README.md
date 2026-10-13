# Validation

Checks to run when the outlines change. None of this is deployed: the service is built from `src/worker.ts` and the `public/` folder only, so nothing here adds to its size or to the build.

The service answers from outlines; these scripts are how the outlines were shown to be right. Run them from the repo root with Deno (they also run on Node 22 or later).

| Script | Checks | Needs |
|---|---|---|
| `outlines.ts` | No two outlines overlap; no outline newly crosses or touches itself; which centres fall outside their own outline; which outlines reach past 110 km, and with an older copy of the data, which grew | The data only |
| `places.ts` | No GeoNames place falls in a city of a country closed to its own | GeoNames `cities500.txt` (236,000 places; a 14 MB download) |
| `compare.ts` | What a change does to real positions: for each one whose city changes, what kind of change | A file of positions with country codes, and two builds |

```
deno run --allow-read validation/outlines.ts data/cities
deno run -A tools/build.ts
deno run --allow-read --allow-write validation/places.ts path/to/cities500.txt out.tsv
deno run --allow-read validation/compare.ts path/to/positions.tsv before/ public/data
```

`tests/` holds the checks that run in seconds with no outside data, including that every city's centre answers that city.

## Reading the results

`outlines.ts` must print "no problems". Its overlap test is exact: coordinates are integers and the arithmetic does not round.

`places.ts` will always list some places. The groups that are expected, and why:

- Disputed areas where the outlines are deliberately left alone: the West Bank inside Jerusalem's outline, Gaza and the Israeli land round it, Western Sahara, Crimea and the Ukraine/Russia border, Armenia/Azerbaijan.
- The Golan, treated as Israeli land for travel; GeoNames codes its villages SY.
- Enclaves an outline cannot exclude, since outlines have no holes: Ceuta and Melilla, Madha, the British bases in Cyprus, Point Roberts. A request that sends a country code gets no city there, which is the intended answer.

A group outside those is a fault in an outline.

`compare.ts` reports by kind. "Lost a city of its own country" and "moved from its own country's city to a foreign one" are the ones to look at, with one caution: the country code is only as good as the file. A hotel file used for this work had hundreds of wrong codes, all with correct coordinates, so check a position against the border before treating it as a fault.

## Rules the outlines follow

- One polygon per city, no holes, 3 to 500 points, coordinates at 1e-7 degrees.
- A city holds no land in a country its own is not open to (`openBorders` in `src/borders.ts`), on land or across water. Hong Kong and Taiwan count as their own countries; Macau counts as China.
- Land goes to the city with the highest influence, `population^0.25 x (100 - distance in km)`, among cities that may hold it, within 100 km. Up to 110 km is left alone. Land beyond that is in no city.
- Borders follow the U.S. Department of State line (`data/borders.json`), closely where people or hotels are near it and loosely where they are not.
