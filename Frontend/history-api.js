// History from the Plant Check API for the history pages, and saving photo scans (window.PlantHistory).
//   GET /api/history?hours=N               → { hours, bucket_seconds, points: [{ t, temperature, humidity, pressure, precipitation, samples }] }
//   GET /api/readings?hours=N&limit&offset → { total, limit, offset, readings: [{ id, recorded_at, temperature, humidity, pressure, precipitation }] }
//   GET /api/disease?limit=N               → { scans: [{ id, scanned_at, status, issue, confidence, health_percentage, description, recommendations, image_url }] }
//   POST /api/disease                      ← { status, issue, confidence, health_percentage, description, recommendations } → { ok, id }
//   POST /api/disease/<id>/image           ← multipart form, field "image" (JPEG / PNG / WebP, max 10 MB) → { ok, id, image_url, bytes }
//   image_url is a path ("/api/disease/images/<file>") on the API, or null when the scan has no photo.
// Times from the API are UTC ("YYYY-MM-DD HH:MM:SS", or Unix seconds for history points); pages show local time.
// Reading is only used in live mode (sample mode keeps reading the sample files in public/data/). Saving a photo
// scan happens in both modes: the analysis is real either way.

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

	// body: sent as JSON; form: a FormData sent as multipart (the browser sets its Content-Type)
	async function get(path, params = {}, { method = "GET", body, form } = {}) {
		const url = new URL(`${BASE}${path}`);
		Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
		let res;
		try {
			res = await fetch(url, {
				method,
				cache: "no-store",
				headers: body === undefined ? undefined : { "Content-Type": "application/json" },
				body: form || (body === undefined ? undefined : JSON.stringify(body)),
				signal: controller.signal,
			});
		} catch {
			throw new ApiError(`Can't reach the API (${BASE.replace(/^https?:\/\//, "")}).`);
		} finally {
			clearTimeout(timer);
		}
		if (!res.ok) {
			let detail = "";
			try {
				const data = await res.json();
				detail = data && data.error ? `: ${data.error}` : "";
			} catch {
				/* no JSON error body */
			}
			if (res.status === 413) throw new ApiError(`the photo is too large for the server (HTTP 413${detail}).`);
			throw new ApiError(`The API answered with an error (HTTP ${res.status}${detail}).`);
		}
		try {
			return await res.json();
		} catch {
			if (method !== "GET") return null; // saved; the server just didn't send anything back
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
		// Saves one photo-scan result (only the fields the API stores)
		saveScan: (r) =>
			get("/api/disease", {}, {
				method: "POST",
				body: {
					status: r.status ?? null,
					issue: r.issue ?? null,
					confidence: r.confidence ?? null,
					health_percentage: r.health_percentage ?? null,
					description: r.description ?? null,
					recommendations: Array.isArray(r.recommendations) ? r.recommendations : r.recommendations ?? null,
				},
			}),
		// Uploads the photo for a saved scan
		uploadScanImage: (id, blob, filename = "scan.jpg") => {
			const form = new FormData();
			form.append("image", blob, filename);
			return get(`/api/disease/${encodeURIComponent(id)}/image`, {}, { method: "POST", form });
		},
		// "/api/disease/images/<file>" → full URL on the API (absolute URLs are kept as they are)
		imageUrl: (path) => (!path ? null : /^https?:\/\//.test(path) ? path : `${BASE}${path.startsWith("/") ? "" : "/"}${path}`),
		parseUtc,
		num,
		ApiError,
	};
})();
