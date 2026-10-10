// Daily rollups: shared loader + table rows (window.PlantDaily), and the Latest updates table on the overview page.
// Loads data/daily-updates.json (sample data in public/data/). Point DATA_URL at the backend's endpoint once
// real daily data is available; it just needs the same "days" shape.
// Field names match the monthly reports in report.js where they overlap.

window.PlantDaily = (function () {
	const DATA_URL = "data/daily-updates.json";
	const CONDITION_LABEL = { healthy: "Healthy", sick: "Sick", withered: "Withered" };
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
		condition.className = `condition condition-${u.condition}`;
		condition.textContent = CONDITION_LABEL[u.condition] || u.condition;
		conditionCell.appendChild(condition);

		tr.append(
			dateCell,
			conditionCell,
			cell(`${Number(u.avgTemp).toFixed(1)}°C`, "num"),
			cell(`${u.avgHumidity}%`, "num"),
			cell(`${u.avgPrecip}%`, "num"),
			cell(String(u.fanUses), "num"),
			cell(String(u.irrigations), "num"),
			cell(u.disease || "None", u.disease ? "disease" : "disease is-none"),
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
