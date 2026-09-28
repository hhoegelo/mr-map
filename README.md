# mr-map

Turns a merge request into one zoomable diagram to walk colleagues through.
From far away it is the story of the change — boxes, arrows, one pulse
travelling through them. Every box can hold a diagram of its own, drawn inside
it, readable once you zoom in — as deep as the code needs.

    python3 tools/subject.py 123 --repo ~/src/project              # what is the MR about?
    node    tools/check.mjs  maps/my-mr/map.js [--repo <checkout>]  # structure, layout, evidence
    python3 tools/build.py   maps/my-mr/map.js -o out/my-mr.html    # one self-contained page
    python3 tools/sheet.py   maps/my-mr/map.js out/my-mr.html -o out/my-mr-sheets

`examples/starter/map.js` is the smallest map worth copying.

Needs `node`, `python3`, `chromium` and Pillow (`sheet.py` only); `glab`, the GitLab CLI,
only when `subject.py` is given an MR number.

## Install the skill

    ln -s "$PWD/skill" ~/.claude/skills/mr-map      # run in the clone

Then ask Claude to "visualize MR 123" or "make an mr-map of this branch".

## The files

| file | what it is |
|---|---|
| `engine/model.js` | everything without a DOM: helpers, arrow routing, pulse timeline, checks. The page and `check.mjs` share it |
| `engine/view.js` | drawing, pulses, camera, input |
| `engine/engine.css`, `engine/shell.html` | look and page frame |
| `tools/subject.py` | resolves MR / branch pair / working tree, prints files and lines per area |
| `tools/check.mjs` | checks a map without a browser; exit 1 on an error |
| `tools/build.py` | engine + map → one HTML file, opens offline, publishes as an artifact unchanged |
| `tools/sheet.py` | screenshots of the overview and every detail, as contact sheets |

## map.js

A plain script that defines `MAP`. It may use any JavaScript to compute
coordinates; `MrMap.node` and `MrMap.row` are there to help.

```js
const MAP = {
  title: "Short Name",              // browser tab and artifact title — read by build.py
  caption: "MR !123 · branch …",    // bottom right
  pulse: { speed: 150, detailSpeed: 350, rest: 1600 },   // optional, these are the defaults
  root: { … diagram … },
  details: { key: { … diagram … }, … },
};
```

### A diagram

| field | meaning |
|---|---|
| `w`, `h` | size in its own units. Details are 1600 × 540 by convention |
| `heading` | detail only: the line at the top |
| `text` | font sizes `{ title, sub, note, heading, group }`; details default to 19 / 16 / 16 / 30 / 15, the root usually wants ~15 / 13 / 12 |
| `groups` | `[x, y, label]` — small uppercase labels ("worker thread · every 2 ms") |
| `nodes` | the boxes, below |
| `rails` | the arrows, below |
| `notes` | `[x, y, text, anchor = "start", cls]`; `cls` is `mono` or `faint` |
| `flow` | the pulse, below |
| `holds` | a pill shown while the pulse waits: `{ x, y, w, text, from: route, until: route }` |
| root only | `bands` `{ y, h, label, note, accent: "rt" }`, `zones` `{ x, y, w, h, label: [lines] }`, `heads` `{ x, y, title, sub }`, `marks` `{ x, y }` (a small ×) |

### Nodes

`{ id, x, y, w, h, title, sub, cls, detail, src, sym }`

- `title` is a real name from the code (`Parser::parse`), `sub` one short line with a number if there is one.
- `cls`: `idle` (grey, dashed — code that runs but does not matter here), `shared` (blue edge), `rt` (red tag: realtime).
- `detail`: key of the diagram drawn inside this node. The same key may be used from several nodes.
- `src: "libs/x/src/Y.cpp:42"` and `sym: "parse"` — evidence; `check.mjs --repo` fails when the line is gone or the symbol is not within 5 lines.

`MrMap.row(y, h, [specs], { x0, x1, gap })` places nodes left to right; a spec may carry `weight`.

### Rails

- `[[x, y], …]` — a polyline
- `{ points, cls }` — same, with `cls`: `bypass` (dashed), `ack` (blue dashed), `plain` (no arrow head)
- `{ from: id, to: id, at, cls }` — routed between the nodes' edges: straight when they face each other, one elbow otherwise; `at` pins the straight line's x (vertical) or y (horizontal)

### Flow (the pulse)

Routes play one after the other.

| field | meaning |
|---|---|
| `points` or `through: [ids]` | the route; `through` goes node centre to node centre along the same routing as rails |
| `name` | to refer to it from `after`, `holds` |
| `with: true` | starts together with the route before |
| `after: [names]`, `delay` | starts when all of those ended, plus `delay` ms |
| `cls: "ack"` | pale — control or acknowledgement rather than data |

The root flow loops. A detail replays its flow each time the pulse on the level
above enters its host node.

## Checks (`check.mjs`)

Errors: unknown detail or node id, a detail containing itself, nodes outside
their diagram or overlapping, text wider than its node, notes running out of the
diagram, broken evidence. Warnings: a miniature narrower than 100 units, a note
lying on a node, text that reads like a debug counter (`x++`), unused details.

Text width is estimated from the character count. The browser's own measurement
(`getBBox`) is useless here: inside a group scaled to 1/1000 it reports widths
several times too large.

## Learnings

- **A miniature must not cover its host's text.** It takes only the room right of
  the longest line, estimated wide (0.67 em mono, 0.56 em sans), and shrinks
  rather than overlap. Fixed after a function name disappeared behind its own detail.
- **Headless chromium does not advance the animation.** Screenshots at any
  `--virtual-time-budget` show the same frame. Test pulse logic by calling
  `window.MR_MAP_VIEWS[i].track.show(t)` in a real page and reading the classes.
- **A hidden browser pane stops `requestAnimationFrame`.** Nothing moves, nothing is broken.
- **`const top` at script level collides with `window.top`** and kills the page
  with a SyntaxError. Name helpers `topOf`.
- **Speeds are the audience's, not the author's.** 150 units/s on the map and
  350 in details were chosen after "too fast" at double the speed.

## License

MIT — see `LICENSE`.
