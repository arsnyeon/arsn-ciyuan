import http from "node:http";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const port = Number(process.env.MOCK_NEZHA_PORT || 8008);
const serverCount = Number(process.env.MOCK_NEZHA_COUNT || 6);
const isGuest = process.argv.includes("--guest");
const updateIntervalMs = Number(
	process.env.MOCK_NEZHA_INTERVAL_MS || (serverCount > 10_000 ? 0 : 2000),
);
const dayMs = 86_400_000;
const minuteMs = 60_000;
const timezoneOffsetMs = 8 * 60 * minuteMs;
const startedAt = Math.floor(Date.now() / 1000) * 1000;

// 前几个节点提供固定 UI 场景；其余节点保留每 17 个离线一个的规则。
const isServerOffline = (id) => id === 3 || id === 4 || id % 17 === 0;

const countries = [
	"US",
	"SG",
	"JP",
	"DE",
	"GB",
	"FR",
	"NL",
	"CA",
	"AU",
	"BR",
	"IN",
	"KR",
	"HK",
	"TW",
	"FI",
	"PL",
];

const platforms = ["linux", "debian", "ubuntu", "centos", "alpine", "Windows"];

const nowIso = () => new Date().toISOString();

function createServer(index) {
	const id = index + 1;
	const platform = platforms[index % platforms.length];
	const memTotal = 2 ** 30 * (2 + (index % 15));
	const diskTotal = 2 ** 30 * (40 + (index % 200));
	const swapTotal = 2 ** 30 * (index % 8);
	const memUsed = memTotal * ((index % 90) / 100);
	const diskUsed = diskTotal * ((index % 84) / 100);
	const swapUsed = swapTotal ? swapTotal * ((index % 60) / 100) : 0;
	const isOffline = isServerOffline(id);

	return {
		id,
		name: `mock-server-${String(id).padStart(4, "0")}`,
		public_note: id % 19 === 0 ? "[[Plan]] bandwidth=1Gbps" : "",
		last_active: isOffline
			? new Date(
					startedAt - (id === 4 ? 31 * dayMs : 10 * minuteMs),
				).toISOString()
			: nowIso(),
		country_code: countries[index % countries.length],
		host: {
			platform,
			platform_version: platform === "Windows" ? "Server 2022" : "6.8",
			cpu: [`Mock CPU ${1 + (index % 8)} Core`],
			gpu: index % 40 === 0 ? ["Mock GPU"] : [],
			mem_total: memTotal,
			disk_total: diskTotal,
			swap_total: swapTotal,
			arch: index % 5 === 0 ? "arm64" : "amd64",
			boot_time: Math.floor(Date.now() / 1000) - 86_400 * (1 + (index % 365)),
			version: "mock-1.0.0",
		},
		state: {
			cpu: (index * 7) % 100,
			mem_used: memUsed,
			swap_used: swapUsed,
			disk_used: diskUsed,
			net_in_transfer: 2 ** 30 * (index % 500),
			net_out_transfer: 2 ** 30 * ((index * 2) % 500),
			net_in_speed: 1024 * (20 + ((index * 13) % 80_000)),
			net_out_speed: 1024 * (20 + ((index * 17) % 80_000)),
			uptime: 3600 * (1 + (index % 20_000)),
			load_1: Number(((index % 100) / 20).toFixed(2)),
			load_5: Number(((index % 80) / 20).toFixed(2)),
			load_15: Number(((index % 60) / 20).toFixed(2)),
			tcp_conn_count: index % 300,
			udp_conn_count: index % 80,
			process_count: 40 + (index % 240),
			temperatures: [],
			gpu: index % 40 === 0 ? [(index * 3) % 100] : [],
		},
	};
}

const servers = Array.from({ length: serverCount }, (_, index) =>
	createServer(index),
);
let onlineCount = servers.filter(
	(server) => !isServerOffline(server.id),
).length;

function updateServerMetrics() {
	const now = Date.now();
	let nextOnlineCount = 0;

	for (const server of servers) {
		const isOffline = isServerOffline(server.id);
		if (!isOffline) {
			server.last_active = new Date(now).toISOString();
			nextOnlineCount += 1;
		}

		const wave = (now / 1000 + server.id) % 100;
		server.state.cpu = Number(wave.toFixed(2));
		server.state.net_in_speed =
			1024 * (20 + ((server.id * 13 + now / 1000) % 80_000));
		server.state.net_out_speed =
			1024 * (20 + ((server.id * 17 + now / 1000) % 80_000));
		server.state.net_in_transfer += server.state.net_in_speed;
		server.state.net_out_transfer += server.state.net_out_speed;
	}

	onlineCount = nextOnlineCount;
}

