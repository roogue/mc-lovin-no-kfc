// Runs the trained forecast model in the browser (window.PlantForecast), so the Prediction page can predict
// from the readings in the database. The model comes from data/model.json, written by
// Prediction-Training/export_js.py from model.joblib; the features below follow Prediction-Training/features.py
// and predict.py step for step (they must stay identical, or the model sees different numbers than in training).
//   loadModel()                → the model (fetched once)
//   predict(model, readings)   readings: [{ t (ms), temperature, humidity, pressure, precipitation }], any order
//     → { ready: true, partial, horizon_minutes, temperature, humidity, precipitation, stress_probability,
//         stress_window_minutes, needed_minutes, have_minutes, rows }
//       partial: less than about 6 hours without long gaps, so gaps are filled and lags reaching back further than
//       the data use the oldest reading (a rougher guess: the model was trained on full histories).
//     → { ready: false, missing: [columns with no values at all], needed_minutes, have_minutes, rows } if that's not possible
//   rows: the readings resampled to 10-minute steps, oldest first: [{ t, temperature, humidity, pressure, precipitation }]

(function (root) {
	"use strict";

	const COLS = ["temperature", "humidity", "pressure", "precipitation"];
	let modelPromise = null;

	function loadModel() {
		if (!modelPromise) {
			modelPromise = fetch("data/model.json", { cache: "no-cache" })
				.then((res) => {
					if (!res.ok) throw new Error(`Couldn't load the model (data/model.json, HTTP ${res.status}).`);
					return res.json();
				})
				.catch((err) => {
					modelPromise = null; // try again next time
					throw err;
				});
		}
		return modelPromise;
	}

	// features.prepare(): sort, average into fixed steps, fill gaps of up to `limit` steps by linear interpolation.
	// Like pandas, a longer gap gets its first `limit` steps filled and the rest stays empty.
	function prepare(readings, stepMin, limit) {
		const step = stepMin * 60000;
		const bins = new Map();
		for (const r of readings) {
			if (!Number.isFinite(r.t)) continue;
			const key = Math.floor(r.t / step) * step;
			let b = bins.get(key);
			if (!b) bins.set(key, (b = { sum: COLS.map(() => 0), n: COLS.map(() => 0) }));
			COLS.forEach((c, i) => {
				const v = r[c];
				if (v != null && Number.isFinite(Number(v))) {
					b.sum[i] += Number(v);
					b.n[i]++;
				}
			});
		}
		if (!bins.size) return [];
		const keys = [...bins.keys()];
		const first = Math.min(...keys);
		const last = Math.max(...keys);
		const rows = [];
		for (let t = first; t <= last; t += step) {
			const b = bins.get(t);
			const row = { t };
			COLS.forEach((c, i) => (row[c] = b && b.n[i] ? b.sum[i] / b.n[i] : NaN));
			rows.push(row);
		}
		for (const c of COLS) {
			let prev = -1; // index of the last value seen
			for (let i = 0; i < rows.length; i++) {
				if (Number.isNaN(rows[i][c])) continue;
				if (prev >= 0 && i - prev > 1) {
					const a = rows[prev][c];
					const b = rows[i][c];
					for (let j = prev + 1; j < i && j <= prev + limit; j++) rows[j][c] = a + ((b - a) * (j - prev)) / (i - prev);
				}
				prev = i;
			}
			// pandas also fills the steps after the last value with that value (up to the limit)
			if (prev >= 0) for (let j = prev + 1; j < rows.length && j <= prev + limit; j++) rows[j][c] = rows[prev][c];
		}
		return rows;
	}

	// Fills every remaining gap: carry the last value forward, then the first value back over the start
	function fillAll(rows) {
		for (const c of COLS) {
			let last = NaN;
			for (const r of rows) Number.isNaN(r[c]) ? (r[c] = last) : (last = r[c]);
			let next = NaN;
			for (let i = rows.length - 1; i >= 0; i--) Number.isNaN(rows[i][c]) ? (rows[i][c] = next) : (next = rows[i][c]);
		}
	}

	// features.build_features() for the newest row only, in the model's column order.
	// clamp: lags further back than the data use the oldest row instead of being empty.
	function lastFeatures(model, rows, clamp) {
		const n = rows.length - 1;
		const at = (stepsBack, c) => (n - stepsBack >= 0 ? rows[n - stepsBack][c] : clamp ? rows[0][c] : NaN);
		const steps = (minutes) => Math.floor(minutes / model.step_minutes);
		const f = {};
		for (const c of COLS) {
			f[c] = at(0, c);
			for (const m of model.lag_minutes) f[`${c}_lag${m}`] = at(steps(m), c);
		}
		f.pressure_trend = at(0, "pressure") - at(steps(model.pressure_trend_minutes), "pressure");
		// The training data is in local time (warmest around noon), so the hour is the local one
		f.hour = new Date(rows[n].t).getHours();
		return model.columns.map((c) => f[c]);
	}

	// One gradient-boosted model: base + learning_rate * sum of trees. scikit-learn compares in float32.
	function raw(m, x) {
		const x32 = x.map((v) => Math.fround(v));
		let sum = 0;
		for (const tree of m.trees) {
			let node = 0;
			while (tree.left[node] !== -1) {
				node = x32[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
			}
			sum += tree.value[node];
		}
		return m.base + m.learning_rate * sum;
	}

	function predict(model, readings) {
		const rows = prepare(readings, model.step_minutes, model.interpolate_limit);
		const span = { needed_minutes: model.min_rows * model.step_minutes, have_minutes: rows.length * model.step_minutes };
		const missing = COLS.filter((c) => !rows.some((r) => Number.isFinite(r[c])));
		if (!rows.length || missing.length) return { ready: false, missing, ...span, rows };
		const incomplete = (x) => x.some((v) => !Number.isFinite(v));
		let x = lastFeatures(model, rows, false);
		const partial = rows.length < model.min_rows || incomplete(x);
		if (partial) {
			const filled = rows.map((r) => ({ ...r }));
			fillAll(filled);
			x = lastFeatures(model, filled, true);
		}
		const m = model.models;
		return {
			ready: true,
			partial,
			...span,
			horizon_minutes: model.horizon_minutes,
			temperature: raw(m.temperature, x),
			humidity: raw(m.humidity, x),
			precipitation: Math.max(0, raw(m.precipitation, x)),
			stress_probability: 1 / (1 + Math.exp(-raw(m.stress, x))),
			stress_window_minutes: model.stress_window_minutes,
			rows,
		};
	}

	root.PlantForecast = { loadModel, predict, prepare };
})(typeof window !== "undefined" ? window : globalThis);
