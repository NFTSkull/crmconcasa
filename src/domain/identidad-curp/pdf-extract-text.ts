/**
 * Extrae texto embebido de un PDF (sin OCR).
 * No loguear el texto resultante.
 */
export async function extractPdfEmbeddedText(
  data: ArrayBuffer | Uint8Array,
): Promise<{ ok: true; text: string } | { ok: false; reason: "PDF_NO_LEGIBLE" | "ERROR_ANALISIS" }> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes =
      data instanceof Uint8Array ? data : new Uint8Array(data);
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      useSystemFonts: true,
    });
    const doc = await loadingTask.promise;
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const line = content.items
        .map((it) => ("str" in it ? String(it.str) : ""))
        .join(" ");
      text += `${line}\n`;
    }
    if (text.replace(/\s+/g, "").length < 40) {
      return { ok: false, reason: "PDF_NO_LEGIBLE" };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "ERROR_ANALISIS" };
  }
}
