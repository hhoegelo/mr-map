---
name: mr-map
description: Visualize a merge request, branch or working tree as one zoomable diagram (boxes and arrows with a travelling pulse, every box holding a deeper diagram of its own) to walk colleagues through the change. Use when someone asks to visualize, present, explain or "walk through" an MR, a branch, a refactoring or how some code path works, or says "mr-map".
---

# mr-map

Everything lives in the repository this `skill/` folder belongs to — follow the
`~/.claude/skills/mr-map` symlink to find it. **Read its `README.md` first** — it holds the map format, the
checks and the learnings. Do not re-derive them.

## Two modes — find out which one first

The person asking is either the **author** of the change or a **reviewer**. If
it is not obvious (they say "my MR", "I wrote…" / "review", "understand"), ask
once, with nothing else in the question.

| | author | reviewer |
|---|---|---|
| who knows the change | the person asking | nobody yet — that is why they ask |
| story and root map | propose the root as a short list, let them choose the focus | decide yourself; do not ask which part matters |
| a fact the code cannot settle | ask them — they know | do not ask; draw it as "not verified" and put it on the question list |
| at the end | the link | the link **and** a numbered list of open questions for the author, worded so it can be pasted into the MR as a comment (the user posts it, not you) |

The reviewer mode must never turn the review back to the reviewer: "which part
should I focus on?" is exactly the question they cannot answer.

## Workflow

1. **What is the change?**
   `python3 tools/subject.py <MR | BASE..HEAD | --dirty BASE> --repo <checkout> --out <map dir>/subject.json`
   Read the area table. Check the base: an integration branch base or a stale
   local ref inflates the diff by orders of magnitude. Fetch the MR branch into
   the checkout (`git fetch origin <branch>`) — never check it out, the checkout
   may be shared. Read the MR description: it says what was observed, which the
   code cannot. But treat its claims as claims: bot summaries (Cursor, …) are
   written for an older commit and stay in the text — class names, file formats,
   whole features in them may be gone. Every mismatch with the code goes into the
   diagram and, in reviewer mode, onto the question list.

2. **Pick the story, then the map.** One sentence: what does this MR make happen
   that did not happen before? The root diagram draws that path — data flow,
   control flow or before/after — with the real function names. Columns for
   roles or components, bands for threads or layers. 10–25 root nodes.
   In author mode, propose the root as a short list first; in reviewer mode,
   draw it. For a small MR (under ~200 lines) read the code yourself instead
   of step 3.

3. **Collect facts in parallel.** One Explore agent per area of the map, each
   asked for: *4–9 boxes in flow order, each `CodeName | one-line fact with a
   number | file:line`, plus the one sub-part complex enough for a further
   level, and everything that could not be verified.* Never draw a fact no
   agent or you read in the code. Tell each agent to read the MR branch with
   `git show '<rev>:<path>'` without checking out; in zsh, `$REV:path` is a
   modifier (`:l` lowercases), so it must be quoted or written `${REV}:path`.
   Before a finding goes onto the question list, read the cited lines yourself.

4. **Write `maps/<name>/map.js`.** Start from `examples/starter/map.js`. Every
   root node gets a detail; a detail node gets one when it hides real logic.
   A node that only points at the next block of the level above gets none.

5. **Check, build, look.**
   `node tools/check.mjs map.js --repo <checkout> --rev <mr-branch>` until 0 errors
   (put `src`/`sym` on the nodes the MR touches);
   `tools/build.py`; `tools/sheet.py` and look at every contact sheet once.

6. **Publish** the built HTML as an artifact (private); give the user the link
   and tell them colleagues need it shared from the page's Share menu.

## Content rules

- Box titles are **real names from the code**. No invented notation.
- **Numbers instead of adjectives**: defaults, sizes, timings from the code.
- **No debug counters** (`x++`, stats fields). Show the behaviour: "dropped",
  "silence", "start again".
- **Plain English**: short sentences, common words, no idioms — the presenter
  may not be a native speaker and has to explain every line.
- **Grey out** (`cls: "idle"`) what runs but does not matter on this side.
- **Say what is not verified** — as a note in the diagram, not by leaving it out.
- A finding on the way (an unused constant, a missing call) goes into the
  diagram *and* is told to the user before they present it.
- Pulse: slow. Keep the defaults unless asked.
