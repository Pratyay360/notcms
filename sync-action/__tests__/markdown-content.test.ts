import { describe, expect, it } from "vitest";
import {
  hasMeaningfulMarkdownChange,
  readNotCmsMetadata,
} from "../src/markdown/content.js";

describe("markdown content comparison", () => {
  it("ignores notcms_last_synced_at changes", () => {
    const existing = [
      "---",
      'title: "Hello"',
      'notcms_id: "page-1"',
      'notcms_db: "blog"',
      'notcms_last_synced_at: "2026-03-24T15:00:00.000Z"',
      "---",
      "# Hello",
      "",
    ].join("\n");
    const generated = [
      "---",
      'title: "Hello"',
      'notcms_id: "page-1"',
      'notcms_db: "blog"',
      'notcms_last_synced_at: "2026-03-25T15:00:00.000Z"',
      "---",
      "# Hello",
      "",
    ].join("\n");

    expect(hasMeaningfulMarkdownChange(existing, generated)).toBe(false);
  });

  it("detects meaningful frontmatter changes", () => {
    const existing = [
      "---",
      'title: "Hello"',
      'notcms_id: "page-1"',
      'notcms_db: "blog"',
      "---",
      "# Hello",
      "",
    ].join("\n");
    const generated = [
      "---",
      'title: "Updated"',
      'notcms_id: "page-1"',
      'notcms_db: "blog"',
      "---",
      "# Hello",
      "",
    ].join("\n");

    expect(hasMeaningfulMarkdownChange(existing, generated)).toBe(true);
  });

  it("reads NotCMS metadata from generated markdown", () => {
    const content = [
      "---",
      'title: "Hello"',
      'notcms_id: "page-1"',
      'notcms_db: "blog"',
      "---",
      "# Hello",
      "",
    ].join("\n");

    expect(readNotCmsMetadata(content)).toEqual({ id: "page-1", db: "blog" });
  });
});
