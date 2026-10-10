// Plant status banner under "Hello Admin!".
// Follows the plant's condition ('plant:state' from plant.js), live sensor readings ('sensor:update' from sensors.js)
// and the latest disease detection (live: the latest scan with an issue from GET /api/disease; sample:
// data/disease-detections.json). Preview a status with ?alert=danger (or healthy / sick / withered).

(function () {
	"use strict";

	const banner = document.getElementById("plant-alert");
	if (!banner) return;

	const $ = (id) => document.getElementById(id);
	const els = {
		eyebrow: $("alert-eyebrow"),
		title: $("alert-title"),
		detail: $("alert-detail"),
		actions: $("alert-actions"),
		particles: $("alert-particles"),
		announce: $("alert-announce"),
	};

	// Danger = a struggling plant under heat / humidity stress, or conditions extreme enough to hurt any plant
	const RULES = { stressTemp: 33, stressHumidity: 85, extremeTemp: 35, extremeHumidity: 92 };
	const PARTICLE = { healthy: "leaf", sick: "spore", withered: "dry", danger: "ember" };
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const preview = new URLSearchParams(location.search).get("alert");

	const plantCard = document.querySelector(".plant-card");
	let plantState = (plantCard && plantCard.dataset.state) || "healthy";
	let health = null;
	let reading = null;
	let disease = null; // latest detection: { disease, confidence (number, or text like "high"), date }
	let current = null;
	let actionsKey = "";

	function statusNow() {
		if (["healthy", "sick", "withered", "danger"].includes(preview)) return preview;
		if (reading) {
			const extreme = reading.temperature >= RULES.extremeTemp || reading.humidity >= RULES.extremeHumidity;
			const stressed = reading.temperature >= RULES.stressTemp || reading.humidity >= RULES.stressHumidity;
			if (extreme || (plantState !== "healthy" && stressed)) return "danger";
		}
		return plantState;
	}

	const diseaseName = () => (disease && disease.disease) || "a leaf disease";
	const readingText = () => (reading ? `${reading.temperature.toFixed(1)}°C and ${Math.round(reading.humidity)}% humidity` : "");

	function copy(status) {
		if (status === "healthy") {
			return {
				eyebrow: "All clear",
				title: "Your plant is healthy",
				detail: reading ? `Happy and thriving at ${readingText()}. Keep it up!` : "Happy and thriving. Keep it up!",
				actions: [{ label: "View history", href: "monitoring-history.html" }],
			};
		}
		if (status === "sick") {
			const conf = disease && disease.confidence;
			const seen = conf == null || conf === "" ? "" : Number.isFinite(Number(conf)) ? ` (${Math.round(Number(conf))}% sure)` : ` (${String(conf).toLowerCase()} confidence)`;
			return {
				eyebrow: "Health alert",
				title: `Your plant has ${diseaseName()}`,
				detail: `Spotted by the plant camera${seen}. Treat it early to stop it spreading.`,
				actions: [{ label: "See treatment", href: "disease.html", primary: true }],
			};
		}
		if (status === "withered") {
			return {
				eyebrow: "Needs care",
				title: "Your plant has withered",
				detail: `Health is down to ${health ?? 12}%. Give it water and some shade as soon as you can.`,
				actions: [
					{ label: "Water now", act: "water", primary: true },
					{ label: "Care tips", href: "disease.html" },
				],
			};
		}
		const why = [];
		if (plantState === "sick") why.push(diseaseName());
		if (plantState === "withered") why.push("wilting");
		if (reading && reading.temperature >= RULES.stressTemp) why.push(`${reading.temperature.toFixed(1)}°C heat`);
		if (reading && reading.humidity >= RULES.stressHumidity) why.push(`${Math.round(reading.humidity)}% humidity`);
		const cause = why.length ? `${why.join(" + ")}. ` : "";
		return {
			eyebrow: "Critical",
			title: "Your plant is in danger!",
			detail: `${cause.charAt(0).toUpperCase()}${cause.slice(1)}Act now: water it and get the air moving.`,
			actions: [
				{ label: "Water now", act: "water", primary: true },
				{ label: "Turn on fan", act: "fan" },
			],
		};
	}

	// Headline words drift in one after another
	function setTitle(text, animate) {
		if (els.title.dataset.text === text && !animate) return;
		els.title.dataset.text = text;
		els.title.replaceChildren(
			...text.split(" ").flatMap((word, i, all) => {
				const span = document.createElement("span");
				span.className = "w";
				span.style.setProperty("--i", i);
				span.textContent = word;
				return i < all.length - 1 ? [span, document.createTextNode(" ")] : [span];
			}),
		);
		els.title.classList.remove("enter");
		void els.title.offsetWidth; // restart the animation
		els.title.classList.add("enter");
	}

	function spawnParticles(status) {
		els.particles.replaceChildren();
		if (reducedMotion) return;
		const count = status === "danger" ? 12 : 14;
		for (let i = 0; i < count; i++) {
			const p = document.createElement("span");
			p.className = `particle ${PARTICLE[status]}`;
			const dur = 6 + Math.random() * 6;
			p.style.setProperty("--x", `${(Math.random() * 100).toFixed(1)}%`);
			p.style.setProperty("--s", `${(6 + Math.random() * 8).toFixed(1)}px`);
			p.style.setProperty("--t", `${(status === "danger" ? dur * 0.45 : dur).toFixed(2)}s`);
			p.style.setProperty("--d", `${(-Math.random() * dur).toFixed(2)}s`); // start mid-flight
			p.style.setProperty("--r", `${Math.round(Math.random() * 540 - 270)}deg`);
			p.style.setProperty("--drift", `${Math.round(Math.random() * 120 - 40)}px`);
			els.particles.appendChild(p);
		}
	}

	function renderActions(actions) {
		const watering = window.PlantControls && PlantControls.watering;
		const fan = window.PlantControls && PlantControls.fan;
		const items = actions.map((a) => {
			if (a.act === "water" && watering) return { ...a, label: "Watering…", disabled: true };
			if (a.act === "fan" && fan) return { ...a, label: "Fan is on", disabled: true };
			return a;
		});
		const key = JSON.stringify(items);
		if (key === actionsKey) return; // don't rebuild (and lose focus) when nothing changed
		actionsKey = key;

		els.actions.replaceChildren(
			...items.map((a) => {
				const el = document.createElement(a.href ? "a" : "button");
				el.className = `alert-btn${a.primary ? " primary" : ""}`;
				el.textContent = a.label;
				if (a.href) {
					el.href = a.href;
				} else {
					el.type = "button";
					el.disabled = !!a.disabled;
					el.addEventListener("click", () => {
						if (!window.PlantControls) return;
						if (a.act === "water") PlantControls.water(1);
						if (a.act === "fan") PlantControls.fanOn();
					});
				}
				return el;
			}),
		);
	}

	function render() {
		const status = statusNow();
		const c = copy(status);
		const changed = status !== current;

		els.eyebrow.textContent = c.eyebrow;
		els.detail.textContent = c.detail;
		setTitle(c.title, changed);
		renderActions(c.actions);

		if (changed) {
			current = status;
			banner.dataset.status = status;
			spawnParticles(status);
			// Announce status changes (not every sensor tick); danger interrupts
			els.announce.setAttribute("aria-live", status === "danger" ? "assertive" : "polite");
			els.announce.textContent = `${c.title} ${c.detail}`;
		}
	}

	document.addEventListener("plant:state", (e) => {
		plantState = e.detail.state;
		health = e.detail.health;
		render();
	});
	document.addEventListener("sensor:lost", () => {
		reading = null;
		render();
	});
	document.addEventListener("sensor:update", (e) => {
		reading = e.detail;
		render();
	});
	["device:fan", "device:irrigation"].forEach((name) => document.addEventListener(name, () => render()));
	// A disease reported live (e.g. chosen on the simulation page) replaces the sample detection
	document.addEventListener("plant:disease", (e) => {
		disease = e.detail;
		render();
	});

	if (window.PlantHistory && PlantHistory.isLive()) {
		PlantHistory.disease(20)
			.then((data) => {
				const scans = (data && Array.isArray(data.scans) ? data.scans : [])
					.filter((s) => s.status && s.status !== "healthy")
					.sort((a, b) => String(b.scanned_at).localeCompare(String(a.scanned_at)));
				const s = scans[0];
				disease = s ? { disease: s.issue || String(s.status).replace(/_/g, " "), confidence: s.confidence, date: s.scanned_at } : null;
				render();
			})
			.catch(() => {}); // keep the generic wording if scans can't load
	} else {
		fetch("data/disease-detections.json", { cache: "no-store" })
			.then((res) => (res.ok ? res.json() : null))
			.then((data) => {
				const list = (data && Array.isArray(data.detections) ? data.detections : []).slice();
				list.sort((a, b) => b.date.localeCompare(a.date));
				disease = list[0] || null;
				render();
			})
			.catch(() => {}); // keep the generic wording if detections can't load
	}

	render();
})();
