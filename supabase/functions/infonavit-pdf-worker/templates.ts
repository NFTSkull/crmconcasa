/**
 * Lectura de plantillas v1 bundled.
 *
 * En deploy normal se leen desde el bundle local. También soporta el worker
 * pinneado a un commit remoto (raw.githubusercontent.com): en ese caso las
 * plantillas se descargan una sola vez por instancia y quedan en memoria.
 */

import type { InfonavitDocumentType } from "../_shared/infonavit-pdf/types.ts";
import { INFONAVIT_B1_TEMPLATE_FILE } from "../_shared/infonavit-pdf/document-type-map.ts";

const templateCache = new Map<string, Promise<Uint8Array>>();

async function readTemplateUrl(url: URL): Promise<Uint8Array> {
  if (url.protocol === "file:") {
    return await Deno.readFile(url);
  }

  if (url.protocol === "https:" || url.protocol === "http:") {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TEMPLATE_HTTP_${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  return await Deno.readFile(url);
}

async function readFirstExisting(urls: URL[]): Promise<Uint8Array> {
  for (const url of urls) {
    try {
      return await readTemplateUrl(url);
    } catch {
      // try next candidate (local graph, static_files layout or remote pin)
    }
  }
  throw new Error("TEMPLATE_NOT_BUNDLED");
}

export async function loadBundledTemplateBytes(
  b1Type: InfonavitDocumentType,
): Promise<Uint8Array> {
  const file = INFONAVIT_B1_TEMPLATE_FILE[b1Type];
  const cacheKey = `${import.meta.url}|${file}`;
  let cached = templateCache.get(cacheKey);

  if (!cached) {
    cached = readFirstExisting([
      new URL(`../_shared/infonavit-templates/v1/${file}`, import.meta.url),
      new URL(`./infonavit-templates/v1/${file}`, import.meta.url),
      new URL(
        `./_shared/infonavit-templates/v1/${file}`,
        import.meta.url,
      ),
    ]);
    templateCache.set(cacheKey, cached);
  }

  try {
    return await cached;
  } catch (error) {
    // No conservar un fallo transitorio de red en cache.
    templateCache.delete(cacheKey);
    throw error;
  }
}

export async function certifyBundledTemplateShas(): Promise<
  Record<InfonavitDocumentType, string>
> {
  const { sha256Hex } = await import("../_shared/infonavit-pdf/sha256.ts");
  const types: InfonavitDocumentType[] = [
    "carta_bajo_protesta",
    "presupuesto_mejoramiento",
    "solicitud_inscripcion_credito",
  ];
  const out = {} as Record<InfonavitDocumentType, string>;
  for (const t of types) {
    const bytes = await loadBundledTemplateBytes(t);
    out[t] = await sha256Hex(bytes);
  }
  return out;
}
