// Talks to the Plant Check backend (Backend/app.py) for live data. Base URL comes from window.API_CONFIG in index.html.
//   GET  /           → { name, status: "ok", sensor_connected, endpoints }
//   GET  /api/sensor → { temperature, humidity, pressure, received_at, age, connected } or { connected: false }
//   GET  /api/relay  → { fan, valve, valve_remaining }
//   POST /api/relay  → body { fan } / { valve: true, seconds } / { valve: false }; no key needed
// Successful relay commands fire 'api:relay' with the new state so the controls can resync.
// When the data source is "sample", the same calls go to the simulated backend on the simulation page
// (simulation.html) over a BroadcastChannel instead of the network (they fail fast when that page isn't open).

window.PlantAPI = (function () {
	"use strict";

	const CONFIG = window.API_CONFIG || {};
	const BASE = String(CONFIG.baseUrl || "").replace(/\/+$/, "");
	const POLL_MS = Math.max(1, Number(CONFIG.pollSeconds) || 2) * 1000;
	const TIMEOUT_MS = 6000;

	class RelayError extends Error {
		constructor(code, message) {
			super(message);
			this.code = code; // 'network' | 'failed'
		}
	}

	/* ---------- simulation transport (BroadcastChannel to simulation.html) ---------- */
	const SIM_TIMEOUT_MS = 1500; // the simulation page answers at once; no answer means it isn't open
	const simChannel = "BroadcastChannel" in window ? new BroadcastChannel("plantcheck-sim") : null;
	const simPending = new Map();
	if (simChannel) {
		simChannel.addEventListener("message", ({ data }) => {
			if (data && data.type === "api-reply" && simPending.has(data.id)) {
				simPending.get(data.id)(data);
				simPending.delete(data.id);
			}
		});
	}
	const viaSimulation = () => !!(window.PlantSensors && PlantSensors.mode === "sample");

	function simRequest(path, { method = "GET", body } = {}) {
		return new Promise((resolve, reject) => {
			if (!simChannel) return reject(new Error("BroadcastChannel not available"));
			const id = Math.random().toString(36).slice(2);
			const timer = setTimeout(() => {
				simPending.delete(id);
				reject(new Error("the simulation page isn't answering"));
			}, SIM_TIMEOUT_MS);
			simPending.set(id, (reply) => {
				clearTimeout(timer);
				resolve({ ok: reply.status >= 200 && reply.status < 300, status: reply.status, data: reply.data });
			});
			simChannel.postMessage({ type: "api", from: "dashboard", id, method, path, body });
		});
	}

	async function request(path, opts = {}) {
		if (viaSimulation()) return simRequest(path, opts);
		const { method = "GET", body } = opts;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
		try {
			const headers = {};
			if (body !== undefined) headers["Content-Type"] = "application/json";
			const res = await fetch(`${BASE}${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				cache: "no-store",
				signal: controller.signal,
			});
			let data = null;
			try {
				data = await res.json();
			} catch {
				/* non-JSON error page */
			}
			return { ok: res.ok, status: res.status, data };
		} finally {
			clearTimeout(timer);
		}
	}

	async function setRelay(body) {
		let res;
		try {
			res = await request("/api/relay", { method: "POST", body });
		} catch {
			throw new RelayError("network", viaSimulation() ? "The simulation page isn't answering. Nothing was changed." : "Couldn't reach the server. Nothing was changed.");
		}
		if (!res.ok || !res.data) {
			throw new RelayError("failed", `The server refused the command${res.data && res.data.error ? `: ${res.data.error}` : ` (${res.status})`}.`);
		}
		document.dispatchEvent(new CustomEvent("api:relay", { detail: { ...res.data, at: Date.now() } }));
		return res.data;
	}

	return {
		configured: !!BASE,
		host: BASE.replace(/^https?:\/\//, ""),
		pollMs: POLL_MS,
		getSensor: () => request("/api/sensor"),
		getRelay: () => request("/api/relay"),
		setRelay,
	};
})();
