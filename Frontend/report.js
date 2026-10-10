// Report History page — monthly reports with print/export-to-PDF support.
// Live mode: built from the API (PlantHistory in history-api.js): sensor averages per month from
// GET /api/history and disease scans from GET /api/disease. The API doesn't record fan / valve activity or how
// many plants are monitored, so live reports say so instead of showing numbers.
// Sample mode: the static MONTHLY_REPORTS below.

const SEVERITY_COLOR = {
	low: "#4CD179",
	medium: "#E0A021",
	high: "#C9573C",
};

const MONTHLY_REPORTS = [
	{
		id: "2026-09",
		label: "September 2026",
		generatedOn: "October 1, 2026",
		status: "ok",
		avgTemp: 29.4,
		minTemp: 26.1,
		maxTemp: 33.8,
		avgHumidity: 58,
		minHumidity: 42,
		maxHumidity: 76,
		fan: { on: 214, off: 214, runtimeHrs: 71.5 },
		valve: { on: 62, off: 62, runtimeHrs: 9.2 },
		plantCount: 12,
		diseases: [
			{ name: "Healthy", count: 8, severity: "low" },
			{ name: "Powdery Mildew", count: 2, severity: "medium" },
			{ name: "Leaf Blight", count: 1, severity: "high" },
			{ name: "Nutrient Deficiency", count: 1, severity: "medium" },
		],
	},
	{
		id: "2026-08",
		label: "August 2026",
		generatedOn: "September 1, 2026",
		status: "warn",
		avgTemp: 31.2,
		minTemp: 27.6,
		maxTemp: 36.4,
		avgHumidity: 51,
		minHumidity: 33,
		maxHumidity: 69,
		fan: { on: 288, off: 288, runtimeHrs: 96.3 },
		valve: { on: 74, off: 74, runtimeHrs: 11.6 },
		plantCount: 12,
		diseases: [
			{ name: "Healthy", count: 6, severity: "low" },
			{ name: "Leaf Blight", count: 3, severity: "high" },
			{ name: "Powdery Mildew", count: 2, severity: "medium" },
			{ name: "Root Rot", count: 1, severity: "high" },
		],
	},
	{
		id: "2026-07",
		label: "July 2026",
		generatedOn: "August 1, 2026",
		status: "ok",
		avgTemp: 30.1,
		minTemp: 26.8,
		maxTemp: 34.9,
		avgHumidity: 55,
		minHumidity: 38,
		maxHumidity: 72,
		fan: { on: 241, off: 241, runtimeHrs: 80.7 },
		valve: { on: 68, off: 68, runtimeHrs: 10.4 },
		plantCount: 11,
		diseases: [
			{ name: "Healthy", count: 9, severity: "low" },
			{ name: "Powdery Mildew", count: 1, severity: "medium" },
			{ name: "Nutrient Deficiency", count: 1, severity: "medium" },
		],
	},
	{
		id: "2026-06",
		label: "June 2026",
		generatedOn: "July 1, 2026",
		status: "ok",
		avgTemp: 28.9,
		minTemp: 25.3,
		maxTemp: 32.7,
		avgHumidity: 60,
		minHumidity: 45,
		maxHumidity: 78,
		fan: { on: 198, off: 198, runtimeHrs: 66.1 },
		valve: { on: 59, off: 59, runtimeHrs: 8.8 },
		plantCount: 11,
		diseases: [
			{ name: "Healthy", count: 10, severity: "low" },
			{ name: "Nutrient Deficiency", count: 1, severity: "medium" },
		],
	},
];

let reports = MONTHLY_REPORTS;

// Text from the API goes into HTML below, so escape it
const esc = (v) =>
	String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fixed = (v, d, unit = "") => (v == null ? "—" : `${v.toFixed(d)}${unit}`);
const range = (lo, hi, d, unit) => (lo == null || hi == null ? "—" : `${lo.toFixed(d)}–${hi.toFixed(d)}${unit}`);
const flagCount = (r) => r.diseases.filter((d) => d.name !== "Healthy").reduce((sum, d) => sum + d.count, 0);

