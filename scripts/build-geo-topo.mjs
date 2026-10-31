import fs from "node:fs";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";

const sourceUrl = new URL("../scripts/data/countries.geojson", import.meta.url);
const geo = JSON.parse(fs.readFileSync(sourceUrl, "utf8"));
const features = geo.features
	.filter((feature) => feature.properties?.iso_a3_eh)
	.map((feature) => ({
		type: "Feature",
		properties: {
			name: feature.properties.name,
			iso_a2_eh: feature.properties.iso_a2_eh,
			iso_a3_eh: feature.properties.iso_a3_eh,
		},
		geometry: feature.geometry,
	}));

const collection = { type: "FeatureCollection", features };
const quantized = topology({ countries: collection }, 1e5);
const weight = Number(process.argv[2] ?? 0);
const simplified =
	weight > 0 ? simplify(presimplify(quantized), weight) : quantized;

const output = JSON.stringify(simplified);
const outputUrl = new URL("../src/assets/countries.topo.json", import.meta.url);
fs.mkdirSync(new URL("../src/assets/", import.meta.url), { recursive: true });
fs.writeFileSync(outputUrl, output);

console.log(
	JSON.stringify({
		features: features.length,
		weight,
		bytes: output.length,
		arcs: simplified.arcs.length,
	}),
);
