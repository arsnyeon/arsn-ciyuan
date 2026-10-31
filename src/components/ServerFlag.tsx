import { hasFlag } from "country-flag-icons";
import getUnicodeFlagIcon from "country-flag-icons/unicode";
import { useEffect, useState } from "react";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { cn } from "@/lib/utils";

const normalizeCountryCode = (countryCode: string) =>
	countryCode.trim().replace(/_/g, "-").toUpperCase();

// Canvas emoji detection is repeated for every flag on the page; cache it once.
let emojiFlagSupport: boolean | undefined;
function detectEmojiFlagSupport() {
	if (emojiFlagSupport !== undefined) return emojiFlagSupport;
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		emojiFlagSupport = false;
		return false;
	}
	const emojiFlag = "🇺🇸";
	ctx.fillStyle = "#000";
	ctx.textBaseline = "top";
	ctx.font = "32px Arial";
	ctx.fillText(emojiFlag, 0, 0);
	emojiFlagSupport = ctx.getImageData(16, 16, 1, 1).data[3] !== 0;
	return emojiFlagSupport;
}

// The flag-icons stylesheet bundles every country (~400 KB) and used to be
// imported by main.tsx, so it blocked first paint even when emoji flags work.
// Load it only when the SVG fallback is actually needed.
let flagCssPromise: Promise<unknown> | undefined;
function ensureFlagCss() {
	if (!flagCssPromise) {
		flagCssPromise = import("flag-icons/css/flag-icons.min.css").catch(
			() => undefined,
		);
	}
	return flagCssPromise;
}

export default function ServerFlag({
	country_code,
	className,
}: {
	country_code: string;
	className?: string;
}) {
	const { forceUseSvgFlag } = useRuntimeConfig();
	const [supportsEmojiFlags, setSupportsEmojiFlags] = useState(
		() => !forceUseSvgFlag && detectEmojiFlagSupport(),
	);

	useEffect(() => {
		if (forceUseSvgFlag) {
			setSupportsEmojiFlags(false);
			return;
		}
		setSupportsEmojiFlags(detectEmojiFlagSupport());
	}, [forceUseSvgFlag]);

	const normalizedCountryCode = normalizeCountryCode(country_code || "");
	const canRenderSvgFlag = hasFlag(normalizedCountryCode);
	const canRenderEmojiFlag = /^[A-Z]{2}$/.test(normalizedCountryCode);
	const useSvg = forceUseSvgFlag || !supportsEmojiFlags || !canRenderEmojiFlag;

	useEffect(() => {
		if (useSvg) void ensureFlagCss();
	}, [useSvg]);

	if (!canRenderSvgFlag) return null;

	return (
		<span className={cn("text-[12px] text-muted-foreground", className)}>
			{useSvg ? (
				<span className={`fi fi-${normalizedCountryCode.toLowerCase()}`} />
			) : (
				getUnicodeFlagIcon(normalizedCountryCode)
			)}
		</span>
	);
}
