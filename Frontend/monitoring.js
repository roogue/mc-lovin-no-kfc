// Monitoring History page.
// Live mode: readings from the API (PlantHistory in history-api.js): averages, four time charts from
// GET /api/history and a paged table from GET /api/readings, for the last 24 hours, 7 days or 30 days.
// Sample mode: summary tiles, charts and the full daily table for the last 7 or 14 days, from the same sample data
// as the overview table (data/daily-updates.json, loaded by PlantDaily in updates.js).

(function () {
	"use strict";

	const $ = (id) => document.getElementById(id);
	const SVG_NS = "http://www.w3.org/2000/svg";
	// Charts are drawn at the card's real pixel width (so text never scales) and redrawn on resize
	const H = 220;
	const PAD = { top: 22, right: 16, bottom: 30, left: 40 };
	const IH = H - PAD.top - PAD.bottom;
	const size = (box) => {
		const W = Math.max(240, Math.round(box.clientWidth));
		return { W, IW: W - PAD.left - PAD.right };
	};

	const DEVICE_SERIES = [
		{ key: "fanUses", label: "Fan uses", color: "#2B88CC" },
		{ key: "irrigations", label: "Waterings", color: "#2E9E57" },
	];

	const els = {
		buttons: document.querySelectorAll('.range-switch[data-mode="sample"] button'),
		temp: $("temp-chart"),
		humidity: $("humidity-chart"),
		devices: $("device-chart"),
		body: $("history-body"),
		sub: $("history-sub"),
	};

	let allDays = []; // newest first
	let range = 7;

	/* ---------- helpers ---------- */
	function svgEl(tag, attrs = {}, text) {
		const el = document.createElementNS(SVG_NS, tag);
		for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
		if (text != null) el.textContent = text;
		return el;
	}

	const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
	const longDate = (iso) =>
		new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
	const avg = (list) => list.reduce((a, b) => a + b, 0) / (list.length || 1);
	const sum = (list) => list.reduce((a, b) => a + b, 0);

	// Round axis bounds out to tidy steps
	function niceScale(min, max, ticks = 5) {
		const raw = (max - min || 1) / ticks;
		const mag = 10 ** Math.floor(Math.log10(raw));
		const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
		return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
	}

	// Axes + grid shared by both chart types; returns the y scale
	function drawFrame(svg, { W, IW }, days, scale, format, xAt) {
		const y = (v) => PAD.top + IH - ((v - scale.min) / (scale.max - scale.min)) * IH;
		for (let v = scale.min; v <= scale.max + 1e-9; v += scale.step) {
			svg.append(
				svgEl("line", { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), class: "grid" }),
				svgEl("text", { x: PAD.left - 8, y: y(v) + 4, "text-anchor": "end", class: "axis" }, format(v)),
			);
		}
		const every = Math.max(1, Math.ceil((days.length * 48) / IW)); // thin out date labels so they don't collide
		days.forEach((d, i) => {
			if ((days.length - 1 - i) % every) return;
			svg.append(svgEl("text", { x: xAt(i), y: H - 8, "text-anchor": "middle", class: "axis" }, shortDate(d.date)));
		});
		return y;
	}

	// Tooltip positioned over a point in viewBox coordinates
	function tooltip(box) {
		let tip = box.querySelector(".chart-tip");
		if (!tip) {
			tip = document.createElement("div");
			tip.className = "chart-tip";
			tip.hidden = true;
			box.appendChild(tip);
		}
		return {
			show(svg, W, vx, vy, lines) {
				const r = svg.getBoundingClientRect();
				const px = (vx * r.width) / W;
				tip.replaceChildren(...lines.map((l, i) => {
					const el = document.createElement(i === 0 ? "strong" : "span");
					el.textContent = l;
					return el;
				}));
				tip.hidden = false;
				// keep the tooltip inside the card
				const half = tip.offsetWidth / 2;
				tip.style.left = `${Math.min(Math.max(px, half), r.width - half)}px`;
				tip.style.top = `${(vy * r.height) / H}px`;
			},
			hide() {
				tip.hidden = true;
			},
		};
	}

	// Map a pointer event to viewBox x
	const pointerX = (svg, W, e) => ((e.clientX - svg.getBoundingClientRect().left) * W) / svg.getBoundingClientRect().width;

	/* ---------- line chart (one series) ---------- */
	function lineChart(box, days, { key, label, unit, decimals, color }) {
		const { W, IW } = size(box);
		const values = days.map((d) => Number(d[key]));
		const lo = Math.min(...values);
		const hi = Math.max(...values);
		const pad = (hi - lo) * 0.15 || 1;
		const scale = niceScale(lo - pad, hi + pad);
		const xAt = (i) => PAD.left + (days.length === 1 ? IW / 2 : (i * IW) / (days.length - 1));
		const fmt = (v) => `${v.toFixed(decimals)}${unit}`;

		const svg = svgEl("svg", {
			viewBox: `0 0 ${W} ${H}`,
			class: "mchart",
			role: "img",
			"aria-label": `${label} by day from ${shortDate(days[0].date)} to ${shortDate(days.at(-1).date)}, between ${fmt(lo)} and ${fmt(hi)}. Exact values are in the Daily history table.`,
		});
		const y = drawFrame(svg, { W, IW }, days, scale, (v) => String(v), xAt);

		const crosshair = svgEl("line", { y1: PAD.top, y2: PAD.top + IH, class: "crosshair", visibility: "hidden" });
		svg.append(crosshair);
		svg.append(svgEl("path", {
			d: values.map((v, i) => `${i ? "L" : "M"}${xAt(i)},${y(v)}`).join(" "),
			fill: "none",
			stroke: color,
			"stroke-width": 2,
			"stroke-linejoin": "round",
			"stroke-linecap": "round",
		}));
		const dots = values.map((v, i) => {
			const c = svgEl("circle", { cx: xAt(i), cy: y(v), r: 4, fill: "#FFFFFF", stroke: color, "stroke-width": 2 });
			svg.append(c);
			return c;
		});
		// Direct label on the latest value only
		const last = values.length - 1;
		// (placed above the last two points so it never sits on the previous marker)
		const labelY = Math.min(y(values[last]), y(values[Math.max(0, last - 1)])) - 12;
		svg.append(svgEl("text", { x: xAt(last) + 4, y: Math.max(PAD.top - 6, labelY), "text-anchor": "end", class: "value" }, fmt(values[last])));

		// Hover layer: crosshair + tooltip on the nearest day
		const hit = svgEl("rect", { x: PAD.left - 10, y: PAD.top, width: IW + 20, height: IH, fill: "transparent" });
		svg.append(hit);
		box.replaceChildren(svg);
		const tip = tooltip(box);
		let active = -1;

		hit.addEventListener("pointermove", (e) => {
			const step = days.length > 1 ? IW / (days.length - 1) : IW;
			const i = Math.min(days.length - 1, Math.max(0, Math.round((pointerX(svg, W, e) - PAD.left) / step)));
			if (i === active) return;
			if (active >= 0) dots[active].setAttribute("r", 4);
			active = i;
			dots[i].setAttribute("r", 6);
			crosshair.setAttribute("x1", xAt(i));
			crosshair.setAttribute("x2", xAt(i));
			crosshair.setAttribute("visibility", "visible");
			tip.show(svg, W, xAt(i), y(values[i]), [longDate(days[i].date), `${label}: ${fmt(values[i])}`]);
		});
		hit.addEventListener("pointerleave", () => {
			if (active >= 0) dots[active].setAttribute("r", 4);
			active = -1;
			crosshair.setAttribute("visibility", "hidden");
			tip.hide();
		});
	}

	/* ---------- grouped bar chart (fan uses vs waterings) ---------- */
	function barPath(x, top, w, base, r = 4) {
		const h = base - top;
		if (h <= 0) return "";
		r = Math.min(r, h, w / 2);
		return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
	}

	function deviceChart(box, days) {
		const { W, IW } = size(box);
		const max = Math.max(1, ...days.flatMap((d) => DEVICE_SERIES.map((s) => d[s.key])));
		const scale = niceScale(0, max * 1.1);
		scale.min = 0;
		const gw = IW / days.length;
		const xAt = (i) => PAD.left + gw * (i + 0.5);
		const bw = Math.min(16, (gw * 0.7 - 2) / 2);

		const svg = svgEl("svg", {
			viewBox: `0 0 ${W} ${H}`,
			class: "mchart",
			role: "img",
			"aria-label": `Fan uses and waterings per day from ${shortDate(days[0].date)} to ${shortDate(days.at(-1).date)}. Exact values are in the Daily history table.`,
		});
		const y = drawFrame(svg, { W, IW }, days, scale, (v) => String(v), xAt);
		const base = y(0);

		const groups = days.map((d, i) => {
			const g = svgEl("g", { class: "bar-group" });
			DEVICE_SERIES.forEach((s, si) => {
				const x = si === 0 ? xAt(i) - bw - 1 : xAt(i) + 1; // 2px gap between the pair
				const path = barPath(x, y(d[s.key]), bw, base);
				if (path) g.append(svgEl("path", { d: path, fill: s.color }));
			});
			svg.append(g);
			return g;
		});

		box.replaceChildren(svg);
		const tip = tooltip(box);

		// One hit target per day (wider than the bars)
		days.forEach((d, i) => {
			const hit = svgEl("rect", { x: PAD.left + gw * i, y: PAD.top, width: gw, height: IH, fill: "transparent" });
			hit.addEventListener("pointerenter", () => {
				groups.forEach((g, gi) => g.classList.toggle("is-dim", gi !== i));
				const top = Math.min(...DEVICE_SERIES.map((s) => y(d[s.key])));
				tip.show(svg, W, xAt(i), top, [longDate(d.date), ...DEVICE_SERIES.map((s) => `${s.label}: ${d[s.key]}`)]);
			});
			hit.addEventListener("pointerleave", () => {
				groups.forEach((g) => g.classList.remove("is-dim"));
				tip.hide();
			});
			svg.append(hit);
		});
	}

	/* ---------- page ---------- */
	function renderCharts() {
		const days = allDays.slice(0, range).reverse(); // oldest → newest
		lineChart(els.temp, days, { key: "avgTemp", label: "Temperature", unit: "°C", decimals: 1, color: "#E0695D" });
		lineChart(els.humidity, days, { key: "avgHumidity", label: "Humidity", unit: "%", decimals: 0, color: "#3D9FE0" });
		deviceChart(els.devices, days);
	}

	function render() {
		const newest = allDays.slice(0, range);
		const days = newest.slice().reverse(); // oldest → newest

		$("tile-temp").textContent = `${avg(days.map((d) => d.avgTemp)).toFixed(1)}°C`;
		$("tile-humidity").textContent = `${Math.round(avg(days.map((d) => d.avgHumidity)))}%`;
		$("tile-fan").textContent = sum(days.map((d) => d.fanUses));
		$("tile-fan-sub").textContent = `in ${days.length} days`;
		$("tile-water").textContent = sum(days.map((d) => d.irrigations));
		$("tile-water-sub").textContent = `in ${days.length} days`;
		$("tile-healthy").textContent = `${days.filter((d) => d.condition === "healthy").length} of ${days.length}`;

		renderCharts();

		els.sub.textContent = `${days.length} days, newest first`;
		els.body.replaceChildren(...newest.map(PlantDaily.row));
	}

	els.buttons.forEach((b) =>
		b.addEventListener("click", () => {
			range = Number(b.dataset.range);
			els.buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
			if (allDays.length) render();
		}),
	);

	let resizeTimer = null;
	window.addEventListener("resize", () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => allDays.length && renderCharts(), 150);
	});

	/* ================= Live mode: readings from the API ================= */
	const LIVE_SERIES = [
		{ box: "live-temp-chart", key: "temperature", label: "Temperature", unit: "°C", decimals: 1, color: "#E0695D" },
		{ box: "live-humidity-chart", key: "humidity", label: "Humidity", unit: "%", decimals: 0, color: "#3D9FE0" },
		{ box: "live-pressure-chart", key: "pressure", label: "Pressure", unit: " hPa", decimals: 1, color: "#7C64C8" },
		{ box: "live-precip-chart", key: "precipitation", label: "Precipitation", unit: " mm", decimals: 1, color: "#2B88CC" },
	];
	const READING_KEYS = ["temperature", "humidity", "pressure", "precipitation"];
	const PAGE_SIZE = 25;
	const RANGE_TEXT = { 24: "24 hours", 168: "7 days", 720: "30 days" };

	const live = { hours: 24, offset: 0, history: null, historyReq: 0, readingsReq: 0 };
	const rangeText = () => RANGE_TEXT[live.hours] || `${live.hours} hours`;

	const timeLabel = (sec) => {
		const d = new Date(sec * 1000);
		return live.hours <= 24
			? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
			: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
	};
	const fullTime = (date) =>
		date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
	const axisNumber = (v) => String(Number(v.toFixed(4)));

	function boxMessage(box, text) {
		box.replaceChildren();
		box.textContent = text;
		box.classList.add("is-empty");
	}

	// One reading over time. Gaps in the data (no readings for a while) break the line instead of bridging it.
	function timeChart(box, { points, start, end, bucket }, s) {
		const pts = points.filter((p) => p[s.key] != null);
		if (!pts.length) return boxMessage(box, `No ${s.label.toLowerCase()} readings in the last ${rangeText()}`);
		box.classList.remove("is-empty");

		const { W, IW } = size(box);
		const values = pts.map((p) => p[s.key]);
		const lo = Math.min(...values);
		const hi = Math.max(...values);
		const pad = (hi - lo) * 0.15 || 1;
		const scale = niceScale(lo - pad, hi + pad);
		const x = (t) => PAD.left + ((t - start) / (end - start || 1)) * IW;
		const y = (v) => PAD.top + IH - ((v - scale.min) / (scale.max - scale.min)) * IH;
		const fmt = (v) => `${v.toFixed(s.decimals)}${s.unit}`;

		const svg = svgEl("svg", {
			viewBox: `0 0 ${W} ${H}`,
			class: "mchart",
			role: "img",
			"aria-label": `${s.label} over the last ${rangeText()}, between ${fmt(lo)} and ${fmt(hi)}, latest ${fmt(values.at(-1))}. Exact values are in the Readings table.`,
		});
		for (let v = scale.min; v <= scale.max + 1e-9; v += scale.step) {
			svg.append(
				svgEl("line", { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), class: "grid" }),
				svgEl("text", { x: PAD.left - 8, y: y(v) + 4, "text-anchor": "end", class: "axis" }, axisNumber(v)),
			);
		}
		const ticks = Math.max(2, Math.min(6, Math.floor(IW / 72)));
		for (let i = 0; i <= ticks; i++) {
			const t = start + ((end - start) * i) / ticks;
			const anchor = i === 0 ? "start" : i === ticks ? "end" : "middle";
			svg.append(svgEl("text", { x: x(t), y: H - 8, "text-anchor": anchor, class: "axis" }, timeLabel(t)));
		}

		const crosshair = svgEl("line", { y1: PAD.top, y2: PAD.top + IH, class: "crosshair", visibility: "hidden" });
		svg.append(crosshair);
		let d = "";
		pts.forEach((p, i) => {
			const gap = i > 0 && p.t - pts[i - 1].t > bucket * 2.5;
			d += `${i === 0 || gap ? "M" : "L"}${x(p.t).toFixed(1)},${y(p[s.key]).toFixed(1)} `;
		});
		svg.append(svgEl("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
		const last = pts.at(-1);
		svg.append(svgEl("circle", { cx: x(last.t), cy: y(last[s.key]), r: 3.5, fill: s.color }));
		svg.append(
			svgEl(
				"text",
				{ x: Math.min(x(last.t), W - PAD.right), y: Math.max(PAD.top - 6, y(last[s.key]) - 10), "text-anchor": "end", class: "value" },
				fmt(last[s.key]),
			),
		);
		const focus = svgEl("circle", { r: 5, fill: "#FFFFFF", stroke: s.color, "stroke-width": 2, visibility: "hidden" });
		svg.append(focus);

		// Hover: crosshair + tooltip on the nearest time slot
		const hit = svgEl("rect", { x: PAD.left - 10, y: PAD.top, width: IW + 20, height: IH, fill: "transparent" });
		svg.append(hit);
		box.replaceChildren(svg);
		const tip = tooltip(box);
		hit.addEventListener("pointermove", (e) => {
			const t = start + ((pointerX(svg, W, e) - PAD.left) / IW) * (end - start);
			let best = pts[0];
			for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
			const px = x(best.t);
			const py = y(best[s.key]);
			crosshair.setAttribute("x1", px);
			crosshair.setAttribute("x2", px);
			crosshair.setAttribute("visibility", "visible");
			focus.setAttribute("cx", px);
			focus.setAttribute("cy", py);
			focus.setAttribute("visibility", "visible");
			const lines = [fullTime(new Date(best.t * 1000)), `${s.label}: ${fmt(best[s.key])}`];
			if (best.samples > 1) lines.push(`Average of ${best.samples} readings`);
			tip.show(svg, W, px, py, lines);
		});
		hit.addEventListener("pointerleave", () => {
			crosshair.setAttribute("visibility", "hidden");
			focus.setAttribute("visibility", "hidden");
			tip.hide();
		});
	}

	// Averages weighted by how many readings each time slot holds
	function weightedAvg(points, key) {
		let total = 0;
		let weight = 0;
		points.forEach((p) => {
			if (p[key] == null) return;
			const w = p.samples || 1;
			total += p[key] * w;
			weight += w;
		});
		return weight ? total / weight : null;
	}

	function renderLiveTiles() {
		const h = live.history;
		const ids = ["live-temp", "live-humidity", "live-pressure", "live-precip", "live-count"];
		if (!h) return ids.forEach((id) => ($(id).textContent = "–"));
		const set = (id, v, decimals) => ($(id).textContent = v == null ? "–" : v.toFixed(decimals));
		set("live-temp", weightedAvg(h.points, "temperature"), 1);
		set("live-humidity", weightedAvg(h.points, "humidity"), 0);
		set("live-pressure", weightedAvg(h.points, "pressure"), 1);
		set("live-precip", weightedAvg(h.points, "precipitation"), 2);
		$("live-count").textContent = h.points.reduce((n, p) => n + (p.samples || 0), 0).toLocaleString("en-GB");
		$("live-count-sub").textContent = `in the last ${rangeText()}`;
	}

	function renderLiveCharts() {
		if (live.history) LIVE_SERIES.forEach((s) => timeChart($(s.box), live.history, s));
	}

	async function loadHistory() {
		const req = ++live.historyReq;
		live.history = null;
		renderLiveTiles();
		LIVE_SERIES.forEach((s) => boxMessage($(s.box), "Loading…"));
		try {
			const data = await PlantHistory.history(live.hours);
			if (req !== live.historyReq) return; // a newer range was picked meanwhile
			const points = (Array.isArray(data && data.points) ? data.points : [])
				.map((p) => {
					const point = { t: Number(p.t), samples: Number(p.samples) || 0 };
					READING_KEYS.forEach((k) => (point[k] = PlantHistory.num(p[k])));
					return point;
				})
				.filter((p) => Number.isFinite(p.t))
				.sort((a, b) => a.t - b.t);
			const end = Date.now() / 1000;
			live.history = { points, start: end - live.hours * 3600, end, bucket: Number(data.bucket_seconds) || (live.hours * 3600) / 300 };
			renderLiveTiles();
			if (!points.length) LIVE_SERIES.forEach((s) => boxMessage($(s.box), `No readings in the last ${rangeText()} yet`));
			else renderLiveCharts();
		} catch (err) {
			if (req !== live.historyReq) return;
			console.warn("Could not load history:", err);
			LIVE_SERIES.forEach((s) => boxMessage($(s.box), err.message));
		}
	}

	const readingsBody = $("readings-body");
	const pager = $("readings-pager");
	const valueCell = (v, decimals, unit) => {
		const td = document.createElement("td");
		td.className = "num";
		td.textContent = v == null ? "—" : `${v.toFixed(decimals)}${unit}`;
		return td;
	};

	function readingRow(r) {
		const tr = document.createElement("tr");
		const td = document.createElement("td");
		const when = PlantHistory.parseUtc(r.recorded_at);
		const time = document.createElement("time");
		if (when) time.dateTime = when.toISOString();
		time.textContent = when
			? when.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })
			: String(r.recorded_at || "—");
		td.appendChild(time);
		const n = PlantHistory.num;
		tr.append(
			td,
			valueCell(n(r.temperature), 1, "°C"),
			valueCell(n(r.humidity), 0, "%"),
			valueCell(n(r.pressure), 1, " hPa"),
			valueCell(n(r.precipitation), 1, " mm"),
		);
		return tr;
	}

	async function loadReadings() {
		const req = ++live.readingsReq;
		PlantDaily.showMessage(readingsBody, "Loading readings…");
		pager.hidden = true;
		try {
			const data = await PlantHistory.readings(live.hours, PAGE_SIZE, live.offset);
			if (req !== live.readingsReq) return;
			const rows = Array.isArray(data && data.readings) ? data.readings : [];
			const total = Number(data && data.total) || 0;
			if (!rows.length) {
				PlantDaily.showMessage(readingsBody, live.offset ? "No more readings." : `No readings in the last ${rangeText()} yet.`);
			} else {
				readingsBody.replaceChildren(...rows.map(readingRow));
			}
			$("readings-sub").textContent = total
				? `${total.toLocaleString("en-GB")} readings in the last ${rangeText()}, newest first, in your local time`
				: "Newest first, in your local time";
			pager.hidden = total <= PAGE_SIZE && live.offset === 0;
			$("readings-page").textContent = rows.length
				? `${(live.offset + 1).toLocaleString("en-GB")}–${(live.offset + rows.length).toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}`
				: "";
			$("readings-prev").disabled = live.offset === 0;
			$("readings-next").disabled = live.offset + rows.length >= total;
		} catch (err) {
			if (req !== live.readingsReq) return;
			console.warn("Could not load readings:", err);
			PlantDaily.showMessage(readingsBody, err.message);
		}
	}

	function initLive() {
		$("page-sub").textContent = "Readings from the ESP32 through the Plant Check API, in your local time.";
		const buttons = document.querySelectorAll('.range-switch[data-mode="live"] button');
		buttons.forEach((b) =>
			b.addEventListener("click", () => {
				if (Number(b.dataset.hours) === live.hours) return;
				live.hours = Number(b.dataset.hours);
				live.offset = 0;
				buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
				loadHistory();
				loadReadings();
			}),
		);
		$("readings-prev").addEventListener("click", () => {
			live.offset = Math.max(0, live.offset - PAGE_SIZE);
			loadReadings();
		});
		$("readings-next").addEventListener("click", () => {
			live.offset += PAGE_SIZE;
			loadReadings();
		});
		let liveResize = null;
		window.addEventListener("resize", () => {
			clearTimeout(liveResize);
			liveResize = setTimeout(() => live.history && live.history.points.length && renderLiveCharts(), 150);
		});
		loadHistory();
		loadReadings();
	}

	/* ---------- start: live or sample ---------- */
	const isLive = !!(window.PlantHistory && PlantHistory.isLive());
	document.querySelectorAll("main [data-mode]").forEach((el) => (el.hidden = el.dataset.mode !== (isLive ? "live" : "sample")));
	if (isLive) return initLive();

	PlantDaily.showMessage(els.body, "Loading history…");
	PlantDaily.load()
		.then((days) => {
			allDays = days;
			if (!days.length) return PlantDaily.showMessage(els.body, "No history yet.");
			render();
		})
		.catch((err) => {
			console.warn("Could not load monitoring history:", err);
			PlantDaily.showMessage(els.body, PlantDaily.errorMessage());
			[els.temp, els.humidity, els.devices].forEach((b) => {
				b.textContent = "No data";
				b.classList.add("is-empty");
			});
		});
})();
