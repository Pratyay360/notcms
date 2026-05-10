import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findStaleSyncFiles } from "../src/git.js";

function managedMarkdown(id: string): string {
  return [
    "---",
    'title: "Old"',
    `notcms_id: "${id}"`,
    'notcms_db: "blog"',
    "---",
    "# Old",
    "",
  ].join("\n");
}

describe("findStaleSyncFiles", () => {
  let originalCwd: string;
  let repoDir: string;

  function git(args: string[]): void {
    execFileSync("git", args, { cwd: repoDir, stdio: "ignore" });
  }

  function writeFile(file: string, content: string): void {
    const absPath = path.join(repoDir, file);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
  }

  beforeEach(() => {
    originalCwd = process.cwd();
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "notcms-sync-action-"));
    git(["init"]);
    git(["checkout", "-b", "main"]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.com"]);
    writeFile("README.md", "base\n");
    git(["add", "."]);
    git(["commit", "-m", "base"]);
    git(["checkout", "-b", "notcms/sync-1"]);
    writeFile("content/old.md", managedMarkdown("page-1"));
    writeFile("notes/manual.md", "# Manual\n");
    git(["add", "."]);
    git(["commit", "-m", "sync"]);
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { force: true, recursive: true });
  });

  it("marks a previous generated path stale when the same page is generated elsewhere", async () => {
    await expect(
      findStaleSyncFiles(
        "main",
        "notcms/sync-1",
        ["content/new.md"],
        ["page-1"],
        ["page-1"]
      )
    ).resolves.toEqual(["content/old.md"]);
  });

  it("keeps a previous generated path when the page was seen but skipped", async () => {
    await expect(
      findStaleSyncFiles("main", "notcms/sync-1", [], [], ["page-1"])
    ).resolves.toEqual([]);
  });

  it("marks a previous generated path stale when the page disappears", async () => {
    await expect(
      findStaleSyncFiles("main", "notcms/sync-1", [], [], [])
    ).resolves.toEqual(["content/old.md"]);
  });
});
