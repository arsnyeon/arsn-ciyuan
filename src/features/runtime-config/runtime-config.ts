import { useSyncExternalStore } from "react";
import {
	SORT_ORDERS,
	SORT_TYPES,
	type SortOrder,
	type SortType,
} from "@/context/sort-context";
import { safeSessionStorage } from "@/lib/storage";

export interface RuntimeConfig {
	arsnMusicPlaylistId: string;
	arsnBackgroundApi: string;
	arsnLogoUrl: string;
	arsnOverviewIconUrl: string;
	arsnMascotUrl: string;
	arsnApiKey: string;
	arsnFooterLinks: Array<{ name: string; link: string }>;
	forceTheme?: "dark" | "light";
	backgroundImage?: string;
	mobileBackgroundImage?: string;
	forceSortType?: SortType;
	forceSortOrder?: SortOrder;
	forceShowServices: boolean;
	forceShowMap: boolean;
	forceCardInline: boolean;
	forcePeakCutEnabled: boolean;
	customLogo?: string;
	customDesc?: string;
	customLinks?: string;
	customIllustration?: string;
	showNetTransfer: boolean;
	fixedTopServerName: boolean;
	forceUseSvgFlag: boolean;
	disableAnimatedMan: boolean;
}

export const RUNTIME_CONFIG_CHANGE_EVENT = "runtimeConfigChange";
const text = (value: unknown) =>
	typeof value === "string" && value ? value : undefined;
const defaults: RuntimeConfig = {
	arsnMusicPlaylistId: "443797814",
	arsnBackgroundApi: "https://acg.yaohud.cn/dm/adaptive.php",
	arsnLogoUrl: "/arsn-assets/logo.png",
	arsnOverviewIconUrl: "/arsn-assets/title-icon.webp",
	arsnMascotUrl: "/arsn-assets/taffy.webp",
	arsnApiKey: "",
	arsnFooterLinks: [
		{ name: "ApiNexus", link: "https://api.xunjinlu.fun/" },
		{ name: "FlowLoss 网测", link: "https://net.arsn.cn/" },
	],
	forceTheme: undefined,
	backgroundImage: undefined,
	mobileBackgroundImage: undefined,
	forceSortType: undefined,
	forceSortOrder: undefined,
	forceShowServices: false,
	forceShowMap: false,
	forceCardInline: false,
	forcePeakCutEnabled: false,
	customLogo: undefined,
	customDesc: undefined,
	customLinks: undefined,
	customIllustration: undefined,
	showNetTransfer: false,
	fixedTopServerName: false,
	forceUseSvgFlag: false,
	disableAnimatedMan: false,
};

let snapshot = defaults;

// Keep the public window.* custom_code API at this boundary.
export function readRuntimeConfig(): RuntimeConfig {
	if (typeof window === "undefined") return defaults;
	const arsn = window.ArsnThemeConfig ?? {};
	const footerLinks = Array.isArray(arsn.footerLinks)
		? arsn.footerLinks.filter(
				(link) =>
					typeof link?.name === "string" && typeof link?.link === "string",
			)
		: defaults.arsnFooterLinks;
	const next: RuntimeConfig = {
		...defaults,
		arsnMusicPlaylistId: text(arsn.playlistId) ?? defaults.arsnMusicPlaylistId,
		arsnBackgroundApi: text(arsn.backgroundApi) ?? defaults.arsnBackgroundApi,
		arsnLogoUrl: text(arsn.logoUrl) ?? defaults.arsnLogoUrl,
		arsnOverviewIconUrl:
			text(arsn.overviewIconUrl) ?? defaults.arsnOverviewIconUrl,
		arsnMascotUrl: text(arsn.mascotUrl) ?? defaults.arsnMascotUrl,
		arsnApiKey:
			typeof arsn.apiKey === "string"
				? arsn.apiKey
				: (text(arsn.weatherKey) ?? ""),
		arsnFooterLinks: footerLinks,
		forceTheme:
			window.ForceTheme === "dark" || window.ForceTheme === "light"
				? window.ForceTheme
				: undefined,
		backgroundImage: text(window.CustomBackgroundImage),
		mobileBackgroundImage: text(window.CustomMobileBackgroundImage),
		forceShowServices: Boolean(window.ForceShowServices),
		forceShowMap: Boolean(window.ForceShowMap),
		forceCardInline: Boolean(window.ForceCardInline),
		forcePeakCutEnabled: Boolean(window.ForcePeakCutEnabled),
		customLogo: text(window.CustomLogo),
		customDesc: text(window.CustomDesc),
		customLinks: text(window.CustomLinks),
		customIllustration: text(window.CustomIllustration),
		showNetTransfer: Boolean(window.ShowNetTransfer),
		fixedTopServerName: Boolean(window.FixedTopServerName),
		forceUseSvgFlag: Boolean(window.ForceUseSvgFlag),
		disableAnimatedMan: Boolean(window.DisableAnimatedMan),
		forceSortType: SORT_TYPES.includes(window.ForceSortType as SortType)
			? (window.ForceSortType as SortType)
			: undefined,
		forceSortOrder: SORT_ORDERS.includes(window.ForceSortOrder as SortOrder)
			? (window.ForceSortOrder as SortOrder)
			: undefined,
	};
	if (
		Object.keys(next).some(
			(key) =>
				next[key as keyof RuntimeConfig] !==
				snapshot[key as keyof RuntimeConfig],
		)
	)
		snapshot = next;
	return snapshot;
}

