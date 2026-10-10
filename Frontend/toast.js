// Small toast messages in the dashboard's style: PlantToast(message, 'error' | 'info' | 'success').
// They stack bottom-right and close by themselves after a few seconds (or with the × button).

window.PlantToast = (function () {
	"use strict";

	let region = null;
	function ensureRegion() {
		if (region) return region;
		region = document.createElement("div");
		region.className = "toast-region";
		region.setAttribute("aria-live", "polite");
		document.body.appendChild(region);
		return region;
	}

	const ICONS = {
		error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.5" /></svg>',
		info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.5" /></svg>',
		success: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></svg>',
	};

	function close(toast) {
		if (!toast.isConnected || toast.classList.contains("is-leaving")) return;
		toast.classList.add("is-leaving");
		setTimeout(() => toast.remove(), 250);
	}

	return function toast(message, kind = "info", { duration = 5000 } = {}) {
		const host = ensureRegion();
		// Don't stack the same message twice (e.g. two commands failing for the same reason)
		const same = [...host.children].find((t) => !t.classList.contains("is-leaving") && t.querySelector("p").textContent === message);
		if (same) return same;
		const el = document.createElement("div");
		el.className = `toast toast-${kind}`;
		el.setAttribute("role", kind === "error" ? "alert" : "status");

		const icon = document.createElement("span");
		icon.className = "toast-icon";
		icon.innerHTML = ICONS[kind] || ICONS.info;
		const text = document.createElement("p");
		text.textContent = message;
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "toast-close";
		btn.setAttribute("aria-label", "Dismiss");
		btn.textContent = "×";
		btn.addEventListener("click", () => close(el));

		el.append(icon, text, btn);
		host.appendChild(el);
		while (host.childElementCount > 4) host.firstElementChild.remove();
		setTimeout(() => close(el), duration);
		return el;
	};
})();
