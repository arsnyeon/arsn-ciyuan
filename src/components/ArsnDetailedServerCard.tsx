import {
	Activity,
	ArrowDown,
	ArrowUp,
	CalendarDays,
	Cpu,
	Gauge,
	HardDrive,
	MemoryStick,
	Network,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import ServerFlag from "@/components/ServerFlag";
import { isServerOnline } from "@/features/servers/selectors";
import { formatBytes } from "@/lib/format";
import { saveMainPageScrollPosition } from "@/lib/navigation";
import { preloadServerDetail } from "@/lib/server-detail-preload";
import { cn, parsePublicNote } from "@/lib/utils";
import type { NezhaServer } from "@/types/nezha-api";

function GaugeMetric({
	icon: Icon,
	label,
	value,
	percent,
	color,
}: {
	icon: typeof Cpu;
	label: string;
	value: string;
	percent: number;
	color: string;
}) {
	return (
		<div
			className="arsn-node-gauge"
			style={
				{
					"--an-gauge": color,
					"--an-fill-pct": `${Math.max(0, Math.min(100, percent))}%`,
				} as CSSProperties
			}
		>
			<div className="arsn-node-gauge-head">
				<span className="arsn-node-gauge-label">
					<Icon aria-hidden="true" />
					<span>{label}</span>
				</span>
				<strong>{value}</strong>
			</div>
			<div className="arsn-node-gauge-track" />
		</div>
	);
}

function RichBytes({
	value,
	perSecond = false,
}: {
	value: number;
	perSecond?: boolean;
}) {
	const number = Math.max(0, Number(value) || 0);
	const formatted =
		number < 1024 ? `${Math.round(number)} B` : formatBytes(number);
	return (
		<>
			{formatted}
			{perSecond ? "/s" : ""}
		</>
	);
}

export default function ArsnDetailedServerCard({
	now,
	serverInfo,
	isVisible = true,
}: {
	now: number;
	serverInfo: NezhaServer;
	isVisible?: boolean;
}) {
	const { state, host } = serverInfo;
	const online = isServerOnline(now, serverInfo);
	const cpu = state.cpu || 0;
	const mem = host.mem_total ? (state.mem_used / host.mem_total) * 100 : 0;
	const disk = host.disk_total ? (state.disk_used / host.disk_total) * 100 : 0;
	const load = state.load_1 || 0;
	const cores = Math.max(1, host.cpu?.length || 1);
	const note = parsePublicNote(serverInfo.public_note);
	const billing = note?.billingDataMod;
	const plan = note?.planDataMod;
	const expiresNever = Boolean(billing?.endDate?.startsWith("0000-00-00"));
	let expiry = expiresNever
		? "永久"
		: billing?.endDate
			? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
					new Date(billing.endDate),
				)
			: "—";
	if (
		billing?.endDate &&
		!expiresNever &&
		!Number.isNaN(Date.parse(billing.endDate))
	) {
		const remainingDays = Math.ceil(
			(Date.parse(billing.endDate) - now) / 86_400_000,
		);
		expiry =
			remainingDays >= 0
				? `${remainingDays} 天`
				: `已过期 ${Math.abs(remainingDays)} 天`;
	}
	const tags = [
		plan?.bandwidth,
		plan?.trafficVol,
		plan?.IPv4 === "1" ? "IPv4" : "",
		plan?.IPv6 === "1" ? "IPv6" : "",
		...(plan?.networkRoute ? plan.networkRoute.split(",") : []),
		...(plan?.extra ? plan.extra.split(",") : []),
	]
		.filter((tag): tag is string => typeof tag === "string")
		.map((tag) => tag.trim())
		.filter(Boolean);
	const openDetails = () => {
		saveMainPageScrollPosition();
	};

	return (
		<Link
			className={cn("arsn-node-card", !online && "is-offline")}
			to={`/server/${serverInfo.id}`}
			data-testid="detailed-server-card"
			data-server-id={serverInfo.id}
			hidden={!isVisible}
			aria-hidden={!isVisible}
			aria-label={`${serverInfo.name}，${online ? "在线" : "离线"}，查看详情`}
			onClick={openDetails}
			onPointerEnter={preloadServerDetail}
			onPointerDown={preloadServerDetail}
			onFocus={preloadServerDetail}
		>
			<header className="arsn-node-header">
				<div className="arsn-node-title-wrap">
					<div className="arsn-node-title-row">
						<span className={cn("arsn-node-dot", !online && "off")} />
						<ServerFlag country_code={serverInfo.country_code} />
						<span className="arsn-node-title">
							{serverInfo.name || "未命名"}
						</span>
					</div>
				</div>
				<div className="arsn-node-actions" title={host.platform}>
					{host.platform && (
						<i
							className={`fl-${host.platform.toLowerCase().split(/[\s/]/)[0]} arsn-node-os`}
							aria-hidden="true"
						/>
					)}
				</div>
			</header>

			<div className="arsn-node-vitals">
				<GaugeMetric
					icon={Cpu}
					label="CPU"
					value={`${cpu.toFixed(2)}%`}
					percent={cpu}
					color="#3b82f6"
				/>
				<GaugeMetric
					icon={MemoryStick}
					label="内存"
					value={`${mem.toFixed(2)}%`}
					percent={mem}
					color="#8b5cf6"
				/>
				<GaugeMetric
					icon={HardDrive}
					label="磁盘"
					value={`${disk.toFixed(2)}%`}
					percent={disk}
					color="#e97b35"
				/>
				<GaugeMetric
					icon={Gauge}
					label="负载"
					value={load.toFixed(2)}
					percent={(load / cores) * 100}
					color="#ec4899"
				/>
			</div>

			<div className="arsn-node-info-strip">
				<div
					className="arsn-node-info-tile is-traffic"
					style={{ "--an-gauge": "#3b82f6" } as CSSProperties}
				>
					<span className="arsn-node-info-k">
						<Activity aria-hidden="true" />
						<span>实时流量</span>
					</span>
					<div className="arsn-node-info-row">
						<ArrowUp className="lab up" aria-hidden="true" />
						<span className="arsn-node-info-name">上传</span>
						<strong>
							<RichBytes value={state.net_out_speed} perSecond />
						</strong>
					</div>
					<div className="arsn-node-info-row">
						<ArrowDown className="lab down" aria-hidden="true" />
						<span className="arsn-node-info-name">下载</span>
						<strong>
							<RichBytes value={state.net_in_speed} perSecond />
						</strong>
					</div>
					<span className="arsn-node-pulse" aria-hidden="true">
						{Array.from({ length: 14 }, (_, index) => (
							<i
								key={index}
								className={
									index <
									Math.min(
										14,
										Math.round(
											(state.net_out_speed + state.net_in_speed) / 2048,
										),
									)
										? "on"
										: ""
								}
							/>
						))}
					</span>
				</div>
				<div
					className="arsn-node-info-tile is-traffic"
					style={{ "--an-gauge": "#8b5cf6" } as CSSProperties}
				>
					<span className="arsn-node-info-k">
						<Activity aria-hidden="true" />
						<span>累计流量</span>
					</span>
					<div className="arsn-node-info-row">
						<ArrowUp className="lab up" aria-hidden="true" />
						<span className="arsn-node-info-name">上传</span>
						<strong>
							<RichBytes value={state.net_out_transfer} />
						</strong>
					</div>
					<div className="arsn-node-info-row">
						<ArrowDown className="lab down" aria-hidden="true" />
						<span className="arsn-node-info-name">下载</span>
						<strong>
							<RichBytes value={state.net_in_transfer} />
						</strong>
					</div>
				</div>
				<div className="arsn-node-info-tile is-network">
					<span className="arsn-node-info-k">
						<Network aria-hidden="true" />
						<span>连接与到期</span>
					</span>
					<div className="arsn-node-netstats">
						<div className="arsn-node-netstat">
							<span className="arsn-node-net-k">TCP</span>
							<strong>{state.tcp_conn_count}</strong>
						</div>
						<div className="arsn-node-netstat">
							<span className="arsn-node-net-k">UDP</span>
							<strong>{state.udp_conn_count}</strong>
						</div>
					</div>
					<div className="arsn-node-expiry">
						<CalendarDays
							className="arsn-node-expiry-icon"
							aria-hidden="true"
						/>
						<span className="arsn-node-expiry-label">到期</span>
						<strong className="arsn-node-info-big">{expiry}</strong>
						{billing?.amount === "0" && (
							<span className="arsn-node-info-sub">免费</span>
						)}
					</div>
				</div>
			</div>

			<div className="arsn-node-traffic">
				<div className="arsn-node-traffic-head">
					<span className="arsn-node-traffic-label">
						剩余 <strong>∞</strong>
					</span>
					<span className="arsn-node-traffic-uptime">
						在线：{formatUptime(state.uptime)}
					</span>
				</div>
				<span className="arsn-node-traffic-track" />
				<span className="arsn-node-traffic-value">
					<RichBytes value={state.net_out_transfer + state.net_in_transfer} /> /
					∞
				</span>
			</div>
			{tags.length > 0 && (
				<div className="arsn-node-foottags">
					{tags.slice(0, 4).map((tag, index) => (
						<span
							key={`${tag}-${index}`}
							className={cn(
								"arsn-node-foottag",
								/Mbps|Gbps/i.test(tag) && "is-mbps",
								tag === "无限" && "is-unlimited",
								tag === "IPv4" && "is-v4",
								tag === "IPv6" && "is-v6",
							)}
						>
							{tag}
						</span>
					))}
				</div>
			)}
		</Link>
	);
}

function formatUptime(value: number) {
	const seconds = Number(value) || 0;
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return days ? `${days} 天` : hours ? `${hours} 小时` : `${minutes} 分钟`;
}
