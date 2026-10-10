// Talks to the Plant Check backend (Backend/app.py) for live data. Base URL comes from window.API_CONFIG in index.html.
//   GET  /api/sensor → { temperature, humidity, pressure, received_at, age, connected } or { connected: false }
//   GET  /api/relay  → { fan, valve, valve_remaining }
//   POST /api/relay  → body { fan } / { valve: true, seconds } / { valve: false }; header X-API-Key only if the server wants it
// Commands are sent without a password first. Only if the server answers 401 (REQUIRE_DASH_KEY on) is the
// "Control password" asked for; once it works it's remembered in localStorage. It's never stored in code.
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

	/* ---------- control password (remembered in localStorage once one is needed) ---------- */
	let memoryKey = ""; // fallback when localStorage is blocked
	function getKey() {
		try {
			return localStorage.getItem(KEY_STORE) || "";
		} catch {
			return memoryKey;
		}
	}
	function setKey(key) {
		memoryKey = key;
		try {
			localStorage.setItem(KEY_STORE, key);
		} catch {
			/* keep it in memory only */
		}
	}
	function clearKey() {
		memoryKey = "";
		try {
			localStorage.removeItem(KEY_STORE);
		} catch {
			/* nothing stored */
		}
	}
	const askKey = (message) => (window.prompt(message) || "").trim();

	async function post(body, key) {
		try {
			return await request("/api/relay", { method: "POST", body, key });
		} catch {
			throw new RelayError("network", "Couldn't reach the server. Nothing was changed.");
		}
	}

	// Sends without a password (or with the remembered one). On a 401: prompt=true asks for the password and tries once
	// more (manual controls); prompt=false gives up straight away (Automate, background calls).
	async function setRelay(body, { prompt = true } = {}) {
		const remembered = getKey();
		let res = await post(body, remembered);
		if (res.status === 401) {
			if (remembered) clearKey(); // the remembered password no longer works
			if (!prompt) throw new RelayError("unauthorized", "The server needs the control password. Nothing was changed.");
			const key = askKey(remembered ? "That control password no longer works. Control password" : "Control password");
			if (!key) throw new RelayError("no-key", "The control password is needed to switch the fan or valve. Nothing was changed.");
			res = await post(body, key);
			if (res.status === 401) throw new RelayError("unauthorized", "Wrong control password. Nothing was changed.");
			if (res.ok) setKey(key); // it works: remember it
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
		// Checks the server will accept our commands (asking for the password if needed). The empty body changes nothing.
		checkAccess: () => setRelay({}, { prompt: true }),
		hasKey: () => !!getKey(),
		clearKey,
	};
})();
