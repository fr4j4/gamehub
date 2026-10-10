// Resuelve los imports absolutos del navegador (/sdk/..., /games/...) a archivos locales.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('/sdk/') || spec.startsWith('/games/')) return next(pathToFileURL(path.join(ROOT, spec)).href, ctx);
  return next(spec, ctx);
}