/* ---------- live mode: monthly reports from the API ---------- */
const LIVE_MONTHS = 6;
const SCAN_SEVERITY = { healthy: "low", nutrient_deficiency: "medium", other: "medium", diseased: "high", pest_damage: "high" };
const SCAN_LABEL = { diseased: "Diseased", pest_damage: "Pest damage", nutrient_deficiency: "Nutrient deficiency", other: "Other" };

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

function buildLiveReports(historyData, diseaseData) {
	const months = new Map();
	const month = (key) => {
		if (!months.has(key)) months.set(key, { points: [], scans: [] });
		return months.get(key);
	};
	(Array.isArray(historyData && historyData.points) ? historyData.points : []).forEach((p) => {
		const t = Number(p.t);
		if (Number.isFinite(t)) month(monthKey(new Date(t * 1000))).points.push(p);
	});
	(Array.isArray(diseaseData && diseaseData.scans) ? diseaseData.scans : []).forEach((s) => {
		const when = PlantHistory.parseUtc(s.scanned_at);
		if (when) month(monthKey(when)).scans.push(s);
	});

	const n = PlantHistory.num;
	// Weighted by how many readings each time slot holds; min / max are of those slot averages
	const stats = (points, key) => {
		let total = 0;
		let weight = 0;
		let lo = null;
		let hi = null;
		points.forEach((p) => {
			const v = n(p[key]);
			if (v == null) return;
			const w = Number(p.samples) || 1;
			total += v * w;
			weight += w;
			lo = lo == null ? v : Math.min(lo, v);
			hi = hi == null ? v : Math.max(hi, v);
		});
		return { avg: weight ? total / weight : null, min: lo, max: hi };
	};

	const asOf = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
	return [...months.entries()]
		.sort((a, b) => b[0].localeCompare(a[0]))
		.slice(0, LIVE_MONTHS) // the oldest month in the window is only partly covered
		.map(([key, m]) => {
			const temp = stats(m.points, "temperature");
			const hum = stats(m.points, "humidity");
			const counts = new Map();
			m.scans.forEach((s) => {
				const status = String(s.status || "other");
				const name = status === "healthy" ? "Healthy" : s.issue || SCAN_LABEL[status] || status;
				const entry = counts.get(name) || { name, count: 0, severity: SCAN_SEVERITY[status] || "medium" };
				entry.count += 1;
				counts.set(name, entry);
			});
			const diseases = [...counts.values()].sort((a, b) => b.count - a.count);
			return {
				id: key,
				label: monthLabel(key),
				generatedOn: `from live data, ${asOf}`,
				live: true,
				status: diseases.some((d) => d.name !== "Healthy") ? "warn" : "ok",
				avgTemp: temp.avg,
				minTemp: temp.min,
				maxTemp: temp.max,
				avgHumidity: hum.avg,
				minHumidity: hum.min,
				maxHumidity: hum.max,
				avgPressure: stats(m.points, "pressure").avg,
				avgPrecip: stats(m.points, "precipitation").avg,
				readings: m.points.reduce((sum, p) => sum + (Number(p.samples) || 0), 0),
				scans: m.scans.length,
				diseases,
			};
		});
}

function gridMessage(text) {
	grid.innerHTML = `<p class="report-empty">${esc(text)}</p>`;
}

async function loadLiveReports() {
	gridMessage("Loading reports…");
	try {
		const [historyData, diseaseData] = await Promise.all([
			PlantHistory.history(LIVE_MONTHS * 31 * 24),
			PlantHistory.disease(200),
		]);
		reports = buildLiveReports(historyData, diseaseData);
		if (!reports.length) return gridMessage("No data yet. Monthly reports appear once the ESP32 has sent readings or the plant has been scanned.");
		renderCards();
	} catch (err) {
		console.warn("Could not load reports:", err);
		reports = [];
		gridMessage(err.message);
	}
}

const grid = document.getElementById("report-grid");
const modal = document.getElementById("report-modal");
const modalTitle = document.getElementById("report-modal-title");
const docEl = document.getElementById("report-doc");
const closeBtn = document.getElementById("report-close");
const exportBtn = document.getElementById("report-export");

function statusLabel(status) {
	return status === "warn" ? "Needs attention" : "Healthy month";
}

