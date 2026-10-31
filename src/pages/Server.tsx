import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo } from "react";
import HomeSkeleton from "@/components/loading/HomeSkeleton";
import MapSkeleton from "@/components/loading/MapSkeleton";
import ServerOverview from "@/components/ServerOverview";
import { ServiceTracker } from "@/components/ServiceTracker";
import {
	selectGroupServerIds,
	selectGroupTabs,
	selectServers,
} from "@/features/servers/selectors";
import { ServerControls } from "@/features/servers/server-controls";
import { ServerList } from "@/features/servers/server-list";
import { BackendErrorState } from "@/features/servers/server-states";
import { useServerPreferences } from "@/features/servers/use-server-preferences";
import { useSort } from "@/hooks/use-sort";
import { useStatus } from "@/hooks/use-status";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { fetchServerGroup, fetchService } from "@/lib/nezha-api";
import { useRuntimeConfig } from "@/lib/runtime-config";

// The map pulls in ~1 MB of GeoJSON plus d3-geo. It is off by default, so keep
// it out of the initial bundle and only fetch it when the map is shown.
const GlobalMap = lazy(() => import("@/components/GlobalMap"));

export default function Servers({
	backendError,
	configurationLoading = false,
}: {
	backendError?: Error | null;
	configurationLoading?: boolean;
}) {
	const sort = useSort();
	const { sortType, sortOrder } = sort;
	const { data: groupData, error: groupError } = useQuery({
		queryKey: ["server-group"],
		queryFn: () => fetchServerGroup(),
		retry: false,
	});
	const { data: serviceData, error: serviceError } = useQuery({
		queryKey: ["service"],
		queryFn: () => fetchService(),
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchInterval: 10000,
		retry: false,
	});
	const hasServices =
		!!serviceData?.data?.services &&
		Object.keys(serviceData.data.services).length > 0;
	const { lastData } = useWebSocketContext();
	const { status } = useStatus();
	const nezhaWsData = lastData;
	const preferences = useServerPreferences(
		hasServices,
		nezhaWsData,
		!configurationLoading,
	);
	const { showServices, showMap, inline, currentGroup } = preferences;

	const { backgroundImage: customBackgroundImage } = useRuntimeConfig();

	const groupServerIdSets = useMemo(
		() => selectGroupServerIds(groupData?.data),
		[groupData?.data],
	);
	const groupTabs = useMemo(
		() => selectGroupTabs(groupData?.data),
		[groupData?.data],
	);
	const {
		down,
		downSpeed,
		filteredServers,
		allServers,
		offlineServers,
		onlineServers,
		totalServers,
		up,
		upSpeed,
	} = useMemo(
		() =>
			selectServers({
				data: nezhaWsData,
				currentGroup,
				groupServerIdSets,
				status,
				sortType,
				sortOrder,
			}),
		[nezhaWsData, currentGroup, groupServerIdSets, status, sortType, sortOrder],
	);

	const currentBackendError = backendError || groupError || serviceError;

	if (!nezhaWsData && currentBackendError) {
		return <BackendErrorState error={currentBackendError} />;
	}

	if (!nezhaWsData || configurationLoading) {
		return <HomeSkeleton />;
	}

	const hasServers = nezhaWsData.servers.length > 0;

	return (
		<div
			className="mx-auto w-full max-w-5xl px-0"
			data-arsn-view-mode={preferences.viewMode}
		>
			<ServerOverview
				total={totalServers}
				online={onlineServers}
				offline={offlineServers}
				up={up}
				down={down}
				upSpeed={upSpeed}
				downSpeed={downSpeed}
			/>
			<ServerControls
				{...preferences}
				{...sort}
				hasServers={hasServers}
				hasServices={hasServices}
				groupTabs={groupTabs}
				customBackgroundImage={customBackgroundImage}
			/>
			{hasServers && showMap === "1" && (
				<Suspense fallback={<MapSkeleton />}>
					<GlobalMap now={nezhaWsData.now} serverList={nezhaWsData.servers} />
				</Suspense>
			)}
			{hasServers && showServices === "1" && (
				<ServiceTracker serverList={filteredServers} />
			)}
			<ServerList
				hasServers={hasServers}
				filteredServers={filteredServers}
				allServers={allServers}
				inline={inline}
				viewMode={preferences.viewMode}
				now={nezhaWsData.now}
			/>
		</div>
	);
}
