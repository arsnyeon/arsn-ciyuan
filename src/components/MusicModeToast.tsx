import { useEffect } from "react";
import { toast } from "sonner";

const MODE_LABELS: Record<string, string> = {
	shuffle: "随机播放",
	single: "单曲循环",
	order: "顺序播放",
};

export default function MusicModeToast() {
	useEffect(() => {
		const handleModeChange = (event: Event) => {
			const mode = (event as CustomEvent<string>).detail;
			const label = MODE_LABELS[mode];
			if (!label) return;
			toast.info(`已切换为${label}`, { duration: 2200 });
		};

		window.addEventListener("arsnMusicModeChanged", handleModeChange);
		return () =>
			window.removeEventListener("arsnMusicModeChanged", handleModeChange);
	}, []);

	return null;
}
