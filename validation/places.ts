// Tests every GeoNames place against the built lookup: a place should not fall in a city of another
// country unless the two are open to each other. GeoNames country codes are reliable, so what this lists
// is either a fault in an outline or one of the known groups (disputed areas, enclaves, territories).
//   deno run --allow-read --allow-write validation/places.ts <cities500.txt> [out.tsv]
// The file is https://download.geonames.org/export/dump/cities500.zip, unzipped. Run tools/build.ts first.

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { openBorders } from "../src/borders.ts";
import { createLookup } from "../src/lookup.ts";

const [file, out] = process.argv.slice(2);
const data = new URL("../public/data/", import.meta.url);
const bin = await readFile(new URL("lookup.bin", data));
const lookup = createLookup(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);
const names: Record<string, string> = JSON.parse(await readFile(new URL("names.json", data), "utf8"));

// Macau is named as part of China and coded MO by GeoNames
const countryOf = (city: string) => (city.startsWith("Macau,") ? "MO" : city.slice(-2));
const open = (a: string, b: string) => a === b || openBorders[a]?.includes(b) || openBorders[b]?.includes(a);

const rows = ["geonameid\tname\tlat\tlon\tcountry\tpopulation\tcity"];
const groups = new Map<string, { places: number; people: number }>();
let total = 0, inCity = 0;
for (const line of (await readFile(file, "utf8")).split("\n")) {
    const r = line.split("\t");
    if (r.length < 15) continue;
    total++;
    const city = names[lookup.cityAt(Number(r[5]), Number(r[4]))];
    if (!city) continue;
    inCity++;
    if (!r[8] || open(r[8], countryOf(city)) || (r[8] === "CN" && countryOf(city) === "MO")) continue;
    rows.push([r[0], r[2], r[4], r[5], r[8], r[14], city].join("\t"));
    const key = `${r[8]} in ${city}`;
    const g = groups.get(key) ?? { places: 0, people: 0 };
    g.places++;
    g.people += Number(r[14]);
    groups.set(key, g);
}
console.log(`${total} places, ${inCity} inside a city, ${rows.length - 1} in a city of a country not open to their own`);
for (const [key, g] of [...groups].sort((a, b) => b[1].places - a[1].places)) console.log(`  ${g.places} places, ${g.people} people: ${key}`);
if (out) await writeFile(out, rows.join("\n") + "\n");
