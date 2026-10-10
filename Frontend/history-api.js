// Read-only history from the Plant Check API for the history pages (window.PlantHistory).
//   GET /api/history?hours=N               → { hours, bucket_seconds, points: [{ t, temperature, humidity, pressure, precipitation, samples }] }
//   GET /api/readings?hours=N&limit&offset → { total, limit, offset, readings: [{ id, recorded_at, temperature, humidity, pressure, precipitation }] }
//   GET /api/disease?limit=N               → { scans: [{ id, scanned_at, status, issue, confidence, health_percentage, description, recommendations }] }
// Times from the API are UTC ("YYYY-MM-DD HH:MM:SS", or Unix seconds for history points); pages show local time.
// Only used in live mode; sample mode keeps reading the sample files in public/data/.

window.PlantHistory = (function () {
	"use strict";

	const CONFIG = window.API_CONFIG || {};
	const BASE = String(CONFIG.baseUrl || "").replace(/\/+$/, "");
	const SOURCE_KEY = "plantcheck:data-source"; // set by the simulation page's remote (and the dashboard)
	const TIMEOUT_MS = 10000;

	// "live" or "sample" (a leftover "simulation" setting counts as sample)
	function mode() {
		if (!BASE) return "sample";
		let stored = null;
		try {
			stored = localStorage.getItem(SOURCE_KEY);
		} catch {
			/* storage blocked: use the default */
		}
		if (stored === "live") return "live";
		if (stored === "sample" || stored === "simulation") return "sample";
		return CONFIG.defaultSource === "sample" ? "sample" : "live";
	}

	class ApiError extends Error {}

	async function get(path, params = {}) {
		const url = new URL(`${BASE}${path}`);
		Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
		let res;
		try {
			res = await fetch(url, { cache: "no-store", signal: controller.signal });
		} catch {
			throw new ApiError(`Can't reach the API (${BASE.replace(/^https?:\/\//, "")}).`);
		} finally {
			clearTimeout(timer);
		}
		if (!res.ok) throw new ApiError(`The API answered with an error (HTTP ${res.status}).`);
		try {
			return await res.json();
		} catch {
			throw new ApiError("The API sent something that isn't valid data.");
		}
	}

	// "2026-10-10 18:02:07" (UTC) → Date
	function parseUtc(text) {
		if (!text) return null;
		const d = new Date(`${String(text).trim().replace(" ", "T")}Z`);
		return Number.isNaN(d.getTime()) ? null : d;
	}

	const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

	return {
		mode,
		isLive: () => mode() === "live",
		host: BASE.replace(/^https?:\/\//, ""),
		history: (hours) => get("/api/history", { hours }),
		readings: (hours, limit, offset) => get("/api/readings", { hours, limit, offset }),
		disease: (limit = 50) => get("/api/disease", { limit }),
		parseUtc,
		num,
		ApiError,
	};
})();
