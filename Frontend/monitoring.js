// Monitoring History page: summary tiles, charts and the full daily table for the last 7 or 14 days.
// Uses the same data as the overview table (data/daily-updates.json, loaded by PlantDaily in updates.js).

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
		buttons: document.querySelectorAll(".range-switch button"),
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
