export function getApiHost(): string {
  return process.env.NOTCMS_API_HOST ?? "https://api.notcms.com/v1";
}

export const host = getApiHost();
