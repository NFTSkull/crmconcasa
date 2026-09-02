/**
 * Conversión local INE (frente/reverso): imagen → PDF en el navegador.
 * No envía la imagen a APIs externas. Solo el PDF resultante llega a Storage.
 */
import { PDFDocument } from "pdf-lib";
import { INE_IMAGE_DOCUMENT_TIPOS } from "@/lib/fileUploadValidation";
import { sanitizeExpedienteDocumentoFileName } from "@/domain/expediente-archivos/storage-path";
import { EXPEDIENTE_DOCUMENTO_MAX_BYTES } from "@/domain/expediente-archivos/upload-constraints";

export const INE_IMAGE_TO_PDF_JPEG_QUALITY = 0.92;
export const INE_PDF_PAGE_MARGIN_PT = 36; // ~0.5"

/** A4 en puntos PDF. */
export const INE_PDF_A4_PORTRAIT = { width: 595.28, height: 841.89 } as const;
export const INE_PDF_A4_LANDSCAPE = { width: 841.89, height: 595.28 } as const;

export const INE_CONVERTIBLE_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const INE_HEIC_MIMES = new Set(["image/heic", "image/heif"]);

export const INE_IMAGE_TO_PDF_HINT =
  "PDF o imagen. Si subes una imagen, la convertiremos automáticamente a PDF.";

export const INE_IMAGE_CONVERTING_STATUS = "Convirtiendo imagen a PDF…";
export const INE_IMAGE_UPLOADING_STATUS = "PDF listo · subiendo…";

export const INE_IMAGE_CONVERT_ERROR =
  "No pudimos convertir esta imagen a PDF. Intenta con otra imagen o sube un PDF.";

export const INE_HEIC_CONVERT_ERROR =
  "No pudimos convertir esta imagen HEIC a PDF. Intenta subirla como JPG, PNG o PDF.";

export const INE_PDF_TOO_LARGE_ERROR =
  "El PDF generado supera el límite de 15 MB. Intenta con una imagen de menor tamaño.";

export type PrepareIneFileForUploadResult = Readonly<{
  file: File;
  converted: boolean;
  originalName: string;
}>;

export class IneImageToPdfError extends Error {
  readonly code: "heic_unsupported" | "decode_failed" | "pdf_too_large" | "empty";

  constructor(
    code: IneImageToPdfError["code"],
    message: string,
  ) {
    super(message);
    this.name = "IneImageToPdfError";
    this.code = code;
  }
}

export function isIneFrenteOrReversoTipo(tipo: string | null | undefined): boolean {
  return INE_IMAGE_DOCUMENT_TIPOS.has(String(tipo ?? "").trim());
}

export function normalizeUploadMime(file: File): string {
  const raw = String(file.type ?? "")
    .toLowerCase()
    .trim()
    .split(";")[0];
  if (raw === "image/jpg") return "image/jpeg";
  if (raw) return raw;
  const name = String(file.name ?? "").toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  return "";
}

export function isPdfLikeUpload(file: File): boolean {
  const mime = normalizeUploadMime(file);
  if (mime === "application/pdf" || mime === "application/x-pdf") return true;
  return String(file.name ?? "")
    .toLowerCase()
    .endsWith(".pdf");
}

export function isConvertibleIneImage(file: File): boolean {
  if (!file || file.size <= 0) return false;
  if (isPdfLikeUpload(file)) return false;
  return INE_CONVERTIBLE_IMAGE_MIMES.has(normalizeUploadMime(file));
}

/** Base name sin extensión + `.pdf`. Evita `foto.jpg.pdf`. */
export function buildInePdfFileName(originalName: string): string {
  const sanitized = sanitizeExpedienteDocumentoFileName(originalName);
  const withoutExt = sanitized.replace(/\.[^.]+$/u, "");
  const base = withoutExt.trim() || "INE";
  return `${base}.pdf`;
}

/**
 * Encaja imagen en página A4 con margen, sin estirar ni recortar.
 * Página portrait si h≥w; landscape si w>h.
 */
export function fitImageInA4Page(
  imageWidth: number,
  imageHeight: number,
  marginPt: number = INE_PDF_PAGE_MARGIN_PT,
): Readonly<{
  pageWidth: number;
  pageHeight: number;
  drawWidth: number;
  drawHeight: number;
  x: number;
  y: number;
}> {
  const w = Math.max(1, Number(imageWidth) || 1);
  const h = Math.max(1, Number(imageHeight) || 1);
  const landscape = w > h;
  const page = landscape ? INE_PDF_A4_LANDSCAPE : INE_PDF_A4_PORTRAIT;
  const maxW = Math.max(1, page.width - marginPt * 2);
  const maxH = Math.max(1, page.height - marginPt * 2);
  const scale = Math.min(maxW / w, maxH / h);
  const drawWidth = w * scale;
  const drawHeight = h * scale;
  return {
    pageWidth: page.width,
    pageHeight: page.height,
    drawWidth,
    drawHeight,
    x: (page.width - drawWidth) / 2,
    y: (page.height - drawHeight) / 2,
  };
}

