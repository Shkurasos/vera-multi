/** Accept web addresses only; bare domains default to HTTPS. */
export function externalSiteUrl(input: string): string | null {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  const explicit = /^https?:\/\//i.test(value);
  if (!explicit && (!/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(value) || value.includes('://'))) return null;
  try {
    const url = new URL(explicit ? value : `https://${value}`);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}