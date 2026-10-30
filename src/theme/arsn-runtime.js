// @ts-nocheck
import { parseThemeConfig, parseThemeConfigValue } from "../features/runtime-config/parse-theme-config";
(function () {
  "use strict";
  /* Theme by arsn-ciyuan | https://github.com/arsnyeon/arsn-ciyuan | 转载请注明出处 */

  /* ===================== 可调参数 ===================== */
  var CFG = {
    interval: 4000,              // 每种状态停留时间（毫秒）→ 4 秒切换一次
    wsPath: "/api/v1/ws/server", // 面板实时数据通道
    reconnectDelay: 3000,        // 自建连接时的重连间隔
    scanFallbackInterval: 8000,  // MutationObserver 的兜底扫描间隔
    svcPerPage: 6,               // 服务监控每屏最多显示几个
    svcInterval: 6000            // 服务监控轮播间隔（毫秒）
  };

  /* 中英文文案（按面板当前语言自动选择） */
  var TEXT = {
    cn: { proc: "进程数", conn: "连接数" },
    tw: { proc: "程序數", conn: "連線數" },
    en: { proc: "Processes", conn: "Connections" }
  };

  /* 右上角看板娘：永雏塔菲透明抠图（WebP / data URI，无需外链） */
  var TAFFY_SRC = "/arsn-assets/taffy.webp";
  var LOGO_DATA = "/arsn-assets/logo.png";
  var DEFAULT_BACKGROUND_API = "https://acg.yaohud.cn/dm/adaptive.php";
  var DEFAULT_MUSIC_PLAYLIST_ID = "443797814";
  var FAVICON_32 = "/arsn-assets/favicon-32.png";
  var FAVICON_16 = "/arsn-assets/favicon-16.png";
  var TITLE_ICON = "/arsn-assets/title-icon.webp";

  /* ===================== 内部状态 ===================== */
  var servers = Object.create(null); // name -> { proc, tcp, udp, cpu, mem, ... }
  var hasServerData = false;         // 游客看不到服务器时，不播报服务器状态
  var cells = [];                    // 已接管的单元格
  var mode = "transfer";             // transfer | stats
  var lastDataAt = 0;
  var disposed = false;

  var tapSock = null;                // 复用的「面板自己的」连接
  var tapped = [];                   // 已挂过监听的连接（清理用）
  var ownSock = null;                // 兜底自建连接

  var scanTimer = 0;
  var linkTimer = 0;
  var tapTimer = 0;
  var tickTimer = 0;
  var sweepTimer = 0;
  var observer = null;
  var globalEvents = [];

  function bindGlobal(target, type, handler, options) {
    if (!target || !target.addEventListener) return handler;
    target.addEventListener(type, handler, options);
    globalEvents.push({ target: target, type: type, handler: handler, options: options });
    return handler;
  }

  function clearGlobalEvents() {
    for (var gi = globalEvents.length - 1; gi >= 0; gi--) {
      var ev = globalEvents[gi];
      try { ev.target.removeEventListener(ev.type, ev.handler, ev.options); } catch (e) {}
    }
    globalEvents.length = 0;
  }

  var svc = { section: null, page: 0, count: -1, paused: false };
  var svcTimer = 0;
  var svcAnimTimer = 0;
  var broadcastTimer = 0;
  var broadcastStartTimer = 0;

  /* 重复注入时先销毁旧实例 */
  var prev = window.__arsnStatCycle;
  if (prev && typeof prev.destroy === "function") {
    try { prev.destroy(); } catch (e) {}
  }

  /* ===================== 工具函数 ===================== */
  function toNum(v) {
    return (typeof v === "number" && isFinite(v)) ? Math.round(v) : null;
  }

  function pickText(label) {
    if (/總上傳|總下載/.test(label)) return TEXT.tw;
    if (/总上传|总下载/.test(label)) return TEXT.cn;
    return TEXT.en;
  }

  function setVis(el, hidden) {
    var v = hidden ? "hidden" : "";
    if (el.style.visibility !== v) el.style.visibility = v;
  }

  /* ===================== 实时数据 ===================== */
  function ingest(payload) {
    if (disposed || !payload) return;

    /* 游客看不到服务器时，payload 里没有 servers（或为空）：清空旧数据并停止服务器播报 */
    if (!Array.isArray(payload.servers) || !payload.servers.length) {
      hasServerData = false;
      for (var key in servers) {
        if (Object.prototype.hasOwnProperty.call(servers, key)) delete servers[key];
      }
      refresh();
      return;
    }

    hasServerData = true;
    lastDataAt = Date.now();
    for (var i = 0; i < payload.servers.length; i++) {
      var s = payload.servers[i];
      if (!s || !s.name) continue;
      var st = s.state || {};
      var host = s.host || {};
      var memTotal = Number(host.mem_total) || 0;
      var diskTotal = Number(host.disk_total) || 0;
      var last = 0;
      try { last = s.last_active ? Date.parse(s.last_active) : 0; } catch (e) {}
      servers[s.name] = {
        id: s.id,
        name: s.name,
        online: !!(st && (Date.now() - last < 60000 || !last)),
        cpu: Number(st.cpu) || 0,
        mem: memTotal ? (Number(st.mem_used) || 0) * 100 / memTotal : 0,
        disk: diskTotal ? (Number(st.disk_used) || 0) * 100 / diskTotal : 0,
        up: Number(st.net_out_speed) || 0,
        down: Number(st.net_in_speed) || 0,
        proc: toNum(st.process_count),
        tcp: toNum(st.tcp_conn_count),
        udp: toNum(st.udp_conn_count),
        load1: Number(st.load_1) || 0,
        load5: Number(st.load_5) || 0,
        load15: Number(st.load_15) || 0,
        cores: Array.isArray(host.cpu) && host.cpu.length ? host.cpu.length : 1,
        uptime: Number(st.uptime) || 0,
        upTotal: Number(st.net_out_transfer) || 0,
        downTotal: Number(st.net_in_transfer) || 0,
        country: String(s.country_code || "").toUpperCase(),
        platform: String(host.platform || "")
      };
    }
    refresh();
    /* Keep the detail cards keyed by server name and update their fields in place. */
  }

  function onMessage(ev) {
    try { ingest(JSON.parse(ev.data)); } catch (e) {}
  }

  /* 在 React 内部找到面板已建立的那条 WebSocket，直接复用，
     这样不会多出一条连接（面板「在线」人数不会 +1）。 */
  function findAppSocket() {
    try {
      var root = document.getElementById("root");
      if (!root) return null;

      var keys = Object.keys(root), key = null;
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf("__reactContainer$") === 0 ||
            keys[i].indexOf("__reactFiber$") === 0) { key = keys[i]; break; }
      }
      if (!key) return null;

      var start = root[key];
      var fiber = (start && start.current) ? start.current : start;
      if (!fiber) return null;

      var stack = [fiber];
      var seen = new WeakSet();
      var guard = 0;

      while (stack.length && guard++ < 20000) {
        var f = stack.pop();
        if (!f || seen.has(f)) continue;
        seen.add(f);

        var h = f.memoizedState, hops = 0;
        while (h && typeof h === "object" && hops++ < 64) {
          var v = h.memoizedState;
          var cand = null;
          if (v instanceof WebSocket) cand = v;
          else if (v && typeof v === "object" && v.current instanceof WebSocket) cand = v.current;

          if (cand && cand.readyState <= 1 &&
              String(cand.url).indexOf(CFG.wsPath) >= 0) return cand;

          h = h.next;
        }

        if (f.child) stack.push(f.child);
        if (f.sibling) stack.push(f.sibling);
      }
    } catch (e) {}
    return null;
  }

  function tryTap() {
    var s = findAppSocket();
    if (!s) return false;
    tapSock = s;
    if (tapped.indexOf(s) === -1) {
      tapped = tapped.filter(function (x) { return x.readyState <= 1; });
      tapped.push(s);
      s.addEventListener("message", onMessage);
      s.addEventListener("close", function () {
        if (tapSock === s) tapSock = null;
      });
    }
    return true;
  }

  function connectOwn() {
    if (ownSock) return;
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    try {
      ownSock = new WebSocket(proto + "//" + location.host + CFG.wsPath);
    } catch (e) {
      ownSock = null;
      return scheduleReconnect();
    }
    ownSock.addEventListener("message", onMessage);
    ownSock.addEventListener("close", function () {
      ownSock = null;
      if (!tapSock) scheduleReconnect();
    });
    ownSock.addEventListener("error", function () {
      try { if (ownSock) ownSock.close(); } catch (e) {}
    });
  }

  function closeOwn() {
    if (!ownSock) return;
    var s = ownSock;
    ownSock = null;
    try { s.close(); } catch (e) {}
  }

  function scheduleReconnect() {
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function () {
      if (!disposed && !tapSock && !ownSock) connectOwn();
    }, CFG.reconnectDelay);
  }

  /* 连接维护：优先复用面板连接；面板重连后自动跟上 */
  function maintain() {
    if (disposed) return;
    if (tapSock && tapSock.readyState > 1) tapSock = null;
    if (tapSock) { if (ownSock) closeOwn(); return; }
    if (tryTap()) { closeOwn(); return; }
    if (!ownSock) connectOwn();
  }

  /* ===================== DOM 接管 ===================== */
  function findName(cell) {
    var el = cell, depth = 0;
    while (el && depth < 8) {
      var p = el.querySelector('p[class*="break-normal"]');
      if (p) return (p.textContent || "").trim();
      el = el.parentElement;
      depth++;
    }
    return "";
  }

  function refreshOne(rec) {
    var s = servers[rec.name];
    var txt = "—";
    if (s) {
      if (rec.kind === "up") {
        txt = (s.proc == null) ? "—" : String(s.proc);
      } else if (s.tcp == null && s.udp == null) {
        txt = "—";
      } else {
        txt = String((s.tcp || 0) + (s.udp || 0));
      }
    }
    if (rec.lv.textContent !== txt) rec.lv.textContent = txt;
  }

  function refresh() {
    for (var i = 0; i < cells.length; i++) {
      var rec = cells[i];
      if (!rec.el.isConnected) continue;
      if (!rec.name) rec.name = findName(rec.el);
      refreshOne(rec);
    }
  }

  function apply(rec) {
    var stats = mode === "stats";
    rec.ov.classList.toggle("arsn-on", stats);
    setVis(rec.label, stats);
    setVis(rec.value, stats);
  }

  /* 接管一个单元格：kind = "up"（原总上传） / "down"（原总下载） */
  function ensure(cell, kind) {
    if (!cell || cell.nodeType !== 1) return;
    var label = cell.children[0];
    var value = cell.children[1];
    if (!label || label.tagName !== "P") return;
    if (!value || value.tagName !== "DIV") return;

    var rec = cell.__arsnRec;
    if (rec) {
      rec.label = label;
      rec.value = value;
      if (rec.ov.parentNode !== cell) cell.appendChild(rec.ov);
      apply(rec);
      return;
    }

    var tx = pickText(label.textContent || "");

    var ov = document.createElement("div");
    ov.className = "arsn-ov";
    ov.setAttribute("data-arsn", kind);

    var lp = document.createElement("p");
    lp.className = label.className;
    lp.textContent = kind === "up" ? tx.proc : tx.conn;

    var lv = document.createElement("div");
    lv.className = value.className;
    lv.textContent = "—";

    ov.appendChild(lp);
    ov.appendChild(lv);

    cell.classList.add("arsn-cell");
    cell.style.position = "relative";
    cell.appendChild(ov);

    rec = {
      el: cell,
      kind: kind,
      name: findName(cell),
      label: label,
      value: value,
      ov: ov,
      lp: lp,
      lv: lv
    };
    cell.__arsnRec = rec;
    cells.push(rec);

    apply(rec);
    refreshOne(rec);
  }

  function prune() {
    for (var i = cells.length - 1; i >= 0; i--) {
      if (!cells[i].el.isConnected) cells.splice(i, 1);
    }
  }

  function totalGrid(grid) {
    if (!grid || grid.children.length < 9) return false;
    var a = grid.children[7].querySelector("p");
    var b = grid.children[8].querySelector("p");
    if (!a || !b) return false;
    return /总上传|總上傳/.test((a.textContent || "").trim()) &&
           /总下载|總下載/.test((b.textContent || "").trim());
  }

  /* 把面板右上角原本的小人换成塔菲 */
  function swapMascot() {
    var imgs = document.querySelectorAll('img[src*="animated-man"], img.arsn-taffy');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.getAttribute("src") === TAFFY_SRC && img.__arsnTaffy) continue;
      img.__arsnTaffy = true;
      img.setAttribute("src", TAFFY_SRC);
      img.alt = "Taffy";
      img.classList.add("arsn-taffy");
    }
  }

  /* ===================== 季节 / 标题 / 气泡 ===================== */
  var ARSN_MEME_DEFAULTS = [
    "/arsn-assets/meme-1.webp",
    "/arsn-assets/meme-2.webp",
    "/arsn-assets/meme-3.webp",
    "/arsn-assets/meme-4.webp",
    "/arsn-assets/meme-5.webp"
  ];
  var ARSN_MEME_DATA = ARSN_MEME_DEFAULTS.slice();

  var BUBBLE_LINES = [
    "今天也要元气满满哦～",
    "服务器们都乖乖在线呢",
    "主人，记得喝水呀",
    "塔菲在看着你哦",
    "要不要摸摸头？",
    "流量又涨啦～",
    "别熬夜啦，早点睡",
    "嘿嘿，今天也很可爱",
    "网络很稳，放心啦",
    "又是被塔菲守护的一天",
    "本舰队状态良好，随时可以出击～",
    "今日的服务器也闪闪发光呢",
    "检测到一枚认真工作的主人！",
    "魔法少女塔菲，开始巡逻啦～",
    "把烦恼丢进回收站，今天也要开心",
    "这份稳定运行，是大家努力的证明哦",
    "塔菲的能量条正在缓慢充电中～",
    "愿你的网络像星光一样顺滑",
    "今日份的好运，已经偷偷加载完成",
    "发现可爱的访问者一名，请多关照～",
    "服务器没有迷路，全都在这里集合啦",
    "状态平稳，适合播放喜欢的歌",
    "秘密任务：让今天也顺利结束",
    "塔菲把安心送到你身边了～",
    "数据流像流星一样划过夜空呢",
    "今天也要和坏心情说拜拜",
    "哼哼，本站的守护结界很牢固",
    "欢迎回来，新的冒险已经准备好了",
    "你的专属看板娘正在值班中"
  ];

  /* 按时间段筛台词：熬夜那句只在 0:00–6:00 出现 */
  function bubblePool() {
    var h = new Date().getHours();
    var lateNight = h >= 0 && h < 6;
    var out = [];
    for (var i = 0; i < BUBBLE_LINES.length; i++) {
      var line = BUBBLE_LINES[i];
      if (line.indexOf("别熬夜") !== -1 && !lateNight) continue;
      out.push(line);
    }
    if (lateNight) out.push("这么晚还不睡，塔菲陪你～");
    return out;
  }

  function pickBubbleMeme() {
    if (!ARSN_MEME_DATA.length) return "";
    var item = ARSN_MEME_DATA[Math.floor(Math.random() * ARSN_MEME_DATA.length)];
    return item;
  }

  function shouldShowBubbleMeme() {
    /* 表情是点缀，告警和大多数播报继续使用文字。 */
    return ARSN_MEME_DATA.length > 0 && Math.random() < 0.08;
  }

  var POKE_LINES = [
    "再点一下？就一下",
    "呀！被发现了～",
    "戳我干嘛啦",
    "嘿嘿，好痒～",
    "塔菲要生气咯（假的）",
    "别戳啦，会坏的～",
    "主人今天也很闲呢",
    "再戳就咬你哦"
  ];

  /* ===================== 天气 & 实时播报 ===================== */
  var WEATHER_API = "https://api.xunjinlu.fun/api/weather/v3.php";
  var XUN_API_KEY = "";
  var IP_API = "https://net.arsn.cn/api/ip";
  var weatherInfo = null;
  var weatherAt = 0;
  var weatherCity = "";          // 定位失败就不显示城市名，不编造
  var weatherCoords = null;
  var xunOk = null;              // 天气接口是否可读（CORS 不合规时走备用）
  var bubbleEl = null;
  var lastBroadcast = "";
  var alertAt = Object.create(null); // 告警冷却：同一件事 10 分钟内只播一次
  var ALERT_COOLDOWN = 10 * 60 * 1000;
  var ALERT_GAP = 3 * 60 * 1000;   // 两条告警之间至少隔 3 分钟
  var lastAlertAt = 0;

  function parseXunWeather(j) {
    var loc = j.data.location || {};
    var w = j.data.weather || {};
    var obs = (w.observe && w.observe[0]) || {};
    var day = w.night || w.day || {};
    return {
      city: (loc.city_name || "").split(",").pop() || weatherCity,
      temp: obs.temp || day.temp || "",
      cond: day.weather || "",
      humidity: obs.humidity || "",
      rain: Number(obs.rain || 0) > 0
    };
  }

  function wmoText(code) {
    code = Number(code);
    if (code === 0) return "晴";
    if (code <= 3) return "多云";
    if (code === 45 || code === 48) return "有雾";
    if (code >= 51 && code <= 57) return "毛毛雨";
    if (code >= 61 && code <= 67) return "下雨";
    if (code >= 71 && code <= 77) return "下雪";
    if (code >= 80 && code <= 82) return "阵雨";
    if (code >= 85 && code <= 86) return "阵雪";
    if (code >= 95) return "雷雨";
    return "";
  }

  /* 访问者 IP 定位：net.arsn.cn 取中文城市名，ipwho.is 取经纬度 */
  function fetchLocation() {
    var cityP = fetch(IP_API, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (disposed) return;
        var d = j && j.data;
        var regs = (d && (d.regions_short || d.regions)) || [];
        var c = regs.length > 1 ? regs[1] : (regs[0] || "");
        c = String(c).replace(/市$/, "").trim();
        if (c) weatherCity = c;
      })
      .catch(function () {});

    var coordP = fetch("https://ipwho.is/", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (g) {
        if (disposed) return;
        if (g && g.success !== false && typeof g.latitude === "number" && typeof g.longitude === "number") {
          weatherCoords = { lat: g.latitude, lon: g.longitude };
        }
      })
      .catch(function () {});

    return Promise.all([cityP, coordP]);
  }

  /* 备用天气：Open-Meteo（用定位到的经纬度） */
  function fetchOpenMeteo(city) {
    if (disposed || !weatherCoords) return;
    fetch("https://api.open-meteo.com/v1/forecast?latitude=" + weatherCoords.lat + "&longitude=" + weatherCoords.lon + "&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FShanghai", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (disposed) return;
        var cur = j && j.current;
        if (!cur) return;
        weatherInfo = {
          city: city,
          temp: Math.round(cur.temperature_2m),
          cond: wmoText(cur.weather_code),
          humidity: Math.round(cur.relative_humidity_2m),
          rain: false
        };
      })
      .catch(function () {});
  }

  function fetchWeather() {
    if (disposed) return;
    if (Date.now() - weatherAt < 30 * 60 * 1000) return;
    weatherAt = Date.now();

    fetchLocation().then(function () {
      if (disposed) return;
      var city = weatherCity;
      if (xunOk === false || !city) return fetchOpenMeteo(city);

      var ctrl = null;
      try { ctrl = new AbortController(); } catch (e) {}
      var opts = { cache: "no-store" };
      if (ctrl) opts.signal = ctrl.signal;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 2500);

      var weatherUrl = WEATHER_API + "?cityname=" + encodeURIComponent(city);
      if (XUN_API_KEY) weatherUrl += "&key=" + encodeURIComponent(XUN_API_KEY);
      return fetch(weatherUrl, opts)
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (disposed) return;
          if (!j || j.code !== 200 || !j.data) throw new Error("bad");
          xunOk = true;
          weatherInfo = parseXunWeather(j);
        })
        .catch(function () {
          if (disposed) return;
          xunOk = false;
          fetchOpenMeteo(city);
        })
        .then(function () { clearTimeout(timer); });
    });
  }

  function weatherLine() {
    if (!weatherInfo) return "";
    var s = (weatherInfo.city ? weatherInfo.city + "现在 " : "现在 ") + weatherInfo.temp + "°C";
    if (weatherInfo.cond) s += "，" + weatherInfo.cond;
    if (weatherInfo.humidity) s += "，湿度 " + weatherInfo.humidity + "%";
    if (weatherInfo.rain) s += "，记得带伞哦";
    return s + "～";
  }

  function speedText(bps) {
    if (!bps || bps <= 0) return "0 KB/s";
    if (bps >= 1024 * 1024) return (bps / 1024 / 1024).toFixed(1) + " MB/s";
    return (bps / 1024).toFixed(0) + " KB/s";
  }

  function pickDifferent(arr) {
    if (!arr.length) return "";
    var pool = [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i] !== lastBroadcast) pool.push(arr[i]);
    }
    if (!pool.length) pool = arr;
    var line = pool[Math.floor(Math.random() * pool.length)];
    lastBroadcast = line;
    return line;
  }

  function shortName(n) {
    n = String(n || "");
    return n.length > 10 ? n.slice(0, 10) + "…" : n;
  }

  function pickBroadcast() {
    var list = [];
    for (var k in servers) {
      if (Object.prototype.hasOwnProperty.call(servers, k)) list.push(servers[k]);
    }

    /* 游客看不到服务器：只聊天气和日常，不播报服务器状态 */
    if (!hasServerData || !list.length) {
      var quiet = [];
      if (weatherInfo) quiet.push(weatherLine());
      var dayLines = bubblePool();
      for (var b = 0; b < dayLines.length; b++) quiet.push(dayLines[b]);
      return pickDifferent(quiet);
    }

    var alerts = [];
    var offline = [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i].online) offline.push(list[i]);
    }
    if (offline.length) {
      var names = [];
      for (var j = 0; j < offline.length && j < 2; j++) names.push(shortName(offline[j].name));
      var offKey = "off:" + offline.map(function (s) { return s.name; }).sort().join("|");
      alerts.push({ key: offKey, text: "掉线 " + offline.length + " 台：" + names.join("、") + (offline.length > 2 ? " 等" : "") });
    }

    function topBy(key) {
      var best = null;
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s.online) continue;
        if (!best || s[key] > best[key]) best = s;
      }
      return best;
    }

    var hotCpu = topBy("cpu");
    if (hotCpu && hotCpu.cpu >= 85) {
      alerts.push({ key: "cpu:" + hotCpu.name, text: "CPU 告急：" + shortName(hotCpu.name) + " " + hotCpu.cpu.toFixed(0) + "%" });
    }
    var hotMem = topBy("mem");
    if (hotMem && hotMem.mem >= 90) {
      alerts.push({ key: "mem:" + hotMem.name, text: "内存吃紧：" + shortName(hotMem.name) + " " + hotMem.mem.toFixed(0) + "%" });
    }
    var hotDisk = topBy("disk");
    if (hotDisk && hotDisk.disk >= 90) {
      alerts.push({ key: "disk:" + hotDisk.name, text: "硬盘告急：" + shortName(hotDisk.name) + " " + hotDisk.disk.toFixed(0) + "%" });
    }
    var fast = topBy("down");
    if (fast && fast.down >= 8 * 1024 * 1024) {
      alerts.push({ key: "speed:" + fast.name, text: shortName(fast.name) + " 网速 " + speedText(fast.down) + " ↓" });
    }

    /* 告警冷却：同一台机器同一类问题，10 分钟内只播报一次 */
    var now = Date.now();
    var activeKeys = Object.create(null);
    for (var q = 0; q < alerts.length; q++) activeKeys[alerts[q].key] = 1;
    for (var ak in alertAt) {
      if (!activeKeys[ak]) delete alertAt[ak]; // 问题恢复后重置冷却
    }
    var fresh = [];
    for (var ai = 0; ai < alerts.length; ai++) {
      var a = alerts[ai];
      if (!alertAt[a.key] || now - alertAt[a.key] >= ALERT_COOLDOWN) fresh.push(a);
    }
    if (fresh.length && now - lastAlertAt >= ALERT_GAP) {
      var picked = fresh[Math.floor(Math.random() * fresh.length)];
      alertAt[picked.key] = now;
      lastAlertAt = now;
      return picked.text;
    }

    var pool = [];
    if (weatherInfo) pool.push(weatherLine());
    var top = topBy("cpu");
    if (top) pool.push("CPU 最高：" + shortName(top.name) + " " + top.cpu.toFixed(0) + "%");
    var busy = topBy("down");
    if (busy && busy.down > 0) pool.push("下载最快：" + shortName(busy.name) + " " + speedText(busy.down));

    /* 日常台词：有天气时占 1/4；天气取不到时补到 2/4，避免气泡太干 */
    var chat = bubblePool();
    if (chat.length) {
      if (weatherInfo) {
        pool.push(chat[Math.floor(Math.random() * chat.length)]);
      } else {
        var i1 = Math.floor(Math.random() * chat.length);
        pool.push(chat[i1]);
        if (chat.length > 1) {
          var i2 = (i1 + 1 + Math.floor(Math.random() * (chat.length - 1))) % chat.length;
          pool.push(chat[i2]);
        }
      }
    }
    if (!pool.length) pool = bubblePool();
    return pickDifferent(pool);
  }

  function sayBroadcast() {
    if (disposed) return;
    if (!bubbleEl || !bubbleEl.isConnected || !bubbleEl.__arsnSay) return;
    if (shouldShowBubbleMeme()) bubbleEl.__arsnSay({ image: pickBubbleMeme() }, 7000);
    else bubbleEl.__arsnSay(pickBroadcast(), 7000);
  }

  function currentSeason() {
    var m = new Date().getMonth();
    if (m >= 2 && m <= 4) return "spring";
    if (m >= 5 && m <= 7) return "summer";
    if (m >= 8 && m <= 10) return "autumn";
    return "winter";
  }

  /* 按季节生成飘落粒子（春樱 / 夏萤 / 秋叶 / 冬雪） */
  function ensureWeather() {
    var season = currentSeason();
    var root = document.documentElement;
    var all = ["spring", "summer", "autumn", "winter"];
    for (var i = 0; i < all.length; i++) {
      root.classList.toggle("arsn-season-" + all[i], all[i] === season);
    }

    var box = document.querySelector(".arsn-weather");
    if (box && box.getAttribute("data-season") === season) return;
    if (box && box.parentNode) box.parentNode.removeChild(box);

    box = document.createElement("div");
    box.className = "arsn-weather";
    box.setAttribute("data-season", season);
    box.setAttribute("aria-hidden", "true");
    var count = season === "summer" ? 10 : 16;
    for (var j = 0; j < count; j++) {
      var p = document.createElement("i");
      p.className = "arsn-" + season;
      p.style.left = (Math.random() * 100).toFixed(2) + "vw";
      var dur = (season === "summer" ? 9 + Math.random() * 7 : 10 + Math.random() * 10).toFixed(1);
      p.style.animationDuration = dur + "s";
      p.style.animationDelay = (-Math.random() * parseFloat(dur)).toFixed(1) + "s";
      box.appendChild(p);
    }
    document.body.appendChild(box);
  }

  /* 服务器分布地图：补玻璃底，避免直接压在壁纸上 */
  function ensureMapCard() {
    var secs = document.querySelectorAll("section.mt-8");
    for (var i = 0; i < secs.length; i++) {
      var s = secs[i];
      if (s.querySelector("div.overflow-x-auto svg") && !s.classList.contains("arsn-map-card")) {
        s.classList.add("arsn-map-card");
      }
    }
  }

  /* 「概览」标题渐变 + 星星 */
  function ensureTitle() {
    var ps = document.querySelectorAll("p");
    for (var i = 0; i < ps.length; i++) {
      var el = ps[i];
      var txt = (el.textContent || "").trim();
      var cls = el.className || "";
      if (txt.length <= 8 && txt.indexOf("概览") !== -1 && cls.indexOf("font-semibold") !== -1) {
        el.classList.add("arsn-title");
        var icon = el.querySelector(".arsn-title-icon");
        if (!icon) {
          el.innerHTML = '<img class="arsn-title-icon" alt="">概览';
          icon = el.querySelector(".arsn-title-icon");
        }
        if (icon && icon.getAttribute("src") !== TITLE_ICON) icon.setAttribute("src", TITLE_ICON);
        el.setAttribute("data-arsn-ready", "1");
        return;
      }
    }
  }

  /* ===================== 排序下拉：自定义菜单 ===================== */
  var sortMenu = null;
  var sortMenuFor = null;
  var sortMenuAt = 0;
  var sortDocTimer = 0;
  var serverSort = "";
  var sortObservedLists = [];
  var sortApplyTimers = [];

  function queueSortApply(delay) {
    var timer = setTimeout(function () {
      applyServerSort();
      var index = sortApplyTimers.indexOf(timer);
      if (index >= 0) sortApplyTimers.splice(index, 1);
    }, delay);
    sortApplyTimers.push(timer);
  }

  function closeSortMenu() {
    clearTimeout(sortDocTimer);
    sortDocTimer = 0;
    if (sortMenu && sortMenu.parentNode) sortMenu.parentNode.removeChild(sortMenu);
    sortMenu = null;
    sortMenuFor = null;
    document.removeEventListener("click", onSortDocClick);
  }

  function onSortDocClick(e) {
    if (!sortMenu) return;
    if (Date.now() - sortMenuAt < 300) return;                 // 刚打开的这一下不算“点外面”
    if (sortMenu.contains(e.target)) return;                    // 点在菜单里
    if (sortMenuFor && (sortMenuFor === e.target || sortMenuFor.contains(e.target))) return; // 点在触发器上
    closeSortMenu();
  }

  function openSortMenu(sel) {
    if (sortMenuFor === sel) { closeSortMenu(); return; }
    closeSortMenu();

    var menu = document.createElement("div");
    menu.className = "arsn-sort-menu";
    for (var i = 0; i < sel.options.length; i++) {
      (function (opt) {
        if (opt.getAttribute("data-arsn-custom") || opt.value.indexOf("__arsn_") === 0) return; /* 跳过内部占位项，避免菜单重复 */
        var item = document.createElement("button");
        item.type = "button";
        item.className = "arsn-sort-item" + (opt.selected && !serverSort ? " is-active" : "");
        item.textContent = opt.textContent;
        item.addEventListener("click", function (ev) {
          ev.stopPropagation();
          setServerSort("");
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          closeSortMenu();
        });
        menu.appendChild(item);
      })(sel.options[i]);
    }

    [{ key: "process", label: "进程数" }, { key: "conn", label: "连接数" }].forEach(function (extra) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "arsn-sort-item" + (serverSort === extra.key ? " is-active" : "");
      item.textContent = extra.label;
      item.addEventListener("click", function (ev) {
        ev.stopPropagation();
        setServerSort(extra.key);
        closeSortMenu();
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    var r = sel.getBoundingClientRect();
    var w = Math.max(160, r.width);
    menu.style.minWidth = w + "px";
    var mh = menu.offsetHeight;
    var left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8));
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = left + "px";
    menu.style.top = top + "px";

    sortMenu = menu;
    sortMenuFor = sel;
    sortMenuAt = Date.now();
    clearTimeout(sortDocTimer);
    sortDocTimer = setTimeout(function () {
      sortDocTimer = 0;
      document.addEventListener("click", onSortDocClick);
    }, 0);
  }

  function findServerState(obj, depth) {
    if (!obj || typeof obj !== "object" || depth > 3) return null;
    if (obj.state && ("process_count" in obj.state || "tcp_conn_count" in obj.state)) {
      return obj.state;
    }
    for (var k in obj) {
      if (k === "children" || k === "state") continue;
      var v = obj[k];
      if (v && typeof v === "object") {
        var found = findServerState(v, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function serverSortValue(card, field) {
    var val = 0;
    /* 1) 直接读卡片上的进程数/连接数覆盖层，最稳 */
    try {
      var sel = field === "process_count" ? '.arsn-ov[data-arsn="up"]' : '.arsn-ov[data-arsn="down"]';
      var el = card.querySelector(sel);
      if (el) {
        var m = el.textContent.match(/(\d+(?:\.\d+)?)/);
        if (m) val = parseFloat(m[1]) || 0;
      }
    } catch (e) {}
    /* 2) React 内部数据兜底 */
    if (!val) {
      try {
        var key = Object.keys(card).filter(function (k) { return k.indexOf("__reactFiber$") === 0; })[0];
        if (key) {
          var fiber = card[key];
          for (var i = 0; i < 12 && fiber; i++) {
            var props = fiber.memoizedProps;
            if (props) {
              var st = findServerState(props, 0);
              if (st) { val = Number(st[field]) || 0; break; }
            }
            fiber = fiber.return;
          }
        }
      } catch (e) {}
    }
    /* 3) 文字兜底 */
    if (!val) {
      var txt = card.innerText || card.textContent || "";
      var label = field === "process_count" ? "(?:进程数|进程)" : "(?:连接数|连接)";
      var mm = txt.match(new RegExp(label + "\\s*[:：]?\\s*([\\d.,]+)"));
      if (!mm) mm = txt.match(new RegExp("([\\d.,]+)\\s*" + label));
      if (mm) val = parseFloat(mm[1].replace(/,/g, "")) || 0;
    }
    return val;
  }

  function serverCardContext() {
    /* 卡片视图：卡片是 .server-card-list 的直接子元素 */
    var grid = document.querySelector(".server-card-list");
    if (grid && grid.children.length >= 2) {
      return { list: grid, cards: Array.prototype.slice.call(grid.children) };
    }
    /* 表格视图：每张卡片被包在自己的 <section> 里，这些 section 才是同一父容器下的行 */
    var ovs = document.querySelectorAll('.arsn-ov[data-arsn]');
    var rows = [];
    for (var i = 0; i < ovs.length; i++) {
      var card = ovs[i].closest('div[class*="rounded-lg"][class*="cursor-pointer"]');
      var row = card ? card.parentElement : ovs[i].parentElement;
      if (row && rows.indexOf(row) === -1) rows.push(row);
    }
    if (rows.length >= 2 && rows[0].parentElement) {
      return { list: rows[0].parentElement, cards: rows };
    }
    return null;
  }

  var arsnSorting = false;

  function applyServerSort() {
    if (disposed) return;
    var ctx = serverCardContext();
    if (!ctx) return;
    var list = ctx.list;
    var cards = ctx.cards;

    if (!serverSort) {
      var marked = cards.filter(function (c) { return c.hasAttribute("data-arsn-orig"); });
      if (marked.length) {
        arsnSorting = true;
        cards.slice().sort(function (a, b) {
          return (parseInt(a.getAttribute("data-arsn-orig") || "0", 10)) - (parseInt(b.getAttribute("data-arsn-orig") || "0", 10));
        }).forEach(function (c) {
          c.removeAttribute("data-arsn-orig");
          list.appendChild(c);
        });
        arsnSorting = false;
      }
      return;
    }
    if (cards.length < 2) return;

    var field = serverSort === "process" ? "process_count" : "tcp_conn_count";
    var values = new Map();
    cards.forEach(function (card) { values.set(card, serverSortValue(card, field)); });

    var dirBtn = document.querySelector('button[aria-label="Toggle sort direction"]');
    var dirPath = dirBtn ? dirBtn.querySelector("svg path") : null;
    var dirD = dirPath ? (dirPath.getAttribute("d") || "") : "";
    var asc = dirD.indexOf("M10 17") !== -1;

    var sorted = cards.slice().sort(function (a, b) {
      var diff = (values.get(b) || 0) - (values.get(a) || 0);
      return asc ? -diff : diff;
    });

    /* cards 是按 DOM 顺序收集的，直接逐位比较即可 */
    var same = sorted.every(function (card, i) { return cards[i] === card; });
    if (!same) {
      arsnSorting = true;
      cards.forEach(function (c, i) {
        if (!c.hasAttribute("data-arsn-orig")) c.setAttribute("data-arsn-orig", String(i));
      });
      sorted.forEach(function (card) { list.appendChild(card); });
      arsnSorting = false;
    }
  }

  function applyServerSortDisplay() {
    var sel = document.querySelector('select[aria-label="Sort metric"]');
    if (!sel) return;
    var wrap = sel.parentElement;
    if (!wrap) return;
    var overlay = wrap.querySelector(".arsn-sort-current");

    if (!serverSort) {
      if (overlay) overlay.remove();
      sel.style.color = "";
      wrap.style.minWidth = "";
      var sizer = wrap.querySelector('span[aria-hidden="true"]');
      if (sizer && sel.selectedIndex >= 0) sizer.textContent = sel.options[sel.selectedIndex].textContent;
      var customs = sel.querySelectorAll("option[data-arsn-custom]");
      for (var c = 0; c < customs.length; c++) customs[c].remove();
      return;
    }

    var label = serverSort === "process" ? "进程数" : "连接数";
    var value = serverSort === "process" ? "process" : "conn";
    var hasOpt = false;
    for (var oi = 0; oi < sel.options.length; oi++) {
      if (sel.options[oi].value === value) { hasOpt = true; break; }
    }
    if (!hasOpt) {
      var opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      opt.setAttribute("data-arsn-custom", "1");
      sel.appendChild(opt);
    }
    if (sel.value !== value) {
      sel.value = value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (!overlay) {
      overlay = document.createElement("span");
      overlay.className = "arsn-sort-current";
      wrap.appendChild(overlay);
    }
    overlay.textContent = label;
    sel.style.color = "transparent";
    wrap.style.minWidth = "";
    var sizer = wrap.querySelector('span[aria-hidden="true"]');
    if (sizer) sizer.textContent = label;
  }

  function ensureServerSort() {
    if (!serverSort) return;
    applyServerSortDisplay();
    applyServerSort();

    var ctx = serverCardContext();
    if (ctx && ctx.list && !ctx.list.__arsnSortObs) {
      ctx.list.__arsnSortObs = new MutationObserver(function () {
        if (arsnSorting) return;
        requestAnimationFrame(applyServerSort);
      });
      ctx.list.__arsnSortObs.observe(ctx.list, { childList: true });
      sortObservedLists.push(ctx.list);
      queueSortApply(500);
    }

    var dirBtn = document.querySelector('button[aria-label="Toggle sort direction"]');
    if (dirBtn && !dirBtn.__arsnDirHooked) {
      dirBtn.__arsnDirHooked = true;
      dirBtn.__arsnDirHandler = function () {
        queueSortApply(60);
      };
      dirBtn.addEventListener("click", dirBtn.__arsnDirHandler);
    }
  }

  function setServerSort(metric) {
    serverSort = metric || "";
    try {
      if (serverSort) localStorage.setItem("arsn-server-sort", serverSort);
      else localStorage.removeItem("arsn-server-sort");
    } catch (e) {}
    applyServerSortDisplay();
    if (!serverSort) {
      for (var oi = sortObservedLists.length - 1; oi >= 0; oi--) {
        var observedList = sortObservedLists[oi];
        if (observedList && observedList.__arsnSortObs) observedList.__arsnSortObs.disconnect();
        if (observedList) delete observedList.__arsnSortObs;
        sortObservedLists.splice(oi, 1);
      }
      applyServerSort();
      return;
    }
    ensureServerSort();
  }


  function ensureSortMenu() {
    var sels = document.querySelectorAll('select[aria-label="Sort metric"]');
    for (var i = 0; i < sels.length; i++) {
      var sel = sels[i];
      if (sel.__arsnSortHandlers) continue;
      var sortDown = function (e) {
        e.preventDefault();
        openSortMenu(this);
      };
      var sortKey = function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openSortMenu(this);
        }
      };
      sel.__arsnSortHandlers = { down: sortDown, key: sortKey };
      sel.__arsnSort = true;
      sel.addEventListener("mousedown", sortDown);
      sel.addEventListener("keydown", sortKey);
    }
  }

  /* ===================== 顶部：换一张背景 ===================== */
  function ensureBgButton() {
    var btns = document.querySelectorAll("button");
    var online = null;
    for (var i = 0; i < btns.length; i++) {
      var txt = (btns[i].textContent || "").replace(/\s+/g, "");
      if (txt.indexOf("在线") !== -1 || txt.indexOf("Online") !== -1) { online = btns[i]; break; }
    }
    if (!online || !online.parentElement) return;

    var exist = document.querySelector(".arsn-bgbtn");
    if (exist && exist.isConnected && exist.parentElement === online.parentElement && exist.__arsnManaged) return;
    if (exist) exist.remove();

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "arsn-bgbtn";
    btn.__arsnManaged = true;
    btn.title = "换一张背景";
    btn.setAttribute("aria-label", "换一张背景");
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
    btn.__arsnBgHandler = function (e) {
      e.preventDefault();
      e.stopPropagation();
      var url = (window.ArsnThemeConfig && window.ArsnThemeConfig.backgroundApi) || "https://acg.yaohud.cn/dm/adaptive.php";
      url += (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
      var done = false;
      function apply() {
        if (done) return;
        done = true;
        document.documentElement.style.setProperty("--arsn-bg", 'url("' + url + '")');
        btn.classList.remove("is-loading");
      }
      btn.classList.add("is-loading");
      var im = new Image();
      im.onload = apply;
      im.onerror = function () { btn.classList.remove("is-loading"); };
      setTimeout(apply, 8000);
      im.src = url;
    };
    btn.addEventListener("click", btn.__arsnBgHandler);
    online.parentElement.insertBefore(btn, online);
  }

  /* ===================== 顶部品牌：去掉「| 哪吒监控」 ===================== */
  function ensureBrand() {
    var logo = document.querySelector(".header-logo");
    if (!logo) return;
    var brand = logo.parentElement;
    if (!brand) return;
    brand.classList.add("arsn-brand");
    var ps = brand.querySelectorAll("p");
    for (var i = 0; i < ps.length; i++) ps[i].style.display = "none";
    var divs = brand.querySelectorAll('[data-orientation="vertical"]');
    for (var j = 0; j < divs.length; j++) divs[j].style.display = "none";
  }

  /* ===================== 站点 logo / favicon ===================== */
  function setIcon(rel, sizes, href) {
    var links = document.querySelectorAll('link[rel="' + rel + '"]');
    var el = null;
    for (var i = 0; i < links.length; i++) {
      if (!sizes || links[i].getAttribute("sizes") === sizes) { el = links[i]; break; }
    }
    if (!el && links.length && !sizes) el = links[0];
    if (!el) {
      el = document.createElement("link");
      el.rel = rel;
      if (sizes) el.sizes = sizes;
      document.head.appendChild(el);
    }
    el.href = href;
    el.type = "image/png";
    if (sizes) el.sizes = sizes;
  }

  function ensureLogo() {
    var imgs = document.querySelectorAll('img[src*="apple-touch-icon"], .header-logo img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.getAttribute("src") !== LOGO_DATA) img.src = LOGO_DATA;
      img.removeAttribute("srcset");
      img.classList.add("arsn-logo");
    }
    setIcon("icon", "32x32", FAVICON_32);
    setIcon("icon", "16x16", FAVICON_16);
    setIcon("apple-touch-icon", "", LOGO_DATA);
  }

  /* 塔菲气泡：随机台词 + 点击互动 */
  function ensureBubble() {
    var img = document.querySelector("img.arsn-taffy");
    if (!img || !img.parentElement) return;
    /* 兼容旧版重复注入：旧实例只留下了布尔标记，没有可移除的处理器。 */
    if (img.__arsnPoke && !img.__arsnPokeHandler) {
      var freshImg = img.cloneNode(true);
      freshImg.__arsnTaffy = true;
      img.parentNode.replaceChild(freshImg, img);
      img = freshImg;
    }
    var parent = img.parentElement;
    var b = parent.querySelector(".arsn-bubble");
    if (!b) {
      b = document.createElement("div");
      b.className = "arsn-bubble";
      b.setAttribute("aria-hidden", "true");
      parent.appendChild(b);
    }

    var allBubbles = document.querySelectorAll(".arsn-bubble");
    for (var bi = 0; bi < allBubbles.length; bi++) {
      if (allBubbles[bi] !== b) allBubbles[bi].remove();
    }

    b.__arsnSay = function (text, ms) {
      b.classList.remove("arsn-media");
      b.style.removeProperty("top");
      b.style.removeProperty("bottom");
      while (b.firstChild) b.removeChild(b.firstChild);
      if (text && typeof text === "object" && text.image) {
        var meme = document.createElement("img");
        meme.alt = "塔菲表情";
        meme.loading = "eager";
        meme.onerror = function () { b.classList.remove("arsn-on"); };
        meme.src = text.image;
        b.classList.add("arsn-media");
        b.appendChild(meme);
      } else {
        b.textContent = String(text == null ? "" : text);
      }
      b.classList.add("arsn-on");
      clearTimeout(b.__arsnHide);
      b.__arsnHide = setTimeout(function () { b.classList.remove("arsn-on"); }, ms || 6200);
    };
    bubbleEl = b;

    if (!img.__arsnPoke) {
      img.__arsnPoke = true;
      img.__arsnPokeHandler = function (e) {
        e.preventDefault();
        e.stopPropagation();

        img.classList.remove("arsn-poke");
        void img.offsetWidth;
        img.classList.add("arsn-poke");
        setTimeout(function () { img.classList.remove("arsn-poke"); }, 700);

        var now = Date.now();
        if (!img.__arsnClickAt || now - img.__arsnClickAt > 3000) img.__arsnClickN = 0;
        img.__arsnClickAt = now;
        img.__arsnClickN = (img.__arsnClickN || 0) + 1;

        var line = img.__arsnClickN >= 5
          ? "别戳啦！真的要坏掉了！"
          : POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)];
        if (b.__arsnSay) b.__arsnSay(line, 5200);
      };
      img.addEventListener("click", img.__arsnPokeHandler);
    }
  }

  /* ===================== 服务监控轮播 ===================== */
  function serviceSection() {
    var list = document.querySelectorAll('section[class*="md:grid-cols-2"][class*="mt-4"]');
    for (var i = 0; i < list.length; i++) {
      if (list[i].classList.contains("server-card-list")) continue;
      if (list[i].querySelector('[class*="gap-[3px]"]')) return list[i];
    }
    return null;
  }

  function serviceCards(section) {
    var out = [];
    for (var i = 0; i < section.children.length; i++) {
      var el = section.children[i];
      if (el.classList && el.classList.contains("arsn-svc-dots")) continue;
      out.push(el);
    }
    return out;
  }

  function svcRender(rotate) {
    if (disposed) return;
    var section = serviceSection();
    if (!section) { svc.section = null; svc.count = -1; return; }

    if (section !== svc.section) {
      svc.section = section;
      svc.page = 0;
      svc.count = -1;
      if (!section.__arsnSvcHoverHandlers) {
        var svcEnter = function () { svc.paused = true; };
        var svcLeave = function () { svc.paused = false; };
        section.__arsnSvcHoverHandlers = { enter: svcEnter, leave: svcLeave };
        section.__arsnSvcHover = true;
        section.addEventListener("mouseenter", svcEnter);
        section.addEventListener("mouseleave", svcLeave);
      }
    }

    var cards = serviceCards(section);
    var pages = Math.max(1, Math.ceil(cards.length / CFG.svcPerPage));

    if (cards.length !== svc.count) {
      svc.count = cards.length;
      if (svc.page >= pages) svc.page = 0;
    }
    if (rotate && pages > 1 && !svc.paused) {
      svc.page = (svc.page + 1) % pages;
    }
    if (svc.page >= pages) svc.page = 0;

    var changed = false;
    for (var i = 0; i < cards.length; i++) {
      var show = Math.floor(i / CFG.svcPerPage) === svc.page;
      var v = show ? "" : "none";
      if (cards[i].style.display !== v) { cards[i].style.display = v; changed = true; }
    }

    var dots = section.querySelector(".arsn-svc-dots");
    if (pages <= 1) {
      if (dots && dots.parentNode) dots.parentNode.removeChild(dots);
    } else {
      if (!dots) {
        dots = document.createElement("div");
        dots.className = "arsn-svc-dots";
        section.appendChild(dots);
      }
      if (dots.children.length !== pages) {
        dots.innerHTML = "";
        for (var p = 0; p < pages; p++) {
          (function (idx) {
            var dot = document.createElement("span");
            dot.setAttribute("data-page", String(idx));
            dot.addEventListener("click", function () {
              svc.page = idx;
              svcRender(false);
            });
            dots.appendChild(dot);
          })(p);
        }
      }
      for (var q = 0; q < dots.children.length; q++) {
        dots.children[q].classList.toggle("arsn-on", q === svc.page);
      }
    }

    if (rotate && changed && pages > 1) {
      section.classList.remove("arsn-svc-anim");
      void section.offsetWidth;
      section.classList.add("arsn-svc-anim");
      clearTimeout(svcAnimTimer);
      svcAnimTimer = setTimeout(function () { section.classList.remove("arsn-svc-anim"); }, 700);
    }
  }

  function scan() {
    if (disposed) return;
    var grids = [];

    /* 首选：列表模式容器内的 9 列网格 */
    var lists = document.querySelectorAll(".server-inline-list");
    for (var i = 0; i < lists.length; i++) {
      var found = lists[i].querySelectorAll('[class*="grid-cols-9"]');
      for (var j = 0; j < found.length; j++) grids.push(found[j]);
    }

    /* 兜底：按“总上传 / 总下载”文字定位 */
    if (!grids.length) {
      var all = document.querySelectorAll('[class*="grid-cols-9"]');
      for (var k = 0; k < all.length; k++) {
        if (totalGrid(all[k])) grids.push(all[k]);
      }
    }

    for (var m = 0; m < grids.length; m++) {
      var g = grids[m];
      if (g.children.length < 9) continue;
      ensure(g.children[7], "up");
      ensure(g.children[8], "down");
    }

    prune();
    refresh();
    swapMascot();
    ensureTitle();
    ensureBubble();
    ensureSortMenu();
    ensureServerSort();
    ensureBgButton();
    ensureBrand();
    ensureLogo();
    ensureMapCard();
    ensureMusicButton();
    svcRender(false);
  }

  /* ===================== 切换与动画 ===================== */
  function bounce() {
    var live = [];
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].el.isConnected) live.push(cells[i].el);
    }
    if (!live.length) return;

    for (var j = 0; j < live.length; j++) live[j].classList.remove("arsn-flash");
    void document.body.offsetHeight; /* 强制重排，让动画每次都能重播 */
    for (var k = 0; k < live.length; k++) live[k].classList.add("arsn-flash");

    setTimeout(function () {
      for (var n = 0; n < live.length; n++) live[n].classList.remove("arsn-flash");
    }, 700);
  }

  function tick() {
    if (disposed) return;
    if (serverSort) { applyServerSortDisplay(); applyServerSort(); } /* 防止 React 重渲染把文字/顺序改回去 */
    if (!lastDataAt) return;          /* 还没拿到实时数据时保持原样 */
    if (!cells.length) scan();
    if (!cells.length) return;

    mode = (mode === "transfer") ? "stats" : "transfer";
    for (var i = 0; i < cells.length; i++) apply(cells[i]);
    bounce();
  }

  /* ===================== 生命周期 ===================== */
  function scheduleScan() {
    if (disposed) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  function isArsnOwnedNode(node) {
    if (!node || node.nodeType !== 1) return false;
    var cls = typeof node.className === "string" ? node.className : (node.getAttribute ? (node.getAttribute("class") || "") : "");
    return /(?:^|\s)arsn-[^\s]+/.test(cls);
  }

  function mutationNeedsScan(mutations) {
    for (var mi = 0; mi < mutations.length; mi++) {
      var m = mutations[mi];
      if (m.target && isArsnOwnedNode(m.target)) continue;
      var nodes = [];
      for (var ai = 0; ai < m.addedNodes.length; ai++) nodes.push(m.addedNodes[ai]);
      for (var ri = 0; ri < m.removedNodes.length; ri++) nodes.push(m.removedNodes[ri]);
      if (!nodes.length) return true;
      for (var ni = 0; ni < nodes.length; ni++) {
        if (nodes[ni].nodeType !== 1 || !isArsnOwnedNode(nodes[ni])) return true;
      }
    }
    return false;
  }

  function destroy() {
    disposed = true;
    clearGlobalEvents();
    try { mpClose(); } catch (e) {}
    mpCloseBar(true);
    clearInterval(tickTimer);
    clearInterval(sweepTimer);
    clearInterval(linkTimer);
    clearInterval(svcTimer);
    clearInterval(broadcastTimer);
    clearTimeout(tapTimer);
    clearTimeout(scanTimer);
    clearTimeout(svcAnimTimer);
    clearTimeout(broadcastStartTimer);
    broadcastStartTimer = 0;
    bubbleEl = null;
    closeSortMenu();

    var sortSelects = document.querySelectorAll('select[aria-label="Sort metric"]');
    for (var si = 0; si < sortSelects.length; si++) {
      var sortSel = sortSelects[si];
      var sortHandlers = sortSel.__arsnSortHandlers;
      if (sortHandlers) {
        sortSel.removeEventListener("mousedown", sortHandlers.down);
        sortSel.removeEventListener("keydown", sortHandlers.key);
      }
      delete sortSel.__arsnSortHandlers;
      delete sortSel.__arsnSort;
    }
    var dirBtns = document.querySelectorAll('button[aria-label="Toggle sort direction"]');
    for (var di = 0; di < dirBtns.length; di++) {
      var dir = dirBtns[di];
      if (dir.__arsnDirHandler) dir.removeEventListener("click", dir.__arsnDirHandler);
      delete dir.__arsnDirHandler;
      delete dir.__arsnDirHooked;
    }
    for (var so = 0; so < sortObservedLists.length; so++) {
      if (sortObservedLists[so].__arsnSortObs) sortObservedLists[so].__arsnSortObs.disconnect();
      delete sortObservedLists[so].__arsnSortObs;
    }
    sortObservedLists.length = 0;
    for (var sat = 0; sat < sortApplyTimers.length; sat++) clearTimeout(sortApplyTimers[sat]);
    sortApplyTimers.length = 0;
    var svcSec = serviceSection();
    if (svcSec) {
      var svcDots = svcSec.querySelector(".arsn-svc-dots");
      if (svcDots && svcDots.parentNode) svcDots.parentNode.removeChild(svcDots);
      svcSec.classList.remove("arsn-svc-anim");
      for (var s = 0; s < svcSec.children.length; s++) svcSec.children[s].style.display = "";
    }
    svc.section = null;
    svc.count = -1;
    var svcSections = document.querySelectorAll("section");
    for (var sh = 0; sh < svcSections.length; sh++) {
      var sec = svcSections[sh];
      var svcHandlers = sec.__arsnSvcHoverHandlers;
      if (svcHandlers) {
        sec.removeEventListener("mouseenter", svcHandlers.enter);
        sec.removeEventListener("mouseleave", svcHandlers.leave);
        delete sec.__arsnSvcHoverHandlers;
        delete sec.__arsnSvcHover;
      }
    }

    var taffyImgs = document.querySelectorAll("img.arsn-taffy");
    for (var ti = 0; ti < taffyImgs.length; ti++) {
      if (taffyImgs[ti].__arsnPokeHandler) {
        taffyImgs[ti].removeEventListener("click", taffyImgs[ti].__arsnPokeHandler);
        delete taffyImgs[ti].__arsnPokeHandler;
      }
      delete taffyImgs[ti].__arsnPoke;
    }
    var buttons = document.querySelectorAll(".arsn-bgbtn, .arsn-musicbtn");
    for (var bi = 0; bi < buttons.length; bi++) {
      var dynBtn = buttons[bi];
      if (dynBtn.__arsnBgHandler) dynBtn.removeEventListener("click", dynBtn.__arsnBgHandler);
      if (dynBtn.__arsnMusicHandler) dynBtn.removeEventListener("click", dynBtn.__arsnMusicHandler);
      var cover = dynBtn.querySelector(".arsn-musicbtn-cover");
      if (cover && dynBtn.__arsnMusicCoverHandler) cover.removeEventListener("error", dynBtn.__arsnMusicCoverHandler);
      if (dynBtn.parentNode) dynBtn.parentNode.removeChild(dynBtn);
    }

    var bb = document.querySelector(".arsn-bubble");
    if (bb) {
      clearInterval(bb.__arsnTimer);
      clearTimeout(bb.__arsnHide);
      if (bb.parentNode) bb.parentNode.removeChild(bb);
    }
    var weather = document.querySelector(".arsn-weather");
    if (weather && weather.parentNode) weather.parentNode.removeChild(weather);
    var title = document.querySelector(".arsn-title");
    if (title) title.classList.remove("arsn-title");
    var seasonCls = ["arsn-season-spring", "arsn-season-summer", "arsn-season-autumn", "arsn-season-winter"];
    for (var sc = 0; sc < seasonCls.length; sc++) {
      document.documentElement.classList.remove(seasonCls[sc]);
    }

    if (observer) { observer.disconnect(); observer = null; }

    if (mp.audio) {
      try { mp.audio.pause(); } catch (e) {}
      var mpHandlers = mp.audio.__arsnMpHandlers;
      if (mpHandlers) {
        mp.audio.removeEventListener("play", mpSyncButtons);
        mp.audio.removeEventListener("pause", mpSyncButtons);
        mp.audio.removeEventListener("timeupdate", mpOnTime);
        mp.audio.removeEventListener("ended", mpHandlers.ended);
        mp.audio.removeEventListener("error", mpHandlers.error);
        delete mp.audio.__arsnMpHandlers;
      }
      try { mp.audio.removeAttribute("src"); mp.audio.load(); } catch (e) {}
    }
    if (mp.ctx && mp.ctx.close) { try { mp.ctx.close(); } catch (e) {} }
    mp.audio = null;
    mp.ctx = null;
    mp.srcNode = null;
    mp.gainNode = null;

    for (var t = 0; t < tapped.length; t++) {
      try { tapped[t].removeEventListener("message", onMessage); } catch (e) {}
    }
    tapped.length = 0;
    tapSock = null;
    closeOwn();

    for (var i = 0; i < cells.length; i++) {
      var rec = cells[i];
      try {
        if (rec.ov.parentNode) rec.ov.parentNode.removeChild(rec.ov);
        setVis(rec.label, false);
        setVis(rec.value, false);
        rec.el.classList.remove("arsn-cell", "arsn-flash");
        delete rec.el.__arsnRec;
      } catch (e) {}
    }
    cells.length = 0;
  }

  /* ===================== 顶部音乐播放器 ===================== */
  /* 首选你自己的红云点歌接口；Meting 只作为兜底 */
  var MUSIC_API = "https://api.xunjinlu.fun/apis/wymusic";
  var MUSIC_PLAYLIST_ID = "443797814";
  var MUSIC_LEVEL = "standard";
  var MUSIC_METING = "https://api.injahow.cn/meting/";
  var MUSIC_FALLBACK = [
    { id: 3315623414, name: "昔涟", singer: "Hanser", picimg: "https://p2.music.126.net/ZFeuPsPp-P5aTuNicQL2aQ==/109951173914849262.jpg" },
    { id: 22707008, name: "潮鳴り", singer: "折戸伸治", picimg: "https://p1.music.126.net/kkkPkRGflxLurhhKBbCmPg==/109951171268737495.jpg" },
    { id: 2086091247, name: "你呀你呀", singer: "多多poi/刘照坤Jock", picimg: "https://p2.music.126.net/NsmUTBKzEogjK5_LCt82OQ==/109951168946555484.jpg" },
    { id: 426881503, name: "スパークル (movie ver.)", singer: "RADWIMPS", picimg: "https://p1.music.126.net/UoHin_i29CVJr4gKPEY1kQ==/109951171836647530.jpg" },
    { id: 1378491298, name: "愛にできることはまだあるかい", singer: "RADWIMPS", picimg: "https://p2.music.126.net/dRwInA9PpkiKkmNWeUvi0w==/109951164220136544.jpg" },
    { id: 426502173, name: "Stay Alive", singer: "", picimg: "" }
  ];

  var MP_ICONS = {
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6.5L20 4v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="15" r="2.5"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.6 5.7c0-1.2 1.3-1.9 2.3-1.3l9.2 6.3c1 .7 1 2.1 0 2.8l-9.2 6.3c-1 .7-2.3 0-2.3-1.3V5.7z"/></svg>',
    playSmall: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8 5 20 12 8 19"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3.6" height="14" rx="1.8"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.8"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6.4v11.2c0 1.1-1.2 1.7-2.1 1.1l-7.2-5.6a1.3 1.3 0 0 1 0-2.2l7.2-5.6c.9-.7 2.1-.1 2.1 1.1z"/><path d="M12.8 6.4v11.2c0 1.1-1.2 1.7-2.1 1.1L3.5 13.1a1.3 1.3 0 0 1 0-2.2l7.2-5.6c.9-.7 2.1-.1 2.1 1.1z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6.4v11.2c0 1.1 1.2 1.7 2.1 1.1l7.2-5.6a1.3 1.3 0 0 0 0-2.2L6.1 5.3C5.2 4.6 4 5.2 4 6.4z"/><path d="M11.2 6.4v11.2c0 1.1 1.2 1.7 2.1 1.1l7.2-5.6a1.3 1.3 0 0 0 0-2.2l-7.2-5.6c-.9-.7-2.1-.1-2.1 1.1z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.6-8.6c.8-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.5 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>',
    order: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 6 6 6-6 6"/><path d="m12 6 6 6-6 6"/></svg>',
    volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>'
  };

  var mp = {
    audio: null,
    btn: null,
    panel: null,
    ui: null,
    tracks: [],
    idx: -1,
    current: null,
    lyric: [],
    lyricEls: [],
    lyricAt: -1,
    listEls: [],
    history: [],
    mode: "shuffle",
    tab: "play",
    busy: false,
    loading: false,
    playlistVersion: 0,
    bar: null,
    barLine: "",
    lyricLoading: false,
    ctx: null,
    gainNode: null,
    srcNode: null,
    docBindTimer: 0
  };
  try {
    var savedMode = localStorage.getItem("arsn-music-mode");
    if (savedMode === "single" || savedMode === "shuffle" || savedMode === "order") mp.mode = savedMode;
  } catch (e) {}

  function mpFmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function mpStatus(text) {
    if (mp.ui && mp.ui.status) mp.ui.status.textContent = text || "";
  }

  function mpMeting(type, id) {
    return MUSIC_METING + "?server=netease&type=" + type + "&id=" + encodeURIComponent(id);
  }

  function mpXun(action, params) {
    var qs = "action=" + encodeURIComponent(action);
    if (XUN_API_KEY) qs += "&key=" + encodeURIComponent(XUN_API_KEY);
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k)) {
        qs += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
      }
    }
    return fetch(MUSIC_API + "?" + qs, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.code !== 0 || !j.data || j.data.code !== 200) {
          throw new Error((j && (j.msg || j.message)) || "接口返回异常");
        }
        return j.data.data;
      });
  }

  function mpParseLrc(lrc) {
    var out = [];
    var lines = String(lrc || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var text = line.replace(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g, "").trim();
      if (!text) continue;
      var re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
      var m;
      while ((m = re.exec(line))) {
        var t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        if (m[3]) t += parseInt(m[3], 10) / Math.pow(10, m[3].length);
        out.push({ t: t, text: text });
      }
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  function mpAudio() {
    if (mp.audio) return mp.audio;
    var a = new Audio();
    a.preload = "none";
    a.crossOrigin = "anonymous"; /* 走 Web Audio 增益需要 CORS */
    var vol = NaN;
    try { vol = parseFloat(localStorage.getItem("arsn-music-vol")); } catch (e) {}
    a.volume = isNaN(vol) ? 0.7 : Math.min(1, Math.max(0, vol));
    var endedHandler = function () { mpNext(true); };
    var errorHandler = function () {
      if (a.src) mpStatus("播放出错，换一首试试");
    };
    a.addEventListener("play", mpSyncButtons);
    a.addEventListener("pause", mpSyncButtons);
    a.addEventListener("timeupdate", mpOnTime);
    a.addEventListener("ended", endedHandler);
    a.addEventListener("error", errorHandler);
    a.__arsnMpHandlers = { ended: endedHandler, error: errorHandler };
    mp.audio = a;
    mpInitGraph();
    return a;
  }

  function mpInitGraph() {
    if (mp.ctx || !mp.audio) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      mp.ctx = new AC();
      mp.srcNode = mp.ctx.createMediaElementSource(mp.audio);
      mp.gainNode = mp.ctx.createGain();
      mp.gainNode.gain.value = 1.8; /* 最多 180% 音量，解决源本身偏小 */
      mp.srcNode.connect(mp.gainNode);
      mp.gainNode.connect(mp.ctx.destination);
    } catch (e) {
      mp.ctx = null;
      mp.gainNode = null;
      mp.srcNode = null;
    }
  }

  function mpResumeGraph() {
    if (mp.ctx && mp.ctx.state === "suspended") {
      mp.ctx.resume().catch(function () {});
    }
  }

  function mpSyncButtons() {
    var a = mp.audio;
    var playing = !!(a && !a.paused);
    if (mp.btn) {
      mp.btn.classList.toggle("is-playing", playing);
      var t = mp.tracks[mp.idx] || {};
      var info = (mp.current && mp.current.info) || {};
      var pic = info.picimg || t.picimg || "";
      var img = mp.btn.querySelector(".arsn-musicbtn-cover");
      if (pic) {
        if (img && img.getAttribute("src") !== pic) img.src = pic;
        mp.btn.classList.add("has-cover");
      } else {
        mp.btn.classList.remove("has-cover");
      }
    }
    if (mp.ui && mp.ui.play) mp.ui.play.innerHTML = playing ? MP_ICONS.pause : MP_ICONS.play;
  }

  function mpOnTime() {
    var a = mp.audio;
    if (!a) return;
    var d = a.duration || 0;
    if (mp.ui) {
      if (mp.ui.bar) mp.ui.bar.style.width = (d ? Math.min(100, a.currentTime / d * 100) : 0) + "%";
      if (mp.ui.cur) mp.ui.cur.textContent = mpFmt(a.currentTime);
      if (mp.ui.dur) mp.ui.dur.textContent = d ? mpFmt(d) : "0:00";
    }
    mpSyncLyric(a.currentTime);
    mpSyncBar();
  }

  function mpSyncLyric(t, force) {
    if (!mp.lyric.length || !mp.ui || !mp.ui.lyrics) return;
    var idx = -1;
    for (var i = 0; i < mp.lyric.length; i++) {
      if (mp.lyric[i].t <= t + 0.2) idx = i;
      else break;
    }
    if (idx === mp.lyricAt && !force) return;
    mp.lyricAt = idx;
    for (var j = 0; j < mp.lyricEls.length; j++) {
      mp.lyricEls[j].classList.toggle("is-active", j === idx);
    }
    var el = mp.lyricEls[idx];
    if (el) {
      var box = mp.ui.lyrics;
      var top = el.offsetTop - box.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
      box.scrollTo({ top: Math.max(0, top), behavior: force ? "auto" : "smooth" });
    }
  }

  function mpSyncBar() {
    if (!mp.bar || !mp.bar.isConnected) return;
    var t = mp.tracks[mp.idx] || {};
    var info = (mp.current && mp.current.info) || {};
    var name = info.name || t.name || "未播放";
    var singer = info.singer || t.singer || "";
    var title = name + (singer ? " - " + singer : "");
    var cover = info.picimg || t.picimg || "";
    var elTitle = mp.bar.querySelector(".arsn-lyricbar-title");
    var elLine = mp.bar.querySelector(".arsn-lyricbar-line");
    var elCover = mp.bar.querySelector(".arsn-lyricbar-cover");
    if (elTitle) elTitle.textContent = title;
    if (elCover) {
      if (cover) {
        if (elCover.getAttribute("src") !== cover) elCover.src = cover;
        elCover.style.visibility = "visible";
      } else {
        elCover.removeAttribute("src");
        elCover.style.visibility = "hidden";
      }
    }

    var line = "";
    var a = mp.audio;
    if (a && a.src) {
      if (mp.lyric.length) {
        var cur = a.currentTime || 0;
        var idx = -1;
        for (var i = 0; i < mp.lyric.length; i++) {
          if (mp.lyric[i].t <= cur + 0.2) idx = i;
          else break;
        }
        if (idx >= 0) line = mp.lyric[idx].text;
        else line = mp.lyric[0].text; /* 前奏阶段先显示第一句 */
      }
      if (!line) line = "纯音乐 / 暂无歌词";
    } else {
      line = "还没有播放歌曲";
    }

    if (line !== mp.barLine) {
      mp.barLine = line;
      if (elLine) {
        elLine.classList.add("is-fade");
        setTimeout(function () {
          if (!mp.bar || mp.barLine !== line) return;
          elLine.textContent = line;
          elLine.classList.remove("is-fade");
        }, 120);
      }
    }
  }

  function mpEnsureBar() {
    if (mp.bar && mp.bar.isConnected) return mp.bar;
    var el = document.createElement("div");
    el.className = "arsn-lyricbar";
    el.innerHTML = '<img class="arsn-lyricbar-cover" alt="">' +
      '<div class="arsn-lyricbar-meta">' +
        '<div class="arsn-lyricbar-title"></div>' +
        '<div class="arsn-lyricbar-line"></div>' +
      '</div>' +
      '<button type="button" class="arsn-lyricbar-close" title="关闭">×</button>';
    document.body.appendChild(el);
    mp.bar = el;
    mp.barLine = "";
    el.querySelector(".arsn-lyricbar-cover").addEventListener("error", function () {
      this.style.visibility = "hidden";
    });
    el.querySelector(".arsn-lyricbar-close").addEventListener("click", function (ev) {
      ev.stopPropagation();
      mpCloseBar();
    });
    el.addEventListener("click", function (ev) {
      if (ev.target.closest(".arsn-lyricbar-close")) return;
      mpOpen();
    });
    return el;
  }

  function mpSaveBarState(open) {
    try { localStorage.setItem("arsn-lyricbar-open", open ? "1" : "0"); } catch (e) {}
  }

  function mpCloseBar(keepState) {
    if (mp.bar && mp.bar.parentNode) mp.bar.parentNode.removeChild(mp.bar);
    mp.bar = null;
    mp.barLine = "";
    if (!keepState) mpSaveBarState(false);
    if (mp.ui && mp.ui.lyrbtn) mp.ui.lyrbtn.classList.remove("is-on");
  }

  function mpToggleBar() {
    if (mp.bar && mp.bar.isConnected) { mpCloseBar(); return; }
    mpEnsureBar();
    mpSyncBar();
    mpSaveBarState(true);
    if (mp.ui && mp.ui.lyrbtn) mp.ui.lyrbtn.classList.add("is-on");
  }

  function mpRestoreBar() {
    var saved = "";
    try { saved = localStorage.getItem("arsn-lyricbar-open") || ""; } catch (e) {}
    if (saved === "1" && !(mp.bar && mp.bar.isConnected)) {
      mpEnsureBar();
      mpSyncBar();
      if (mp.ui && mp.ui.lyrbtn) mp.ui.lyrbtn.classList.add("is-on");
    }
  }

  function mpUpdateLyricEmpty() {
    if (!mp.ui || !mp.ui.lyrics || mp.lyric.length) return;
    var em = mp.ui.lyrics.querySelector(".arsn-music-empty");
    if (!em) return;
    em.textContent = mp.lyricLoading ? "暂无歌词" : ((mp.audio && mp.audio.src) ? "纯音乐 / 暂无歌词" : "暂无歌词");
  }

  function mpRenderLyrics() {
    if (!mp.ui || !mp.ui.lyrics) return;
    var box = mp.ui.lyrics;
    box.innerHTML = "";
    box.classList.toggle("is-empty", !mp.lyric.length);
    mp.lyricEls = [];
    mp.lyricAt = -1;
    if (!mp.lyric.length) {
      var empty = document.createElement("div");
      empty.className = "arsn-music-empty";
      empty.textContent = mp.lyricLoading ? "暂无歌词" : ((mp.audio && mp.audio.src) ? "纯音乐 / 暂无歌词" : "暂无歌词");
      box.appendChild(empty);
      return;
    }
    for (var i = 0; i < mp.lyric.length; i++) {
      (function (i) {
        var el = document.createElement("div");
        el.className = "arsn-music-lyric-line";
        el.textContent = mp.lyric[i].text;
        el.addEventListener("click", function () {
          var a = mpAudio();
          if (a && a.duration) a.currentTime = mp.lyric[i].t;
        });
        box.appendChild(el);
        mp.lyricEls.push(el);
      })(i);
    }
    var totalH = 0;
    for (var k = 0; k < mp.lyricEls.length; k++) totalH += mp.lyricEls[k].offsetHeight;
    /* 内容短到一屏放得下时，居中显示，不出现滚动条 */
    box.classList.toggle("is-short", totalH > 0 && totalH <= box.clientHeight - 8);
    mpSyncLyric(mp.audio ? mp.audio.currentTime : 0, true);
    mpSyncBar();
  }

  function mpRenderNow() {
    if (!mp.ui) return;
    var t = mp.tracks[mp.idx] || {};
    var info = (mp.current && mp.current.info) || {};
    var name = info.name || t.name || "未播放";
    var singer = info.singer || t.singer || "ArsnProbe";
    if (mp.ui.title) mp.ui.title.textContent = name;
    if (mp.ui.artist) mp.ui.artist.textContent = singer;
    if (mp.ui.cover) {
      var pic = info.picimg || t.picimg || "";
      if (pic) {
        mp.ui.cover.src = pic;
        mp.ui.cover.style.visibility = "visible";
      } else {
        mp.ui.cover.removeAttribute("src");
        mp.ui.cover.style.visibility = "hidden";
      }
    }
    mpSyncBar();
  }

  function mpRenderList() {
    if (!mp.ui || !mp.ui.list) return;
    var box = mp.ui.list;
    if (!mp.tracks.length) {
      box.innerHTML = '<div class="arsn-music-empty">歌单还没加载</div>';
      mp.listEls = [];
      return;
    }
    box.innerHTML = "";
    mp.listEls = [];
    for (var i = 0; i < mp.tracks.length; i++) {
      (function (i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "arsn-music-item" + (i === mp.idx ? " is-active" : "");
        b.textContent = (i + 1) + ". " + mp.tracks[i].name + (mp.tracks[i].singer ? " - " + mp.tracks[i].singer : "");
        b.addEventListener("click", function (ev) { ev.stopPropagation(); mpPlayIdx(i); });
        box.appendChild(b);
        mp.listEls.push(b);
      })(i);
    }
    var act = mp.listEls[mp.idx];
    if (act) {
      var top = act.offsetTop - box.offsetTop - box.clientHeight / 2 + act.clientHeight / 2;
      box.scrollTop = Math.max(0, top);
    }
  }

  function mpSetTab(tab) {
    mp.tab = tab;
    if (!mp.ui) return;
    var tabs = mp.ui.tabs || [];
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("is-active", tabs[i].getAttribute("data-tab") === tab);
    var views = mp.ui.views || [];
    for (var j = 0; j < views.length; j++) views[j].classList.toggle("is-active", views[j].getAttribute("data-view") === tab);
    if (tab === "lyric") mpSyncLyric(mp.audio ? mp.audio.currentTime : 0, true);
  }

  function mpSetMode(mode) {
    mp.mode = mode;
    try { localStorage.setItem("arsn-music-mode", mode); } catch (e) {}
    if (mp.ui && mp.ui.mode) {
      var icons = { shuffle: MP_ICONS.shuffle, single: MP_ICONS.repeat, order: MP_ICONS.order };
      var titles = {
        shuffle: "随机播放（点击切换单曲循环）",
        single: "单曲循环（点击切换顺序播放）",
        order: "顺序播放（点击切换随机播放）"
      };
      mp.ui.mode.innerHTML = icons[mode] || MP_ICONS.shuffle;
      mp.ui.mode.title = titles[mode] || titles.shuffle;
    }
  }

  function mpCycleMode() {
    var list = ["shuffle", "single", "order"];
    var i = list.indexOf(mp.mode);
    var nextMode = list[(i + 1) % list.length];
    mpSetMode(nextMode);
    window.dispatchEvent(new CustomEvent("arsnMusicModeChanged", { detail: nextMode }));
  }

  function mpLoadPlaylist(playlistId, version) {
    return mpXun("playlist", { id: playlistId }).then(function (d) {
      var songs = (d && d.songs) || [];
      if (!songs.length) throw new Error("歌单为空");
      return songs.map(function (s) {
        return {
          id: s.id,
          name: s.name || "未知歌曲",
          singer: s.singer || "",
          picimg: s.picimg || "",
          url: "",
          lrc: ""
        };
      });
    }).catch(function (err) {
      if (version !== mp.playlistVersion) return [];
      /* 兜底：Meting 歌单（自带播放地址和歌词地址） */
      return fetch(MUSIC_METING + "?type=playlist&id=" + encodeURIComponent(playlistId), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (list) {
          if (!Array.isArray(list) || !list.length) throw err;
          return list.map(function (s, i) {
            return {
              id: i,
              name: s.name || "未知歌曲",
              singer: s.artist || "",
              picimg: s.pic || "",
              url: s.url || "",
              lrc: s.lrc || ""
            };
          });
        });
    });
  }

  function mpPlayIdx(i, noHistory) {
    if (i < 0 || i >= mp.tracks.length) return;
    if (!noHistory && mp.idx >= 0 && mp.idx !== i) {
      mp.history.push(mp.idx);
      if (mp.history.length > 30) mp.history.shift();
    }

    var t = mp.tracks[i];
    var a = mpAudio();
    a.pause(); /* 切歌先停掉正在播放的，避免旧歌还在响 */

    mp.idx = i;
    mp.lyricLoading = true;
    mp.current = { info: { name: t.name, singer: t.singer, picimg: t.picimg } };
    mp.lyric = [];
    mp.lyricAt = -1;
    mpRenderNow();
    mpRenderList();
    mpRenderLyrics();
    mpSyncButtons();
    mpStatus("加载歌曲…");

    function playUrl(url, lrcText, lrcUrl) {
      if (mp.tracks[mp.idx] !== t) return;
      a.src = url;
      mpSyncBar();
      mpUpdateLyricEmpty();
      mpResumeGraph();
      var p = a.play();
      if (p && p.catch) p.catch(function () { mpStatus("点击播放键继续"); });
      if (lrcText) {
        mp.lyricLoading = false;
        mp.lyric = mpParseLrc(lrcText);
        mpRenderLyrics();
        mpStatus("");
      } else if (lrcUrl) {
        fetch(lrcUrl, { cache: "no-store" })
          .then(function (r) { return r.text(); })
          .then(function (txt) {
            if (mp.tracks[mp.idx] !== t) return;
            mp.lyricLoading = false;
            mp.lyric = mpParseLrc(txt);
            mpRenderLyrics();
            mpStatus("");
          })
          .catch(function () {
            mp.lyricLoading = false;
            mpUpdateLyricEmpty();
            mpStatus("");
          });
      } else {
        mp.lyricLoading = false;
        mpUpdateLyricEmpty();
        mpStatus("");
      }
    }

    /* Meting 兜底过的曲目已经带直链和歌词地址，直接播 */
    if (t.url) {
      playUrl(t.url, "", t.lrc);
      return;
    }

    mpXun("song", { id: t.id, level: MUSIC_LEVEL }).then(function (d) {
      if (mp.tracks[mp.idx] !== t) return;
      var info = d.info || {};
      var url = d.url && d.url.url;
      if (!url) throw new Error("没有播放地址");
      t.name = info.name || t.name;
      t.singer = info.singer || t.singer;
      t.picimg = info.picimg || t.picimg;
      mp.current = { info: { name: t.name, singer: t.singer, picimg: t.picimg } };
      mpRenderNow();
      mpRenderList();
      mpSyncButtons();
      playUrl(url, (d.lyric && d.lyric.lrc) || "", "");
    }).catch(function () {
      if (mp.tracks[mp.idx] !== t) return;
      t.url = mpMeting("url", t.id);
      t.lrc = mpMeting("lrc", t.id);
      playUrl(t.url, "", t.lrc);
      mpStatus("接口读取失败，已切换备用源");
    });
  }

  function mpStart() {
    if (!mp.tracks.length) {
      mpStatus("正在加载歌单…");
      mpLoadPlaylist().then(function () {
        mpStatus("");
        mpPlayIdx(mp.mode === "order" ? 0 : Math.floor(Math.random() * mp.tracks.length));
      }).catch(function () {
        mpSeedFallback();
        mpStatus("歌单读取失败，使用备用列表");
        mpPlayIdx(0);
      });
      return;
    }
    if (mp.idx < 0) mpPlayIdx(mp.mode === "order" ? 0 : Math.floor(Math.random() * mp.tracks.length));
    else {
      var a = mpAudio();
      if (!a.src) mpPlayIdx(mp.idx);
      else a.play().catch(function () {});
    }
  }

  function mpToggle() {
    var a = mpAudio();
    if (!a.src) { mpStart(); return; }
    if (a.paused) { mpResumeGraph(); a.play().catch(function () {}); }
    else a.pause();
  }

  function mpNext(auto) {
    if (!mp.tracks.length) return;
    if (auto && mp.mode === "single") {
      var a = mpAudio();
      a.currentTime = 0;
      a.play().catch(function () {});
      return;
    }
    var n = mp.tracks.length;
    if (mp.mode === "order") {
      mpPlayIdx((mp.idx + 1) % n);
      return;
    }
    var i = Math.floor(Math.random() * n);
    if (n > 1 && i === mp.idx) i = (i + 1) % n;
    mpPlayIdx(i);
  }

  function mpPrev() {
    var a = mpAudio();
    if (a.currentTime > 3) { a.currentTime = 0; return; }
    if (mp.history.length) {
      var i = mp.history.pop();
      mpPlayIdx(i, true);
      return;
    }
    if (mp.mode === "order" && mp.tracks.length) {
      mpPlayIdx((mp.idx - 1 + mp.tracks.length) % mp.tracks.length, true);
      return;
    }
    mpNext(false);
  }

  function mpDocClick(e) {
    if (!mp.panel) return;
    if (mp.panel.contains(e.target)) return;
    if (mp.btn && (mp.btn === e.target || mp.btn.contains(e.target))) return;
    mpClose();
  }

  function mpEsc(e) {
    if (e.key === "Escape") mpClose();
  }

  function mpClose() {
    clearTimeout(mp.docBindTimer);
    mp.docBindTimer = 0;
    if (mp.panel && mp.panel.parentNode) mp.panel.parentNode.removeChild(mp.panel);
    mp.panel = null;
    mp.ui = null;
    mp.listEls = [];
    document.removeEventListener("click", mpDocClick);
    document.removeEventListener("keydown", mpEsc);
  }

  function mpPositionPanel() {
    if (!mp.panel || !mp.btn) return;
    var r = mp.btn.getBoundingClientRect();
    var w = mp.panel.offsetWidth;
    var h = mp.panel.offsetHeight;
    var maxW = Math.max(8, window.innerWidth - w - 8);
    var left = Math.min(Math.max(8, r.right - w), maxW);
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - h - 8);
    }
    mp.panel.style.left = left + "px";
    mp.panel.style.top = top + "px";
  }

  function mpOpen() {
    if (mp.panel) return;
    var el = document.createElement("div");
    el.className = "arsn-music-panel";
    el.innerHTML =
      '<div class="arsn-music-head">' +
        '<img class="arsn-music-cover" alt="">' +
        '<div class="arsn-music-meta">' +
          '<div class="arsn-music-title">未播放</div>' +
          '<div class="arsn-music-artist">ArsnProbe</div>' +
        '</div>' +
        '<button type="button" class="arsn-music-lyrbtn" title="悬浮歌词"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h13"/></svg></button>' +
        '<button type="button" class="arsn-music-mode"></button>' +
      '</div>' +
      '<div class="arsn-music-tabs">' +
        '<button type="button" class="arsn-music-tab is-active" data-tab="play">播放</button>' +
        '<button type="button" class="arsn-music-tab" data-tab="lyric">歌词</button>' +
      '</div>' +
      '<div class="arsn-music-views">' +
        '<div class="arsn-music-view is-active" data-view="play">' +
          '<div class="arsn-music-bar"><i></i></div>' +
          '<div class="arsn-music-time"><span class="arsn-music-cur">0:00</span><span class="arsn-music-dur">0:00</span></div>' +
          '<div class="arsn-music-ctrl">' +
            '<button type="button" class="arsn-music-prev" title="上一首">' + MP_ICONS.prev + '</button>' +
            '<button type="button" class="arsn-music-play" title="播放/暂停">' + MP_ICONS.play + '</button>' +
            '<button type="button" class="arsn-music-next" title="下一首">' + MP_ICONS.next + '</button>' +
          '</div>' +
          '<div class="arsn-music-vol">' + MP_ICONS.volume + '<div class="arsn-music-vol-track"><i></i><input type="range" min="0" max="1" step="0.01"></div></div>' +
          '<div class="arsn-music-list"></div>' +
        '</div>' +
        '<div class="arsn-music-view" data-view="lyric">' +
          '<div class="arsn-music-lyrics"></div>' +
        '</div>' +
      '</div>' +
      '<div class="arsn-music-status"></div>';
    document.body.appendChild(el);
    /* 面板内所有点击都不冒泡到 document，避免按钮重绘导致目标脱离后被当成“点外面” */
    el.addEventListener("click", function (ev) { ev.stopPropagation(); });

    var q = function (sel) { return el.querySelector(sel); };
    mp.ui = {
      title: q(".arsn-music-title"),
      artist: q(".arsn-music-artist"),
      cover: q(".arsn-music-cover"),
      mode: q(".arsn-music-mode"),
      lyrbtn: q(".arsn-music-lyrbtn"),
      tabs: Array.prototype.slice.call(el.querySelectorAll(".arsn-music-tab")),
      views: Array.prototype.slice.call(el.querySelectorAll(".arsn-music-view")),
      bar: q(".arsn-music-bar i"),
      cur: q(".arsn-music-cur"),
      dur: q(".arsn-music-dur"),
      play: q(".arsn-music-play"),
      list: q(".arsn-music-list"),
      lyrics: q(".arsn-music-lyrics"),
      status: q(".arsn-music-status")
    };

    var a = mpAudio();
    var volInput = q(".arsn-music-vol input");
    var volFill = q(".arsn-music-vol-track i");
    function syncVol(v) {
      if (volFill) volFill.style.width = Math.round(Math.min(1, Math.max(0, v)) * 100) + "%";
    }
    volInput.value = String(a.volume);
    syncVol(a.volume);
    volInput.addEventListener("input", function () {
      var v = Math.min(1, Math.max(0, parseFloat(this.value) || 0));
      a.volume = v;
      syncVol(v);
      try { localStorage.setItem("arsn-music-vol", String(v)); } catch (e) {}
    });

    q(".arsn-music-play").addEventListener("click", mpToggle);
    q(".arsn-music-prev").addEventListener("click", mpPrev);
    q(".arsn-music-next").addEventListener("click", function () { mpNext(false); });

    q(".arsn-music-bar").addEventListener("click", function (e) {
      var dur = a.duration;
      if (!dur) return;
      var r = this.getBoundingClientRect();
      var ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      a.currentTime = ratio * dur;
    });

    for (var i = 0; i < mp.ui.tabs.length; i++) {
      (function (tab) {
        tab.addEventListener("click", function () { mpSetTab(tab.getAttribute("data-tab")); });
      })(mp.ui.tabs[i]);
    }

    mp.ui.mode.addEventListener("click", function () {
      mpCycleMode();
    });

    q(".arsn-music-lyrbtn").addEventListener("click", function () {
      mpToggleBar();
    });

    if (mp.bar && mp.bar.isConnected && mp.ui.lyrbtn) mp.ui.lyrbtn.classList.add("is-on");

    mp.ui.cover.addEventListener("error", function () { this.style.visibility = "hidden"; });

    mp.panel = el;
    mpSetMode(mp.mode);
    mpRenderNow();
    mpRenderList();
    mpRenderLyrics();
    mpSetTab(mp.tab);
    mpSyncButtons();
    mpOnTime();

    mpPositionPanel();

    clearTimeout(mp.docBindTimer);
    mp.docBindTimer = setTimeout(function () {
      if (!mp.panel) return;
      document.addEventListener("click", mpDocClick);
    }, 0);
    document.addEventListener("keydown", mpEsc);
  }

  function mpEnsurePlaylist(forceReload) {
    if (forceReload) {
      mp.playlistVersion++;
      mp.tracks = [];
      mp.idx = -1;
      mp.loading = false;
      mpRenderList();
    }
    if (mp.tracks.length || mp.loading) return;
    mp.loading = true;
    var version = mp.playlistVersion;
    var playlistId = MUSIC_PLAYLIST_ID;
    mpStatus("加载歌单…");
    mpLoadPlaylist(playlistId, version).then(function (tracks) {
      if (version !== mp.playlistVersion) return;
      mp.loading = false;
      mp.tracks = tracks;
      mpRenderList();
      mpStatus("");
      mpSyncButtons();
    }).catch(function () {
      if (version !== mp.playlistVersion) return;
      mp.loading = false;
      mpSeedFallback();
      mpStatus("歌单读取失败，使用备用列表");
    });
  }

  function mpSeedFallback() {
    mp.tracks = MUSIC_FALLBACK.map(function (t) {
      return {
        id: t.id,
        name: t.name,
        singer: t.singer,
        picimg: t.picimg,
        url: mpMeting("url", t.id),
        lrc: mpMeting("lrc", t.id)
      };
    });
    mpRenderList();
  }

  function mpButtonClick() {
    if (mp.panel) { mpClose(); return; } /* 再点一下关闭弹窗 */
    mpOpen();
    mpEnsurePlaylist();
  }

  function applyArsnThemeConfig(config) {
    var values = config && typeof config === "object" && !Array.isArray(config) ? config : {};
    var previousApiKey = XUN_API_KEY;
    var previousPlaylist = MUSIC_PLAYLIST_ID;
    var backgroundApi = typeof values.backgroundApi === "string" && values.backgroundApi.trim()
      ? values.backgroundApi.trim().replace(/"/g, "\\\"")
      : DEFAULT_BACKGROUND_API;
    MUSIC_PLAYLIST_ID = typeof values.playlistId === "string" && values.playlistId.trim()
      ? values.playlistId.trim()
      : DEFAULT_MUSIC_PLAYLIST_ID;
    LOGO_DATA = typeof values.logoUrl === "string" && values.logoUrl.trim()
      ? values.logoUrl.trim()
      : "/arsn-assets/logo.png";
    TITLE_ICON = typeof values.overviewIconUrl === "string" && values.overviewIconUrl.trim()
      ? values.overviewIconUrl.trim()
      : "/arsn-assets/title-icon.webp";
    TAFFY_SRC = typeof values.mascotUrl === "string" && values.mascotUrl.trim()
      ? values.mascotUrl.trim()
      : "/arsn-assets/taffy.webp";
    document.documentElement.style.setProperty("--arsn-bg", 'url("' + backgroundApi + '")');
    if (Array.isArray(values.memeImages)) {
      ARSN_MEME_DATA = values.memeImages.filter(function (image) {
        return typeof image === "string" && image.trim().length > 0;
      }).map(function (image) { return image.trim(); });
    } else {
      ARSN_MEME_DATA = ARSN_MEME_DEFAULTS.slice();
    }
    var apiKey = typeof values.apiKey === "string" ? values.apiKey : values.weatherKey;
    XUN_API_KEY = typeof apiKey === "string" ? apiKey.trim() : "";
    if (window.CustomLogo !== LOGO_DATA) window.CustomLogo = LOGO_DATA;
    if (window.CustomIllustration !== TAFFY_SRC) window.CustomIllustration = TAFFY_SRC;
    setIcon("icon", "32x32", FAVICON_32);
    setIcon("icon", "16x16", FAVICON_16);
    setIcon("apple-touch-icon", "", LOGO_DATA);
    swapMascot();
    ensureTitle();
    if (MUSIC_PLAYLIST_ID !== previousPlaylist || XUN_API_KEY !== previousApiKey) {
      mpEnsurePlaylist(true);
    }
    if (XUN_API_KEY !== previousApiKey) {
      weatherAt = 0;
      xunOk = null;
      fetchWeather();
    }
  }

  function applyArsnCustomCode(code) {
    var values = {};
    if (typeof code === "string" && code.trim()) {
      try {
        values = parseThemeConfig(code) || {};
      } catch (e) {
        console.warn("Unable to read ArsnThemeConfig. Check the configuration object syntax.");
      }
      var aliases = {
        playlistId: "ArsnMusicPlaylistId",
        backgroundApi: "ArsnBackgroundApi",
        logoUrl: "ArsnLogoUrl",
        overviewIconUrl: "ArsnOverviewIconUrl",
        mascotUrl: "ArsnMascotUrl",
        memeImages: "ArsnMemeImages",
        apiKey: "ArsnApiKey",
        weatherKey: "ArsnWeatherKey"
      };
      Object.keys(aliases).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(values, key)) return;
        try {
          var value = parseThemeConfigValue(code, aliases[key]);
          if (value !== undefined) values[key] = value;
        } catch (e) {}
      });
    }
    window.ArsnThemeConfig = values;
    applyArsnThemeConfig(values);
  }

  window.__arsnApplyCustomCode = applyArsnCustomCode;

  function ensureMusicButton() {
    var online = null;
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var txt = (btns[i].textContent || "").replace(/\s+/g, "");
      if (txt.indexOf("在线") !== -1 || txt.indexOf("Online") !== -1) { online = btns[i]; break; }
    }
    if (!online || !online.parentElement) return;
    var exist = document.querySelector(".arsn-musicbtn");
    if (exist && exist.isConnected && exist.parentElement === online.parentElement && exist.__arsnManaged) {
      mp.btn = exist;
      mpSyncButtons();
      return;
    }
    if (exist) exist.remove();

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "arsn-musicbtn";
    btn.__arsnManaged = true;
    btn.title = "音乐";
    btn.setAttribute("aria-label", "音乐");
    btn.innerHTML = MP_ICONS.note + '<img class="arsn-musicbtn-cover" alt=""><span class="arsn-musicbtn-play">' + MP_ICONS.playSmall + '</span>';
    btn.__arsnMusicHandler = function (e) {
      e.preventDefault();
      e.stopPropagation();
      mpButtonClick();
    };
    btn.addEventListener("click", btn.__arsnMusicHandler);
    var img = btn.querySelector(".arsn-musicbtn-cover");
    if (img) {
      btn.__arsnMusicCoverHandler = function () {
        btn.classList.remove("has-cover");
      };
      img.addEventListener("error", btn.__arsnMusicCoverHandler);
    }
    online.parentElement.insertBefore(btn, online);
    mp.btn = btn;
    mpSyncButtons();
  }

  function boot() {
    bindGlobal(window, "runtimeConfigChange", function () {
      applyArsnThemeConfig(window.ArsnThemeConfig);
    });
    applyArsnThemeConfig(window.ArsnThemeConfig);
    try {
      var savedServerSort = localStorage.getItem("arsn-server-sort");
      if (savedServerSort === "process" || savedServerSort === "conn") serverSort = savedServerSort;
    } catch (e) {}
    scan();
    mpEnsurePlaylist();
    mpRestoreBar();
    ensureWeather();

    if (window.MutationObserver && document.body) {
      observer = new MutationObserver(function (mutations) {
        if (mutationNeedsScan(mutations)) scheduleScan();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    tickTimer = setInterval(tick, CFG.interval);
    sweepTimer = setInterval(scheduleScan, CFG.scanFallbackInterval); /* MutationObserver 失效时的低频兜底 */
    svcTimer = setInterval(function () { svcRender(true); }, CFG.svcInterval);

    /* 天气 + 塔菲实时播报 */
    fetchWeather();
    broadcastStartTimer = setTimeout(function () {
      broadcastStartTimer = 0;
      sayBroadcast();
    }, 2500);
    broadcastTimer = setInterval(function () {
      fetchWeather();
      sayBroadcast();
    }, 12000);

    /* 排序菜单关闭时机 */
    bindGlobal(window, "resize", closeSortMenu);
    bindGlobal(window, "scroll", closeSortMenu);
    /* 音乐面板跟着按钮/视口走，屏幕变小或被裁掉时重新贴回 */
    bindGlobal(window, "resize", mpPositionPanel);
    bindGlobal(window, "scroll", mpPositionPanel);
    bindGlobal(document, "keydown", function (e) {
      if (e.key === "Escape") closeSortMenu();
    });

    if (!tryTap()) {
      /* 给面板自己的连接一点时间；仍找不到才自建一条 */
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () {
        if (!tryTap()) connectOwn();
      }, 2500);
    }

    linkTimer = setInterval(maintain, 5000);

    /* 主题运行逻辑已初始化。 */
    document.documentElement.setAttribute("data-arsn-ready", "1");
  }


  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.__arsnStatCycle = { version: "1.2.0", destroy: destroy };
})();
