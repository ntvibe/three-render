// Keep project references portable. Apply the hosting prefix only at load time.
export function publicAssetUrl(path: string, base = import.meta.env.BASE_URL): string {
  if (!/^\/?(?:assets|catalog|examples)\//.test(path)) return path;
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${path.replace(/^\//, '')}`;
}