function renderCards() {
	grid.innerHTML = reports.map(
		(r) => `
		<article class="report-card">
			<div class="report-card-head">
				<div>
					<h2>${esc(r.label)}</h2>
					<span>Generated ${esc(r.generatedOn)}</span>
				</div>
				<span class="report-badge ${r.status}">${statusLabel(r.status)}</span>
			</div>

			<div class="report-mini-stats">
				<div><span>Avg Temp</span><strong>${fixed(r.avgTemp, 1, "°C")}</strong></div>
				<div><span>Avg Humidity</span><strong>${fixed(r.avgHumidity, 0, "%")}</strong></div>
				${
					r.live
						? `<div><span>Readings</span><strong>${r.readings.toLocaleString("en-GB")}</strong></div>`
						: `<div><span>Plants Monitored</span><strong>${r.plantCount}</strong></div>`
				}
				<div><span>Disease Flags</span><strong>${flagCount(r)}</strong></div>
			</div>

			<div class="report-card-actions">
				<button type="button" data-view="${r.id}">View report</button>
				<button type="button" class="primary" data-export="${r.id}">Export PDF</button>
			</div>
		</article>`
	).join("");
}

function buildDiseaseRows(diseases) {
	if (!diseases.length) return `<p class="report-note">No scans this month.</p>`;
	const max = Math.max(...diseases.map((d) => d.count), 1);
	return diseases
		.map(
			(d) => `
			<div class="disease-row">
				<span class="name">${esc(d.name)}</span>
				<span class="bar"><span style="--sev-color:${SEVERITY_COLOR[d.severity]}; width:${
				(d.count / max) * 100
			}%"></span></span>
				<span class="count">${d.count}</span>
			</div>`
		)
		.join("");
}

function buildReportDoc(r) {
	const diseaseCount = flagCount(r);
	const devices = r.live
		? `<p class="report-note">Fan and valve activity isn't recorded in the database yet.</p>`
		: `
			<table class="device-table">
				<thead>
					<tr>
						<th>Device</th>
						<th class="num">Turned On</th>
						<th class="num">Turned Off</th>
						<th class="num">Runtime</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Fan</td>
						<td class="num">${r.fan.on}</td>
						<td class="num">${r.fan.off}</td>
						<td class="num">${r.fan.runtimeHrs.toFixed(1)} hrs</td>
					</tr>
					<tr>
						<td>Irrigation Valve</td>
						<td class="num">${r.valve.on}</td>
						<td class="num">${r.valve.off}</td>
						<td class="num">${r.valve.runtimeHrs.toFixed(1)} hrs</td>
					</tr>
				</tbody>
				<tfoot>
					<tr>
						<td>Total toggles</td>
						<td class="num" colspan="2">${r.fan.on + r.fan.off + r.valve.on + r.valve.off}</td>
						<td class="num">${(r.fan.runtimeHrs + r.valve.runtimeHrs).toFixed(1)} hrs</td>
					</tr>
				</tfoot>
			</table>`;
	const liveEnv = r.live
		? `
			<div class="env-grid env-grid-more">
				<div class="env-tile">
					<span>Avg Pressure</span>
					<strong>${fixed(r.avgPressure, 1, " hPa")}</strong>
				</div>
				<div class="env-tile">
					<span>Avg Precipitation</span>
					<strong>${fixed(r.avgPrecip, 2, " mm")}</strong>
				</div>
				<div class="env-tile">
					<span>Readings</span>
					<strong>${r.readings.toLocaleString("en-GB")}</strong>
				</div>
				<div class="env-tile">
					<span>Photo Scans</span>
					<strong>${r.scans}</strong>
				</div>
			</div>
			<p class="report-note">Ranges are taken from averaged readings (about 300 time slots across six months), so single peaks may not show.</p>`
		: "";

	docEl.innerHTML = `
		<div class="report-doc-header">
			<div class="report-doc-brand">
				<svg class="logo-icon" viewBox="0 0 40 40" aria-hidden="true">
					<path d="M20 20 C 14 21, 6 18, 4 10 C 11 8, 18 12, 20 20 Z" fill="#4CD179" />
					<path d="M20 20 C 26 21, 34 18, 36 10 C 29 8, 22 12, 20 20 Z" fill="#7FDC9C" />
					<line x1="20" y1="19" x2="20" y2="26" stroke="#4CD179" stroke-width="2" />
					<rect x="10" y="25" width="20" height="4" rx="1" fill="#F48A5C" />
					<path d="M12 30 H28 L26 37 H14 Z" fill="#F9A47D" />
				</svg>
				<div>
					<strong>Plant Check</strong>
					<span>Automated greenhouse monitoring report</span>
				</div>
			</div>
			<div class="report-doc-meta">
				<h3>${esc(r.label)}</h3>
				<p>Generated ${esc(r.generatedOn)}</p>
			</div>
		</div>

		<section class="report-section">
			<h4>Environment Summary</h4>
			<div class="env-grid">
				<div class="env-tile temp">
					<span>Avg Temperature</span>
					<strong>${fixed(r.avgTemp, 1, "°C")}</strong>
				</div>
				<div class="env-tile temp">
					<span>Temp Range</span>
					<strong>${range(r.minTemp, r.maxTemp, 1, "°C")}</strong>
				</div>
				<div class="env-tile hum">
					<span>Avg Humidity</span>
					<strong>${fixed(r.avgHumidity, 0, "%")}</strong>
				</div>
				<div class="env-tile hum">
					<span>Humidity Range</span>
					<strong>${range(r.minHumidity, r.maxHumidity, 0, "%")}</strong>
				</div>
			</div>${liveEnv}
		</section>

		<section class="report-section">
			<h4>Device Activity</h4>${devices}
		</section>

		<section class="report-section">
			<h4>Plant &amp; Disease Summary</h4>
			<div class="plant-summary">
				<div class="plant-count-box">
					<strong>${r.live ? r.scans : r.plantCount}</strong>
					<span>${r.live ? "Photo scans" : "Plants monitored"}</span>
				</div>
				<div class="disease-list">
					${buildDiseaseRows(r.diseases)}
				</div>
			</div>
		</section>

		<div class="report-doc-footer">
			${diseaseCount} disease flag${diseaseCount === 1 ? "" : "s"} ${
		r.live ? `in ${r.scans} photo scan${r.scans === 1 ? "" : "s"}` : `detected across ${r.plantCount} plants`
	} this month · Plant Check automated report
		</div>`;
}

