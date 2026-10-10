// Latest updates table on the overview page.
// Loads daily rollups from data/daily-updates.json (sample data in public/data/) and shows the newest 7 days.
// Point DATA_URL at the backend's endpoint once real daily data is available; it just needs the same "days" shape.
// Field names match the monthly reports in report.js where they overlap.

const DATA_URL = "data/daily-updates.json";
const DAYS_SHOWN = 7;
const CONDITION_LABEL = { healthy: "Healthy", sick: "Sick", withered: "Withered" };

(function () {
	const body = document.getElementById("updates-body");
	if (!body) return;

	const COLUMNS = 8;
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

	// A single full-width row for loading / error messages
	function showMessage(text) {
		const tr = document.createElement("tr");
		const td = cell(text, "updates-message");
		td.colSpan = COLUMNS;
		tr.appendChild(td);
		body.replaceChildren(tr);
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

	async function load() {
		showMessage("Loading latest updates…");
		try {
			const res = await fetch(DATA_URL, { cache: "no-store" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			const days = Array.isArray(data.days) ? data.days.slice() : [];
			if (!days.length) {
				showMessage("No updates yet.");
				return;
			}
			days.sort((a, b) => b.date.localeCompare(a.date)); // newest first (ISO dates sort as text)
			body.replaceChildren(...days.slice(0, DAYS_SHOWN).map(row));
		} catch (err) {
			console.warn("Could not load latest updates:", err);
			showMessage(
				location.protocol === "file:"
					? "Couldn't load the data. Run npm run dev and open the site from localhost."
					: "Couldn't load the latest updates.",
			);
		}
	}

	load();
})();
