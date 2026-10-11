// Prediction page. The database is down, so it reads data/prediction.json: a 6-hour history and the model's
// prediction for each scenario. The simulation page picks the scenario. Swap fetchPrediction() for the real API later.

(function () {
    "use strict";

    const $ = (id) => document.getElementById(id);
    const SCENARIO_KEY = "plantcheck:prediction-scenario";

    function scenarioId() {
        try {
            return localStorage.getItem(SCENARIO_KEY) || "stable";
        } catch {
            return "stable";
        }
    }

    // Returns { name, description, history, prediction: { temperature, humidity, precipitation, stress_probability } }
    async function fetchPrediction() {
        const res = await fetch("data/prediction.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`Couldn't load prediction.json (HTTP ${res.status}).`);
        const data = await res.json();
        const s = data.scenarios && data.scenarios[scenarioId()];
        if (!s) throw new Error("The selected scenario isn't in prediction.json.");
        return s;
    }

    function showError(msg) {
        const el = $("predict-error");
        el.textContent = msg || "";
        el.hidden = !msg;
    }

    // Anomaly: hot, clearly rising, or high stress risk
    function isAnomaly(s) {
        const p = s.prediction;
        const now = s.history[s.history.length - 1];
        return p.temperature >= 33 || p.temperature - now.temperature >= 1 || p.stress_probability >= 0.5;
    }

    function actionsFor(p) {
        const out = [];
        if (p.temperature >= 33) out.push("Turn the fan on and shade the plant: temperature is heading above 33°C.");
        if (p.humidity <= 60) out.push("Water the plant soon: humidity is dropping.");
        if (p.humidity >= 85) out.push("Increase airflow: humidity is heading above 85%.");
        if (p.precipitation > 0) out.push("Rain is expected: hold off on watering.");
        if (p.stress_probability >= 0.5) out.push("Check the plant within the next 3 hours: stress risk is high.");
        if (!out.length) out.push("No action needed. Conditions look steady.");
        return out;
    }

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tiles = () => document.querySelectorAll(".tiles .tile");

    function log(text, cls) {
        const box = $("pred-console");
        const line = document.createElement("div");
        if (cls) line.className = cls;
        line.textContent = `[${new Date().toLocaleTimeString("en-GB")}] ${text}`;
        box.appendChild(line);
        box.scrollTop = box.scrollHeight;
    }

    function countUp(el, to, format, ms = 700) {
        if (reduceMotion) {
            el.textContent = format(to);
            return;
        }
        const start = performance.now();
        const tick = (now) => {
            const k = Math.min(1, (now - start) / ms);
            el.textContent = format(to * (1 - Math.pow(1 - k, 3)));
            if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    const METRICS = {
        temperature: { label: "Temperature", unit: "°C", digits: 1, limit: 33 },
        humidity: { label: "Humidity", unit: "%", digits: 0, limit: 85 },
    };
    let metric = "temperature";
    let lastResult = null;
    const SVG_NS = "http://www.w3.org/2000/svg";
    const svgEl = (name, attrs) => {
        const el = document.createElementNS(SVG_NS, name);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    };

    // History (solid) then a dashed leg to the predicted value 60 minutes ahead
    function drawChart(s) {
        const m = METRICS[metric];
        const W = 640, H = 230, L = 46, R = 16, T = 16, B = 28;
        const hist = s.history.map((r) => ({ x: -r.minutes_ago, y: r[metric] }));
        const horizon = s.prediction.horizon_minutes;
        const pred = { x: horizon, y: s.prediction[metric] };
        const ys = [...hist.map((p) => p.y), pred.y, m.limit];
        const lo = Math.min(...ys), hi = Math.max(...ys);
        const pad = Math.max((hi - lo) * 0.12, 1);
        const y0 = lo - pad, y1 = hi + pad;
        const x0 = hist[0].x, x1 = horizon;
        const px = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
        const py = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
        const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");

        const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "pred-svg", role: "img", "aria-label": `${m.label} over the last 6 hours and the prediction` });
        for (let i = 0; i < 4; i++) {
            const v = y0 + ((y1 - y0) * i) / 3;
            svg.append(svgEl("line", { x1: L, x2: W - R, y1: py(v), y2: py(v), class: "pred-grid" }));
            const t = svgEl("text", { x: L - 8, y: py(v) + 4, class: "pred-axis", "text-anchor": "end" });
            t.textContent = v.toFixed(m.digits);
            svg.append(t);
        }
        [[-360, "-6 h"], [-180, "-3 h"], [0, "now"], [horizon, "+1 h"]].forEach(([x, label]) => {
            const t = svgEl("text", { x: px(x), y: H - 8, class: "pred-axis", "text-anchor": "middle" });
            t.textContent = label;
            svg.append(t);
        });
        svg.append(svgEl("line", { x1: px(0), x2: px(0), y1: T, y2: H - B, class: "pred-now" }));
        svg.append(svgEl("line", { x1: L, x2: W - R, y1: py(m.limit), y2: py(m.limit), class: "pred-limit" }));
        const lt = svgEl("text", { x: W - R, y: py(m.limit) - 5, class: "pred-limit-label", "text-anchor": "end" });
        lt.textContent = `stress at ${m.limit}${m.unit}`;
        svg.append(lt);

        const now = hist[hist.length - 1];
        svg.append(svgEl("path", { d: path(hist), class: "pred-line", pathLength: 1 }));
        svg.append(svgEl("path", { d: path([now, pred]), class: "pred-line is-forecast", pathLength: 1 }));
        svg.append(svgEl("circle", { cx: px(now.x), cy: py(now.y), r: 4, class: "pred-dot" }));
        svg.append(svgEl("circle", { cx: px(pred.x), cy: py(pred.y), r: 5.5, class: "pred-dot is-forecast" }));
        $("pred-chart").replaceChildren(svg);
        $("pred-chart-card").hidden = false;
    }

    // Note under a card: "in about 1 hour · " plus a green up / red down arrow with the change
    function setTrend(id, prefix, delta, unit, digits) {
        const abs = Math.abs(delta);
        const note = $(id);
        if (abs < 0.05) return (note.textContent = `${prefix}steady`);
        const arrow = document.createElement("span");
        arrow.className = delta > 0 ? "pred-up" : "pred-down";
        arrow.textContent = `${delta > 0 ? "↑" : "↓"} ${abs.toFixed(digits)}${unit}`;
        note.replaceChildren(`${prefix}`, arrow, " from now");
    }

    function riskLabel(p) {
        return p >= 0.66 ? "High risk" : p >= 0.33 ? "Moderate risk" : "Low risk";
    }

    /* ---------------- Fan and irrigation ---------------- */
    const AUTO_KEY = "plantcheck:prediction-auto-action";
    const WATER_SECONDS = 60;
    const dev = { fan: false, water: false, waterEnd: 0 };
    let autoAction = false;
    let lastCommandAt = 0;
    let waterTimer = null;
    try {
        autoAction = localStorage.getItem(AUTO_KEY) === "1";
    } catch {
        autoAction = false;
    }

    const toast = (msg) => (window.PlantToast ? PlantToast(msg, "error") : showError(msg));
    const isServer = () => !!(window.PlantAPI && window.PlantSensors && ["live", "simulation"].includes(PlantSensors.mode));

    function renderDevices() {
        $("pred-fan").setAttribute("aria-checked", String(dev.fan));
        $("pred-fan-status").textContent = dev.fan ? "On · Cooling" : "Off";
        $("pred-water").setAttribute("aria-checked", String(dev.water));
        const left = Math.max(0, Math.ceil((dev.waterEnd - Date.now()) / 1000));
        $("pred-water-status").textContent = dev.water ? `Watering · ${left}s left` : "Off";

        clearInterval(waterTimer);
        waterTimer = null;
        if (dev.water) {
            waterTimer = setInterval(() => {
                if (Date.now() >= dev.waterEnd && !isServer()) dev.water = false;
                renderDevices();
            }, 1000);
        }
    }

    function applyState({ fan, water, remaining }) {
        if (typeof fan === "boolean") dev.fan = fan;
        if (typeof water === "boolean") {
            dev.water = water;
            if (water) dev.waterEnd = Date.now() + (Number(remaining) || WATER_SECONDS) * 1000;
        }
        renderDevices();
    }

    // Server mode: the polled relay state is the source of truth. Otherwise state is kept on this page only.
    async function sendRelay(body) {
        if (isServer()) {
            lastCommandAt = Date.now();
            try {
                await PlantAPI.setRelay(body);
            } finally {
                lastCommandAt = Date.now();
            }
            return;
        }
        applyState({ fan: body.fan, water: body.valve, remaining: body.seconds });
    }

    async function runRelay(body) {
        try {
            await sendRelay(body);
            return true;
        } catch (err) {
            toast(err.message);
            return false;
        }
    }

    document.addEventListener("api:relay", (e) => {
        const d = e.detail || {};
        if (!isServer() || (d.at || 0) < lastCommandAt) return;
        applyState({ fan: d.fan, water: d.valve === true && d.valve_remaining > 0, remaining: d.valve_remaining });
    });

    $("pred-fan").addEventListener("click", () => runRelay({ fan: !dev.fan }));
    $("pred-water").addEventListener("click", () =>
        runRelay(dev.water ? { valve: false } : { valve: true, seconds: WATER_SECONDS }),
    );

    function renderAutoAction() {
        $("auto-action").setAttribute("aria-checked", String(autoAction));
        $("auto-action-note").textContent = autoAction ? "On · fan and irrigation start on a warning" : "Off · you choose the actions";
    }

    // Shows the fan / irrigation toggles for a warning and, with Automatic Action on, starts both
    async function handleAnomaly(s) {
        const warn = isAnomaly(s);
        $("actions-devices").hidden = !warn;
        if (!warn) return;
        renderDevices();
        if (!autoAction) return;
        log("Anomaly detected. Automatic Action is on.", "log-ok");
        if (!dev.fan && (await runRelay({ fan: true }))) log("Fan turned on.", "log-ok");
        if (!dev.water && (await runRelay({ valve: true, seconds: WATER_SECONDS }))) log(`Irrigation started for ${WATER_SECONDS} s.`, "log-ok");
    }

    $("auto-action").addEventListener("click", () => {
        autoAction = !autoAction;
        try {
            localStorage.setItem(AUTO_KEY, autoAction ? "1" : "0");
        } catch {
            // storage unavailable: the setting only lasts for this page
        }
        renderAutoAction();
        if (autoAction && lastResult) handleAnomaly(lastResult);
    });
    renderAutoAction();

    function render(s) {
        lastResult = s;
        const p = s.prediction;
        const now = s.history[s.history.length - 1];
        const soon = "in about 1 hour · ";
        setTrend("pred-temperature-note", soon, p.temperature - now.temperature, "°C", 1);
        setTrend("pred-humidity-note", soon, p.humidity - now.humidity, "%", 0);
        setTrend("pred-precipitation-note", soon, p.precipitation - now.precipitation, " mm", 1);
        $("pred-stress-note").textContent = `next 3 hours · ${riskLabel(p.stress_probability)}`;
        $("pred-stress").closest(".tile").dataset.risk = p.stress_probability >= 0.66 ? "high" : p.stress_probability >= 0.33 ? "mid" : "low";
        drawChart(s);

        countUp($("pred-temperature"), p.temperature, (v) => `${v.toFixed(1)}°C`);
        countUp($("pred-humidity"), p.humidity, (v) => `${Math.round(v)}%`);
        countUp($("pred-precipitation"), p.precipitation, (v) => `${v.toFixed(1)} mm`);
        countUp($("pred-stress"), p.stress_probability * 100, (v) => `${Math.round(v)}%`);
        tiles().forEach((t) => {
            t.classList.remove("is-revealed");
            void t.offsetWidth;
            t.classList.add("is-revealed");
        });

        $("actions-list").replaceChildren(
            ...actionsFor(p).map((t) => {
                const li = document.createElement("li");
                li.textContent = t;
                return li;
            }),
        );
        $("actions-empty").hidden = true;
        handleAnomaly(s);
    }

    document.querySelectorAll("#pred-metric button").forEach((b) =>
        b.addEventListener("click", () => {
            metric = b.dataset.metric;
            document.querySelectorAll("#pred-metric button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
            if (lastResult) drawChart(lastResult);
        }),
    );

    const button = $("predict-btn");
    button.addEventListener("click", async () => {
        showError("");
        button.disabled = true;
        button.textContent = "Predicting…";
        $("pred-console").replaceChildren();
        tiles().forEach((t) => t.classList.add("is-loading"));
        const pause = (ms) => wait(reduceMotion ? 0 : ms);
        try {
            log(`Scenario: ${scenarioId()}`, "log-dim");
            log("Loading data/prediction.json…");
            await pause(500);
            const s = await fetchPrediction();
            const h = s.history;
            const last = h[h.length - 1];
            log(`Loaded ${h.length} readings (last ${Math.round(h[0].minutes_ago / 60 * 10) / 10} h). Latest: ${last.temperature}°C, ${last.humidity}%, ${last.pressure} hPa, ${last.precipitation} mm`, "log-ok");
            await pause(600);
            log("Resampling to 10-minute steps and building lag features…");
            await pause(700);
            log("Running the temperature, humidity, precipitation and stress models…");
            await pause(900);
            const p = s.prediction;
            log(`Predicted in ${p.horizon_minutes} min: temperature ${p.temperature.toFixed(1)}°C, humidity ${p.humidity.toFixed(1)}%, precipitation ${p.precipitation.toFixed(1)} mm`, "log-ok");
            log(`Stress probability (next ${p.stress_window_minutes} min): ${(p.stress_probability * 100).toFixed(1)}%`, "log-ok");
            console.log("[prediction]", s.name, p);
            render(s);
        } catch (err) {
            log(`Error: ${err.message}`);
            showError(err.message);
        } finally {
            tiles().forEach((t) => t.classList.remove("is-loading"));
            button.disabled = false;
            button.textContent = "Predict";
        }
    });
})();