let activeReportId = null;

function openReport(id) {
	const report = reports.find((r) => r.id === id);
	if (!report) return;
	activeReportId = id;
	modalTitle.textContent = `Monthly Report — ${report.label}`; // textContent: no escaping needed
	buildReportDoc(report);
	modal.classList.add("open");
	modal.setAttribute("aria-hidden", "false");
}

function closeReport() {
	modal.classList.remove("open");
	modal.setAttribute("aria-hidden", "true");
	activeReportId = null;
}

// The modal's open-state transition is a 0.2s fade-in. Calling window.print()
// right after writing the report's innerHTML can both race the browser's
// layout/paint (printing a blank page before anything is laid out) and catch
// the fade mid-flight (printing every color at partial opacity, i.e. "shaded"
// instead of solid). @media print disables the animation outright, but we
// also wait out its duration here as a second line of defense, plus webfonts
// and a couple of animation frames so the DOM is guaranteed painted first.
const MODAL_FADE_MS = 200;

function printActiveReport() {
	const triggerPrint = () =>
		requestAnimationFrame(() =>
			requestAnimationFrame(() => setTimeout(() => window.print(), MODAL_FADE_MS))
		);
	if (document.fonts && document.fonts.ready) {
		document.fonts.ready.then(triggerPrint, triggerPrint);
	} else {
		triggerPrint();
	}
}

grid.addEventListener("click", (event) => {
	const viewBtn = event.target.closest("[data-view]");
	const exportBtnInGrid = event.target.closest("[data-export]");
	if (viewBtn) {
		openReport(viewBtn.dataset.view);
	} else if (exportBtnInGrid) {
		openReport(exportBtnInGrid.dataset.export);
		printActiveReport();
	}
});

closeBtn.addEventListener("click", closeReport);
exportBtn.addEventListener("click", printActiveReport);

modal.addEventListener("click", (event) => {
	if (event.target === modal) closeReport();
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && modal.classList.contains("open")) closeReport();
});

if (window.PlantHistory && PlantHistory.isLive()) loadLiveReports();
else renderCards();
