// Data source status next to the greeting ("Live · ESP32 connected", "Sample · simulated ESP32 connected", …). Follows 'sensor:source'
// from sensors.js. The source itself is chosen on the simulation page (the remote control), never here.
// When readings stop, the chip says why and the temperature / humidity cards show it (no popup).

(function () {
	"use strict";

	const chip = document.getElementById("source-chip");
	const chipText = document.getElementById("source-chip-text");
	if (!chip || !window.PlantSensors) return;

	function chipLabel(mode, state, reason) {
		if (mode === "sample") {
			// The simulation page's ESP32 while that page is open, otherwise the demo feed
			if (state === "connected") return "Sample · simulated ESP32 connected";
			if (state === "disconnected") return "Sample · simulated ESP32 not connected";
			return "Sample data";
		}
		if (state === "connected") return "Live · ESP32 connected";
		if (state === "disconnected") return reason === "unreachable" ? "Live · server unreachable" : "Live · ESP32 not connected";
		return "Live · connecting…";
	}

	function render({ mode, state, reason }) {
		chip.dataset.state = state;
		chip.dataset.mode = mode;
		chipText.textContent = chipLabel(mode, state, reason);
	}

	document.addEventListener("sensor:source", (e) => render(e.detail));
	render({ mode: PlantSensors.mode, state: PlantSensors.state || "sample", reason: PlantSensors.reason });
})();
