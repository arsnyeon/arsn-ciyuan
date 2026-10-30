import { useCallback, useEffect, useRef, useState } from "react";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { safeLocalStorage, safeSessionStorage } from "@/lib/storage";
import type { NezhaWebsocketResponse } from "@/types/nezha-api";

const isViewMode = (value: string | null): value is "0" | "1" | "2" =>
	value === "0" || value === "1" || value === "2";

export function useServerPreferences(
	hasServices: boolean,
	data: NezhaWebsocketResponse | null | undefined,
	canRestoreScroll = true,
) {
	const { forceShowServices, forceShowMap, forceCardInline } =
		useRuntimeConfig();
	const [desiredShowServices, setShowServices] = useState<string>("0");
	const [showMap, setShowMap] = useState<string>("0");
	const [viewMode, setViewMode] = useState<"0" | "1" | "2">(() => {
		const savedViewMode = safeLocalStorage.getItem("arsn-view-mode");
		if (isViewMode(savedViewMode)) return savedViewMode;
		if (typeof window !== "undefined" && window.innerWidth < 768) return "0";
		return safeLocalStorage.getItem("inline") === "1" ? "1" : "0";
	});
	const unsavedViewMode = useRef<"0" | "1" | "2" | null>(null);
	const hasRestoredScroll = useRef(false);
	const [currentGroup, setCurrentGroup] = useState<string>("All");
	const restoreScrollPosition = useCallback(() => {
		const isFromMainPage =
			safeSessionStorage.getItem("fromMainPage") === "true";
		const savedPosition = safeSessionStorage.getItem("scrollPosition");
		const scrollTop = savedPosition ? Number(savedPosition) : Number.NaN;

		if (
			hasRestoredScroll.current ||
			!isFromMainPage ||
			!Number.isFinite(scrollTop)
		) {
			return;
		}

		hasRestoredScroll.current = true;
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				window.scrollTo({ top: scrollTop, left: 0, behavior: "auto" });
			});
		});
	}, []);

	const handleTagChange = (newGroup: string) => {
		setCurrentGroup(newGroup);
		safeSessionStorage.setItem("selectedGroup", newGroup);
		safeSessionStorage.setItem("scrollPosition", String(window.scrollY || 0));
	};

	useEffect(() => {
		const showServicesState = safeLocalStorage.getItem("showServices");
		if (forceShowServices) {
			setShowServices("1");
		} else if (showServicesState !== null) {
			setShowServices(showServicesState);
		}
	}, [forceShowServices]);

	const showServices = hasServices ? desiredShowServices : "0";
	const inline = viewMode === "1" ? "1" : "0";

	useEffect(() => {
		const checkViewSettings = () => {
			if (window.innerWidth < 768) return;
			const savedViewMode = safeLocalStorage.getItem("arsn-view-mode");
			const inlineState = safeLocalStorage.getItem("inline");
			if (forceCardInline) {
				setViewMode("1");
			} else if (unsavedViewMode.current !== null) {
				setViewMode(unsavedViewMode.current);
			} else if (isViewMode(savedViewMode)) {
				setViewMode(savedViewMode);
			} else if (inlineState !== null) {
				setViewMode(inlineState === "1" ? "1" : "0");
			}
		};

		checkViewSettings();
		window.addEventListener("resize", checkViewSettings);
		return () => window.removeEventListener("resize", checkViewSettings);
	}, [forceCardInline]);

	useEffect(() => {
		const showMapState = safeLocalStorage.getItem("showMap");
		if (forceShowMap) {
			setShowMap("1");
		} else if (showMapState !== null) {
			setShowMap(showMapState);
		}
	}, [forceShowMap]);

	useEffect(() => {
		const savedGroup = safeSessionStorage.getItem("selectedGroup") || "All";
		setCurrentGroup(savedGroup);
	}, []);

	useEffect(() => {
		if (data && canRestoreScroll) restoreScrollPosition();
	}, [data, canRestoreScroll, restoreScrollPosition]);

	const toggleMap = () => {
		const value = showMap === "0" ? "1" : "0";
		setShowMap(value);
		safeLocalStorage.setItem("showMap", value);
	};
	const toggleServices = () => {
		const value = desiredShowServices === "0" ? "1" : "0";
		setShowServices(value);
		safeLocalStorage.setItem("showServices", value);
	};
	const toggleInline = () => {
		const value = String((Number(viewMode) + 1) % 3) as "0" | "1" | "2";
		setViewMode(value);
		const inlineValue = value === "1" ? "1" : "0";
		const savedMode = safeLocalStorage.setItem("arsn-view-mode", value);
		const savedInline = safeLocalStorage.setItem("inline", inlineValue);
		unsavedViewMode.current = savedMode && savedInline ? null : value;
	};

	return {
		showServices,
		showMap,
		inline,
		viewMode,
		currentGroup,
		handleTagChange,
		toggleMap,
		toggleServices,
		toggleInline,
	};
}
