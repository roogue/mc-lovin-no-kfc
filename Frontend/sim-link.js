// Connects the dashboard to the simulation page (simulation.html) in another tab, over a BroadcastChannel:
// the plant's condition and disease, the data source switch, and a "hello" so each side knows the other is open.
// Readings and relay commands don't go through here: in "simulation" mode api.js calls the simulated backend
// on that page directly, with the same endpoints as the real API.

(function () {
	"use strict";

	if (!("BroadcastChannel" in window)) return;
	const channel = new BroadcastChannel("plantcheck-sim");
	const send = (msg) => channel.postMessage({ ...msg, from: "dashboard" });

	const sourceInfo = () => (window.PlantSensors ? { mode: PlantSensors.mode, state: PlantSensors.state } : null);
	const plantState = () => (document.querySelector(".plant-card") || {}).dataset?.state || "healthy";

	channel.onmessage = ({ data }) => {
		if (!data || data.from === "dashboard") return;
		switch (data.type) {
			case "plant-state":
				if (window.PlantCard) PlantCard.setState(data.state);
				break;
			case "disease":
				document.dispatchEvent(new CustomEvent("plant:disease", { detail: data.payload }));
				break;
			case "data-source": // Sample data / live from ESP32 switch on the simulation page
				if (window.PlantSensors) PlantSensors.setMode(data.mode);
				break;
			case "hello":
				send({ type: "hello", state: plantState(), source: sourceInfo() });
				break;
		}
	};

	document.addEventListener("plant:state", (e) => send({ type: "plant-state", state: e.detail.state }));
	document.addEventListener("sensor:source", () => send({ type: "data-source", mode: PlantSensors.mode, source: sourceInfo() }));

	send({ type: "hello", state: plantState(), source: sourceInfo() });
})();
