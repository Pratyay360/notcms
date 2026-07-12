import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dumpConfig, loadConfig } from "../src/cli/features/config";

const DEFAULT_CONFIG = { schema: "src/notcms/schema.ts" };

describe("cli config", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "notcms-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a config file as readable JSON", async () => {
    const configPath = path.join(dir, "notcms.config.json");
    await dumpConfig(configPath, { schema: "src/custom/schema.ts" });

    expect(await loadConfig(configPath)).toEqual({
      schema: "src/custom/schema.ts",
    });
    expect(JSON.parse(await readFile(configPath, "utf-8"))).toEqual({
      schema: "src/custom/schema.ts",
    });
  });

  it("falls back to the default config when the file is missing", async () => {
    expect(await loadConfig(path.join(dir, "missing.json"))).toEqual(
      DEFAULT_CONFIG
    );
  });

  it("falls back to the default config for broken or invalid content", async () => {
    const broken = path.join(dir, "broken.json");
    await writeFile(broken, "not json");
    expect(await loadConfig(broken)).toEqual(DEFAULT_CONFIG);

    const wrongShape = path.join(dir, "wrong.json");
    await writeFile(wrongShape, JSON.stringify({ schema: 123 }));
    expect(await loadConfig(wrongShape)).toEqual(DEFAULT_CONFIG);
  });
});
