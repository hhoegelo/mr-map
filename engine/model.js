/* mr-map model: everything that does not touch the DOM.
   Shared by the page (view.js) and by tools/check.mjs, so what check finds is
   what the page draws. */
"use strict";

const MrMap = (() => {
  const DETAIL_TEXT = { title: 19, sub: 16, note: 16, heading: 30, group: 15 };
  const PULSE = { speed: 150, detailSpeed: 350, rest: 1600, dash: 38, detailDash: 70 };

  //! Width of one character per unit of font size. ROOMY errs on the wide
  //! side, so a miniature never covers text whichever font the viewer ends up
  //! with; FITS is what the page's own fonts need, for the "too wide" check.
  const ROOMY = { mono: 0.67, sans: 0.56 };
  const FITS = { mono: 0.61, sans: 0.48 };

  /* ─────────── authoring helpers ─────────── */

  const node = (x, y, w, h, title, sub, more = {}) => ({ x, y, w, h, title, sub, ...more });

  //! Lays specs out left to right between x0 and x1; `weight` shares the room.
  function row(y, h, specs, { x0 = 40, x1 = 1560, gap = 40 } = {}) {
    const total = specs.reduce((sum, spec) => sum + (spec.weight ?? 1), 0);
    const room = x1 - x0 - gap * (specs.length - 1);
    let x = x0;
    return specs.map(({ weight = 1, ...spec }) => {
      const w = Math.round(room * weight / total);
      const placed = { ...spec, x, y, w, h };
      x += w + gap;
      return placed;
    });
  }

  /* ─────────── geometry ─────────── */

  const centerX = n => n.x + n.w / 2;
  const centerY = n => n.y + n.h / 2;
  const within = (v, lo, hi) => v >= lo && v <= hi;

  //! Manhattan route from one node's edge to another's: straight when the
  //! nodes face each other, one elbow otherwise. `at` pins the straight line.
  function connect(a, b, at) {
    if (b.y >= a.y + a.h) return vertical(a, b, at, a.y + a.h, b.y);
    if (b.y + b.h <= a.y) return vertical(a, b, at, a.y, b.y + b.h);
    if (b.x >= a.x + a.w) return horizontal(a, b, at, a.x + a.w, b.x);
    return horizontal(a, b, at, a.x, b.x + b.w);
  }

  function vertical(a, b, at, from, to) {
    const x = at ?? [centerX(a), centerX(b)].find(v => within(v, a.x, a.x + a.w) && within(v, b.x, b.x + b.w));
    if (x !== undefined) return [[x, from], [x, to]];
    const middle = (from + to) / 2;
    return [[centerX(a), from], [centerX(a), middle], [centerX(b), middle], [centerX(b), to]];
  }

  function horizontal(a, b, at, from, to) {
    const y = at ?? [centerY(a), centerY(b)].find(v => within(v, a.y, a.y + a.h) && within(v, b.y, b.y + b.h));
    if (y !== undefined) return [[from, y], [to, y]];
    const middle = (from + to) / 2;
    return [[from, centerY(a)], [middle, centerY(a)], [middle, centerY(b)], [to, centerY(b)]];
  }

  //! A pulse route through node centres, turning where the rails turn.
  function through(nodes) {
    return nodes.slice(1).reduce((points, b, i) => {
      const a = nodes[i];
      return [...points, ...connect(a, b), [centerX(b), centerY(b)]];
    }, [[centerX(nodes[0]), centerY(nodes[0])]]);
  }

  const lengthOf = points =>
    points.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - points[i][0], y - points[i][1]), 0);

  /* ─────────── resolving a diagram ─────────── */

  //! Turns an authored diagram into one with plain coordinates everywhere:
  //! rails and flows given by node ids become point lists. A reference to an
  //! unknown node goes to `complain` and the rail or route is left out.
  function resolve(D, isRoot, complain = fail) {
    const text = { ...DETAIL_TEXT, ...(D.text ?? {}) };
    const nodes = D.nodes.map((n, i) => ({ id: n.id ?? `#${i}`, ...n }));
    const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
    const known = ids => {
      const missing = ids.filter(id => !byId[id]);
      missing.forEach(id => complain(`unknown node "${id}"`));
      return missing.length === 0;
    };
    const rails = (D.rails ?? []).flatMap(r => {
      if (Array.isArray(r)) return [{ points: r, cls: "" }];
      if (r.points) return [{ cls: "", ...r }];
      return known([r.from, r.to]) ? [{ cls: "", ...r, points: connect(byId[r.from], byId[r.to], r.at) }] : [];
    });
    const flow = (D.flow ?? []).flatMap(f => {
      if (!f.through) return [f];
      return known(f.through) ? [{ ...f, points: through(f.through.map(id => byId[id])) }] : [];
    });
    return { ...D, isRoot, text, nodes, byId, rails, flow, groups: D.groups ?? [], notes: D.notes ?? [] };
  }

  function fail(message) {
    throw new Error(message);
  }

  /* ─────────── pulse timeline ─────────── */

  //! Routes play one after the other by default. `with` starts a route with
  //! the one before; `after: [names]` starts it once all of those have ended,
  //! plus `delay`.
  function schedule(flow, speed, rest) {
    const byName = {};
    let previousStart = 0;
    let lastEnd = 0;
    const shots = flow.map(f => {
      const start = f.after
        ? Math.max(...f.after.map(n => (byName[n] ?? fail(`unknown route "${n}"`)).end)) + (f.delay ?? 0)
        : f.with ? previousStart : lastEnd + (f.delay ?? 0);
      const shot = { ...f, start, end: start + lengthOf(f.points) / speed * 1000 };
      if (f.name) byName[f.name] = shot;
      previousStart = start;
      lastEnd = Math.max(lastEnd, shot.end);
      return shot;
    });
    return { shots, byName, cycle: lastEnd + rest };
  }

  /* ─────────── text and miniatures ─────────── */

  const titleWidth = (s, T, G = ROOMY) => (s ?? "").length * G.mono * T.title;
  const subWidth = (s, T, G = ROOMY) => (s ?? "").length * G.sans * T.sub;
  const noteWidth = (s, T, cls) => (s ?? "").length * (cls === "mono" ? FITS.mono : FITS.sans) * T.note;
  const textEnd = (n, T) => n.x + 16 + Math.max(titleWidth(n.title, T), subWidth(n.sub, T));

  //! The miniature takes the room right of the host's longest line, at most
  //! the host's height.
  function miniatureScale(host, T, D) {
    const room = host.x + host.w - 8 - (textEnd(host, T) + 12);
    return Math.min((host.h - 10) / D.h, room / D.w);
  }

  /* ─────────── checks ─────────── */

  //! Every finding is { level: "error" | "warn", where, message }.
  function validate(MAP) {
    const findings = [];
    const report = (level, where, message) => findings.push({ level, where, message });
    const used = new Set();
    const checked = new Set();

    function walk(key, raw, isRoot, trail) {
      if (trail.includes(key)) return report("error", key, `contains itself: ${[...trail, key].join(" → ")}`);
      if (checked.has(key)) return;
      checked.add(key);
      const D = resolve(raw, isRoot, message => report("error", key, message));
      checkIds(D, key, report);
      checkBounds(D, key, report);
      checkOverlaps(D, key, report);
      checkNotes(D, key, report);
      checkWords(D, key, report);
      try {
        schedule(D.flow, 1, 0);
      } catch (e) {
        report("error", key, e.message);
      }
      D.nodes.filter(n => n.detail).forEach(n => {
        used.add(n.detail);
        const inner = MAP.details?.[n.detail];
        if (!inner) return report("error", `${key} › ${n.title}`, `detail "${n.detail}" does not exist`);
        const k = miniatureScale(n, D.text, inner);
        if (k * inner.w < 100)
          report("warn", `${key} › ${n.title}`, `miniature only ${Math.round(k * inner.w)} wide — widen the node or shorten its text`);
        walk(n.detail, inner, false, [...trail, key]);
      });
    }

    walk("root", MAP.root, true, []);
    Object.keys(MAP.details ?? {}).filter(k => !used.has(k)).forEach(k => report("warn", k, "detail is never used"));
    return findings;
  }

  function checkIds(D, key, report) {
    const seen = new Set();
    D.nodes.filter(n => !n.id.startsWith("#")).forEach(n => {
      if (seen.has(n.id)) report("error", key, `node id "${n.id}" twice`);
      seen.add(n.id);
    });
  }

  function checkBounds(D, key, report) {
    const out = (x, y) => x < 0 || y < 0 || x > D.w || y > D.h;
    D.nodes.forEach(n => {
      if (out(n.x, n.y) || out(n.x + n.w, n.y + n.h)) report("error", `${key} › ${n.title}`, "node outside the diagram");
      const room = n.w - 24;
      const wide = Math.max(titleWidth(n.title, D.text, FITS), subWidth(n.sub, D.text, FITS));
      if (wide > room) report("error", `${key} › ${n.title}`, `text ~${Math.round(wide - room)} too wide for the node`);
    });
    [...D.rails.map(r => r.points), ...D.flow.map(f => f.points)].flat()
      .filter(([x, y]) => out(x, y))
      .forEach(([x, y]) => report("error", key, `line point ${x},${y} outside the diagram`));
  }

  function checkOverlaps(D, key, report) {
    D.nodes.forEach((a, i) => D.nodes.slice(i + 1).forEach(b => {
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w > 0 && h > 0) report("error", key, `"${a.title}" and "${b.title}" overlap`);
    }));
  }

  function checkNotes(D, key, report) {
    D.notes.forEach(([x, y, content, anchor, cls]) => {
      const w = noteWidth(content, D.text, cls);
      const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
      if (left < 0 || left + w > D.w) report("error", key, `note "${content}" runs out of the diagram`);
      const box = { x: left, y: y - D.text.note * 0.8, w, h: D.text.note };
      const hit = D.nodes.find(n => box.x < n.x + n.w && box.x + box.w > n.x && box.y < n.y + n.h && box.y + box.h > n.y);
      if (hit) report("warn", key, `note "${content}" lies on "${hit.title}"`);
    });
  }

  //! Debug counters are clutter on a slide: show what happens, not a stat.
  function checkWords(D, key, report) {
    const texts = [D.heading, ...D.nodes.flatMap(n => [n.title, n.sub]), ...D.notes.map(n => n[2])].filter(Boolean);
    texts.filter(t => /\w\+\+/.test(t)).forEach(t => report("warn", key, `"${t}" reads like a debug counter`));
  }

  return { node, row, connect, through, lengthOf, resolve, schedule, miniatureScale, validate, PULSE, DETAIL_TEXT };
})();

if (typeof module !== "undefined") module.exports = MrMap;