function websocketPayload() {
	const payload = { now: Date.now() };

	if (onlineCount > 0) {
		payload.online = onlineCount;
	}
	if (servers.length > 0) {
		payload.servers = servers;
	}

	return JSON.stringify(payload);
}

function jsonResponse(response, data, statusCode = 200) {
	response.writeHead(statusCode, {
		"Access-Control-Allow-Origin": "*",
		"Cache-Control": "no-store",
		"Content-Type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(data));
}

// 与真实指标接口保持相同单位：百分比、字节、字节/秒、计数和毫秒时间戳。
const metricSamplers = {
	cpu: (_server, wave) => 10 + wave * 70,
	memory: (server, wave) => server.host.mem_total * (0.25 + wave * 0.5),
	swap: (server, wave) => server.host.swap_total * wave * 0.3,
	disk: (server, wave) => server.host.disk_total * (0.3 + wave * 0.1),
	net_in_speed: (_server, wave) => 2 ** 20 * (5 + wave * 25),
	net_out_speed: (_server, wave) => 2 ** 20 * (2 + wave * 15),
	net_in_transfer: (server, _wave, age) =>
		Math.max(0, server.state.net_in_transfer - age * 1024),
	net_out_transfer: (server, _wave, age) =>
		Math.max(0, server.state.net_out_transfer - age * 1024),
	load1: (_server, wave) => 0.2 + wave * 2,
	load5: (_server, wave) => 0.3 + wave * 1.5,
	load15: (_server, wave) => 0.4 + wave,
	tcp_conn: (server, wave) =>
		Math.round(server.state.tcp_conn_count + wave * 40),
	udp_conn: (server, wave) =>
		Math.round(server.state.udp_conn_count + wave * 10),
	process_count: (server, wave) =>
		Math.round(server.state.process_count + wave * 20),
	temperature: (_server, wave) => 40 + wave * 20,
	uptime: (server, _wave, age) => Math.max(0, server.state.uptime - age),
	gpu: (server, wave) => (server.host.gpu.length > 0 ? 10 + wave * 60 : 0),
};
const metricPeriods = {
	"1d": { days: 1, stepMs: 15 * minuteMs },
	"7d": { days: 7, stepMs: 60 * minuteMs },
	"30d": { days: 30, stepMs: 6 * 60 * minuteMs },
};

function createMetricHistory(server, metric, period) {
	const { days, stepMs } = metricPeriods[period];
	// 同一窗口对齐到固定采样时间，内存/交换、上传/下载等成对序列才能匹配。
	const windowEnd = Math.floor(Date.now() / stepMs) * stepMs;
	const windowStart = windowEnd - days * dayMs;
	const lastActive = Date.parse(server.last_active);
	const dataPoints = [];
	for (
		let ts = windowStart;
		ts <= windowEnd && ts <= lastActive;
		ts += stepMs
	) {
		const wave = (Math.sin(ts / (60 * minuteMs) + server.id) + 1) / 2;
		const age = (windowEnd - ts) / 1000;
		dataPoints.push({
			ts,
			value: Number(metricSamplers[metric](server, wave, age).toFixed(2)),
		});
	}
	return {
		server_id: server.id,
		server_name: server.name,
		metric,
		data_points: dataPoints,
	};
}

function createMonitorHistory(server, period) {
	const { days, stepMs } = metricPeriods[period];
	const end = Math.floor(Date.now() / stepMs) * stepMs;
	const timestamps = [];
	for (
		let ts = end - days * dayMs;
		ts <= end && ts <= Date.parse(server.last_active);
		ts += stepMs
	) {
		timestamps.push(ts);
	}
	return ["Hong Kong · ICMP", "Tokyo · TCP", "Singapore · HTTPS"].map(
		(name, index) => {
			const loss = timestamps.map((ts) => {
				const sample = Math.floor(ts / stepMs) + server.id + index * 7;
				return index === 0
					? 0
					: sample % 43 === 0
						? 100
						: sample % 11 === 0
							? 5 + index * 3
							: 0;
			});
			return {
				monitor_id: index + 1,
				monitor_name: name,
				display_index: 3 - index,
				server_id: server.id,
				server_name: server.name,
				created_at: timestamps,
				avg_delay: timestamps.map((ts, sample) =>
					loss[sample] === 100
						? 0
						: Number(
								(
									25 +
									index * 40 +
									(Math.sin(ts / (60 * minuteMs) + server.id + index) + 1) *
										(6 + index * 8) +
									loss[sample] * 3
								).toFixed(2),
							),
				),
				packet_loss: loss,
			};
		},
	);
}

function createOnlineHistory(server, days) {
	const windowEnd = Math.floor(Date.now() / 1000) * 1000;
	const windowStart = windowEnd - days * dayMs;
	const firstDay =
		Math.floor((windowStart + timezoneOffsetMs) / dayMs) * dayMs -
		timezoneOffsetMs;
	const currentlyOnline = !isServerOffline(server.id);
	const onlineEnd = currentlyOnline
		? windowEnd
		: Date.parse(server.last_active);
	const periods = [];
	const daily = [];

	const addPeriod = (start, end) => {
		if (end <= start) return;
		periods.push({
			start: new Date(start).toISOString(),
			end: new Date(end).toISOString(),
			ongoing: currentlyOnline && end === windowEnd,
		});
	};

	// 1/6: 日常短暂掉线；2: 持续在线；3: 当前离线；4: 无历史；5: 密集短时段。
	// 先生成离线间隙，再取补集，跨午夜的在线会话保持连续。
	if (server.id !== 4) {
		let cursor = windowStart;
		for (let day = firstDay; day < onlineEnd; day += dayMs) {
			if (server.id === 2) continue;
			const dayIndex = Math.floor((day + timezoneOffsetMs) / dayMs);
			const hours =
				server.id === 5
					? [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]
					: [2, 8, 15];
			for (const hour of hours) {
				const gapStart = Math.max(windowStart, day + hour * 60 * minuteMs);
				const gapMinutes =
					server.id === 5 ? 35 : 10 + ((dayIndex + server.id + hour) % 6) * 13;
				// 最后活跃前半小时保持在线，让时段终点与 WebSocket 状态一致。
				const gapEnd = Math.min(
					day + (hour * 60 + gapMinutes) * minuteMs,
					onlineEnd - 30 * minuteMs,
				);
				if (gapEnd <= gapStart) continue;
				addPeriod(cursor, gapStart);
				cursor = gapEnd;
			}
		}
		addPeriod(cursor, onlineEnd);
	}

	// 每日数字和概要都从同一组时段计算，避免时间轴与统计不一致。
	for (let day = firstDay; day < windowEnd; day += dayMs) {
		const onlineSeconds = periods.reduce((total, period) => {
			const start = Math.max(day, Date.parse(period.start));
			const end = Math.min(day + dayMs, Date.parse(period.end));
			return total + Math.max(0, (end - start) / 1000);
		}, 0);
		daily.push({
			date: new Date(day + timezoneOffsetMs).toISOString().slice(0, 10),
			online_seconds: onlineSeconds,
		});
	}
	const totalOnlineSeconds = daily.reduce(
		(total, day) => total + day.online_seconds,
		0,
	);

	return {
		server_id: server.id,
		server_name: server.name,
		days,
		max_days: isGuest ? 1 : 30,
		timezone: "Asia/Shanghai",
		window_start: new Date(windowStart).toISOString(),
		window_end: new Date(windowEnd).toISOString(),
		total_online_seconds: totalOnlineSeconds,
		online_rate:
			(totalOnlineSeconds / ((windowEnd - windowStart) / 1000)) * 100,
		currently_online: currentlyOnline,
		last_active:
			server.id === 4 ? undefined : new Date(onlineEnd).toISOString(),
		periods,
		daily,
	};
}

const populatedServerGroups = [
	{
		group: {
			id: 1,
			created_at: nowIso(),
			updated_at: nowIso(),
			name: "Region US/EU",
		},
		servers:
			serverCount > 10_000
				? []
				: servers
						.filter((server) =>
							["US", "DE", "GB", "FR", "NL"].includes(server.country_code),
						)
						.map((server) => server.id),
	},
	{
		group: {
			id: 2,
			created_at: nowIso(),
			updated_at: nowIso(),
			name: "Region APAC",
		},
		servers:
			serverCount > 10_000
				? []
				: servers
						.filter((server) =>
							["SG", "JP", "KR", "HK", "TW", "AU"].includes(
								server.country_code,
							),
						)
						.map((server) => server.id),
	},
];
const serverGroups = serverCount === 0 ? [] : populatedServerGroups;

const serviceHistory = Array.from({ length: 30 }, (_, index) => ({
	up: 95 + (index % 6),
	down: index % 13 === 0 ? 1 : 0,
	delay: 20 + index * 3,
}));

const services =
	serverCount === 0
		? {}
		: {
				mock_http: {
					service_name: "Mock HTTP",
					current_up: 1,
					current_down: 0,
					total_up: 2999,
					total_down: 1,
					delay: serviceHistory.map((item) => item.delay),
					up: serviceHistory.map((item) => item.up),
					down: serviceHistory.map((item) => item.down),
				},
			};

const httpServer = http.createServer((request, response) => {
	const requestUrl = new URL(
		request.url || "/",
		`http://${request.headers.host}`,
	);

	if (request.method === "OPTIONS") {
		response.writeHead(204, {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		});
		response.end();
		return;
	}

	if (
		isGuest &&
		["/api/v1/profile", "/api/v1/refresh-token"].includes(requestUrl.pathname)
	) {
		jsonResponse(response, { success: false, error: "unauthorized" }, 401);
		return;
	}

	if (
		isGuest &&
		/^\/api\/v1\/server\/\d+\/(metrics|service)$/.test(requestUrl.pathname) &&
		(requestUrl.searchParams.get("period") ?? "1d") !== "1d"
	) {
		jsonResponse(
			response,
			{
				success: false,
				error: "unauthorized: only 1d data available for guests",
			},
			401,
		);
		return;
	}

	const metricsMatch = requestUrl.pathname.match(
		/^\/api\/v1\/server\/(\d+)\/(metrics|service)$/,
	);
	if (metricsMatch) {
		const server = servers[Number(metricsMatch[1]) - 1];
		const metric = requestUrl.searchParams.get("metric") ?? "cpu";
		const period = requestUrl.searchParams.get("period") ?? "1d";
		if (!server) {
			jsonResponse(
				response,
				{ success: false, error: "server not found" },
				404,
			);
			return;
		}
		if (
			!Object.hasOwn(metricSamplers, metric) ||
			!Object.hasOwn(metricPeriods, period)
		) {
			jsonResponse(
				response,
				{ success: false, error: "invalid metric or period" },
				400,
			);
			return;
		}
		jsonResponse(response, {
			success: true,
			data:
				metricsMatch[2] === "service"
					? createMonitorHistory(server, period)
					: createMetricHistory(server, metric, period),
		});
		return;
	}

	const onlineHistoryMatch = requestUrl.pathname.match(
		/^\/api\/v1\/server\/(\d+)\/online-history$/,
	);
	if (onlineHistoryMatch) {
		const server = servers[Number(onlineHistoryMatch[1]) - 1];
		const days = Number(
			requestUrl.searchParams.get("days") ?? (isGuest ? 1 : 7),
		);
		if (!server) {
			jsonResponse(
				response,
				{ success: false, error: "server not found" },
				404,
			);
			return;
		}
		if (!Number.isInteger(days) || days < 1 || days > 30) {
			jsonResponse(
				response,
				{ success: false, error: "days must be an integer between 1 and 30" },
				400,
			);
			return;
		}
		if (isGuest && days > 1) {
			jsonResponse(
				response,
				{
					success: false,
					error: "unauthorized: only 1d data available for guests",
				},
				401,
			);
			return;
		}
		jsonResponse(response, {
			success: true,
			data: createOnlineHistory(server, days),
		});
		return;
	}

	switch (requestUrl.pathname) {
		case "/api/v1/setting":
			jsonResponse(response, {
				success: true,
				data: {
					config: {
						debug: true,
						language: "en-US",
						site_name: `Nezha Mock ${serverCount}`,
						user_template: "",
						admin_template: "",
						custom_code: "",
					},
					version: "mock-1.0.0",
				},
			});
			return;
		case "/api/v1/server-group":
			jsonResponse(response, { success: true, data: serverGroups });
			return;
		case "/api/v1/service":
			jsonResponse(response, {
				success: true,
				data: {
					services,
					cycle_transfer_stats: {},
				},
			});
			return;
		case "/api/v1/profile":
			jsonResponse(response, {
				success: true,
				data: {
					id: 1,
					username: "mock-user",
					password: "",
					created_at: nowIso(),
					updated_at: nowIso(),
				},
			});
			return;
		default:
			jsonResponse(response, { success: true, data: [] });
	}
});

const websocketServer = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (request, socket, head) => {
	if (!request.url?.startsWith("/api/v1/ws/server")) {
		socket.destroy();
		return;
	}

	websocketServer.handleUpgrade(request, socket, head, (websocket) => {
		websocketServer.emit("connection", websocket, request);
	});
});

websocketServer.on("connection", (websocket) => {
	websocket.send(websocketPayload());
});

if (updateIntervalMs > 0) {
	setInterval(() => {
		updateServerMetrics();
		const payload = websocketPayload();
		for (const client of websocketServer.clients) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(payload);
			}
		}
	}, updateIntervalMs);
}

httpServer.listen(port, () => {
	console.log(
		`Mock Nezha API listening on http://localhost:${httpServer.address().port} with ${serverCount} servers`,
	);
	console.log(`Mock Nezha auth mode: ${isGuest ? "guest" : "user"}`);
	if (updateIntervalMs === 0) {
		console.log(
			"Mock Nezha websocket is in static mode. Set MOCK_NEZHA_INTERVAL_MS to enable repeated full-payload updates.",
		);
	}
});
