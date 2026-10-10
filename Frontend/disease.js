// Disease page: current status, detection history and a care guide.
// Detections come from data/disease-detections.json (sample data in public/data/); point DATA_URL at the
// backend once the camera's disease model reports real detections.

(function () {
	"use strict";

	const DATA_URL = "data/disease-detections.json";
	const $ = (id) => document.getElementById(id);

	const SEVERITY_LABEL = { low: "Low", medium: "Medium", high: "High" };
	const STATUS_LABEL = { active: "Active", resolved: "Resolved" };

	// Care guide shown under the table; detections link to these by name
	const GUIDE = [
		{
			name: "Powdery Mildew",
			severity: "medium",
			signs: "White, powdery spots on leaves and stems that slowly spread across the leaf.",
			cause: "Humid air with poor airflow, especially warm days followed by cool nights.",
			action: "Remove affected leaves, keep air moving (Automate runs the fan above 80% humidity), water the soil rather than the leaves, and treat with a sulfur or potassium bicarbonate spray.",
		},
		{
			name: "Leaf Blight",
			severity: "high",
			signs: "Brown or black patches with yellow edges that grow quickly; leaves wilt and drop.",
			cause: "Fungal or bacterial infection spread by splashing water and leaves that stay wet.",
			action: "Cut off infected leaves and bin them (don't compost), avoid wetting the leaves, clean your tools, and use a copper-based fungicide if it keeps spreading.",
		},
		{
			name: "Nutrient Deficiency",
			severity: "medium",
			signs: "Yellowing between the veins or on older leaves, pale new growth and slow growth.",
			cause: "Tired soil, or soil pH that stops the roots taking up nutrients.",
			action: "Feed with a balanced fertiliser, check the soil pH, and refresh the potting mix if it's old.",
		},
		{
			name: "Root Rot",
			severity: "high",
			signs: "Wilting even when the soil is wet, yellow leaves, and soft, dark roots with a sour smell.",
			cause: "Too much water and poor drainage, so the roots sit in wet soil.",
			action: "Let the soil dry out, make sure the pot drains, trim rotten roots and repot in fresh mix, then water less often.",
		},
	];

	const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
	const daysAgo = (iso) => Math.round((startOfDay(new Date()) - new Date(`${iso}T00:00:00`)) / 86400000);
	const agoText = (n) => (n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);

	function tag(className, text) {
		const span = document.createElement("span");
		span.className = className;
		span.textContent = text;
		return span;
	}

	function cell(content, className) {
		const td = document.createElement("td");
		if (className) td.className = className;
		if (typeof content === "string") td.textContent = content;
		else td.appendChild(content);
		return td;
	}

	function renderBanner(detections) {
		const banner = $("disease-banner");
		const active = detections.filter((d) => d.status === "active");
		const latest = detections[0];

		if (active.length) {
			const names = [...new Set(active.map((d) => d.disease))].join(", ");
			banner.classList.add("is-alert");
			$("banner-title").textContent = `${names} detected`;
			$("banner-text").textContent = "Check the guide below for what to do. The camera will keep watching.";
			banner.querySelector(".status-banner-icon").innerHTML =
				'<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5" /><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>';
		} else {
			$("banner-title").textContent = "No active disease";
			$("banner-text").textContent = latest
				? `Last detection: ${latest.disease}, ${agoText(daysAgo(latest.date))}. It has been resolved.`
				: "Nothing has been detected yet.";
		}
	}

	function renderTiles(detections) {
		const recent = detections.filter((d) => daysAgo(d.date) <= 13);
		$("tile-count").textContent = recent.length;

		if (detections.length) {
			const n = daysAgo(detections[0].date);
			$("tile-since").textContent = n <= 0 ? "Today" : `${n} day${n === 1 ? "" : "s"}`;
			$("tile-since-sub").textContent = detections[0].disease;

			const counts = {};
			detections.forEach((d) => (counts[d.disease] = (counts[d.disease] || 0) + 1));
			const [name, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
			$("tile-common").textContent = name;
			$("tile-common-sub").textContent = `${count} detection${count === 1 ? "" : "s"}`;
		} else {
			$("tile-since").textContent = "–";
			$("tile-common").textContent = "None";
		}
	}

	function renderTable(detections) {
		const body = $("detections-body");
		if (!detections.length) {
			const tr = document.createElement("tr");
			const td = cell("No detections yet.", "updates-message");
			td.colSpan = 5;
			tr.appendChild(td);
			return body.replaceChildren(tr);
		}
		body.replaceChildren(
			...detections.map((d) => {
				const tr = document.createElement("tr");
				const time = document.createElement("time");
				time.dateTime = d.date;
				time.textContent = PlantDaily.formatDate(d.date);
				tr.append(
					cell(time),
					cell(d.disease),
					cell(tag(`severity severity-${d.severity}`, SEVERITY_LABEL[d.severity] || d.severity)),
					cell(`${d.confidence}%`, "num"),
					cell(tag(`detection-status is-${d.status}`, STATUS_LABEL[d.status] || d.status)),
				);
				return tr;
			}),
		);
	}

	function renderGuide(detections) {
		const seen = new Set(detections.map((d) => d.disease));
		$("guide-grid").replaceChildren(
			...GUIDE.map((g) => {
				const card = document.createElement("article");
				card.className = "card panel guide-card";
				const head = document.createElement("div");
				head.className = "guide-head";
				const h3 = document.createElement("h3");
				h3.textContent = g.name;
				head.append(h3, tag(`severity severity-${g.severity}`, `${SEVERITY_LABEL[g.severity]} risk`));
				card.appendChild(head);
				if (seen.has(g.name)) card.appendChild(tag("guide-seen", "Seen on this plant"));

				const dl = document.createElement("dl");
				[["What you'll see", g.signs], ["Why it happens", g.cause], ["What to do", g.action]].forEach(([term, text]) => {
					const dt = document.createElement("dt");
					dt.textContent = term;
					const dd = document.createElement("dd");
					dd.textContent = text;
					dl.append(dt, dd);
				});
				card.appendChild(dl);
				return card;
			}),
		);
	}

	renderGuide([]);

	fetch(DATA_URL, { cache: "no-store" })
		.then((res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.json();
		})
		.then((data) => {
			const detections = (Array.isArray(data.detections) ? data.detections.slice() : []).sort((a, b) =>
				b.date.localeCompare(a.date),
			);
			renderBanner(detections);
			renderTiles(detections);
			renderTable(detections);
			renderGuide(detections);
		})
		.catch((err) => {
			console.warn("Could not load disease detections:", err);
			$("banner-title").textContent = "Couldn't load detections";
			$("banner-text").textContent = PlantDaily.errorMessage();
			$("disease-banner").classList.add("is-muted");
			const td = cell(PlantDaily.errorMessage(), "updates-message");
			td.colSpan = 5;
			const tr = document.createElement("tr");
			tr.appendChild(td);
			$("detections-body").replaceChildren(tr);
		});
})();
