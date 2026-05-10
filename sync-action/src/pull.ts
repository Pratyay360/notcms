import fs from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import { resolveFilePath } from "./file-mapper.js";
import { hasMeaningfulMarkdownChange } from "./markdown/content.js";
import { generateMarkdown } from "./markdown/frontmatter.js";
import { fetchPages, fetchSchema } from "./notcms-client.js";

export interface PullOptions {
  apiHost: string;
  workspaceId: string;
  secretKey: string;
  filePath: string;
}

export interface PullResult {
  filesChanged: number;
  filesGenerated: string[];
  filesWritten: string[];
  filesSkipped: number;
  generatedNotCmsIds: string[];
  seenNotCmsIds: string[];
}

export async function pull(options: PullOptions): Promise<PullResult> {
  const {
    apiHost,
    workspaceId,
    secretKey,
    filePath: filePathTemplate,
  } = options;

  const filesWritten: string[] = [];
  const filesGenerated: string[] = [];
  const generatedNotCmsIds: string[] = [];
  const seenNotCmsIds: string[] = [];
  let filesSkipped = 0;

  // 1. Fetch schema
  core.info("Fetching schema from NotCMS...");
  const schema = await fetchSchema(apiHost, workspaceId, secretKey);
  const dbNames = Object.keys(schema);
  core.info(`Found ${dbNames.length} database(s): ${dbNames.join(", ")}`);

  // 2. Process each database
  for (const dbName of dbNames) {
    const db = schema[dbName];
    core.info(`Fetching pages for "${dbName}" (${db.id})...`);
    const pages = await fetchPages(apiHost, workspaceId, db.id, secretKey);
    core.info(`Found ${pages.length} page(s) in "${dbName}"`);

    for (const page of pages) {
      seenNotCmsIds.push(page.id);

      if (page.content == null) {
        core.warning(
          `Skipping page "${page.title ?? page.id}" — content not yet synced`
        );
        filesSkipped++;
        continue;
      }

      // Resolve file path from template
      const { path: filePath, missingKeys } = resolveFilePath(
        filePathTemplate,
        page,
        dbName
      );
      if (missingKeys.length > 0) {
        core.warning(
          `Skipping page "${page.title ?? page.id}" — missing values for: ${missingKeys.join(", ")}`
        );
        filesSkipped++;
        continue;
      }

      const markdown = generateMarkdown(page, dbName);
      filesGenerated.push(filePath);
      generatedNotCmsIds.push(page.id);

      // Check if file already exists with same content
      const absPath = path.resolve(filePath);
      try {
        const existing = await fs.readFile(absPath, "utf-8");
        if (!hasMeaningfulMarkdownChange(existing, markdown)) {
          continue; // No meaningful change
        }
      } catch {
        // File doesn't exist — will be created
      }

      // Write file
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, markdown, "utf-8");
      filesWritten.push(filePath);
      core.info(`Written: ${filePath}`);
    }
  }

  core.info(
    `Pull complete: ${filesWritten.length} file(s) written, ${filesSkipped} skipped`
  );
  return {
    filesChanged: filesWritten.length,
    filesGenerated,
    filesWritten,
    filesSkipped,
    generatedNotCmsIds,
    seenNotCmsIds,
  };
}
