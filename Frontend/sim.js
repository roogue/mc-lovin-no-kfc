// Simulation page: a software ESP32 (port of esp32/esp32.ino) and ESP server (port of esp32-server/server.py,
// plus the planned HTTP endpoints POST /data and GET /status) that drive the dashboard in another tab.
// The tabs talk over a BroadcastChannel (see sim-link.js on the dashboard side).

(function () {
	"use strict";

	const $ = (id) => document.getElementById(id);
	const TX_INTERVAL = 1000; // esp32.ino: txInterval
	const COMMAND_INTERVAL = 3000; // server.py: COMMAND_INTERVAL
	const DASHBOARD_TIMEOUT = 8000;
	const SERIAL_DELAY = 120; // time a line spends "on the wire"
	const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
	const noise = (a) => (Math.random() - 0.5) * 2 * a;
	const pad = (text, width) => String(text).padStart(width, " ");
	const pyJson = (obj) => JSON.stringify(obj).replace(/":/g, '": ').replace(/,"/g, ', "'); // json.dumps spacing

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
		setTimeout(() => server.onSerialLine(line), SERIAL_DELAY);
	}

	/* ================= ESP server (server.py + HTTP endpoints) ================= */
	const server = {
		mode: "dashboard", // "dashboard" = GET /status; "mock" = random relay states like server.py today
		posts: 0,
		lastPost: null,
		lastStatus: null,
		lastCommand: null,
		dashboardSeen: 0,
		backendStatus: { fan: false, valve: false },
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

			// POST /data
			const payload = { temperature: temp, humidity: hum, pressure: press };
			send({ type: "data", payload });
			server.posts++;
			server.lastPost = payload;
			server.request("POST", "/data", !dashboardConnected() ? "no dashboard open" : dataSource === "simulation" ? "200 OK" : `ignored · dashboard on ${SOURCE_NAMES[dataSource]}`);
			packet("wire-http", "data");
			renderServer();
		},

		// GET /status: ask the dashboard, wait briefly for the answer, fall back to the last known state
		getStatus() {
			return new Promise((resolve) => {
				const id = Math.random().toString(36).slice(2);
				const timer = setTimeout(() => {
					pendingStatus.delete(id);
					resolve(undefined); // no answer at all
				}, 500);
				pendingStatus.set(id, (payload) => {
					clearTimeout(timer);
					resolve(payload);
				});
				send({ type: "get-status", id });
				packet("wire-http", "status", true);
			});
		},

		async poll() {
			if (!running) return;
			if (!esp32.attached) {
				serialPrint("error", "SERVER serial error: could not open port COM3 (ESP32 unplugged)");
				return;
			}
			let cmd;
			if (server.mode === "mock") {
				cmd = { fan: Math.random() < 0.5, valve: Math.random() < 0.5 };
			} else {
				const answer = await server.getStatus();
				if (answer) {
					server.backendStatus = answer;
					server.lastStatus = answer;
					server.request("GET", "/status", `200 ${pyJson(answer)}`);
				} else if (answer === null) {
					server.request("GET", "/status", "dashboard isn't using the simulation, keeping last state");
				} else {
					server.request("GET", "/status", "no answer, keeping last state");
				}
				cmd = { ...server.backendStatus };
			}
			server.lastCommand = cmd;
			const line = `${pyJson(cmd)}\n`; // serial line must end with '\n'
			serialPrint("rx", `SERVER → ${line.trim()}`);
			serialPrint("info", `[SENT RELAY ] Fan -> ${cmd.fan ? "ON " : "OFF"} | Valve -> ${cmd.valve ? "ON " : "OFF"}`);
			packet("wire-serial", "command", true);
			setTimeout(() => {
				esp32SerialIn(line);
				packet("wire-sensor", "command", true);
			}, SERIAL_DELAY);
			renderServer();
		},

		request(method, path, result) {
			server.requests.unshift({ method, path, result, at: new Date() });
			server.requests.length = Math.min(server.requests.length, 6);
		},
	};
	const pendingStatus = new Map();
	const dashboardConnected = () => Date.now() - server.dashboardSeen < DASHBOARD_TIMEOUT;

	/* ================= Messages from the dashboard ================= */
	let dashboardState = null;
	let dashboardSource = null; // { mode, state } as the dashboard sees it
	if (channel) {
		channel.onmessage = ({ data }) => {
			if (!data || data.from !== "dashboard") return;
			server.dashboardSeen = Date.now();
			if (data.type === "status" || data.type === "hello") {
				if (data.payload) server.backendStatus = data.payload;
				if (data.id && pendingStatus.has(data.id)) pendingStatus.get(data.id)(data.payload);
			}
			if (data.state) dashboardState = data.state;
			if (data.source) dashboardSource = data.source;
			if (data.type === "data-source" && data.mode && data.mode !== dataSource) {
				dataSource = data.mode; // changed on the dashboard (e.g. "Use sample data" in its modal)
				saveSource();
			}
			renderSource();
			if (data.type === "plant-state" || data.type === "hello") renderPlant();
			renderServer();
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
		if (e.key === SOURCE_KEY) {
			if (SOURCE_NAMES[e.newValue]) dataSource = e.newValue;
			renderSource();
		}
	});

	function renderSource() {
		sourceButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.source === dataSource)));
		const state = dashboardSource && dashboardSource.mode === dataSource ? dashboardSource.state : null;
		let note;
		if (dataSource === "sample") note = "The dashboard shows sample readings and ignores this simulation.";
		else if (dataSource === "live") note = "The dashboard shows real readings from the API and ignores this simulation. Nothing here is ever sent to the real API.";
		else if (!dashboardConnected()) note = "The dashboard will use this simulation's readings. Open it to see them.";
		else if (state === "connected") note = "The dashboard is showing this simulation's readings.";
		else if (state === "disconnected") note = "The dashboard says the simulation isn't sending. Plug the USB serial back in or resume the simulation.";
		else note = "Waiting for the first simulated reading…";
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
	const usbToggle = $("usb-toggle");
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
			server.mode = b.dataset.mode;
			serialPrint("info", server.mode === "mock" ? "SERVER now sends random relay states (server.py mock)" : "SERVER now follows the dashboard via GET /status");
			renderServer();
		}),
	);

	function renderServer() {
		const connected = dashboardConnected();
		serverModeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === server.mode)));
		$("srv-posts").textContent = server.posts;
		$("srv-post").textContent = server.lastPost ? JSON.stringify(server.lastPost, null, 2) : "—";
		$("srv-status").textContent = server.lastStatus ? JSON.stringify(server.lastStatus, null, 2) : "—";
		$("srv-command").textContent = server.lastCommand ? pyJson(server.lastCommand) : "—";
		$("srv-requests").replaceChildren(
			...server.requests.map((r) => {
				const li = document.createElement("li");
				const m = document.createElement("span");
				m.className = `req-method req-${r.method.toLowerCase()}`;
				m.textContent = r.method;
				const p = document.createElement("code");
				p.textContent = r.path;
				const res = document.createElement("span");
				res.className = "req-result";
				res.textContent = r.result;
				li.append(m, p, res);
				return li;
			}),
		);

		const chip = $("dash-chip");
		chip.classList.toggle("is-on", connected);
		chip.lastChild.textContent = connected ? "Dashboard connected" : "Dashboard not open";
		$("flow-dashboard").textContent = connected ? "Connected" : "Not open";
		$("flow-server").textContent = server.mode === "mock" ? "Random relay mock" : "Polls /status every 3 s";
		$("flow").classList.toggle("is-offline", !connected);
	}

	/* ================= Run / pause, monitor controls ================= */
	const runBtn = $("sim-run");
	runBtn.addEventListener("click", () => {
		running = !running;
		runBtn.textContent = running ? "Pause" : "Resume";
		runBtn.setAttribute("aria-pressed", String(!running));
		document.body.classList.toggle("sim-paused", !running);
		serialPrint("info", running ? "Simulation resumed" : "Simulation paused");
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
	send({ type: "hello" });
	renderEsp32();
	renderServer();
	renderPlant();
	setInterval(esp32Tick, TX_INTERVAL);
	setInterval(() => server.poll(), COMMAND_INTERVAL);
	renderSource();
	setInterval(() => {
		renderServer();
		renderPlant();
		renderSource();
	}, 2000);
})();
