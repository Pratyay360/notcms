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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("polls the API until the dashboard approves the device", async () => {
    vi.stubEnv("NOTCMS_API_HOST", "https://api.example.com/v1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "device-code-with-enough-entropy-1234567890",
            user_code: "ABCD-EFGH",
            verification_uri: "https://dash.example.com/cli/login",
            verification_uri_complete:
              "https://dash.example.com/cli/login?user_code=ABCD-EFGH",
            expires_in: 600,
            interval: 1,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "authorization_pending" }), {
          status: 400,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token_type: "notcms_secret",
            secret_key: "ncsec_ok",
            workspace_id: "ws_ok",
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const loginPromise = loginViaBrowser();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(loginPromise).resolves.toEqual({
      secretKey: "ncsec_ok",
      workspaceId: "ws_ok",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.com/v1/cli/device/authorization"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.example.com/v1/cli/device/token"
    );
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        "https://dash.example.com/cli/login?user_code=ABCD-EFGH",
      ]),
      expect.objectContaining({ detached: true })
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("ABCD-EFGH"));
  });

  it("rejects a non-HTTPS browser URL returned by the API", async () => {
    vi.stubEnv("NOTCMS_API_HOST", "https://api.example.com/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "device-code-with-enough-entropy-1234567890",
            user_code: "ABCD-EFGH",
            verification_uri: "http://attacker.example/cli/login",
            verification_uri_complete:
              "http://attacker.example/cli/login?user_code=ABCD-EFGH",
            expires_in: 600,
            interval: 5,
          }),
          { status: 200 }
        )
      )
    );

    await expect(loginViaBrowser()).rejects.toThrow("unsafe browser login URL");
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
