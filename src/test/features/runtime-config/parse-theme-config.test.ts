import { describe, expect, it } from "vitest";
import {
	parseThemeConfig,
	parseThemeConfigValue,
} from "@/features/runtime-config/parse-theme-config";

describe("parseThemeConfig", () => {
	it("reads static JavaScript object assignments with comments and trailing commas", () => {
		expect(
			parseThemeConfig(`
				window.ArsnThemeConfig = {
					playlistId: '13579', // playlist
					memeImages: ['/one.webp', "https://example.com/two.png",],
					footerLinks: [{name: 'Docs', link: 'https://example.com/docs'},],
				};
				window.notPartOfConfig = true;
			`),
		).toEqual({
			playlistId: "13579",
			memeImages: ["/one.webp", "https://example.com/two.png"],
			footerLinks: [{ name: "Docs", link: "https://example.com/docs" }],
		});
	});

	it("ignores assignment examples in comments and strings", () => {
		expect(
			parseThemeConfig(`
				// window.ArsnThemeConfig = { playlistId: 'wrong' }
				const example = "window.ArsnThemeConfig = { playlistId: 'also-wrong' }";
			window.ArsnThemeConfig = { playlistId: 'right' };
			`),
		).toEqual({ playlistId: "right" });
	});

	it("returns undefined when the setting does not contain an assignment", () => {
		expect(parseThemeConfig("body { color: red; }")).toBeUndefined();
	});

	it("rejects expressions rather than evaluating admin-provided code", () => {
		expect(() =>
			parseThemeConfig("window.ArsnThemeConfig = getConfig();"),
		).toThrow(/plain object/);
	});

	it("reads supported legacy static string assignments", () => {
		expect(
			parseThemeConfigValue(
				"ArsnMusicPlaylistId = '12345';",
				"ArsnMusicPlaylistId",
			),
		).toBe("12345");
	});
});
