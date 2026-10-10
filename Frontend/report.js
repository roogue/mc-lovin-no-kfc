// Report History page — monthly mock reports with print/export-to-PDF support.
// Data here is a static mockup; swap MONTHLY_REPORTS for real aggregated readings
// from the backend once monthly rollups are available.

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
	grid.innerHTML = MONTHLY_REPORTS.map(
		(r) => `
		<article class="report-card">
			<div class="report-card-head">
				<div>
					<h2>${r.label}</h2>
					<span>Generated ${r.generatedOn}</span>
				</div>
				<span class="report-badge ${r.status}">${statusLabel(r.status)}</span>
			</div>

			<div class="report-mini-stats">
				<div><span>Avg Temp</span><strong>${r.avgTemp.toFixed(1)}°C</strong></div>
				<div><span>Avg Humidity</span><strong>${r.avgHumidity}%</strong></div>
				<div><span>Plants Monitored</span><strong>${r.plantCount}</strong></div>
				<div><span>Disease Flags</span><strong>${r.diseases
					.filter((d) => d.name !== "Healthy")
					.reduce((sum, d) => sum + d.count, 0)}</strong></div>
			</div>

			<div class="report-card-actions">
				<button type="button" data-view="${r.id}">View report</button>
				<button type="button" class="primary" data-export="${r.id}">Export PDF</button>
			</div>
		</article>`
	).join("");
}

function buildDiseaseRows(diseases) {
	const max = Math.max(...diseases.map((d) => d.count), 1);
	return diseases
		.map(
			(d) => `
			<div class="disease-row">
				<span class="name">${d.name}</span>
				<span class="bar"><span style="--sev-color:${SEVERITY_COLOR[d.severity]}; width:${
				(d.count / max) * 100
			}%"></span></span>
				<span class="count">${d.count}</span>
			</div>`
		)
		.join("");
}

function buildReportDoc(r) {
	const diseaseCount = r.diseases
		.filter((d) => d.name !== "Healthy")
		.reduce((sum, d) => sum + d.count, 0);

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
				<h3>${r.label}</h3>
				<p>Generated ${r.generatedOn}</p>
			</div>
		</div>

		<section class="report-section">
			<h4>Environment Summary</h4>
			<div class="env-grid">
				<div class="env-tile temp">
					<span>Avg Temperature</span>
					<strong>${r.avgTemp.toFixed(1)}°C</strong>
				</div>
				<div class="env-tile temp">
					<span>Temp Range</span>
					<strong>${r.minTemp.toFixed(1)}–${r.maxTemp.toFixed(1)}°C</strong>
				</div>
				<div class="env-tile hum">
					<span>Avg Humidity</span>
					<strong>${r.avgHumidity}%</strong>
				</div>
				<div class="env-tile hum">
					<span>Humidity Range</span>
					<strong>${r.minHumidity}–${r.maxHumidity}%</strong>
				</div>
			</div>
		</section>

		<section class="report-section">
			<h4>Device Activity</h4>
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
			</table>
		</section>

		<section class="report-section">
			<h4>Plant &amp; Disease Summary</h4>
			<div class="plant-summary">
				<div class="plant-count-box">
					<strong>${r.plantCount}</strong>
					<span>Plants monitored</span>
				</div>
				<div class="disease-list">
					${buildDiseaseRows(r.diseases)}
				</div>
			</div>
		</section>

		<div class="report-doc-footer">
			${diseaseCount} disease flag${diseaseCount === 1 ? "" : "s"} detected across ${
		r.plantCount
	} plants this month · Plant Check automated report
		</div>`;
}

let activeReportId = null;

function openReport(id) {
	const report = MONTHLY_REPORTS.find((r) => r.id === id);
	if (!report) return;
	activeReportId = id;
	modalTitle.textContent = `Monthly Report — ${report.label}`;
	buildReportDoc(report);
	modal.classList.add("open");
	modal.setAttribute("aria-hidden", "false");
}

function closeReport() {
	modal.classList.remove("open");
	modal.setAttribute("aria-hidden", "true");
	activeReportId = null;
}

// Calling window.print() right after writing the report's innerHTML can race
// the browser's layout/paint — some machines print a blank page because the
// freshly-injected DOM hasn't been laid out yet. Waiting for webfonts plus a
// couple of animation frames guarantees the modal has actually been painted
// before print() captures it.
function printActiveReport() {
	const triggerPrint = () => requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
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

renderCards();
