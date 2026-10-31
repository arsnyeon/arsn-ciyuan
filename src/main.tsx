import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import App from "./App";
import MusicModeToast from "./components/MusicModeToast";
import { ThemeColorManager } from "./components/ThemeColorManager";
import { ThemeProvider } from "./components/ThemeProvider";
import { CommandProvider } from "./context/command-provider";
import { SortProvider } from "./context/sort-provider";
import { StatusProvider } from "./context/status-provider";
import { TooltipProvider } from "./context/tooltip-provider";
import { WebSocketProvider } from "./context/websocket-provider";
import "./i18n";
import "./index.css";
import "./theme/arsn-theme.css";
import "./theme/arsn-runtime.js";
// flag-icons CSS is loaded on demand by ServerFlag (SVG fallback only); the
// full set is ~400 KB and unnecessary when native emoji flags are available.

const queryClient = new QueryClient();
const ReactQueryDevtools = import.meta.env.DEV
	? lazy(() =>
			import("@tanstack/react-query-devtools").then((module) => ({
				default: module.ReactQueryDevtools,
			})),
		)
	: null;

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
	<ThemeProvider storageKey="vite-ui-theme">
		<ThemeColorManager />
		<MusicModeToast />
		<QueryClientProvider client={queryClient}>
			<WebSocketProvider url="/api/v1/ws/server">
				<CommandProvider>
					<StatusProvider>
						<SortProvider>
							<TooltipProvider>
								<App />
								<Toaster
									duration={1000}
									toastOptions={{
										classNames: {
											default:
												"w-fit rounded-full px-2.5 py-1.5 bg-neutral-100 border border-neutral-200 backdrop-blur-xl shadow-none",
										},
									}}
									position="top-center"
									className={"flex items-center justify-center"}
								/>
								{ReactQueryDevtools ? (
									<Suspense fallback={null}>
										<ReactQueryDevtools />
									</Suspense>
								) : null}
							</TooltipProvider>
						</SortProvider>
					</StatusProvider>
				</CommandProvider>
			</WebSocketProvider>
		</QueryClientProvider>
	</ThemeProvider>,
);
