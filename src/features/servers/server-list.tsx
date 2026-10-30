import ArsnDetailedServerCard from "@/components/ArsnDetailedServerCard";
import ServerCard from "@/components/ServerCard";
import ServerCardInline from "@/components/ServerCardInline";
import type { NezhaServer } from "@/types/nezha-api";
import { ServerEmptyState } from "./server-states";

export function ServerList({
	hasServers,
	filteredServers,
	allServers,
	inline,
	viewMode,
	now,
}: {
	hasServers: boolean;
	filteredServers: NezhaServer[];
	allServers: NezhaServer[];
	inline: string;
	viewMode: string;
	now: number;
}) {
	if (!hasServers) return <ServerEmptyState />;

	const hasFilteredServers = filteredServers.length > 0;
	const visibleServerIds = new Set(filteredServers.map((server) => server.id));
	const orderedServers = [
		...filteredServers,
		...allServers.filter((server) => !visibleServerIds.has(server.id)),
	];
	return (
		<>
			<section
				className="arsn-richview arsn-react-richview"
				aria-label="详细服务器视图"
				hidden={viewMode !== "2"}
			>
				{orderedServers.map((serverInfo) => (
					<ArsnDetailedServerCard
						key={serverInfo.id}
						isVisible={visibleServerIds.has(serverInfo.id)}
						now={now}
						serverInfo={serverInfo}
					/>
				))}
				{viewMode === "2" && !hasFilteredServers && (
					<ServerEmptyState filtered />
				)}
			</section>
			{hasFilteredServers ? (
				inline === "1" ? (
					<section
						hidden={viewMode === "2"}
						className="flex flex-col gap-2 overflow-x-scroll p-px scrollbar-hidden mt-6 server-inline-list"
					>
						{filteredServers.map((serverInfo) => (
							<ServerCardInline
								key={serverInfo.id}
								now={now}
								serverInfo={serverInfo}
							/>
						))}
					</section>
				) : (
					<section
						hidden={viewMode === "2"}
						className="grid grid-cols-1 gap-2 md:grid-cols-2 mt-6 server-card-list"
					>
						{filteredServers.map((serverInfo) => (
							<ServerCard
								key={serverInfo.id}
								now={now}
								serverInfo={serverInfo}
							/>
						))}
					</section>
				)
			) : viewMode !== "2" ? (
				<div className="mt-6">
					<ServerEmptyState filtered />
				</div>
			) : null}
		</>
	);
}
