// Disease page: current status, detection history and a care guide.
// Live mode: photo scans from the API (GET /api/disease via PlantHistory in history-api.js).
// Sample mode: data/disease-detections.json (sample data in public/data/).

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

	const ALERT_ICON =
		'<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5" /><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>';

	function showAlertBanner(title, text) {
		const banner = $("disease-banner");
		banner.classList.remove("is-muted");
		banner.classList.add("is-alert");
		$("banner-title").textContent = title;
		$("banner-text").textContent = text;
		banner.querySelector(".status-banner-icon").innerHTML = ALERT_ICON;
	}

	function renderBanner(detections) {
		const active = detections.filter((d) => d.status === "active");
		const latest = detections[0];

		if (active.length) {
			const names = [...new Set(active.map((d) => d.disease))].join(", ");
			showAlertBanner(`${names} detected`, "Check the guide below for what to do. The camera will keep watching.");
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

	// ----- Photo scan: photo -> DeepSeek (straight from the browser), JSON result shown in the scan card -----
	const SCAN = window.DISEASE_SCAN_CONFIG || {};
	const SCAN_TIMEOUT_MS = 90000;
	const SCAN_PROMPT = [
		"You are an expert plant pathologist. Examine the uploaded plant image and return ONLY a JSON object with this exact structure:",
		"{",
		'  "status": "healthy" | "diseased" | "pest_damage" | "nutrient_deficiency" | "other",',
		'  "issue": "short issue name or null if healthy",',
		'  "confidence": "low" | "medium" | "high",',
		'  "health_percentage": 0 to 100 (estimated overall plant health),',
		'  "description": "detailed explanation of visible symptoms or healthy state",',
		'  "risk_score": 0 to 100 (how much danger the plant is in; 0 = none, 100 = about to die or spread to other plants),',
		'  "risk_explanation": "1-2 sentences on why this score: spread, speed, severity, damaged area",',
		'  "priority": "low" | "medium" | "high" | "urgent" (how soon the owner must act),',
		'  "priority_reason": "one sentence on why act within that time frame",',
		'  "recommendations": ["step 1", "step 2", "step 3"]',
		"}",
		"No markdown, no commentary, only valid JSON.",
	].join("\n");
	const MAX_SCAN_BYTES = 8 * 1024 * 1024;
	const SCAN_MIMES = ["image/jpeg", "image/png", "image/webp"];
	const SCAN_STATUS = {
		healthy: "Healthy",
		diseased: "Diseased",
		pest_damage: "Pest damage",
		nutrient_deficiency: "Nutrient deficiency",
		other: "Other",
	};
	const PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
	const PRIORITY_TIME = { low: "Monitor and act when convenient.", medium: "Act within a few days.", high: "Act within 24 hours.", urgent: "Act today." };
	const PLANT_STATE_TEXT = {
		healthy: "Plant status set to Healthy.",
		sick: "Plant status set to Sick. The dashboard now shows the plant as sick.",
		withered: "Plant status set to Withered. The dashboard now shows the plant as withered.",
	};
	let scanFile = null;
	let previewUrl = "";

	const levelFromRisk = (risk) => (risk >= 80 ? "urgent" : risk >= 60 ? "high" : risk >= 30 ? "medium" : "low");

	// Never trust the model's level blindly: a missing or invalid one falls back to the risk score
	function scanAssessment(r, pct) {
		const healthy = r.status === "healthy";
		let risk = Number(r.risk_score);
		if (!Number.isFinite(risk)) risk = healthy ? Math.min(20, 100 - pct) : 100 - pct;
		risk = Math.round(Math.min(100, Math.max(0, risk)));
		const priority = PRIORITY_LABEL[r.priority] ? r.priority : levelFromRisk(risk);
		// Withered = the plant is mostly lost; otherwise any problem makes it sick
		const state = healthy ? "healthy" : pct <= 30 || risk >= 75 ? "withered" : "sick";
		return { risk, priority, state };
	}

	function saveScanState(state) {
		try {
			localStorage.setItem("plantcheck-scan-state", JSON.stringify({ state, at: Date.now() }));
		} catch {
			// storage unavailable: the dashboard just keeps its current status
		}
	}

	function scanError(msg) {
		const el = $("scan-error");
		el.textContent = msg || "";
		el.hidden = !msg;
	}

	function titleCase(s) {
		return String(s || "–").replace(/^./, (c) => c.toUpperCase());
	}

	const GAUGE_LENGTH = 2 * Math.PI * 18;

	function renderScanResult(r) {
		const pct = Math.min(100, Math.max(0, Number(r.health_percentage) || 0));
		const status = SCAN_STATUS[r.status] || titleCase(r.status);
		const result = $("scan-result");
		result.dataset.tone = pct >= 70 ? "good" : pct >= 40 ? "fair" : "poor";

		$("scan-health").textContent = `${pct}%`;
		$("scan-gauge").setAttribute("aria-label", `Estimated plant health ${pct}%`);
		$("scan-status").textContent = status;
		$("scan-confidence").textContent = `${titleCase(r.confidence)} confidence`;
		$("scan-issue").textContent = r.issue || (r.status === "healthy" ? "No issues found" : status);
		$("scan-description").textContent = r.description || "";

		const a = scanAssessment(r, pct);
		$("scan-priority-box").dataset.level = a.priority;
		$("scan-priority").textContent = PRIORITY_LABEL[a.priority];
		$("scan-priority-reason").textContent = [PRIORITY_TIME[a.priority], r.priority_reason].filter(Boolean).join(" ");
		$("scan-risk-box").dataset.level = levelFromRisk(a.risk);
		$("scan-risk").textContent = a.risk;
		$("scan-meter").setAttribute("aria-label", `Risk score ${a.risk} out of 100`);
		$("scan-meter-fill").style.width = `${a.risk}%`;
		$("scan-risk-reason").textContent = r.risk_explanation || "No explanation was provided for this score.";
		$("scan-plantstate").textContent = PLANT_STATE_TEXT[a.state];
		saveScanState(a.state);
		if (window.PlantCard) PlantCard.setState(a.state);

		const recs = Array.isArray(r.recommendations) ? r.recommendations : [];
		$("scan-recs").hidden = !recs.length;
		$("scan-recommendations").replaceChildren(
			...recs.map((step) => {
				const li = document.createElement("li");
				li.textContent = step;
				return li;
			}),
		);
		// Start the gauge empty so it sweeps up to the score once visible
		const fill = $("scan-gauge-fill");
		fill.style.strokeDasharray = GAUGE_LENGTH;
		fill.style.strokeDashoffset = GAUGE_LENGTH;
		result.hidden = false;
		fill.getBoundingClientRect();
		fill.style.strokeDashoffset = GAUGE_LENGTH * (1 - pct / 100);

		// Banner only changes when the scan finds a problem
		if (r.status !== "healthy") {
			showAlertBanner(`${r.issue || status} detected`, `Found by photo scan. ${PRIORITY_LABEL[a.priority]} priority, risk ${a.risk}/100. See the recommendations below.`);
		}
	}

	function readAsDataUrl(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(new Error("Couldn't read that image."));
			reader.readAsDataURL(file);
		});
	}

	// Models sometimes wrap the JSON in ```json fences despite the instructions
	function parseScanReply(text) {
		const json = String(text || "").trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
		const result = JSON.parse(json);
		if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("not an object");
		return result;
	}

	async function analysePhoto(file) {
		if (!SCAN.apiKey) throw new Error("No DeepSeek key set: add it to DISEASE_SCAN_CONFIG in disease.html.");
		const imageUrl = await readAsDataUrl(file);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
		let res;
		try {
			res = await fetch(`${String(SCAN.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "")}/chat/completions`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${SCAN.apiKey}` },
				body: JSON.stringify({
					model: SCAN.model,
					messages: [
						{ role: "system", content: SCAN_PROMPT },
						{
							role: "user",
							content: [
								{ type: "image_url", image_url: { url: imageUrl } },
								{ type: "text", text: "Analyze this plant image and report any issues using the requested JSON format." },
							],
						},
					],
					max_tokens: 1500,
					thinking: { type: "disabled" }, // thinking would eat the token budget before the JSON
				}),
				signal: controller.signal,
			});
		} catch (err) {
			throw new Error(err.name === "AbortError" ? "DeepSeek took too long to answer. Please try again." : "Couldn't reach DeepSeek. Check your internet connection.");
		} finally {
			clearTimeout(timer);
		}
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const detail = (data.error && data.error.message) || `HTTP ${res.status}`;
			throw new Error(res.status === 401 ? "DeepSeek rejected the API key." : `DeepSeek couldn't analyse the photo: ${detail}`);
		}
		try {
			return parseScanReply(data.choices[0].message.content);
		} catch {
			throw new Error("DeepSeek returned an unexpected answer. Please try again.");
		}
	}

	function initScan() {
		const input = $("scan-input");
		const submit = $("scan-submit");

		input.addEventListener("change", () => {
			scanError("");
			$("scan-result").hidden = true;
			scanFile = null;
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			previewUrl = "";
			$("scan-preview").hidden = true;
			$("scan-drop-text").hidden = false;

			const file = input.files && input.files[0];
			if (!file) return;
			if (!SCAN_MIMES.includes(file.type)) return scanError("Please pick a jpeg, png or webp image.");
			if (file.size > MAX_SCAN_BYTES) return scanError("That image is over 8 MB — please pick a smaller one.");

			scanFile = file;
			previewUrl = URL.createObjectURL(file);
			$("scan-preview").src = previewUrl;
			$("scan-preview").hidden = false;
			$("scan-drop-text").hidden = true;
		});

		submit.addEventListener("click", async () => {
			if (!scanFile) return scanError("Please upload a plant photo first.");
			scanError("");
			$("scan-result").hidden = true;
			submit.disabled = true;
			submit.textContent = "Analysing…";
			try {
				renderScanResult(await analysePhoto(scanFile));
			} catch (err) {
				scanError(err.message);
			} finally {
				submit.disabled = false;
				submit.textContent = "Analyse photo";
			}
		});
	}
	initScan();


	/* ================= Live mode: photo scans from the API (GET /api/disease) ================= */
	const SCAN_LABEL = {
		healthy: "Healthy",
		diseased: "Diseased",
		pest_damage: "Pest damage",
		nutrient_deficiency: "Nutrient deficiency",
		other: "Other",
	};
	const titleText = (s) => String(s).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

	// API scan → what this page shows
	function fromScan(s) {
		const status = String(s.status || "other");
		const healthy = status === "healthy";
		let recommendations = s.recommendations;
		if (typeof recommendations === "string") recommendations = recommendations.trim() ? [recommendations] : [];
		if (!Array.isArray(recommendations)) recommendations = [];
		const n = PlantHistory.num;
		return {
			when: PlantHistory.parseUtc(s.scanned_at),
			disease: s.issue || (healthy ? "No issue" : SCAN_LABEL[status] || titleText(status)),
			status,
			healthy,
			confidence: s.confidence == null || s.confidence === "" ? null : n(s.confidence) != null ? `${Math.round(n(s.confidence))}%` : titleText(s.confidence),
			health: n(s.health_percentage),
			description: s.description ? String(s.description) : "",
			recommendations: recommendations.map(String).filter(Boolean),
		};
	}

	const scanDaysAgo = (date) => (date ? Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000) : null);
	const scanAgo = (date) => (date ? agoText(scanDaysAgo(date)) : "at an unknown time");
	const scanTime = (date) =>
		date ? date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

	function renderLiveBanner(scans) {
		const latest = scans[0];
		const lastIssue = scans.find((s) => !s.healthy);
		if (latest && !latest.healthy) {
			const health = latest.health != null ? ` Plant health ${Math.round(latest.health)}%.` : "";
			return showAlertBanner(`${latest.disease} detected`, `Found by the latest scan, ${scanAgo(latest.when)}.${health} See the details below and the guide for what to do.`);
		}
		$("banner-title").textContent = latest ? "No active disease" : "No scans yet";
		$("banner-text").textContent = !latest
			? "Scan results will show up here once the plant has been checked."
			: `The latest scan (${scanAgo(latest.when)}) found the plant healthy${latest.health != null ? `, ${Math.round(latest.health)}% plant health` : ""}.` +
			(lastIssue ? ` Last issue: ${lastIssue.disease}, ${scanAgo(lastIssue.when)}.` : "");
	}

	function renderLiveTiles(scans) {
		const issues = scans.filter((s) => !s.healthy);
		$("tile-count").textContent = issues.filter((s) => scanDaysAgo(s.when) != null && scanDaysAgo(s.when) <= 13).length;
		$("tile-count-sub").textContent = "issues, last 14 days";
		if (issues.length) {
			const n = scanDaysAgo(issues[0].when);
			$("tile-since").textContent = n == null ? "–" : n <= 0 ? "Today" : `${n} day${n === 1 ? "" : "s"}`;
			$("tile-since-sub").textContent = issues[0].disease;
			const counts = {};
			issues.forEach((s) => (counts[s.disease] = (counts[s.disease] || 0) + 1));
			const [name, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
			$("tile-common").textContent = name;
			$("tile-common-sub").textContent = `${count} scan${count === 1 ? "" : "s"}`;
		} else {
			$("tile-since").textContent = "–";
			$("tile-since-sub").textContent = scans.length ? "no issues found" : "";
			$("tile-common").textContent = "None";
			$("tile-common-sub").textContent = "";
		}
	}

	function scanDetails(s) {
		if (!s.description && !s.recommendations.length) return null;
		const details = document.createElement("details");
		details.className = "scan-details";
		const summary = document.createElement("summary");
		summary.textContent = "Details";
		details.appendChild(summary);
		if (s.description) {
			const p = document.createElement("p");
			p.textContent = s.description;
			details.appendChild(p);
		}
		if (s.recommendations.length) {
			const ol = document.createElement("ol");
			s.recommendations.forEach((r) => {
				const li = document.createElement("li");
				li.textContent = r;
				ol.appendChild(li);
			});
			details.appendChild(ol);
		}
		return details;
	}

	function renderLiveTable(scans) {
		const body = $("detections-body");
		if (!scans.length) return tableMessage("No scans yet.");
		body.replaceChildren(
			...scans.map((s) => {
				const tr = document.createElement("tr");
				const time = document.createElement("time");
				if (s.when) time.dateTime = s.when.toISOString();
				time.textContent = scanTime(s.when);
				const issue = document.createElement("td");
				issue.className = "scan-issue-cell";
				issue.append(tag("scan-issue-name", s.disease));
				const details = scanDetails(s);
				if (details) issue.appendChild(details);
				tr.append(
					cell(time),
					issue,
					cell(tag(`detection-status is-${s.healthy ? "resolved" : "active"}`, SCAN_LABEL[s.status] || titleText(s.status))),
					cell(s.confidence || "—", "num"),
					cell(s.health != null ? `${Math.round(s.health)}%` : "—", "num"),
				);
				return tr;
			}),
		);
	}

	function tableMessage(text) {
		const td = cell(text, "updates-message");
		td.colSpan = 5;
		const tr = document.createElement("tr");
		tr.appendChild(td);
		$("detections-body").replaceChildren(tr);
	}

	function loadLive() {
		// Table columns for scans
		const heads = document.querySelectorAll(".detections-table thead th");
		["Date", "Issue", "Status", "Confidence", "Health"].forEach((text, i) => {
			if (!heads[i]) return;
			heads[i].textContent = text;
			heads[i].classList.toggle("num", i >= 3);
		});
		$("detections-sub").textContent = "From photo scans, newest first, in your local time";
		$("banner-title").textContent = "Loading the latest scans…";
		tableMessage("Loading scans…");

		PlantHistory.disease(50)
			.then((data) => {
				const scans = (Array.isArray(data && data.scans) ? data.scans : [])
					.map(fromScan)
					.sort((a, b) => (b.when ? b.when.getTime() : 0) - (a.when ? a.when.getTime() : 0));
				renderLiveBanner(scans);
				renderLiveTiles(scans);
				renderLiveTable(scans);
				renderGuide(scans.filter((s) => !s.healthy));
			})
			.catch((err) => {
				console.warn("Could not load disease scans:", err);
				$("banner-title").textContent = "Couldn't load scans";
				$("banner-text").textContent = err.message;
				$("disease-banner").classList.add("is-muted");
				tableMessage(err.message);
			});
	}

	renderGuide([]);

	if (window.PlantHistory && PlantHistory.isLive()) return loadLive();

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
