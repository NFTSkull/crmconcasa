/**
 * Lectura de plantillas v1 bundled. El renderer B1 no toca fs.
 */

import type { InfonavitDocumentType } from "../_shared/infonavit-pdf/types.ts";
import { INFONAVIT_B1_TEMPLATE_FILE } from "../_shared/infonavit-pdf/document-type-map.ts";

async function readFirstExisting(urls: URL[]): Promise<Uint8Array> {
  for (const url of urls) {
    try {
      return await Deno.readFile(url);
    } catch {
      // try next candidate (local graph vs static_files layout)
    }
  }
  throw new Error("TEMPLATE_NOT_BUNDLED");
}

export async function loadBundledTemplateBytes(
  b1Type: InfonavitDocumentType,
): Promise<Uint8Array> {
  const file = INFONAVIT_B1_TEMPLATE_FILE[b1Type];
  return await readFirstExisting([
    new URL(`../_shared/infonavit-templates/v1/${file}`, import.meta.url),
    new URL(`./infonavit-templates/v1/${file}`, import.meta.url),
    new URL(
      `./_shared/infonavit-templates/v1/${file}`,
      import.meta.url,
    ),
  ]);
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
