// Connects the dashboard to the simulation page (simulation.html) in another tab, over a BroadcastChannel.
// The simulated ESP server talks to the dashboard the way the real one will talk to the backend:
//   POST /data   → { temperature, humidity, pressure }  (sim → dashboard: replaces the demo sensor feed)
//   GET /status  → { fan, valve }                       (dashboard → sim: the relay states)
// The simulation page can also set the plant's condition and disease.
// Readings and relay states are only exchanged while "simulation" is the dashboard's data source, so the
// simulation never mixes with live data from the real API (and it never makes network requests itself).

(function () {
	"use strict";

	if (!("BroadcastChannel" in window)) return;
	const channel = new BroadcastChannel("plantcheck-sim");
	const send = (msg) => channel.postMessage({ ...msg, from: "dashboard" });

	const status = () => ({
		fan: !!(window.PlantControls && PlantControls.fan),
		valve: !!(window.PlantControls && PlantControls.watering),
	});
	const simulating = () => !!(window.PlantSensors && PlantSensors.mode === "simulation");
	const sourceInfo = () => (window.PlantSensors ? { mode: PlantSensors.mode, state: PlantSensors.state } : null);
	const plantState = () => (document.querySelector(".plant-card") || {}).dataset?.state || "healthy";

	channel.onmessage = ({ data }) => {
		if (!data || data.from === "dashboard") return;
		switch (data.type) {
			case "data": // POST /data (ignored unless simulating)
				if (window.PlantSensors) PlantSensors.pushExternal(data.payload);
				break;
			case "get-status": // GET /status (no relay state shared unless simulating)
				send({ type: "status", id: data.id, payload: simulating() ? status() : null, source: sourceInfo() });
				break;
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
				send({ type: "hello", state: plantState(), payload: simulating() ? status() : null, source: sourceInfo() });
				break;
		}
	};

	// Push changes straight away so the simulation page stays in sync between polls
	["device:fan", "device:irrigation"].forEach((name) =>
		document.addEventListener(name, () => {
			if (simulating()) send({ type: "status", payload: status() });
		}),
	);
	document.addEventListener("plant:state", (e) => send({ type: "plant-state", state: e.detail.state }));
	document.addEventListener("sensor:source", () => send({ type: "data-source", mode: PlantSensors.mode, source: sourceInfo() }));

	send({ type: "hello", state: plantState(), payload: simulating() ? status() : null, source: sourceInfo() });
})();
