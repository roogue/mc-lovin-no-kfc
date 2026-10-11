// Overview temperature chart: hover tooltip with each point's date and value.
// The chart covers the last 7 days ending today, so the day labels under it are set from today's date too.
(function () {
	"use strict";

	const card = document.querySelector(".chart-card");
	const svg = card && card.querySelector("svg.chart");
	if (!svg) return;

	const NS = "http://www.w3.org/2000/svg";
	const W = svg.viewBox.baseVal.width;
	const H = svg.viewBox.baseVal.height;
	// The grid runs from y=220 (24°C) up to y=20 (36°C)
	const valueAt = (cy) => 24 + ((220 - cy) / 200) * 12;

	const dots = [...svg.querySelectorAll(".points circle")];
	const labels = [...svg.querySelectorAll("g.axis-label[text-anchor='middle'] text")];
	const xs = dots.map((c) => Number(c.getAttribute("cx")));
	const ys = dots.map((c) => Number(c.getAttribute("cy")));
	const radius = dots.map((c) => c.getAttribute("r"));

	// Point i is (n - 1 - i) days before today
	const today = new Date();
	const dates = dots.map((_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (dots.length - 1 - i)));
	labels.forEach((t, i) => dates[i] && (t.textContent = dates[i].toLocaleDateString("en-GB", { weekday: "short" })));
	const longDate = (d) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });

	const crosshair = document.createElementNS(NS, "line");
	Object.entries({ y1: 20, y2: 220, class: "crosshair", visibility: "hidden" }).forEach(([k, v]) => crosshair.setAttribute(k, v));
	svg.querySelector(".points").before(crosshair);

	const hit = document.createElementNS(NS, "rect");
	Object.entries({ x: xs[0] - 20, y: 0, width: xs[xs.length - 1] - xs[0] + 40, height: H, fill: "transparent" }).forEach(([k, v]) =>
		hit.setAttribute(k, v),
	);
	svg.append(hit);

	const tip = document.createElement("div");
	tip.className = "chart-tip";
	tip.hidden = true;
	card.append(tip);

	let active = -1;

	function show(i) {
		if (i === active) return;
		hide();
		active = i;
		dots[i].setAttribute("r", 6);
		crosshair.setAttribute("x1", xs[i]);
		crosshair.setAttribute("x2", xs[i]);
		crosshair.setAttribute("visibility", "visible");

		const date = document.createElement("strong");
		date.textContent = longDate(dates[i]);
		const value = document.createElement("span");
		value.textContent = `Temperature: ${valueAt(ys[i]).toFixed(1)}°C`;
		tip.replaceChildren(date, value);
		tip.hidden = false;

		// Place it over the point, in the card's coordinates, kept inside the card
		const s = svg.getBoundingClientRect();
		const c = card.getBoundingClientRect();
		const half = tip.offsetWidth / 2;
		const px = s.left - c.left + (xs[i] * s.width) / W;
		tip.style.left = `${Math.min(Math.max(px, half), c.width - half)}px`;
		tip.style.top = `${s.top - c.top + (ys[i] * s.height) / H}px`;
	}

	function hide() {
		if (active >= 0) dots[active].setAttribute("r", radius[active]);
		active = -1;
		crosshair.setAttribute("visibility", "hidden");
		tip.hidden = true;
	}

	hit.addEventListener("pointermove", (e) => {
		const r = svg.getBoundingClientRect();
		const x = ((e.clientX - r.left) * W) / r.width;
		let nearest = 0;
		xs.forEach((cx, i) => Math.abs(cx - x) < Math.abs(xs[nearest] - x) && (nearest = i));
		show(nearest);
	});
	hit.addEventListener("pointerleave", hide);
})();
