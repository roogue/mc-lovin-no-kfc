// Daily rollups: shared loader + table rows (window.PlantDaily), and the Latest updates table on the overview page.
// Sample mode: data/daily-updates.json (sample data in public/data/).
// Live mode (overview table): each day is built from the database through the API (PlantHistory in history-api.js):
// averages from GET /api/history, condition and disease from that day's scans in GET /api/disease. Fan and
// watering counts aren't recorded by the API yet, so they show "—".
// Field names match the monthly reports in report.js where they overlap.

window.PlantDaily = (function () {
	const DATA_URL = "data/daily-updates.json";
	const CONDITION_LABEL = { healthy: "Healthy", sick: "Sick", withered: "Withered" };
	// Missing values (live data) show as "—"
	const fixed = (v, decimals, unit) =>
		v == null || v === "" || !Number.isFinite(Number(v)) ? "—" : `${Number(v).toFixed(decimals)}${unit}`;
	const COLUMNS = 8;
	let request = null;

	// Resolves to every day in the file, newest first
	function load() {
		if (!request) {
			request = fetch(DATA_URL, { cache: "no-store" })
				.then((res) => {
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					return res.json();
				})
				.then((data) => {
					const days = Array.isArray(data.days) ? data.days.slice() : [];
					return days.sort((a, b) => b.date.localeCompare(a.date)); // ISO dates sort as text
				})
				.catch((err) => {
					request = null; // allow a retry
					throw err;
				});
		}
		return request;
	}

	const today = new Date();
	const isSameDay = (a, b) =>
		a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

	function formatDate(iso) {
		const d = new Date(`${iso}T00:00:00`);
		if (isSameDay(d, today)) return "Today";
		return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
	}

	function cell(text, className) {
		const td = document.createElement("td");
		if (className) td.className = className;
		td.textContent = text;
		return td;
	}

	function row(u) {
		const tr = document.createElement("tr");

		const dateCell = document.createElement("td");
		const time = document.createElement("time");
		time.dateTime = u.date;
		time.textContent = formatDate(u.date);
		dateCell.appendChild(time);

		const conditionCell = document.createElement("td");
		const condition = document.createElement("span");
		condition.className = `condition condition-${u.condition || "none"}`;
		condition.textContent = u.condition ? CONDITION_LABEL[u.condition] || u.condition : "No scan";
		conditionCell.appendChild(condition);

		const precipMm = u.precipUnit === "mm";
		tr.append(
			dateCell,
			conditionCell,
			cell(fixed(u.avgTemp, 1, "°C"), "num"),
			cell(fixed(u.avgHumidity, 0, "%"), "num"),
			cell(fixed(u.avgPrecip, precipMm ? 1 : 0, precipMm ? " mm" : "%"), "num"),
			cell(u.fanUses == null ? "—" : String(u.fanUses), "num"),
			cell(u.irrigations == null ? "—" : String(u.irrigations), "num"),
			cell(u.disease || (u.condition ? "None" : "—"), u.disease ? "disease" : "disease is-none"),
		);
		return tr;
	}

	// A single full-width row for loading / error messages
	function showMessage(body, text) {
		const tr = document.createElement("tr");
		const td = cell(text, "updates-message");
		td.colSpan = COLUMNS;
		tr.appendChild(td);
		body.replaceChildren(tr);
	}

	function errorMessage() {
		return location.protocol === "file:"
			? "Couldn't load the data. Run npm run dev and open the site from localhost."
			: "Couldn't load the data.";
	}

	return { load, row, formatDate, showMessage, errorMessage, CONDITION_LABEL };
})();

// Latest updates table (overview page): the newest 7 days
(function () {
	const DAYS_SHOWN = 7;
	const body = document.getElementById("updates-body");
	if (!body) return;

	// Live: one row per local day with readings or scans, built from the database
	const dayKey = (date) =>
		`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

	function buildDays(historyData, diseaseData) {
		const first = new Date();
		first.setHours(0, 0, 0, 0);
		first.setDate(first.getDate() - (DAYS_SHOWN - 1));
		const oldest = dayKey(first);
		const days = new Map();
		const day = (key) => {
			if (!days.has(key)) days.set(key, { sums: {}, weights: {}, scans: [] });
			return days.get(key);
		};

		(Array.isArray(historyData && historyData.points) ? historyData.points : []).forEach((p) => {
			const t = Number(p.t);
			if (!Number.isFinite(t)) return;
			const key = dayKey(new Date(t * 1000));
			if (key < oldest) return;
			const d = day(key);
			const w = Number(p.samples) || 1;
			["temperature", "humidity", "precipitation"].forEach((k) => {
				const v = PlantHistory.num(p[k]);
				if (v == null) return;
				d.sums[k] = (d.sums[k] || 0) + v * w;
				d.weights[k] = (d.weights[k] || 0) + w;
			});
		});
		(Array.isArray(diseaseData && diseaseData.scans) ? diseaseData.scans : []).forEach((s) => {
			const when = PlantHistory.parseUtc(s.scanned_at);
			if (!when || dayKey(when) < oldest) return;
			day(dayKey(when)).scans.push(s);
		});

		const avg = (d, k) => (d.weights[k] ? d.sums[k] / d.weights[k] : null);
		return [...days.entries()]
			.sort((a, b) => b[0].localeCompare(a[0]))
			.slice(0, DAYS_SHOWN)
			.map(([date, d]) => {
				const issues = d.scans.filter((s) => s.status && s.status !== "healthy");
				const names = [...new Set(issues.map((s) => s.issue || String(s.status).replace(/_/g, " ")))];
				return {
					date,
					condition: issues.length ? "sick" : d.scans.length ? "healthy" : null,
					avgTemp: avg(d, "temperature"),
					avgHumidity: avg(d, "humidity"),
					avgPrecip: avg(d, "precipitation"),
					precipUnit: "mm",
					fanUses: null,
					irrigations: null,
					disease: names.length ? names.join(", ") : null,
				};
			});
	}

	if (window.PlantHistory && PlantHistory.isLive()) {
		const sub = document.getElementById("updates-sub");
		if (sub) sub.textContent = "From the database, last 7 days. Fan and watering counts aren't recorded yet.";
		PlantDaily.showMessage(body, "Loading latest updates…");
		Promise.all([PlantHistory.history(DAYS_SHOWN * 24), PlantHistory.disease(100)])
			.then(([historyData, diseaseData]) => {
				const days = buildDays(historyData, diseaseData);
				if (!days.length) return PlantDaily.showMessage(body, "No readings or scans in the last 7 days yet.");
				body.replaceChildren(...days.map(PlantDaily.row));
			})
			.catch((err) => {
				console.warn("Could not load latest updates:", err);
				PlantDaily.showMessage(body, err.message);
			});
		return;
	}

	PlantDaily.showMessage(body, "Loading latest updates…");
	PlantDaily.load()
		.then((days) => {
			if (!days.length) return PlantDaily.showMessage(body, "No updates yet.");
			body.replaceChildren(...days.slice(0, DAYS_SHOWN).map(PlantDaily.row));
		})
		.catch((err) => {
			console.warn("Could not load latest updates:", err);
			PlantDaily.showMessage(body, PlantDaily.errorMessage());
		});
})();
