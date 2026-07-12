import { spawn } from "node:child_process";
import { createServer } from "node:http";

const host = "127.0.0.1";
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ data: [] }));
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, host, resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Failed to start the NotCMS mock server.");
}

let exitCode = 1;
try {
  const command = process.platform === "win32" ? "next.cmd" : "next";
  exitCode = await new Promise((resolve, reject) => {
    const build = spawn(command, ["build"], {
      env: {
        ...process.env,
        NOTCMS_API_HOST: `http://${host}:${address.port}`,
        NOTCMS_SECRET_KEY: "ci-build",
        NOTCMS_WORKSPACE_ID: "ci-build",
      },
      stdio: "inherit",
    });

    build.once("error", reject);
    build.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

process.exitCode = exitCode;
