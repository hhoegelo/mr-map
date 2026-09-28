#!/usr/bin/env node
// Check a map without a browser: structure, layout, text width, and —
// with --repo — that every `src: "path:line"` exists in the checkout.
//
//   check.mjs examples/starter/map.js [--repo ~/src/project [--rev origin/feature-x]] [--keys]
//
// With --rev the files are read from that commit (git show), so the checkout
// can stay on whatever branch it is on.
//
// Exit 1 on any error. --keys prints the detail keys (one per line) and
// nothing else; tools/sheet.py uses it.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const engine = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "engine");
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const repo = option("--repo");
const rev = option("--rev");
const mapFile = args.find((a, i) => !a.startsWith("--") && !["--repo", "--rev"].includes(args[i - 1]));

const MAP = load(mapFile);

if (args.includes("--keys")) {
  Object.keys(MAP.details ?? {}).forEach(k => console.log(k));
  process.exit(0);
}

const findings = [...MAP_MODEL.validate(MAP), ...(repo ? evidence(MAP, repo) : [])];
findings.forEach(f => console.log(`${f.level === "error" ? "ERROR" : "warn "}  ${f.where}: ${f.message}`));
summary(MAP, findings);
process.exit(findings.some(f => f.level === "error") ? 1 : 0);

function load(file) {
  const context = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(engine, "model.js"), "utf8"), context, { filename: "model.js" });
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  globalThis.MAP_MODEL = vm.runInContext("MrMap", context);
  return vm.runInContext("MAP", context);
}

function* allNodes(MAP) {
  for (const [key, D] of [["root", MAP.root], ...Object.entries(MAP.details ?? {})])
    for (const n of D.nodes) yield [key, n];
}

//! A node's `src` is "path:line"; `sym`, when given, has to appear within
//! five lines of it, so a moved function is caught rather than trusted.
function evidence(MAP, repo) {
  const found = [];
  for (const [key, n] of allNodes(MAP)) {
    if (!n.src) continue;
    const [file, line] = n.src.split(":");
    const content = read(file);
    if (content === null) {
      found.push({ level: "error", where: `${key} › ${n.title}`, message: `${file} does not exist${rev ? ` at ${rev}` : ""}` });
      continue;
    }
    const lines = content.split("\n");
    const at = Number(line);
    if (!(at >= 1 && at <= lines.length))
      found.push({ level: "error", where: `${key} › ${n.title}`, message: `${n.src}: no such line` });
    else if (n.sym && !lines.slice(Math.max(0, at - 6), at + 5).some(l => l.includes(n.sym)))
      found.push({ level: "error", where: `${key} › ${n.title}`, message: `"${n.sym}" not near ${n.src}` });
  }
  return found;
}

function read(file) {
  try {
    return rev
      ? execFileSync("git", ["-C", repo, "show", `${rev}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      : fs.readFileSync(path.join(repo, file), "utf8");
  } catch {
    return null;
  }
}

function summary(MAP, findings) {
  const nodes = [...allNodes(MAP)];
  const errors = findings.filter(f => f.level === "error").length;
  console.log(`\n${1 + Object.keys(MAP.details ?? {}).length} diagrams · ${nodes.length} nodes · ` +
    `${nodes.filter(([, n]) => n.src).length} with src · ${errors} errors · ${findings.length - errors} warnings`);
}
