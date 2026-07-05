import { getEnv } from "../src/utils/env";

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns values from process.env with surrounding whitespace trimmed", () => {
    vi.stubEnv("NOTCMS_TEST_KEY", "  sk_value  ");

    expect(getEnv("NOTCMS_TEST_KEY")).toBe("sk_value");
  });

  it("returns undefined for unset variables", () => {
    vi.stubEnv("NOTCMS_TEST_KEY_UNSET", undefined);

    expect(getEnv("NOTCMS_TEST_KEY_UNSET")).toBeUndefined();
  });
});
