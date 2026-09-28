/* A starting point: copy this folder, rename, and replace the content.
   Shows the helpers — row() for placing nodes, rails by node id, pulses
   `through` node ids, one detail with its own flow. */

const { node, row } = MrMap;

const ROOT = {
  w: 2000, h: 900,
  text: { title: 17, sub: 14, note: 14 },
  heads: [
    { x: 500, y: 60, title: "Before", sub: "what master does" },
    { x: 1500, y: 60, title: "After", sub: "what this MR changes" },
  ],
  nodes: [
    ...row(160, 70, [
      { id: "input", title: "Input::read", sub: "one frame from the device" },
      { id: "parse", title: "Parser::parse", sub: "validates, fills a Message" },
    ], { x0: 100, x1: 900, gap: 80 }),
    ...row(160, 70, [
      { id: "input2", title: "Input::read", sub: "unchanged" },
      { id: "parse2", title: "Parser::parse", sub: "now stateless", detail: "parser" },
    ], { x0: 1100, x1: 1900, gap: 80 }),
    { id: "sink", x: 100, y: 400, w: 800, h: 70, title: "Handler::handle", sub: "one handler for all messages" },
    { id: "sink2", x: 1100, y: 400, w: 800, h: 70, title: "Router::dispatch", sub: "one handler per message type", cls: "shared" },
  ],
  rails: [
    { from: "input", to: "parse" },
    { from: "parse", to: "sink" },
    { from: "input2", to: "parse2" },
    { from: "parse2", to: "sink2" },
  ],
  notes: [[1000, 600, "every box names a real function — replace these with the code of your MR", "middle"]],
  flow: [
    { name: "old", through: ["input", "parse", "sink"] },
    { name: "new", with: true, through: ["input2", "parse2", "sink2"] },
  ],
};

const DETAILS = {
  parser: {
    w: 1600, h: 540,
    heading: "Parser::parse · no state between calls",
    groups: [[40, 102, "per frame"]],
    nodes: [
      ...row(120, 90, [
        { id: "bytes", title: "bytes", sub: "one frame" },
        { id: "check", title: "checkHeader", sub: "length and type" },
        { id: "fill", title: "Message", sub: "built, returned by value" },
      ]),
      node(560, 320, 480, 90, "reject", "bad header → std::nullopt", { id: "reject", cls: "idle" }),
    ],
    rails: [
      { from: "bytes", to: "check" },
      { from: "check", to: "fill" },
      { from: "check", to: "reject", cls: "bypass" },
    ],
    notes: [[40, 480, "was: a member buffer kept between calls — now nothing survives a call", "start"]],
    flow: [{ through: ["bytes", "check", "fill"] }],
  },
};

const MAP = {
  title: "Starter Map",
  caption: "replace me · branch and MR number",
  root: ROOT,
  details: DETAILS,
};