export function refreshRuntimeConfig() {
	if (typeof window !== "undefined")
		window.dispatchEvent(new Event(RUNTIME_CONFIG_CHANGE_EVENT));
}

const observedKeys = [
	"ForceTheme",
	"CustomBackgroundImage",
	"CustomMobileBackgroundImage",
	"ForceSortType",
	"ForceSortOrder",
	"ArsnThemeConfig",
	"ForceShowServices",
	"ForceShowMap",
	"ForceCardInline",
	"ForcePeakCutEnabled",
	"CustomLogo",
	"CustomDesc",
	"CustomLinks",
	"CustomIllustration",
	"ShowNetTransfer",
	"FixedTopServerName",
	"ForceUseSvgFlag",
	"DisableAnimatedMan",
] as const;
let subscribers = 0;
let stopObserving: (() => void) | undefined;

function observeAssignments() {
	const cleanups: Array<() => void> = [];
	let needsLegacyFallback = false;
	for (const key of observedKeys) {
		const descriptor = Object.getOwnPropertyDescriptor(window, key);
		// Do not replace custom accessors, readonly data, or nonconfigurable globals.
		if (
			descriptor &&
			(!descriptor.configurable ||
				!("value" in descriptor) ||
				!descriptor.writable)
		) {
			needsLegacyFallback = true;
			continue;
		}
		let value: unknown = window[key];
		let assigned = false;
		const get = () => value;
		const set = (next: unknown) => {
			assigned = true;
			if (Object.is(value, next)) return;
			value = next;
			refreshRuntimeConfig();
		};
		Object.defineProperty(window, key, {
			configurable: true,
			enumerable: descriptor?.enumerable ?? true,
			get,
			set,
		});
		cleanups.push(() => {
			const current = Object.getOwnPropertyDescriptor(window, key);
			// A custom script may replace our descriptor; never overwrite its changes.
			if (current?.get !== get || current?.set !== set) return;
			if (!descriptor && !assigned) Reflect.deleteProperty(window, key);
			else
				Object.defineProperty(window, key, {
					...descriptor,
					configurable: true,
					enumerable: descriptor?.enumerable ?? true,
					writable: true,
					value,
				});
		});
	}
	// Preserve the former five-second discovery window only for globals that
	// cannot safely be observed. Normal assignments need no polling at all.
	if (needsLegacyFallback) {
		let checks = 0;
		const interval = window.setInterval(() => {
			refreshRuntimeConfig();
			if (++checks >= 50) window.clearInterval(interval);
		}, 100);
		cleanups.push(() => window.clearInterval(interval));
	}
	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}

function subscribe(listener: () => void) {
	if (typeof window === "undefined") return () => {};
	window.addEventListener(RUNTIME_CONFIG_CHANGE_EVENT, listener);
	window.addEventListener("backgroundChange", listener);
	if (subscribers++ === 0) stopObserving = observeAssignments();
	return () => {
		window.removeEventListener(RUNTIME_CONFIG_CHANGE_EVENT, listener);
		window.removeEventListener("backgroundChange", listener);
		if (--subscribers === 0) {
			stopObserving?.();
			stopObserving = undefined;
		}
	};
}

export function useRuntimeConfig() {
	return useSyncExternalStore(subscribe, readRuntimeConfig, () => defaults);
}

export function restoreBackground() {
	if (!window.CustomBackgroundImage) {
		window.CustomBackgroundImage =
			safeSessionStorage.getItem("savedBackgroundImage") || "";
	}
	refreshRuntimeConfig();
}

export function updateBackground(newBackground: string | undefined) {
	window.CustomBackgroundImage = newBackground || "";
	window.dispatchEvent(new Event("backgroundChange"));
}
