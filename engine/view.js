/* mr-map view: draws MAP (see model.js) into #world, runs the pulses and the
   camera. Every diagram is drawn the same way; the root adds bands, zones and
   column heads, a detail adds its window and heading. */
"use strict";

(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PULSE = { ...MrMap.PULSE, ...(MAP.pulse ?? {}) };
  const VIEWS = [];

  function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (parent) parent.appendChild(node);
    return node;
  }

  function text(parent, x, y, content, cls, size, attrs = {}) {
    const node = el("text", { x, y, class: cls, "font-size": size, ...attrs }, parent);
    node.textContent = content;
    return node;
  }

  const pathOf = points => points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");

  /* ─────────── drawing one diagram ─────────── */

  //! \param toWorld maps the diagram's own coordinates to the world
  function drawDiagram(g, D, toWorld) {
    const T = D.text;
    if (!D.isRoot) {
      el("rect", { x: 0, y: 0, width: D.w, height: D.h, rx: 18, class: "window" }, g);
      text(g, 40, 52, D.heading ?? "", "heading", T.heading);
    }
    (D.bands ?? []).forEach(b => drawBand(g, D, b));
    (D.zones ?? []).forEach(z => drawZone(g, z, T));
    (D.heads ?? []).forEach(h => drawHead(g, h));
    D.groups.forEach(([x, y, label]) => text(g, x, y, label, "group", T.group));
    D.rails.forEach(r => el("path", {
      d: pathOf(r.points), class: `rail ${r.cls}`,
      "marker-end": r.cls === "plain" ? "none" : r.cls === "ack" ? "url(#arrowAck)" : "url(#arrow)",
    }, g));
    const plan = MrMap.schedule(D.flow, D.isRoot ? PULSE.speed : PULSE.detailSpeed, PULSE.rest);
    const pulses = drawPulses(g, plan, D.isRoot ? PULSE.dash : PULSE.detailDash);
    const nodes = D.nodes.map(n => drawNode(g, n, T, toWorld));
    D.notes.forEach(([x, y, content, anchor = "start", cls = ""]) =>
      text(g, x, y, content, `note ${cls}`, T.note, { "text-anchor": anchor }));
    (D.marks ?? []).forEach(m => el("path", { d: `M${m.x - 7},${m.y} l14,14 M${m.x + 7},${m.y} l-14,14`, class: "mark" }, g));
    const holds = (D.holds ?? []).map(h => drawHold(g, h, plan));
    return { nodes, track: makeTrack(pulses, nodes, holds), plan };
  }

  function drawBand(g, D, b) {
    el("rect", { x: 20, y: b.y, width: D.w - 40, height: b.h, rx: 10, class: "band" }, g);
    const x = 52, y = b.y + b.h / 2;
    const vertical = at => ({ "text-anchor": "middle", transform: `rotate(-90 ${at} ${y})` });
    text(g, x, y, b.label, `band-label ${b.accent ?? ""}`, 11, vertical(x));
    if (b.note) text(g, x + 18, y, b.note, "band-label", 11, vertical(x + 18));
  }

  function drawZone(g, z) {
    el("rect", { x: z.x, y: z.y, width: z.w, height: z.h, rx: 14, class: "zone" }, g);
    (z.label ?? []).forEach((line, i) => text(g, z.labelX ?? z.x + z.w / 2, z.y + 30 + i * 20, line, "zone-label", 15, { "text-anchor": "middle" }));
  }

  function drawHead(g, h) {
    text(g, h.x, h.y, h.title, "head", 26, { "text-anchor": "middle" });
    if (h.sub) text(g, h.x, h.y + 24, h.sub, "head-sub", 14, { "text-anchor": "middle" });
  }

  function drawNode(g, n, T, toWorld) {
    const ng = el("g", { class: `node ${n.cls ?? ""}` }, g);
    el("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: 8, class: "frame" }, ng);
    if ((n.cls ?? "").includes("rt")) el("rect", { x: n.x, y: n.y + 8, width: 4, height: n.h - 16, class: "tag" }, ng);
    drawNodeText(ng, n, T);
    const drawn = { ...n, el: ng, world: frameOf(n, toWorld) };
    if (n.detail) {
      drawn.detail = drawDetail(ng, drawn, T, toWorld);
      ng.classList.add("has-detail");
      ng.dataset.view = VIEWS.indexOf(drawn.detail);
    }
    ng.dataset.node = JSON.stringify(drawn.world);
    return drawn;
  }

  //! Title and subtitle as one block, centred in the node.
  function drawNodeText(ng, n, T) {
    if (!n.sub) {
      text(ng, n.x + 16, n.y + n.h / 2 + T.title * 0.35, n.title, "title", T.title);
      return;
    }
    const gap = T.sub * 0.55;
    const top = n.y + (n.h - (T.title + gap + T.sub)) / 2;
    const titleBase = top + T.title * 0.8;
    text(ng, n.x + 16, titleBase, n.title, "title", T.title);
    text(ng, n.x + 16, titleBase + gap + T.sub * 0.95, n.sub, "sub", T.sub);
  }

  const frameOf = (r, t) => ({ x: t.x + t.k * r.x, y: t.y + t.k * r.y, w: r.w * t.k, h: r.h * t.k });

  function drawDetail(parent, host, T, outer) {
    const D = MrMap.resolve(MAP.details[host.detail], false);
    const k = MrMap.miniatureScale(host, T, D);
    const x = host.x + host.w - D.w * k - 8, y = host.y + (host.h - D.h * k) / 2;
    const toWorld = { x: outer.x + outer.k * x, y: outer.y + outer.k * y, k: outer.k * k };
    const g = el("g", { class: "detail", transform: `translate(${x},${y}) scale(${k})` }, parent);
    const view = { key: host.detail, host, el: g, frame: frameOf({ x: 0, y: 0, w: D.w, h: D.h }, toWorld) };
    VIEWS.push(view);
    Object.assign(view, drawDiagram(g, D, toWorld));
    return view;
  }

  function drawHold(g, h, plan) {
    const hg = el("g", { class: "hold" }, g);
    el("rect", { x: h.x, y: h.y, width: h.w ?? 190, height: 26, rx: 13 }, hg);
    text(hg, h.x + (h.w ?? 190) / 2, h.y + 17, h.text, "", 11, { "text-anchor": "middle" });
    return { el: hg, from: plan.byName[h.from].end, until: plan.byName[h.until].start };
  }

  /* ─────────── pulses ─────────── */

  function drawPulses(parent, plan, dash) {
    return plan.shots.map(shot => {
      const node = el("path", { d: pathOf(shot.points), class: `pulse ${shot.cls ?? ""}` }, parent);
      const length = MrMap.lengthOf(shot.points);
      node.setAttribute("stroke-dasharray", `${dash} ${length + dash}`);
      node.style.visibility = "hidden";
      return { ...shot, node, length, dash };
    });
  }

  function pointAt(points, distance) {
    let left = distance;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      const segment = Math.hypot(bx - ax, by - ay);
      if (left <= segment) return [ax + (bx - ax) * left / segment, ay + (by - ay) * left / segment];
      left -= segment;
    }
    return points[points.length - 1];
  }

  const inside = ([x, y], n) => x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h;

  //! Pulses, the nodes they light and the holds they show, on one timeline.
  function makeTrack(pulses, nodes, holds) {
    return {
      show(t) {
        const heads = pulses.flatMap(p => {
          const k = (t - p.start) / (p.end - p.start);
          const active = k >= 0 && k <= 1;
          p.node.style.visibility = active ? "visible" : "hidden";
          if (!active) return [];
          p.node.setAttribute("stroke-dashoffset", p.dash - k * p.length);
          return [pointAt(p.points, k * p.length)];
        });
        nodes.forEach(n => n.el.classList.toggle("lit", heads.some(h => inside(h, n))));
        holds.forEach(h => h.el.classList.toggle("on", t >= h.from && t < h.until));
      },
    };
  }

  //! A detail replays its flow each time the pulse above enters its host.
  function followHost(view, now) {
    const hostLit = view.host.el.classList.contains("lit");
    if (hostLit && !view.hostWasLit) view.startedAt = now;
    view.hostWasLit = hostLit;
    view.track.show(view.startedAt === undefined ? -1 : now - view.startedAt);
  }

  function animate(root) {
    let elapsed = 0, last = performance.now(), running = true;
    function frame(now) {
      if (running) elapsed += now - last;
      last = now;
      root.track.show(elapsed % root.plan.cycle);
      VIEWS.forEach(view => followHost(view, elapsed));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return { toggle: () => (running = !running) };
  }

  /* ─────────── camera: a viewBox that flies ─────────── */

  function makeCamera(svg, W, H) {
    let view = fitAll();
    const width = () => svg.getBoundingClientRect().width;

    function fitAll() {
      const margin = 40;
      return { x: -margin, y: -margin, w: W + 2 * margin, h: H + 2 * margin };
    }

    function apply() {
      const { width: pw, height: ph } = svg.getBoundingClientRect();
      const scale = Math.max(view.w / pw, view.h / ph);
      const w = pw * scale, h = ph * scale;
      view = { x: view.x - (w - view.w) / 2, y: view.y - (h - view.h) / 2, w, h };
      svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
      fadeDetails(pw / view.w);
    }

    function fadeDetails(pixelsPerUnit) {
      VIEWS.forEach(v => {
        const shown = v.frame.w * pixelsPerUnit / width();
        v.el.style.opacity = Math.min(1, 0.3 + Math.max(0, shown - 0.15) * 1.6);
      });
    }

    function flyTo(target, ms = 900) {
      const from = { ...view };
      const t0 = performance.now();
      const step = now => {
        const k = Math.min(1, Math.max(0, (now - t0) / ms));
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const w = from.w * Math.exp(Math.log(target.w / from.w) * e);
        const cx = from.x + from.w / 2 + (target.x + target.w / 2 - from.x - from.w / 2) * e;
        const cy = from.y + from.h / 2 + (target.y + target.h / 2 - from.y - from.h / 2) * e;
        const h = w * (target.h / target.w);
        view = { x: cx - w / 2, y: cy - h / 2, w, h };
        apply();
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    function toWorld(clientX, clientY) {
      const r = svg.getBoundingClientRect();
      return [view.x + (clientX - r.left) / r.width * view.w, view.y + (clientY - r.top) / r.height * view.h];
    }

    function zoomAt(clientX, clientY, factor) {
      const [wx, wy] = toWorld(clientX, clientY);
      const w = Math.min(Math.max(view.w * factor, 0.5), W * 3);
      const k = w / view.w;
      view = { x: wx - (wx - view.x) * k, y: wy - (wy - view.y) * k, w, h: view.h * k };
      apply();
    }

    function panBy(dx, dy) {
      const r = svg.getBoundingClientRect();
      view = { ...view, x: view.x - dx / r.width * view.w, y: view.y - dy / r.height * view.h };
      apply();
    }

    const padded = (f, share) => {
      const pad = Math.max(f.w, f.h) * share;
      return { x: f.x - pad, y: f.y - pad, w: f.w + 2 * pad, h: f.h + 2 * pad };
    };

    new ResizeObserver(apply).observe(svg);
    apply();
    return {
      zoomAt, panBy,
      overview: () => flyTo(fitAll()),
      enter: (v, ms) => flyTo(padded(v.frame, 0.06), ms),
      focus: frame => flyTo(padded(frame, 0.25)),
    };
  }

  function wireInput(svg, camera) {
    let drag = null;
    svg.addEventListener("wheel", e => { e.preventDefault(); camera.zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    svg.addEventListener("pointerdown", e => {
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add("dragging");
    });
    svg.addEventListener("pointermove", e => {
      if (drag) {
        drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
        camera.panBy(e.clientX - drag.x, e.clientY - drag.y);
        drag.x = e.clientX; drag.y = e.clientY;
      }
    });
    svg.addEventListener("pointerup", e => {
      const clicked = drag && drag.moved < 5;
      drag = null;
      svg.classList.remove("dragging");
      const under = clicked ? document.elementsFromPoint(e.clientX, e.clientY) : [];
      const withDetail = under.map(n => n.closest?.(".has-detail")).find(Boolean);
      const plain = under.map(n => n.closest?.(".node")).find(Boolean);
      if (withDetail) camera.enter(VIEWS[withDetail.dataset.view]);
      else if (plain) camera.focus(JSON.parse(plain.dataset.node));
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") camera.overview(); });
  }

  /* ─────────── start ─────────── */

  function main() {
    const svg = document.getElementById("map");
    const D = MrMap.resolve(MAP.root, true);
    const root = drawDiagram(document.getElementById("world"), D, { x: 0, y: 0, k: 1 });
    const player = animate(root);
    const camera = makeCamera(svg, D.w, D.h);
    wireInput(svg, camera);
    const deepLinked = VIEWS.find(v => v.key === location.hash.slice(1));
    if (deepLinked) camera.enter(deepLinked, 1);
    document.getElementById("caption").textContent = MAP.caption ?? "";
    const toggle = document.getElementById("toggle");
    toggle.addEventListener("click", () => { toggle.textContent = player.toggle() ? "pause" : "play"; });
    document.getElementById("overview").addEventListener("click", camera.overview);
    window.MR_MAP_VIEWS = VIEWS;
  }

  main();
})();
