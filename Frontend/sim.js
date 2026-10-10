// Simulation page: the whole hardware path in software, so the dashboard can be tried without the real devices.
//   ESP32 (port of esp32/esp32.ino) --serial--> ESP server (port of esp32-server/server.py)
//   --POST /data, GET /status--> Backend (port of Backend/app.py) <--GET /api/sensor, /api/relay, POST /api/relay-- dashboard
// The backend runs in this tab. The dashboard reaches it over a BroadcastChannel when its data source is
// "Simulation" (see api.js). Nothing on this page ever talks to the real API.

(function () {
	"use strict";

	const $ = (id) => document.getElementById(id);
	const TX_INTERVAL = 1000; // esp32.ino: txInterval
	const COMMAND_INTERVAL = 3000; // server.py: COMMAND_INTERVAL
	const DASHBOARD_TIMEOUT = 8000;
	const WIRE_DELAY = 120; // time a message spends "on the wire"
	const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
	const noise = (a) => (Math.random() - 0.5) * 2 * a;
	const pad = (text, width) => String(text).padStart(width, " ");
	const pyJson = (obj) => JSON.stringify(obj).replace(/":/g, '": ').replace(/,"/g, ', "'); // json.dumps spacing
	// Staged "on the wire" delays only while this tab is visible: a background tab's timers are slowed down by
	// the browser, and the dashboard shouldn't have to wait for an animation it can't see.
	const later = (fn) => (document.hidden ? fn() : setTimeout(fn, WIRE_DELAY));

	// A steady clock that keeps running in a background tab: the browser throttles page timers there (down to
	// once a minute), but not a worker's, so the ESP32 keeps its 1-second rhythm while you watch the dashboard.
	function every(ms, fn) {
		try {
			const src = `setInterval(() => postMessage(0), ${ms});`;
			const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
			worker.onmessage = () => fn();
			return;
		} catch {
			/* no workers: fall back to a normal timer */
		}
		setInterval(fn, ms);
	}

	const channel = "BroadcastChannel" in window ? new BroadcastChannel("plantcheck-sim") : null;
	const send = (msg) => channel && channel.postMessage({ ...msg, from: "sim" });
	let running = true;

	/* ================= Serial monitor ================= */
	const logEl = $("serial-log");
	const MAX_LINES = 250;
	let logPaused = false;

	function serialPrint(kind, text) {
		if (logPaused) return;
		const line = document.createElement("div");
		line.className = `log-line log-${kind}`;
		const time = document.createElement("span");
		time.className = "log-time";
		time.textContent = new Date().toLocaleTimeString([], { hour12: false });
		line.append(time, document.createTextNode(text));
		const stuckToBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8;
		logEl.appendChild(line);
		while (logEl.childElementCount > MAX_LINES) logEl.firstChild.remove();
		if (stuckToBottom) logEl.scrollTop = logEl.scrollHeight;
	}

	/* ================= Packets on the flow diagram ================= */
	function packet(wireId, kind = "", reverse = false) {
		const wire = $(wireId);
		if (!wire || document.hidden) return;
		const dot = document.createElement("span");
		dot.className = `packet ${kind}${reverse ? " reverse" : ""}`;
		dot.addEventListener("animationend", () => dot.remove());
		wire.appendChild(dot);
	}

	// A list of recent requests shown in a panel: { method, path, status, note }
	function pushRequest(list, entry, max = 7) {
		list.unshift({ ...entry, at: new Date() });
		list.length = Math.min(list.length, max);
	}

	function renderRequests(el, list) {
		el.replaceChildren(
			...list.map((r) => {
				const li = document.createElement("li");
				const m = document.createElement("span");
				m.className = `req-method req-${r.method.toLowerCase()}`;
				m.textContent = r.method;
				const p = document.createElement("code");
				p.textContent = r.path;
				const res = document.createElement("span");
				res.className = `req-result${r.status >= 400 ? " is-error" : ""}`;
				res.textContent = [r.status, r.note].filter(Boolean).join(" · ");
				li.append(m, p, res);
				return li;
			}),
		);
	}

	/* ================= ESP32 (esp32.ino) ================= */
	const esp32 = {
		fan: false, // PIN_FAN (GPIO 10)
		valve: false, // PIN_VALVE (GPIO 11)
		sensorOk: true, // BME280 on I2C (SDA 8, SCL 9)
		attached: true, // USB serial cable to the ESP server
		mode: "drift",
		bootAt: performance.now(),
		env: { temperature: 30.8, humidity: 71, pressure: 1008.6 },
		manual: { temperature: 31, humidity: 72, pressure: 1008.5 },
		lastLine: "",
	};

	// processIncomingCommand(): apply {"fan": bool, "valve": bool}; malformed packets are ignored
	function processIncomingCommand(jsonStr) {
		let doc;
		try {
			doc = JSON.parse(jsonStr);
		} catch {
			return;
		}
		if (doc && "fan" in doc) esp32.fan = !!doc.fan;
		if (doc && "valve" in doc) esp32.valve = !!doc.valve;
		renderEsp32();
	}

	// readSerialCommands(): newline-terminated lines, '\r' dropped
	let rxBuffer = "";
	function esp32SerialIn(chunk) {
		for (const c of chunk) {
			if (c === "\n") {
				const line = rxBuffer.trim();
				if (line) processIncomingCommand(line);
				rxBuffer = "";
			} else if (c !== "\r") {
				rxBuffer += c;
			}
		}
	}

	// Environment around the plant: a slow swing, and the relays push it like a real fan / valve would
	const simStart = performance.now();
	function stepEnvironment() {
		const e = esp32.env;
		if (esp32.mode === "manual") {
			e.temperature = esp32.manual.temperature + noise(0.03);
			e.humidity = clamp(esp32.manual.humidity + noise(0.1), 0, 100);
			e.pressure = esp32.manual.pressure + noise(0.03);
			return;
		}
		const s = (performance.now() - simStart) / 1000;
		const targetT = 31 + 2.6 * Math.sin((s * 2 * Math.PI) / 180) - (esp32.fan ? 1.8 : 0) - (esp32.valve ? 0.6 : 0);
		const targetH = 72 + 11 * Math.sin((s * 2 * Math.PI) / 140 + 1.2) - (esp32.fan ? 7 : 0) + (esp32.valve ? 9 : 0);
		const targetP = 1008.5 + 1.6 * Math.sin((s * 2 * Math.PI) / 600);
		e.temperature += (targetT - e.temperature) * 0.15 + noise(0.06);
		e.humidity = clamp(e.humidity + (targetH - e.humidity) * 0.15 + noise(0.25), 0, 100);
		e.pressure += (targetP - e.pressure) * 0.1 + noise(0.04);
	}

	// loop(): every txInterval, read the BME280 and print one JSON line on serial
	function esp32Tick() {
		if (!running) return;
		stepEnvironment();
		const e = esp32.env;
		const f = (v) => (esp32.sensorOk ? v.toFixed(2) : "nan"); // an unplugged BME280 reads NaN
		const line = `{"temperature": ${f(e.temperature)}, "humidity": ${f(e.humidity)}, "pressure": ${f(e.pressure)}}`;
		esp32.lastLine = line;
		packet("wire-sensor", "sense");
		renderEsp32();
		if (!esp32.attached) return; // USB serial unplugged: the line goes nowhere
		serialPrint(esp32.sensorOk ? "tx" : "error", `ESP32 → ${line}`);
		setTimeout(() => packet("wire-serial", "data"), 60);
		later(() => espServer.onSerialLine(line));
	}

	/* ================= Backend (Backend/app.py) ================= */
	const backend = {
		requireDashKey: true, // REQUIRE_DASH_KEY (on unless set to something other than "1")
		requireDeviceKey: false, // REQUIRE_DEVICE_KEY
		dashKey: "sim-password", // DASH_KEY: simulation only, shown on this page
		deviceKey: "sim-device-key", // DEVICE_KEY: the simulated ESP server doesn't send it (like Weisen's script)
		sensor: null,
		fanOn: false,
		valveUntil: 0,
		requests: [],
		STALE_AFTER: 10,
		DEFAULT_VALVE_SECONDS: 60,
		MAX_VALVE_SECONDS: 600,

		relayState() {
			const remaining = Math.max(0, this.valveUntil - Date.now()) / 1000;
			return { fan: this.fanOn, valve: remaining > 0, valve_remaining: Math.round(remaining) };
		},

		// One HTTP request → { status, data }, following app.py rule for rule
		handle({ method, path, body, key = "" }) {
			const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
			const isDict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
			const reply = (status, data) => ({ status, data });

			if (method === "POST" && path === "/data") {
				if (this.requireDeviceKey && key !== this.deviceKey) return reply(401, { error: "unauthorized" });
				if (!isDict(body) || !["temperature", "humidity", "pressure"].every((k) => isNumber(body[k]))) {
					return reply(400, { error: "invalid reading" });
				}
				this.sensor = { temperature: body.temperature, humidity: body.humidity, pressure: body.pressure, received_at: Date.now() / 1000 };
				return reply(200, { ok: true });
			}
			if (method === "GET" && path === "/") {
				const fresh = !!this.sensor && Date.now() / 1000 - this.sensor.received_at < this.STALE_AFTER;
				return reply(200, {
					name: "PlantCheck API (simulated)",
					status: "ok",
					sensor_connected: fresh,
					endpoints: {
						"GET /api/sensor": "latest sensor reading",
						"GET /api/relay": "fan and valve state",
						"POST /api/relay": `set fan or valve${this.requireDashKey ? " (needs X-API-Key)" : ""}`,
						"POST /data": `device: send a reading${this.requireDeviceKey ? " (needs X-API-Key)" : ""}`,
						"GET /status": "device: get relay state",
					},
				});
			}
			if (method === "GET" && path === "/status") {
				const s = this.relayState();
				return reply(200, { fan: s.fan, valve: s.valve });
			}
			if (method === "GET" && path === "/api/sensor") {
				if (!this.sensor) return reply(200, { connected: false });
				const age = Date.now() / 1000 - this.sensor.received_at;
				return reply(200, { ...this.sensor, age: Math.round(age * 10) / 10, connected: age < this.STALE_AFTER });
			}
			if (method === "GET" && path === "/api/relay") return reply(200, this.relayState());
			if (method === "POST" && path === "/api/relay") {
				if (this.requireDashKey && key !== this.dashKey) return reply(401, { error: "unauthorized" });
				if (!isDict(body)) return reply(400, { error: "invalid json" });
				for (const k of ["fan", "valve"]) {
					if (k in body && typeof body[k] !== "boolean") return reply(400, { error: `${k} must be true or false` });
				}
				let secs = null;
				if (body.valve === true) {
					const raw = body.seconds ?? this.DEFAULT_VALVE_SECONDS; // Python int(): numbers and whole-number strings
					if (typeof raw === "number" && Number.isFinite(raw)) secs = Math.trunc(raw);
					else if (typeof raw === "string" && /^\s*[-+]?\d+\s*$/.test(raw)) secs = parseInt(raw, 10);
					else if (typeof raw === "boolean") secs = Number(raw);
					else return reply(400, { error: "seconds must be a number" });
				}
				// everything is valid: apply it all at once
				if ("fan" in body) this.fanOn = body.fan;
				if ("valve" in body) {
					this.valveUntil = secs !== null ? Date.now() + Math.min(Math.max(secs, 1), this.MAX_VALVE_SECONDS) * 1000 : 0;
				}
				return reply(200, this.relayState());
			}
			return reply(404, { error: "not found" });
		},

		// Wraps handle() with logging for the Backend panel
		request(who, req) {
			const res = this.handle(req);
			let note = who;
			if (req.method === "POST" && req.path === "/api/relay" && res.status === 200) {
				note = `${who} · ${Object.keys(req.body || {}).length ? pyJson(req.body) : "access check"}`;
			}
			pushRequest(this.requests, { method: req.method, path: req.path, status: res.status, note }, 9);
			renderBackend();
			return res;
		},
	};

	/* ================= ESP server (server.py, talking to the backend) ================= */
	const espServer = {
		mode: "backend", // "backend" = relay state from GET /status; "mock" = random relay states like server.py today
		posts: 0,
		lastPost: null,
		lastPostStatus: null,
		lastStatus: null,
		lastCommand: null,
		requests: [],

		onSerialLine(raw) {
			let telemetry;
			try {
				telemetry = JSON.parse(raw);
			} catch {
				serialPrint("error", "SERVER skipped a malformed packet (is the BME280 connected?)");
				return;
			}
			if (telemetry.error) {
				serialPrint("error", `SERVER device error: ${telemetry.error}`);
				return;
			}
			const temp = Number(telemetry.temperature) || 0;
			const hum = Number(telemetry.humidity) || 0;
			const press = Number(telemetry.pressure) || 0;
			serialPrint("info", `[RECV SENSOR] Temp: ${pad(temp.toFixed(2), 5)} °C | Hum: ${pad(hum.toFixed(2), 5)}% | Press: ${pad(press.toFixed(2), 7)} hPa`);

			// POST /data to the backend
			const payload = { temperature: temp, humidity: hum, pressure: press };
			packet("wire-device", "data");
			later(() => {
				const res = backend.request("ESP server", { method: "POST", path: "/data", body: payload });
				espServer.posts++;
				espServer.lastPost = payload;
				espServer.lastPostStatus = res.status;
				pushRequest(espServer.requests, { method: "POST", path: "/data", status: res.status, note: res.status === 200 ? "" : res.data.error });
				if (res.status !== 200) serialPrint("error", `SERVER POST /data failed: ${res.status} ${res.data.error}`);
				renderServer();
			});
		},

		poll() {
			if (!running) return;
			if (!esp32.attached) {
				serialPrint("error", "SERVER serial error: could not open port COM3 (ESP32 unplugged)");
				return;
			}
			if (espServer.mode === "mock") return espServer.writeCommand({ fan: Math.random() < 0.5, valve: Math.random() < 0.5 });

			// GET /status from the backend, then forward it to the ESP32
			packet("wire-device", "status");
			later(() => {
				const res = backend.request("ESP server", { method: "GET", path: "/status" });
				espServer.lastStatus = res.data;
				pushRequest(espServer.requests, { method: "GET", path: "/status", status: res.status, note: pyJson(res.data) });
				packet("wire-device", "command", true);
				espServer.writeCommand({ fan: !!res.data.fan, valve: !!res.data.valve });
			});
		},

		writeCommand(cmd) {
			espServer.lastCommand = cmd;
			const line = `${pyJson(cmd)}\n`; // serial line must end with '\n'
			serialPrint("rx", `SERVER → ${line.trim()}`);
			serialPrint("info", `[SENT RELAY ] Fan -> ${cmd.fan ? "ON " : "OFF"} | Valve -> ${cmd.valve ? "ON " : "OFF"}`);
			packet("wire-serial", "command", true);
			later(() => {
				esp32SerialIn(line);
				packet("wire-sensor", "command", true);
			});
			renderServer();
		},
	};

	/* ================= Dashboard ⇄ this tab ================= */
	let dashboardSeen = 0;
	let dashboardState = null;
	let dashboardSource = null; // { mode, state, reason } as the dashboard sees it
	const dashboardConnected = () => Date.now() - dashboardSeen < DASHBOARD_TIMEOUT;

	if (channel) {
		channel.onmessage = ({ data }) => {
			if (!data || data.from !== "dashboard") return;
			dashboardSeen = Date.now();

			// The dashboard's API calls (only sent while its data source is "Simulation")
			if (data.type === "api") {
				const req = { method: data.method, path: data.path, body: data.body, key: data.key };
				const isCommand = data.method === "POST";
				const res = backend.request("Dashboard", req); // answered at once, even from a background tab
				send({ type: "api-reply", id: data.id, status: res.status, data: res.data });
				packet("wire-dash", isCommand ? "command" : "status", true);
				if (!isCommand && data.path === "/api/sensor" && res.data.connected) setTimeout(() => packet("wire-dash", "data"), WIRE_DELAY);
				return;
			}

			if (data.state) dashboardState = data.state;
			if (data.source) dashboardSource = data.source;
			if (data.type === "data-source" && data.mode && data.mode !== dataSource) {
				dataSource = data.mode; // changed on the dashboard (its chip menu or the "Use sample data" button)
				saveSource();
			}
			renderSource();
			if (data.type === "plant-state" || data.type === "hello") renderPlant();
			renderFlow();
		};
	}

	/* ================= Plant condition ================= */
	const stateButtons = document.querySelectorAll("#sim-state button");
	const diseaseSelect = $("sim-disease");

	function sendDisease() {
		send({ type: "disease", payload: { disease: diseaseSelect.value, confidence: 90 + Math.round(Math.random() * 8), date: new Date().toISOString().slice(0, 10) } });
	}

	stateButtons.forEach((b) =>
		b.addEventListener("click", () => {
			if (b.dataset.state === "sick") sendDisease();
			send({ type: "plant-state", state: b.dataset.state });
			dashboardState = b.dataset.state;
			renderPlant();
		}),
	);
	diseaseSelect.addEventListener("change", () => {
		sendDisease();
		renderPlant();
	});

	function renderPlant() {
		stateButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.state === dashboardState)));
		$("sim-plant-note").textContent = !dashboardConnected()
			? "Open the dashboard in another tab to see the change."
			: dashboardState === "sick"
				? `The dashboard shows the plant sick with ${diseaseSelect.value}.`
				: `The dashboard shows the plant ${dashboardState || "healthy"}.`;
	}

	/* ================= Dashboard data source ================= */
	const SOURCE_KEY = "plantcheck:data-source";
	const sourceButtons = document.querySelectorAll("#data-source button");
	const SOURCE_NAMES = { sample: "sample data", simulation: "this simulation", live: "live data from the real API" };
	let dataSource = (() => {
		try {
			const stored = localStorage.getItem(SOURCE_KEY);
			return SOURCE_NAMES[stored] ? stored : "live"; // the dashboard's default
		} catch {
			return "live";
		}
	})();

	function saveSource() {
		try {
			localStorage.setItem(SOURCE_KEY, dataSource); // the dashboard remembers it even if this tab closes
		} catch { /* private mode: the message below still switches an open dashboard */ }
	}

	sourceButtons.forEach((b) =>
		b.addEventListener("click", () => {
			if (b.dataset.source === dataSource) return;
			dataSource = b.dataset.source;
			saveSource();
			send({ type: "data-source", mode: dataSource });
			serialPrint("info", `Dashboard switched to ${SOURCE_NAMES[dataSource]}`);
			renderSource();
		}),
	);
	window.addEventListener("storage", (e) => {
		if (e.key === SOURCE_KEY && SOURCE_NAMES[e.newValue]) {
			dataSource = e.newValue;
			renderSource();
		}
	});

	function renderSource() {
		sourceButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.source === dataSource)));
		const s = dashboardSource && dashboardSource.mode === dataSource ? dashboardSource : null;
		let note;
		if (dataSource === "sample") note = "The dashboard shows sample readings and ignores this simulation.";
		else if (dataSource === "live") note = "The dashboard uses the real API and ignores this simulation. Nothing here is ever sent to the real API.";
		else if (!dashboardConnected()) note = "The dashboard will read this page's simulated backend. Open it to see the readings.";
		else if (s && s.state === "connected") note = "The dashboard is reading this page's simulated backend.";
		else if (s && s.state === "disconnected") note = "The dashboard says the simulated ESP32 isn't sending: check the USB serial, the BME280 or Pause.";
		else note = "The dashboard is connecting to this page's simulated backend…";
		$("source-note").textContent = note;
	}

	/* ================= ESP32 panel ================= */
	const sliders = {
		temperature: $("sl-temp"),
		humidity: $("sl-humidity"),
		pressure: $("sl-pressure"),
	};
	const modeButtons = document.querySelectorAll("#esp-mode button");
	const bmeToggle = $("bme-toggle");
	const usbToggle = $("usb-toggle");

	function setMode(mode) {
		esp32.mode = mode;
		if (mode === "manual") Object.assign(esp32.manual, esp32.env); // start from the current readings
		renderEsp32();
	}
	modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
	Object.entries(sliders).forEach(([key, input]) =>
		input.addEventListener("input", () => {
			esp32.manual[key] = Number(input.value);
			renderEsp32();
		}),
	);
	usbToggle.addEventListener("click", () => {
		esp32.attached = !esp32.attached;
		serialPrint(esp32.attached ? "info" : "error", esp32.attached ? "USB serial reconnected" : "USB serial unplugged: nothing reaches the ESP server");
		renderEsp32();
	});
	bmeToggle.addEventListener("click", () => {
		esp32.sensorOk = !esp32.sensorOk;
		serialPrint(esp32.sensorOk ? "info" : "error", esp32.sensorOk ? "BME280 reconnected" : "BME280 unplugged: readings will be NaN");
		renderEsp32();
	});

	function formatUptime(ms) {
		const s = Math.floor(ms / 1000);
		return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
	}

	function renderEsp32() {
		const e = esp32.env;
		const show = (v, d) => (esp32.sensorOk ? v.toFixed(d) : "NaN");
		$("esp-temp").textContent = `${show(e.temperature, 1)}°C`;
		$("esp-humidity").textContent = `${show(e.humidity, 0)}%`;
		$("esp-pressure").textContent = `${show(e.pressure, 1)}`;
		$("esp-uptime").textContent = formatUptime(performance.now() - esp32.bootAt);
		$("esp-line").textContent = esp32.lastLine || "waiting for first reading…";

		[["relay-fan", esp32.fan], ["relay-valve", esp32.valve]].forEach(([id, on]) => {
			const el = $(id);
			el.classList.toggle("is-on", on);
			el.querySelector(".relay-state").textContent = on ? "ON" : "OFF";
		});

		modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === esp32.mode)));
		Object.entries(sliders).forEach(([key, input]) => {
			input.disabled = esp32.mode !== "manual";
			if (esp32.mode !== "manual") input.value = e[key];
			$(`${input.id}-value`).textContent = Number(esp32.mode === "manual" ? esp32.manual[key] : e[key]).toFixed(key === "humidity" ? 0 : 1);
		});
		bmeToggle.setAttribute("aria-checked", String(esp32.sensorOk));
		usbToggle.setAttribute("aria-checked", String(esp32.attached));
		$("flow").classList.toggle("is-unplugged", !esp32.attached);
		$("bme-chip").textContent = !esp32.attached ? "USB unplugged" : esp32.sensorOk ? "BME280 OK" : "BME280 missing";
		$("bme-chip").classList.toggle("is-bad", !esp32.sensorOk || !esp32.attached);

		$("flow-sensors").textContent = esp32.sensorOk ? `${e.temperature.toFixed(1)}°C · ${Math.round(e.humidity)}%` : "BME280 unplugged";
		$("flow-esp32").textContent = `Fan ${esp32.fan ? "on" : "off"} · Valve ${esp32.valve ? "open" : "closed"}`;
	}

	/* ================= ESP server panel ================= */
	const serverModeButtons = document.querySelectorAll("#server-mode button");
	serverModeButtons.forEach((b) =>
		b.addEventListener("click", () => {
			espServer.mode = b.dataset.mode;
			serialPrint("info", espServer.mode === "mock" ? "SERVER now sends random relay states (server.py mock)" : "SERVER now follows the backend via GET /status");
			renderServer();
		}),
	);

	function renderServer() {
		serverModeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === espServer.mode)));
		$("srv-posts").textContent = espServer.posts;
		$("srv-post").textContent = espServer.lastPost ? JSON.stringify(espServer.lastPost, null, 2) : "—";
		$("srv-post-status").textContent = espServer.lastPostStatus ? `last answer ${espServer.lastPostStatus}` : "";
		$("srv-status").textContent = espServer.lastStatus ? JSON.stringify(espServer.lastStatus, null, 2) : "—";
		$("srv-command").textContent = espServer.lastCommand ? pyJson(espServer.lastCommand) : "—";
		renderRequests($("srv-requests"), espServer.requests);
		renderFlow();
	}

	/* ================= Backend panel ================= */
	const dashKeyToggle = $("dashkey-toggle");
	const dashKeyInput = $("dashkey-input");
	const deviceKeyToggle = $("devicekey-toggle");

	dashKeyToggle.addEventListener("click", () => {
		backend.requireDashKey = !backend.requireDashKey;
		renderBackend();
	});
	deviceKeyToggle.addEventListener("click", () => {
		backend.requireDeviceKey = !backend.requireDeviceKey;
		serialPrint(backend.requireDeviceKey ? "error" : "info", backend.requireDeviceKey
			? "BACKEND now requires DEVICE_KEY on POST /data (the ESP server doesn't send one)"
			: "BACKEND accepts POST /data without a key again");
		renderBackend();
	});
	dashKeyInput.addEventListener("input", () => {
		backend.dashKey = dashKeyInput.value;
	});

	function renderBackend() {
		dashKeyToggle.setAttribute("aria-checked", String(backend.requireDashKey));
		deviceKeyToggle.setAttribute("aria-checked", String(backend.requireDeviceKey));
		dashKeyInput.disabled = !backend.requireDashKey;
		const sensor = backend.handle({ method: "GET", path: "/api/sensor" }).data;
		const relay = backend.relayState();
		$("be-sensor").textContent = JSON.stringify(sensor, (k, v) => (k === "received_at" ? undefined : v), 2);
		$("be-relay").textContent = JSON.stringify(relay, null, 2);
		const chip = $("backend-chip");
		chip.textContent = sensor.connected ? "connected: true" : "connected: false";
		chip.classList.toggle("is-bad", !sensor.connected);
		renderRequests($("be-requests"), backend.requests);
		$("flow-backend").textContent = relay.valve ? `Watering · ${relay.valve_remaining}s left` : `Fan ${relay.fan ? "on" : "off"} · valve off`;
	}

	function renderFlow() {
		const connected = dashboardConnected();
		const usingSim = connected && dataSource === "simulation";
		$("flow-server").textContent = espServer.mode === "mock" ? "Random relay mock" : "Polls /status every 3 s";
		$("flow-dashboard").textContent = !connected ? "Not open" : usingSim ? "Reading this backend" : `On ${SOURCE_NAMES[dataSource]}`;
		$("flow").classList.toggle("is-offline", !usingSim);
		const chip = $("dash-chip");
		chip.classList.toggle("is-on", connected);
		chip.lastChild.textContent = connected ? "Dashboard connected" : "Dashboard not open";
	}

	/* ================= Run / pause, monitor controls ================= */
	const runBtn = $("sim-run");
	runBtn.addEventListener("click", () => {
		running = !running;
		runBtn.textContent = running ? "Pause" : "Resume";
		runBtn.setAttribute("aria-pressed", String(!running));
		document.body.classList.toggle("sim-paused", !running);
		serialPrint("info", running ? "Simulation resumed (the backend kept running)" : "Simulation paused: the ESP32 and ESP server stop; the backend keeps answering");
	});
	$("log-pause").addEventListener("click", (e) => {
		logPaused = !logPaused;
		e.currentTarget.textContent = logPaused ? "Resume log" : "Pause log";
	});
	$("log-clear").addEventListener("click", () => logEl.replaceChildren());

	if (!channel || location.protocol === "file:") {
		$("sim-warning").hidden = false;
	}

	/* ================= Boot ================= */
	serialPrint("info", "ESP32 booting… relays OFF, BME280 found at 0x76");
	serialPrint("info", "SERVER connected to the ESP32 over serial (115200 baud)");
	serialPrint("info", "BACKEND ready (simulated Backend/app.py in this tab)");
	send({ type: "hello" });
	renderEsp32();
	renderServer();
	renderBackend();
	renderPlant();
	renderSource();
	every(TX_INTERVAL, esp32Tick);
	every(COMMAND_INTERVAL, () => espServer.poll());
	setInterval(renderBackend, 1000); // age, "connected" and the valve countdown move on their own
	setInterval(() => {
		renderFlow();
		renderPlant();
		renderSource();
	}, 2000);
})();
