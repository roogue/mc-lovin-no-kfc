// Phones only (≤ 720px): iOS AssistiveTouch-style controls. A floating button you can drag to either edge of the
// screen opens the Controls card as a panel. The button mirrors the device state: green dot for Automate,
// spinning fan when the fan is on, and the watering countdown while irrigation runs.
// Wider screens keep the Controls card in the page as before (the button is hidden by CSS).

(function () {
	"use strict";

	const card = document.querySelector(".controls-card");
	if (!card) return;

	const mobile = window.matchMedia("(max-width: 720px)");
	const POS_KEY = "plantcheck:assist-pos";
	const SIZE = 56;
	const EDGE = 10; // gap to the screen edge
	const IDLE_MS = 3000;

	card.id = card.id || "controls-card";
	card.tabIndex = -1; // focus fallback for the panel

	/* ---------- button ---------- */
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "assist-btn";
	btn.setAttribute("aria-label", "Controls");
	btn.setAttribute("aria-expanded", "false");
	btn.setAttribute("aria-controls", card.id);
	btn.innerHTML = `
		<span class="assist-rings" aria-hidden="true"></span>
		<span class="assist-time" aria-hidden="true"></span>
		<span class="assist-fan" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" /><path d="M12 10c0-3 .5-6 3-6s3 3.5 0 5.5" /><path d="M14 12c3 0 6 .5 6 3s-3.5 3-5.5 0" /><path d="M12 14c0 3-.5 6-3 6s-3-3.5 0-5.5" /><path d="M10 12c-3 0-6-.5-6-3s3.5-3 5.5 0" /></svg></span>
		<span class="assist-auto" aria-hidden="true"></span>`;

	const backdrop = document.createElement("div");
	backdrop.className = "assist-backdrop";
	backdrop.hidden = true;

	document.body.append(backdrop, btn);

	/* ---------- panel extras: camera shortcut + close (shown on phones only) ---------- */
	const tools = document.createElement("div");
	tools.className = "assist-tools";
	tools.innerHTML = `
		<button type="button" class="assist-tool" data-assist="camera" aria-label="Open CCTV">
			<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3z" /></svg>
		</button>
		<button type="button" class="assist-tool" data-assist="close" aria-label="Close controls">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
		</button>`;
	card.prepend(tools);

	/* ---------- position: snapped to the left or right edge, height as a fraction of the free space ---------- */
	let pos = { side: "right", y: 0.62 };
	try {
		const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
		if (saved && (saved.side === "left" || saved.side === "right") && saved.y >= 0 && saved.y <= 1) pos = saved;
	} catch {
		/* default position */
	}

	function bounds() {
		const bar = document.querySelector(".sidebar");
		const barHeight = bar && getComputedStyle(bar).position === "fixed" ? bar.offsetHeight : 0;
		return { top: EDGE + 8, bottom: window.innerHeight - barHeight - SIZE - EDGE, right: window.innerWidth - SIZE - EDGE };
	}

	function place(x, y) {
		btn.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
	}

	function placeSnapped() {
		const b = bounds();
		place(pos.side === "left" ? EDGE : b.right, b.top + pos.y * Math.max(0, b.bottom - b.top));
	}

	function savePos() {
		try {
			localStorage.setItem(POS_KEY, JSON.stringify(pos));
		} catch {
			/* not remembered */
		}
	}

	/* ---------- idle fade, like iOS ---------- */
	let idleTimer = 0;
	function wake() {
		btn.classList.remove("is-idle");
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			if (!isOpen()) btn.classList.add("is-idle");
		}, IDLE_MS);
	}

	/* ---------- open / close ---------- */
	const isOpen = () => card.classList.contains("is-assist-open");

	function focusables() {
		return [...card.querySelectorAll("button, input, [href], [tabindex]:not([tabindex='-1'])")].filter(
			(el) => !el.disabled && !el.closest("[hidden]") && el.offsetParent !== null,
		);
	}

	function open() {
		if (isOpen() || !mobile.matches) return;
		// Grow out of the button: the panel's transform origin is the button's centre
		const b = btn.getBoundingClientRect();
		const c = card.getBoundingClientRect();
		card.style.setProperty("--assist-origin", `${b.left + b.width / 2 - c.left}px ${b.top + b.height / 2 - c.top}px`);
		card.setAttribute("role", "dialog");
		card.setAttribute("aria-modal", "true");
		card.setAttribute("aria-label", "Controls");
		backdrop.hidden = false;
		btn.setAttribute("aria-expanded", "true");
		btn.classList.add("is-open");
		wake();
		requestAnimationFrame(() => {
			backdrop.classList.add("is-open");
			card.classList.add("is-assist-open");
			(focusables()[0] || card).focus({ preventScroll: true }); // visible from now on, so it can take focus
		});
	}

	function close({ restoreFocus = true } = {}) {
		if (!isOpen()) return;
		card.classList.remove("is-assist-open");
		backdrop.classList.remove("is-open");
		card.removeAttribute("role");
		card.removeAttribute("aria-modal");
		card.removeAttribute("aria-label");
		btn.setAttribute("aria-expanded", "false");
		btn.classList.remove("is-open");
		setTimeout(() => {
			if (!isOpen()) backdrop.hidden = true;
		}, 250);
		if (restoreFocus && mobile.matches) btn.focus({ preventScroll: true });
		wake();
	}

	backdrop.addEventListener("click", () => close());
	tools.addEventListener("click", (e) => {
		const action = e.target.closest("[data-assist]")?.dataset.assist;
		if (action === "close") close();
		if (action === "camera") {
			close({ restoreFocus: false });
			document.getElementById("cctv-open")?.click();
		}
	});
	card.addEventListener("keydown", (e) => {
		if (!isOpen()) return;
		if (e.key === "Escape") {
			e.preventDefault();
			close();
		} else if (e.key === "Tab") {
			// Keep keyboard focus inside the panel while it's open
			const items = focusables();
			if (!items.length) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	});

	/* ---------- drag to move, tap to open ---------- */
	let drag = null;
	let suppressClick = false;

	btn.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		const r = btn.getBoundingClientRect();
		drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, x: r.left, y: r.top, moved: false };
		btn.setPointerCapture(e.pointerId);
		wake();
	});
	btn.addEventListener("pointermove", (e) => {
		if (!drag || e.pointerId !== drag.id) return;
		const dx = e.clientX - drag.startX;
		const dy = e.clientY - drag.startY;
		if (!drag.moved && Math.hypot(dx, dy) < 6) return;
		if (!drag.moved) {
			drag.moved = true;
			close({ restoreFocus: false });
			btn.classList.add("is-dragging");
		}
		const b = bounds();
		place(Math.min(Math.max(drag.x + dx, EDGE), b.right), Math.min(Math.max(drag.y + dy, b.top), b.bottom));
	});
	function endDrag(e) {
		if (!drag || e.pointerId !== drag.id) return;
		if (drag.moved) {
			suppressClick = true;
			const r = btn.getBoundingClientRect();
			const b = bounds();
			pos = {
				side: r.left + SIZE / 2 < window.innerWidth / 2 ? "left" : "right",
				y: b.bottom > b.top ? Math.min(1, Math.max(0, (r.top - b.top) / (b.bottom - b.top))) : 0,
			};
			btn.classList.remove("is-dragging");
			placeSnapped();
			savePos();
		}
		drag = null;
	}
	btn.addEventListener("pointerup", endDrag);
	btn.addEventListener("pointercancel", endDrag);
	btn.addEventListener("click", () => {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		isOpen() ? close() : open();
	});

	/* ---------- mirror the device state ---------- */
	const fanToggle = document.getElementById("fan-toggle");
	const autoToggle = document.getElementById("auto-toggle");
	const irrigation = document.getElementById("irrigation-control");
	const timerText = document.getElementById("timer-text");
	const timeEl = btn.querySelector(".assist-time");

	function mirror() {
		const fanOn = fanToggle?.getAttribute("aria-checked") === "true";
		const autoOn = autoToggle?.getAttribute("aria-checked") === "true";
		const watering = !!irrigation?.classList.contains("is-running");
		btn.classList.toggle("is-fan", fanOn);
		btn.classList.toggle("is-auto", autoOn);
		btn.classList.toggle("is-watering", watering);
		timeEl.textContent = watering && timerText ? timerText.textContent.replace(/^0(\d:)/, "$1") : "";
		const state = [autoOn && "Automate on", fanOn && "fan on", watering && `watering, ${timerText?.textContent} left`].filter(Boolean);
		btn.setAttribute("aria-label", state.length ? `Controls: ${state.join(", ")}` : "Controls");
		if (fanOn || watering) wake();
	}
	const observer = new MutationObserver(mirror);
	if (fanToggle) observer.observe(fanToggle, { attributes: true, attributeFilter: ["aria-checked"] });
	if (autoToggle) observer.observe(autoToggle, { attributes: true, attributeFilter: ["aria-checked"] });
	if (irrigation) observer.observe(irrigation, { attributes: true, attributeFilter: ["class"] });
	if (timerText) observer.observe(timerText, { childList: true, characterData: true, subtree: true });
	mirror();

	/* ---------- layout changes ---------- */
	function onLayout() {
		if (!mobile.matches) close({ restoreFocus: false });
		placeSnapped();
	}
	window.addEventListener("resize", onLayout);
	mobile.addEventListener("change", onLayout);
	placeSnapped();
	wake();
})();
