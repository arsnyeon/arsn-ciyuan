import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";

import countriesTopo from "@/assets/countries.topo.json";
import { countryCoordinates } from "@/lib/geo-limit";

describe("static geographic data", () => {
	it("provides known country coordinate metadata", () => {
		expect(countryCoordinates.CN).toMatchObject({
			lat: 35,
			lng: 105,
			name: "China",
		});
		expect(countryCoordinates.US.name).toBe("United States");
	});

	it("ships parseable TopoJSON country data", () => {
		const topology = countriesTopo as unknown as Topology;
		const geoJson = feature(
			topology,
			topology.objects.countries,
		) as unknown as {
			type: string;
			features: unknown[];
		};

		expect(topology.type).toBe("Topology");
		expect(geoJson.type).toBe("FeatureCollection");
		expect(geoJson.features.length).toBeGreaterThan(0);
	});
});
