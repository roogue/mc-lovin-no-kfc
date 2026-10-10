// Simulation page: ML test data. Writes known 6-hour histories into the REAL database so the prediction model
// (Prediction-Training/) has something predictable to read.
//   Fresh     DELETE /api/readings                         → { ok, deleted }   clears the sensor table
//   Scenario  POST /api/readings/bulk  { readings: [...] }  → { ok, inserted }  readings with past timestamps
// The model reads temperature, humidity, pressure and precipitation from the last 6 hours, averaged into 10-minute
// steps, and compares each value with 10 minutes to 6 hours earlier. So each scenario covers a little more than
// 6 hours (one reading every 5 minutes, ending now), or the oldest step would fall out of the window.

(function () {
	"use strict";

	const card = document.getElementById("ml-card");
	if (!card || !window.PlantHistory) return;

	const $ = (id) => document.getElementById(id);
	const STEP_MIN = 5;
	const SPAN_MIN = 390; // 6.5 hours

	// Small seeded random numbers, so the preview is exactly what gets written
	function random(seed) {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
	const smooth = (x) => {
		const k = clamp(x, 0, 1);
		return k * k * (3 - 2 * k);
	};

	// Each scenario: values for a reading `a` minutes before now (0 = now); p = 0 at the oldest reading, 1 now
	const SCENARIOS = [
		{
			id: "stable",
			name: "Stable / normal",
			looks: "Temperature about 26–28°C, humidity about 70–75%, pressure flat.",
			expect: "Values stay about the same, low stress.",
			key: "temperature",
			at: (a) => ({
				temperature: 27 + 0.6 * Math.sin((2 * Math.PI * a) / 150),
				humidity: 72.5 + 1.8 * Math.cos((2 * Math.PI * a) / 130),
				pressure: 1009.2 + 0.1 * Math.sin(a / 90),
				precipitation: 0,
			}),
		},
		{
			id: "spike",
			name: "Sudden temperature spike",
			looks: "Temperature rises from 28°C to about 35°C in the last 1.5 hours, humidity drops.",
			expect: "Temperature stays high, stress probability high.",
			key: "temperature",
			at: (a) => {
				const k = smooth((90 - a) / 90);
				return {
					temperature: 28 + 0.3 * Math.sin(a / 40) + 7 * k,
					humidity: 72 + Math.cos(a / 50) - 17 * k,
					pressure: 1009,
					precipitation: 0,
				};
			},
		},
		{
			id: "heatwave",
			name: "Heat wave",
			looks: "Temperature climbs over the whole window and stays at 33°C or higher for the last half.",
			expect: "High stress, humidity low.",
			key: "temperature",
			at: (a, p) => ({
				temperature: 30 + 5.5 * Math.pow(p, 0.8),
				humidity: 66 - 16 * p,
				pressure: 1008.5 - 0.8 * p,
				precipitation: 0,
			}),
		},
		{
			id: "humidity",
			name: "Humidity surge",
			looks: "Humidity climbs from 70% to over 90% while temperature stays flat.",
			expect: "Humidity above 85%, high stress.",
			key: "humidity",
			at: (a, p) => ({
				temperature: 27.5 + 0.3 * Math.sin(a / 45),
				humidity: 70 + 23 * smooth((240 - a) / 240),
				pressure: 1009 - 0.4 * p,
				precipitation: 0,
			}),
		},
		{
			id: "storm",
			name: "Storm approaching",
			looks: "Pressure falls over 4 hPa in the last 3 hours, humidity rises, temperature falls, rain starts at the end.",
			expect: "Precipitation above 0, humidity up, temperature down.",
			key: "pressure",
			at: (a) => {
				const k = clamp((180 - a) / 180, 0, 1);
				return {
					temperature: 29 - 3.5 * k,
					humidity: 72 + 19 * k,
					pressure: 1010 - 4.2 * k,
					precipitation: a < 40 ? 0.4 + ((40 - a) / 40) * 2.6 : 0,
				};
			},
		},
	];

	const NOISE = { temperature: 0.08, humidity: 0.3, pressure: 0.03, precipitation: 0 };
	const DECIMALS = { temperature: 2, humidity: 1, pressure: 1, precipitation: 1 };
	const UNITS = { temperature: "°C", humidity: "%", pressure: " hPa", precipitation: " mm" };
	const LABELS = { temperature: "Temperature", humidity: "Humidity", pressure: "Pressure", precipitation: "Rain" };
	const utc = (date) => date.toISOString().slice(0, 19).replace("T", " ");

	// Oldest first, one reading every STEP_MIN minutes, ending at `end`
	function generate(scenario, end = new Date()) {
		const rand = random(scenario.id.split("").reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
		const now = new Date(Math.floor(end.getTime() / 60000) * 60000);
		const out = [];
		for (let a = SPAN_MIN; a >= 0; a -= STEP_MIN) {
			const v = scenario.at(a, 1 - a / SPAN_MIN);
			const reading = { recorded_at: utc(new Date(now.getTime() - a * 60000)) };
			Object.keys(NOISE).forEach((k) => {
				const value = v[k] + (rand() - 0.5) * 2 * NOISE[k];
				reading[k] = Number((k === "humidity" ? clamp(value, 0, 100) : k === "precipitation" ? Math.max(0, value) : value).toFixed(DECIMALS[k]));
			});
			out.push(reading);
		}
		return out;
	}

	/* ---------- cards ---------- */
	const SVG_NS = "http://www.w3.org/2000/svg";
	function sparkline(readings, key) {
		const W = 220;
		const H = 44;
		const values = readings.map((r) => r[key]);
		// A minimum range per reading, so a flat history looks flat instead of being stretched to fill the chart
		const MIN_SPAN = { temperature: 4, humidity: 10, pressure: 3, precipitation: 1 };
		const mid = (Math.min(...values) + Math.max(...values)) / 2;
		const span = Math.max(Math.max(...values) - Math.min(...values), MIN_SPAN[key] || 1);
		const lo = mid - span / 2;
		const d = values
			.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(1)},${(H - 4 - ((v - lo) / span) * (H - 8)).toFixed(1)}`)
			.join(" ");
		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
		svg.setAttribute("class", `ml-spark is-${key}`);
		svg.setAttribute("aria-hidden", "true");
		svg.setAttribute("preserveAspectRatio", "none");
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute("d", d);
		svg.appendChild(path);
		return svg;
	}

	function change(readings, key) {
		// Start of the 6-hour window → now
		const first = readings[Math.round((SPAN_MIN - 360) / STEP_MIN)];
		const last = readings[readings.length - 1];
		const f = (v) => (key === "humidity" ? Math.round(v) : v.toFixed(1));
		return `${f(first[key])} → ${f(last[key])}${UNITS[key]}`;
	}

	const grid = $("ml-grid");
	SCENARIOS.forEach((s) => {
		const preview = generate(s);
		const el = document.createElement("article");
		el.className = "ml-scenario";
		el.innerHTML = `
			<h3></h3>
			<p class="ml-looks"></p>
			<div class="ml-chart">
				<span class="ml-chart-label"></span>
			</div>
			<ul class="ml-values"></ul>
			<p class="ml-expect"><strong>Model should predict:</strong> <span></span></p>
			<button type="button" class="sim-btn primary ml-write">Write to database</button>`;
		el.querySelector("h3").textContent = s.name;
		el.querySelector(".ml-looks").textContent = s.looks;
		el.querySelector(".ml-chart-label").textContent = `${LABELS[s.key]}, last 6 h`;
		el.querySelector(".ml-chart").appendChild(sparkline(preview, s.key));
		el.querySelector(".ml-values").append(
			...Object.keys(LABELS).map((k) => {
				const li = document.createElement("li");
				li.innerHTML = "<span></span><strong></strong>";
				li.firstChild.textContent = LABELS[k];
				li.lastChild.textContent = change(preview, k);
				return li;
			}),
		);
		el.querySelector(".ml-expect span").textContent = s.expect;
		const btn = el.querySelector(".ml-write");
		btn.setAttribute("aria-label", `Write the ${s.name} scenario to the database`);
		btn.addEventListener("click", () => writeScenario(s, btn));
		grid.appendChild(el);
	});

	/* ---------- actions ---------- */
	const statusEl = $("ml-status");
	const freshBtn = $("ml-fresh");
	function status(text, state) {
		statusEl.textContent = text;
		statusEl.dataset.state = state;
		statusEl.hidden = !text;
	}

	function explain(err) {
		if (err && (err.status === 404 || err.status === 405)) {
			return `the server doesn't support this yet (HTTP ${err.status}). Add the ML test-data endpoints to the backend first.`;
		}
		return String((err && err.message) || err).replace(/^./, (c) => c.toLowerCase());
	}

	let busy = false;
	function setBusy(on) {
		busy = on;
		freshBtn.disabled = on;
		card.querySelectorAll(".ml-write").forEach((b) => (b.disabled = on));
	}

	freshBtn.addEventListener("click", async () => {
		if (busy) return;
		const sure = window.confirm("Delete every sensor reading in the real database? This can't be undone.");
		if (!sure) return;
		setBusy(true);
		status("Clearing the sensor table…", "working");
		try {
			const res = await PlantHistory.clearReadings();
			const n = res && Number.isFinite(Number(res.deleted)) ? Number(res.deleted) : null;
			status(`Sensor table cleared${n != null ? ` (${n.toLocaleString("en-GB")} readings deleted)` : ""}. Now write a scenario.`, "done");
		} catch (err) {
			console.warn("Could not clear the readings:", err);
			status(`Not cleared: ${explain(err)}`, "error");
		} finally {
			setBusy(false);
		}
	});

	async function writeScenario(s, btn) {
		if (busy) return;
		setBusy(true);
		const readings = generate(s); // timestamps end at the moment of the click
		status(`Writing “${s.name}” (${readings.length} readings over the last 6.5 hours)…`, "working");
		try {
			const res = await PlantHistory.addReadings(readings);
			const n = res && Number.isFinite(Number(res.inserted)) ? Number(res.inserted) : readings.length;
			status(`“${s.name}” written: ${n} readings, one every ${STEP_MIN} minutes up to now. The model can predict from it right away.`, "done");
			btn.closest(".ml-scenario").classList.add("is-written");
			setTimeout(() => btn.closest(".ml-scenario").classList.remove("is-written"), 2400);
		} catch (err) {
			console.warn("Could not write the scenario:", err);
			status(`“${s.name}” not written: ${explain(err)}`, "error");
		} finally {
			setBusy(false);
		}
	}

	window.PlantScenarios = { generate, SCENARIOS }; // for checking the data from the console
})();
