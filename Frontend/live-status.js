// Data source chip next to the greeting (a small Live / Sample data / Simulation menu) and the
// "not connected" modal shown when the chosen source stops delivering readings. Follows 'sensor:source' from sensors.js.

(function () {
	"use strict";

	const chip = document.getElementById("source-chip");
	const chipText = document.getElementById("source-chip-text");
	const menu = document.getElementById("source-options");
	const modal = document.getElementById("offline-modal");
	if (!chip || !menu || !modal || !window.PlantSensors) return;

	const host = (window.PlantAPI && PlantAPI.host) || "the server";

	function chipLabel(mode, state, reason) {
		if (mode === "sample") return "Sample data";
		if (mode === "simulation") {
			if (state === "connected") return "Simulation · ESP32 connected";
			if (state === "disconnected") return reason === "unreachable" ? "Simulation · not running" : "Simulation · ESP32 not connected";
			return "Simulation · connecting…";
		}
		if (state === "connected") return "Live · ESP32 connected";
		if (state === "disconnected") return reason === "unreachable" ? "Live · server unreachable" : "Live · ESP32 not connected";
		return "Live · connecting…";
	}

	const MODAL_COPY = {
		live: {
			"no-data": {
				title: "ESP32 not connected",
				text: "The server is up, but it hasn't had a reading from the ESP32 in the last 10 seconds. Check the ESP32's USB cable and that the ESP server on Weisen's PC is running. Until readings come back, temperature and humidity stay empty.",
			},
			unreachable: {
				title: "Can't reach the server",
				text: `The dashboard can't reach ${host}. Check your internet connection and that the API is running. Until it's back, temperature and humidity stay empty.`,
			},
		},
		simulation: {
			"no-data": {
				title: "Simulated ESP32 not connected",
				text: "The simulated backend is running but hasn't had a reading in the last 10 seconds. On the simulation page, plug the USB serial back in, reconnect the BME280 or resume the simulation.",
			},
			unreachable: {
				title: "Simulation not running",
				text: "The dashboard is set to use the simulation, but the simulation page isn't answering. Open it in another tab of this browser.",
			},
		},
	};

	/* ---------- chip menu ---------- */
	const items = [...menu.querySelectorAll("[data-source]")];

	function openMenu(open) {
		menu.hidden = !open;
		chip.setAttribute("aria-expanded", String(open));
		if (open) {
			(items.find((i) => i.getAttribute("aria-checked") === "true") || items[0]).focus();
			refreshServerStatus();
		}
	}

	// Each backend's own overview (GET /): "PlantCheck API · ok · ESP32 connected". Read-only.
	const statusLines = [...menu.querySelectorAll("[data-status-for]")];
	let statusRound = 0; // a reply from an earlier opening never overwrites a newer one
	function refreshServerStatus() {
		if (!window.PlantAPI) return;
		const round = ++statusRound;
		statusLines.forEach(async (line) => {
			const via = line.dataset.statusFor;
			const where = via === "simulation" ? "the simulation" : PlantAPI.host;
			line.dataset.state = "checking";
			line.textContent = "Checking…";
			let state = "down";
			let text;
			try {
				const res = await PlantAPI.getInfo(via);
				const info = res.data;
				if (res.ok && info && info.status === "ok") {
					state = info.sensor_connected ? "ok" : "partial";
					text = `${info.name || "API"} · ok · ESP32 ${info.sensor_connected ? "connected" : "not connected"}`;
				} else {
					text = res.ok ? `Unexpected reply from ${where}` : `${where} · error ${res.status}`;
				}
			} catch {
				text = via === "simulation" ? "Simulation page not open" : `Can't reach ${where}`;
			}
			if (round !== statusRound) return;
			line.dataset.state = state;
			line.textContent = text;
		});
	}

	chip.addEventListener("click", () => openMenu(menu.hidden));
	items.forEach((item) =>
		item.addEventListener("click", () => {
			PlantSensors.setMode(item.dataset.source);
			openMenu(false);
			chip.focus();
		}),
	);
	menu.addEventListener("keydown", (e) => {
		const i = items.indexOf(document.activeElement);
		if (e.key === "ArrowDown") items[(i + 1) % items.length].focus();
		else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length].focus();
		else if (e.key === "Escape") {
			openMenu(false);
			chip.focus();
		} else return;
		e.preventDefault();
	});
	document.addEventListener("click", (e) => {
		if (!menu.hidden && !menu.contains(e.target) && !chip.contains(e.target)) openMenu(false);
	});

	/* ---------- modal ---------- */
	const retryBtn = document.getElementById("offline-retry");
	const simLink = document.getElementById("offline-sim");
	let dismissed = false; // dismissed for this outage only; it comes back next time

	function render({ mode, state, reason }) {
		chip.dataset.state = state;
		chip.dataset.mode = mode;
		chipText.textContent = chipLabel(mode, state, reason);
		items.forEach((i) => i.setAttribute("aria-checked", String(i.dataset.source === mode)));

		if (state === "disconnected" && mode !== "sample") {
			const byMode = MODAL_COPY[mode] || MODAL_COPY.live;
			const copy = byMode[reason] || byMode["no-data"];
			document.getElementById("offline-title").textContent = copy.title;
			document.getElementById("offline-text").textContent = copy.text;
			retryBtn.hidden = false;
			simLink.hidden = mode !== "simulation";
			if (!dismissed && !modal.open) modal.showModal();
		} else {
			dismissed = false;
			if (modal.open) modal.close();
		}
	}

	document.getElementById("offline-sample").addEventListener("click", () => {
		PlantSensors.setMode("sample"); // also updates the simulation page's switch
		modal.close();
	});
	retryBtn.addEventListener("click", () => PlantSensors.retry());
	document.getElementById("offline-close").addEventListener("click", () => {
		dismissed = true;
		modal.close();
	});
	modal.addEventListener("cancel", () => {
		dismissed = true; // Esc
	});
	modal.addEventListener("click", (e) => {
		if (e.target === modal) {
			dismissed = true;
			modal.close();
		}
	});

	document.addEventListener("sensor:source", (e) => render(e.detail));
	render({ mode: PlantSensors.mode, state: PlantSensors.state || "sample", reason: PlantSensors.reason });
})();
