import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  getCredentialsFromEnv,
  loginViaBrowser,
  saveCredentials,
} from "../src/cli/features/login";

const spawnMock = vi.hoisted(() =>
  vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }))
);
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

describe("getCredentialsFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when credentials are missing", () => {
    vi.stubEnv("NOTCMS_SECRET_KEY", undefined);
    vi.stubEnv("NOTCMS_WORKSPACE_ID", undefined);

    expect(getCredentialsFromEnv()).toBeNull();
  });

  it("returns null when only one credential is set", () => {
    vi.stubEnv("NOTCMS_SECRET_KEY", "sk_test");
    vi.stubEnv("NOTCMS_WORKSPACE_ID", undefined);

    expect(getCredentialsFromEnv()).toBeNull();
  });

  it("returns credentials when both are set", () => {
    vi.stubEnv("NOTCMS_SECRET_KEY", "sk_test");
    vi.stubEnv("NOTCMS_WORKSPACE_ID", "ws_test");

    expect(getCredentialsFromEnv()).toEqual({
      secretKey: "sk_test",
      workspaceId: "ws_test",
    });
  });
});

describe("saveCredentials", () => {
  let dir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "notcms-login-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const credentials = { secretKey: "ncsec_abc", workspaceId: "ws_123" };

  it("creates the env file when it does not exist", async () => {
    const savedPath = await saveCredentials(credentials);

    expect(savedPath).toBe(path.join(dir, ".env.local"));
    const content = await fs.readFile(savedPath, "utf-8");
    expect(content).toBe(
      "NOTCMS_SECRET_KEY=ncsec_abc\nNOTCMS_WORKSPACE_ID=ws_123\n"
    );
  });

  it.skipIf(process.platform === "win32")(
    "creates the env file with owner-only permissions",
    async () => {
      const savedPath = await saveCredentials(credentials);

      const stat = await fs.stat(savedPath);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  );

  it.skipIf(process.platform === "win32")(
    "tightens permissions of an existing env file with loose permissions",
    async () => {
      const envPath = path.join(dir, ".env.local");
      await fs.writeFile(envPath, "OTHER_KEY=value\n");
      await fs.chmod(envPath, 0o644);

      await saveCredentials(credentials);

      const stat = await fs.stat(envPath);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  );

  it("appends to an existing env file without clobbering other keys", async () => {
    const envPath = path.join(dir, ".env.local");
    await fs.writeFile(envPath, "OTHER_KEY=value\n");

    await saveCredentials(credentials);

    const content = await fs.readFile(envPath, "utf-8");
    expect(content).toBe(
      "OTHER_KEY=value\nNOTCMS_SECRET_KEY=ncsec_abc\nNOTCMS_WORKSPACE_ID=ws_123\n"
    );
  });

  it("replaces existing credential lines in place", async () => {
    const envPath = path.join(dir, ".env.local");
    await fs.writeFile(
      envPath,
      "NOTCMS_SECRET_KEY=old\nOTHER_KEY=value\nNOTCMS_WORKSPACE_ID=old_ws\n"
    );

    await saveCredentials(credentials);

    const content = await fs.readFile(envPath, "utf-8");
    expect(content).toBe(
      "NOTCMS_SECRET_KEY=ncsec_abc\nOTHER_KEY=value\nNOTCMS_WORKSPACE_ID=ws_123\n"
    );
  });

  it("writes to a custom env file path", async () => {
    const savedPath = await saveCredentials(credentials, ".env");

    expect(savedPath).toBe(path.join(dir, ".env"));
  });
});

describe("loginViaBrowser", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves with credentials delivered to the local callback", async () => {
    vi.stubEnv("NOTCMS_DASH_HOST", "https://dash.example.com");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const loginPromise = loginViaBrowser();

    // Wait for the login URL to be printed, then extract port and state
    await vi.waitFor(() => {
      expect(logSpy).toHaveBeenCalled();
    });
    const printed = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    // strip ANSI color codes
    const plain = printed.replace(/\[[0-9;]*m/g, "");
    const url = new URL(
      plain.match(/https:\/\/dash\.example\.com\/cli\/login\?[^\s]+/)?.[0] ?? ""
    );
    const port = url.searchParams.get("port");
    const state = url.searchParams.get("state");
    expect(port).not.toBeNull();
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(spawnMock).toHaveBeenCalled();

    // Wrong state is rejected and the server keeps waiting
    const badResponse = await fetch(
      `http://127.0.0.1:${port}/callback?secret_key=sk&workspace_id=ws&state=wrong`
    );
    expect(badResponse.status).toBe(400);
    expect(await badResponse.text()).not.toContain("Go to dashboard");

    // Correct state resolves the login
    const goodResponse = await fetch(
      `http://127.0.0.1:${port}/callback?secret_key=ncsec_ok&workspace_id=ws_ok&state=${state}`
    );
    expect(goodResponse.status).toBe(200);
    const resultPage = await goodResponse.text();
    expect(resultPage).toContain('href="https://dash.example.com/"');
    expect(resultPage).toContain("Go to dashboard");

    await expect(loginPromise).resolves.toEqual({
      secretKey: "ncsec_ok",
      workspaceId: "ws_ok",
    });
  });
});
