#!/usr/bin/env python3
"""Resolve what a map is about: a merge request, a branch pair, or a working tree.

    subject.py 123                        a merge request
    subject.py origin/master..feature-x   a branch pair
    subject.py develop feature-x          the same, two arguments
    subject.py --dirty develop            working tree against a base

Writes subject.json and prints the size before anything expensive runs.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, asdict, field

NOISE = ("oe-workdir/", "oe-logs/")


def main():
    args = parse_args()
    repo = Repo(args.repo)
    subject = resolve(repo, args)
    report(subject, args.max_files)
    write(subject, args.out)
    return 0 if subject.files_of_interest <= args.max_files else 2


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("spec", nargs="*", help="MR number, BASE..HEAD, or BASE HEAD")
    p.add_argument("--repo", default=".", help="checkout to read")
    p.add_argument("--dirty", action="store_true", help="use the working tree as head")
    p.add_argument("--path", action="append", default=[],
                   help="keep only files under this prefix (repeatable)")
    p.add_argument("--max-files", type=int, default=60)
    p.add_argument("--out", default="subject.json")
    return p.parse_args()


# ── the resolved subject ────────────────────────────────────────────────────

@dataclass
class Subject:
    kind: str
    repo: str
    repoPath: str
    base: str
    head: str
    mergeBase: str
    commit: str
    title: str
    blob: str | None = None
    mr: int | None = None
    paths: list[str] = field(default_factory=list)
    files: list[str] = field(default_factory=list)
    noise: list[str] = field(default_factory=list)
    filtered: list[str] = field(default_factory=list)
    untracked: list[str] = field(default_factory=list)
    commits: list[str] = field(default_factory=list)
    insertions: int = 0
    deletions: int = 0

    @property
    def files_of_interest(self):
        return len(self.files)


def resolve(repo, args):
    if args.dirty:
        return from_working_tree(repo, base_of(args), args.path)
    if len(args.spec) == 1 and args.spec[0].isdigit():
        return from_merge_request(repo, int(args.spec[0]), args.path)
    return from_branches(repo, *branch_pair(args.spec), paths=args.path)


def base_of(args_or_spec):
    spec = args_or_spec.spec if hasattr(args_or_spec, "spec") else args_or_spec
    return spec[0] if spec else None


def branch_pair(spec):
    if len(spec) == 1 and ".." in spec[0]:
        return spec[0].split("..", 1)
    if len(spec) == 2:
        return spec[0], spec[1]
    sys.exit("give a MR number, BASE..HEAD, BASE HEAD, or --dirty BASE")


def from_merge_request(repo, number, paths=()):
    mr = repo.glab(f"projects/{repo.project()}/merge_requests/{number}")
    base = repo.prefer_remote(mr["target_branch"])
    head = mr["sha"]
    subject = span(repo, base, head, kind="merge_request", title=mr["title"], paths=paths)
    subject.mr = number
    subject.head = mr["source_branch"]
    subject.blob = f"{mr['web_url'].split('/-/')[0]}/-/blob/{head}"
    return subject


def from_branches(repo, base, head, paths=()):
    base = repo.prefer_remote(base)
    subject = span(repo, base, repo.rev(head), kind="branch_diff",
                   title=f"{base}..{head}", paths=paths)
    subject.head = head
    subject.blob = repo.blob_url(subject.commit)
    return subject


def from_working_tree(repo, base, paths=()):
    base = repo.prefer_remote(base or repo.upstream())
    subject = span(repo, base, repo.stash_commit(), kind="working_tree",
                   title=f"{base}..{repo.branch()} (uncommitted)", paths=paths)
    subject.head = repo.branch()
    subject.untracked = [f for f in repo.untracked() if keep(f, subject.paths)]
    subject.files = sorted(set(subject.files) | set(subject.untracked))
    return subject


def span(repo, base, head, kind, title, paths=()):
    merge_base = repo.merge_base(base, head)
    changed = repo.changed_files(merge_base, head)
    kept = [f for f in changed if keep(f, paths)]
    added, removed = repo.line_counts(merge_base, head, pathspec(paths))
    return Subject(
        kind=kind, repo=repo.origin(), repoPath=repo.path, base=base, head=head,
        mergeBase=merge_base, commit=head, title=title, paths=list(paths),
        files=kept,
        noise=[f for f in changed if is_noise(f)],
        filtered=[f for f in changed if f not in kept and not is_noise(f)],
        commits=repo.subjects(merge_base, head),
        insertions=added, deletions=removed)


def is_noise(path):
    return path.startswith(NOISE)


def keep(path, paths):
    if is_noise(path):
        return False
    return not paths or any(path.startswith(p) for p in paths)


def pathspec(paths):
    """What `git diff` should count — the same set `keep` accepts."""
    return list(paths) if paths else [f":(exclude){d}" for d in NOISE]


# ── git and glab ────────────────────────────────────────────────────────────

class Repo:
    def __init__(self, path):
        self.path = os.path.abspath(path)

    def git(self, *args):
        done = subprocess.run(["git", "-C", self.path, *args],
                              capture_output=True, text=True)
        return done.stdout.strip() if done.returncode == 0 else ""

    def glab(self, endpoint):
        done = subprocess.run(["glab", "api", endpoint], capture_output=True, text=True,
                              cwd=self.path, timeout=60)
        if done.returncode != 0:
            sys.exit(f"glab api {endpoint} failed: {done.stderr.strip()}")
        return json.loads(done.stdout)

    def rev(self, ref):
        sha = self.git("rev-parse", ref)
        return sha or sys.exit(f"unknown ref: {ref}")

    def branch(self):
        return self.git("branch", "--show-current") or "HEAD"

    def upstream(self):
        return self.git("rev-parse", "--abbrev-ref", "@{upstream}") or "origin/master"

    def project(self):
        """The GitLab project path of origin, URL-encoded for the API."""
        path = re.sub(r"^(https://[^/]+/|git@[^:]+:)", "", self.git("remote", "get-url", "origin"))
        return path.removesuffix(".git").replace("/", "%2F")

    def origin(self):
        return re.sub(r"^(https://|git@)", "", self.git("remote", "get-url", "origin"))

    def blob_url(self, sha):
        url = self.git("remote", "get-url", "origin")
        web = re.sub(r"^git@([^:]+):", r"https://\1/", url).removesuffix(".git")
        return f"{web}/-/blob/{sha}" if self.git("branch", "-r", "--contains", sha) else None

    def prefer_remote(self, ref):
        """A stale local ref silently inflates the diff — origin/<ref> is the honest base."""
        remote = f"origin/{ref}"
        if ref.startswith("origin/") or not self.git("rev-parse", "--verify", remote):
            return ref
        if self.git("rev-parse", ref) != self.git("rev-parse", remote):
            print(f"note: local {ref} differs from {remote} — using {remote}", file=sys.stderr)
        return remote

    def merge_base(self, base, head):
        return self.git("merge-base", base, head) or sys.exit(
            f"no merge base between {base} and {head}")

    def changed_files(self, merge_base, head):
        return [f for f in self.git("diff", "--name-only", merge_base, head).splitlines() if f]

    def line_counts(self, merge_base, head, pathspec=()):
        stat = self.git("diff", "--shortstat", merge_base, head, "--", *pathspec)
        added = re.search(r"(\d+) insertion", stat)
        removed = re.search(r"(\d+) deletion", stat)
        return (int(added.group(1)) if added else 0,
                int(removed.group(1)) if removed else 0)

    def added_lines(self, merge_base, head):
        rows = (line.split("\t") for line in self.git("diff", "--numstat", merge_base, head).splitlines())
        return {r[2]: int(r[0]) for r in rows if len(r) == 3 and r[0].isdigit()}

    def subjects(self, merge_base, head):
        return self.git("log", "--format=%s", f"{merge_base}..{head}").splitlines()

    def stash_commit(self):
        """A throw-away commit holding the tracked edits.

        `stash create` writes objects without touching the index or the working tree, so a
        checkout shared with someone else stays exactly as it was. Untracked files are not in
        it — they are collected separately by untracked()."""
        return self.git("stash", "create") or self.rev("HEAD")

    def untracked(self):
        return [f for f in self.git("ls-files", "--others", "--exclude-standard").splitlines() if f]


# ── report ──────────────────────────────────────────────────────────────────

def report(subject, max_files):
    print(f"{subject.title}")
    print(f"  {subject.kind}  {subject.base}..{subject.head}  merge-base {subject.mergeBase[:9]}")
    print(f"  {len(subject.files)} files, {subject.insertions} insertions, "
          f"{subject.deletions} deletions, {len(subject.commits)} commits")
    if subject.noise:
        print(f"  {len(subject.noise)} build-system files dropped ({', '.join(NOISE)})")
    if subject.filtered:
        print(f"  {len(subject.filtered)} files outside --path {' '.join(subject.paths)}")
    if subject.untracked:
        print(f"  {len(subject.untracked)} untracked files included")
    print("  files  +lines  area")
    for module, files, lines in areas(subject):
        print(f"  {files:5d}  {lines:6d}  {module}")
    if subject.files_of_interest > max_files:
        print(f"\n  {len(subject.files)} files is above --max-files {max_files}.")
        print("  narrow it with a path filter, or pick a nearer base.")


def areas(subject, limit=16):
    """Files and added lines per area, most lines first — the first hint which
    story the change tells. Counted over the same files that are listed."""
    added = Repo(subject.repoPath).added_lines(subject.mergeBase, subject.commit)
    table = {}
    for path in subject.files:
        key = area_of(path)
        files, lines = table.get(key, (0, 0))
        table[key] = (files + 1, lines + added.get(path, 0))
    return sorted(((k, f, n) for k, (f, n) in table.items()), key=lambda row: -row[2])[:limit]


def area_of(path):
    parts = path.split("/")
    depth = 3 if parts[0] in ("libs", "apps") else 2
    return "/".join(parts[:min(depth, len(parts) - 1)]) or parts[0]


def write(subject, out):
    with open(out, "w") as f:
        json.dump(asdict(subject), f, indent=2)
    print(f"\nwrote {out}")


if __name__ == "__main__":
    sys.exit(main())
