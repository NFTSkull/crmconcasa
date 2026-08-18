/**
 * Inspección OOXML de un .docx P189 (tests locales).
 * Usa JSZip ya presente como transitiva de exceljs.
 */

import JSZip from "jszip";

export interface DocxInspectResult {
  files: string[];
  documentXml: string;
  wtTexts: string[];
  joinedText: string;
  drawingCount: number;
  blipCount: number;
  mediaFiles: string[];
  hasWordprocessingMl: boolean;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export async function inspectInfonavitDocx(
  bytes: Uint8Array,
): Promise<DocxInspectResult> {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).sort();
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error("DOCX_MISSING_DOCUMENT_XML");
  }
  const documentXml = await docFile.async("string");
  const wtTexts = [...documentXml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(
    (m) => decodeXml(m[1] ?? ""),
  );
  const stripped = decodeXml(documentXml.replace(/<[^>]+>/g, " ")).replace(
    /\s+/g,
    " ",
  );
  const contentTypes = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
  return {
    files,
    documentXml,
    wtTexts,
    joinedText: `${wtTexts.join(" ")} ${stripped}`,
    drawingCount: (documentXml.match(/<w:drawing\b/g) ?? []).length,
    blipCount: (documentXml.match(/<a:blip\b/g) ?? []).length,
    mediaFiles: files.filter((f) => f.startsWith("word/media/")),
    hasWordprocessingMl: contentTypes.includes("wordprocessingml"),
  };
}

export function assertNativeEditableText(
  inspect: DocxInspectResult,
  needle: string,
): boolean {
  if (!needle.trim()) return true;
  const inWt = inspect.wtTexts.some((t) => t.normalize("NFC").includes(needle.normalize("NFC")));
  if (!inWt) return false;
  const inDrawing = /<w:drawing[\s\S]*?<\/w:drawing>/g.test(inspect.documentXml)
    ? [...inspect.documentXml.matchAll(/<w:drawing[\s\S]*?<\/w:drawing>/g)].some(
        (block) => block[0].includes(needle),
      )
    : false;
  return inWt && !inDrawing;
}

/** Edita un w:t conocido y reempaca — prueba de que el valor es XML de Word, no raster. */
export async function replaceDocxText(
  bytes: Uint8Array,
  from: string,
  to: string,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("DOCX_MISSING_DOCUMENT_XML");
  let xml = await docFile.async("string");
  if (!xml.includes(from)) {
    throw new Error("DOCX_TEXT_NOT_FOUND");
  }
  xml = xml.replace(from, to);
  zip.file("word/document.xml", xml);
  const out = await zip.generateAsync({ type: "uint8array" });
  return out;
}
