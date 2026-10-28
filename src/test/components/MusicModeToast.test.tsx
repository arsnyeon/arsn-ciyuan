import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MusicModeToast from "@/components/MusicModeToast";

const toastMock = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMock }));

describe("MusicModeToast", () => {
	beforeEach(() => toastMock.info.mockClear());

	it.each([
		["shuffle", "已切换为随机播放"],
		["single", "已切换为单曲循环"],
		["order", "已切换为顺序播放"],
	])("announces the selected %s playback mode", (mode, message) => {
		const { unmount } = render(<MusicModeToast />);

		act(() => {
			window.dispatchEvent(
				new CustomEvent("arsnMusicModeChanged", { detail: mode }),
			);
		});

		expect(toastMock.info).toHaveBeenCalledWith(message, { duration: 2200 });
		unmount();
	});

	it("ignores unknown playback mode values", () => {
		render(<MusicModeToast />);

		act(() => {
			window.dispatchEvent(
				new CustomEvent("arsnMusicModeChanged", { detail: "unknown" }),
			);
		});

		expect(toastMock.info).not.toHaveBeenCalled();
	});
});
