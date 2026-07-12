import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import chalk from "chalk";
import dedent from "dedent";
import { getDashHost } from "../variables.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export type Credentials = {
  secretKey: string;
  workspaceId: string;
};

export function getCredentialsFromEnv(): Credentials | null {
  const { NOTCMS_SECRET_KEY, NOTCMS_WORKSPACE_ID } = process.env;
  if (!NOTCMS_SECRET_KEY || !NOTCMS_WORKSPACE_ID) {
    return null;
  }
  return {
    secretKey: NOTCMS_SECRET_KEY,
    workspaceId: NOTCMS_WORKSPACE_ID,
  };
}

/**
 * Log in to NotCMS via browser.
 *
 * Starts a one-shot HTTP server on 127.0.0.1 and opens the dashboard's CLI
 * login page. The dashboard mints a secret key for the workspace the user
 * picks and redirects back to the local server with the credentials.
 */
export function loginViaBrowser(): Promise<Credentials> {
  const state = randomBytes(16).toString("hex");

  return new Promise<Credentials>((resolve, reject) => {
    let finished = false;
    const finish = (settle: () => void) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      // Close after the in-flight response is flushed.
      setImmediate(() => server.close());
      settle();
    };

    const timeout = setTimeout(() => {
      finish(() =>
        reject(new Error("Login timed out. Run the command again to retry."))
      );
    }, LOGIN_TIMEOUT_MS);

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const secretKey = url.searchParams.get("secret_key");
      const workspaceId = url.searchParams.get("workspace_id");
      const receivedState = url.searchParams.get("state");
      if (receivedState !== state || !secretKey || !workspaceId) {
        // Ignore requests that don't carry our state and keep waiting.
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResultPage(false));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderResultPage(true));
      finish(() => resolve({ secretKey, workspaceId }));
    });

    server.on("error", (error) => finish(() => reject(error)));

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const loginUrl = new URL("/cli/login", getDashHost());
      loginUrl.searchParams.set("port", String(port));
      loginUrl.searchParams.set("state", state);

      console.log(dedent`
        Opening your browser to log in to NotCMS...

        If the browser does not open, visit:
        ${chalk.blue(loginUrl.toString())}
      `);
      openBrowser(loginUrl.toString());
    });
  });
}

/**
 * Save credentials to an env file, replacing existing entries in place.
 * Returns the absolute path of the file written.
 */
export async function saveCredentials(
  credentials: Credentials,
  envPath = ".env.local"
): Promise<string> {
  const absolutePath = path.resolve(process.cwd(), envPath);
  let content = "";
  try {
    content = await fs.readFile(absolutePath, "utf-8");
  } catch {
    // The file does not exist yet; it will be created.
  }
  content = upsertEnvLine(content, "NOTCMS_SECRET_KEY", credentials.secretKey);
  content = upsertEnvLine(
    content,
    "NOTCMS_WORKSPACE_ID",
    credentials.workspaceId
  );
  // mode only applies when the file is newly created
  await fs.writeFile(absolutePath, content, { mode: 0o600 });
  await tightenPermissions(absolutePath, envPath);

  await warnIfNotGitignored(envPath);

  return absolutePath;
}

/**
 * The file now contains a secret: make sure it is not readable by group or
 * others. No-op on Windows, which has no POSIX permission bits.
 */
async function tightenPermissions(
  absolutePath: string,
  envPath: string
): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const stat = await fs.stat(absolutePath);
  if ((stat.mode & 0o077) === 0) {
    return;
  }
  await fs.chmod(absolutePath, 0o600);
  console.log(
    chalk.gray(
      `Tightened permissions of ${path.basename(envPath)} to owner-only (600).`
    )
  );
}

function upsertEnvLine(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  const needsNewline = content.length > 0 && !content.endsWith("\n");
  return `${content}${needsNewline ? "\n" : ""}${line}\n`;
}

async function warnIfNotGitignored(envPath: string): Promise<void> {
  const gitignorePath = path.resolve(process.cwd(), ".gitignore");
  let gitignore: string;
  try {
    gitignore = await fs.readFile(gitignorePath, "utf-8");
  } catch {
    // Not a git project (or no .gitignore); nothing to check.
    return;
  }
  const fileName = path.basename(envPath);
  if (!gitignore.includes(".env")) {
    console.log(
      chalk.yellow(
        `Warning: ${fileName} does not appear to be gitignored. ` +
          `Add it to .gitignore to avoid committing your secret key.`
      )
    );
  }
}

function openBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {
    // The login URL is already printed; auto-open is best-effort.
  });
  child.unref();
}

function renderResultPage(success: boolean): string {
  const title = success ? "Login successful" : "Login failed";
  const message = success
    ? "You are logged in to NotCMS. You can close this tab and return to the terminal."
    : "Something went wrong. Return to the terminal and try again.";
  const dashboardLink = success
    ? `<a class="dashboard-link" href="${new URL("/", getDashHost()).toString()}">Go to dashboard</a>`
    : "";
  return dedent`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title} - NotCMS</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0a0a0a; color: #fafafa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
          main { padding: 1.5rem; text-align: center; }
          h1 { font-size: 1.5rem; }
          p { color: #a1a1aa; }
          .dashboard-link { display: inline-flex; margin-top: 0.75rem; padding: 0.5rem 0.75rem; border: 1px solid #27272a; border-radius: 0.5rem; color: #a1a1aa; font-size: 0.875rem; text-decoration: none; transition: background-color 150ms, border-color 150ms, color 150ms; }
          .dashboard-link:hover { border-color: #52525b; background: #18181b; color: #fafafa; }
          .dashboard-link:focus-visible { outline: 2px solid #f9a8d4; outline-offset: 3px; }
        </style>
      </head>
      <body>
        <main>
          <h1>${success ? "✓" : "✗"} ${title}</h1>
          <p>${message}</p>
          ${dashboardLink}
        </main>
      </body>
    </html>
  `;
}
