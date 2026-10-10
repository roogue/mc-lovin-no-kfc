// Talks to the Plant Check backend (Backend/app.py) for live data. Base URL comes from window.API_CONFIG in index.html.
//   GET  /api/sensor → { temperature, humidity, pressure, received_at, age, connected } or { connected: false }
//   GET  /api/relay  → { fan, valve, valve_remaining }
//   POST /api/relay  → header X-API-Key (the dashboard's "Control password"); body { fan } / { valve: true, seconds } / { valve: false }
// The password is never stored in code: it's asked for on first use and kept in sessionStorage for this tab only.
// Successful relay commands fire 'api:relay' with the new state so the controls can resync.

window.PlantAPI = (function () {
	"use strict";

	const CONFIG = window.API_CONFIG || {};
	const BASE = String(CONFIG.baseUrl || "").replace(/\/+$/, "");
	const POLL_MS = Math.max(1, Number(CONFIG.pollSeconds) || 2) * 1000;
	const TIMEOUT_MS = 6000;
	const KEY_STORE = "plantcheck:control-key";

	class RelayError extends Error {
		constructor(code, message) {
			super(message);
			this.code = code; // 'no-key' | 'unauthorized' | 'network' | 'failed'
		}
	}

	async function request(path, { method = "GET", body, key } = {}) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
		try {
			const headers = {};
			if (body !== undefined) headers["Content-Type"] = "application/json";
			if (key) headers["X-API-Key"] = key;
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

	/* ---------- control password (sessionStorage, this tab only) ---------- */
	function getKey() {
		try {
			return sessionStorage.getItem(KEY_STORE) || "";
		} catch {
			return memoryKey;
		}
	}
	let memoryKey = ""; // fallback when sessionStorage is blocked
	function setKey(key) {
		memoryKey = key;
		try {
			sessionStorage.setItem(KEY_STORE, key);
		} catch {
			/* keep it in memory only */
		}
	}
	function clearKey() {
		memoryKey = "";
		try {
			sessionStorage.removeItem(KEY_STORE);
		} catch {
			/* nothing stored */
		}
	}
	function askKey() {
		const key = (window.prompt("Control password") || "").trim();
		if (key) setKey(key);
		return key;
	}

	// prompt: ask for the password if this tab doesn't have one yet (manual controls do; Automate never does)
	async function setRelay(body, { prompt = true } = {}) {
		let key = getKey();
		if (!key && prompt) key = askKey();
		if (!key) throw new RelayError("no-key", "The control password is needed to switch the fan or valve.");

		let res;
		try {
			res = await request("/api/relay", { method: "POST", body, key });
		} catch {
			throw new RelayError("network", "Couldn't reach the server. Nothing was changed.");
		}
		if (res.status === 401) {
			clearKey();
			throw new RelayError("unauthorized", "Wrong control password. Nothing was changed.");
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
		hasKey: () => !!getKey(),
		askKey,
		clearKey,
	};
})();
