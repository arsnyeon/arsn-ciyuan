/// <reference types="vite/client" />

interface Window {
	__ARSN_THEME__?: boolean;
	__arsnApplyCustomCode?: (code: string) => void;
	ArsnThemeConfig?: {
		playlistId?: string;
		backgroundApi?: string;
		logoUrl?: string;
		overviewIconUrl?: string;
		mascotUrl?: string;
		footerLinks?: Array<{ name: string; link: string }>;
		apiKey?: string;
		memeImages?: string[];
		/** Legacy alias; apiKey is the shared key for XunJinLu APIs. */
		weatherKey?: string;
		[key: string]: unknown;
	};
	CustomBackgroundImage: string;
	CustomMobileBackgroundImage: string;
	ForceShowServices: boolean;
	ForceCardInline: boolean;
	ForceShowMap: boolean;
	ForcePeakCutEnabled: boolean;
	CustomLogo?: string;
	CustomDesc?: string;
	CustomLinks?: string;
	CustomIllustration?: string;
	ShowNetTransfer?: boolean;
	FixedTopServerName?: boolean;
	ForceUseSvgFlag?: boolean;
	DisableAnimatedMan?: boolean;
	ForceTheme?: string;
	ForceSortType?: string;
	ForceSortOrder?: string;
}