export async function embedJpegInPdfFile(
  jpegBytes: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  outputFileName: string,
): Promise<File> {
  const pdf = await PDFDocument.create();
  const layout = fitImageInA4Page(imageWidth, imageHeight);
  const page = pdf.addPage([layout.pageWidth, layout.pageHeight]);
  const jpg = await pdf.embedJpg(jpegBytes);
  page.drawImage(jpg, {
    x: layout.x,
    y: layout.y,
    width: layout.drawWidth,
    height: layout.drawHeight,
  });
  const bytes = await pdf.save();
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new File([ab], outputFileName, { type: "application/pdf" });
}

type DecodeToJpegResult = Readonly<{
  jpegBytes: Uint8Array;
  width: number;
  height: number;
}>;

/**
 * Decodifica imagen en canvas del navegador y re-encoda a JPEG de alta calidad.
 * Respeta orientación cuando `createImageBitmap` está disponible.
 */
export async function decodeIneImageFileToJpeg(
  file: File,
): Promise<DecodeToJpegResult> {
  const mime = normalizeUploadMime(file);
  const isHeic = INE_HEIC_MIMES.has(mime);

  let bitmap: ImageBitmap | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
    }
  } catch {
    bitmap = null;
  }

  if (!bitmap) {
    // Fallback Image element (puede fallar en HEIC)
    try {
      const url = URL.createObjectURL(file);
      try {
        const img = await loadHtmlImage(url);
        return await rasterizeToJpeg(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      if (isHeic) {
        throw new IneImageToPdfError("heic_unsupported", INE_HEIC_CONVERT_ERROR);
      }
      throw new IneImageToPdfError("decode_failed", INE_IMAGE_CONVERT_ERROR);
    }
  }

  try {
    return await rasterizeToJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = url;
  });
}

async function rasterizeToJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<DecodeToJpegResult> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    throw new IneImageToPdfError("decode_failed", INE_IMAGE_CONVERT_ERROR);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new IneImageToPdfError("decode_failed", INE_IMAGE_CONVERT_ERROR);
  }
  ctx.drawImage(source, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", INE_IMAGE_TO_PDF_JPEG_QUALITY);
  });
  if (!blob || blob.size <= 0) {
    throw new IneImageToPdfError("decode_failed", INE_IMAGE_CONVERT_ERROR);
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  return { jpegBytes: buf, width: w, height: h };
}

/** Convierte imagen INE a PDF (una página, aspect ratio preservado). */
export async function convertIneImageToPdf(file: File): Promise<File> {
  if (!file || file.size <= 0) {
    throw new IneImageToPdfError("empty", "Selecciona un archivo válido.");
  }
  const decoded = await decodeIneImageFileToJpeg(file);
  const pdfFile = await embedJpegInPdfFile(
    decoded.jpegBytes,
    decoded.width,
    decoded.height,
    buildInePdfFileName(file.name),
  );
  if (pdfFile.size > EXPEDIENTE_DOCUMENTO_MAX_BYTES) {
    throw new IneImageToPdfError("pdf_too_large", INE_PDF_TOO_LARGE_ERROR);
  }
  return pdfFile;
}

/**
 * Prepara archivo para upload de INE frente/reverso.
 * PDF → intacto. Imagen → PDF local. Otros tipos documentales → intacto.
 */
export async function prepareIneFileForUpload(
  file: File,
  tipoDocumento: string,
): Promise<PrepareIneFileForUploadResult> {
  const originalName = String(file?.name ?? "").trim() || "archivo";
  if (!isIneFrenteOrReversoTipo(tipoDocumento)) {
    return { file, converted: false, originalName };
  }
  if (isPdfLikeUpload(file)) {
    return { file, converted: false, originalName };
  }
  if (!isConvertibleIneImage(file)) {
    // Deja que la validación MIME existente rechace formatos no soportados.
    return { file, converted: false, originalName };
  }
  const pdf = await convertIneImageToPdf(file);
  return { file: pdf, converted: true, originalName };
}

export function isIneImageToPdfError(err: unknown): err is IneImageToPdfError {
  return err instanceof IneImageToPdfError;
}
