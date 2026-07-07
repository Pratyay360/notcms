export const host = process.env.NOTCMS_API_HOST ?? "https://api.notcms.com/v1";

// NOTE: read lazily so that env files loaded by dotenvx are respected
export function getDashHost(): string {
  return process.env.NOTCMS_DASH_HOST ?? "https://dash.notcms.com";
}
