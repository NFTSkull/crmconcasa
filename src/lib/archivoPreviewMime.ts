/** MIME previsualizable como imagen en Mesa (PNG, JPG/JPEG, WebP y demás `image/*`). */
export function isArchivoPreviewImageMime(mime: string): boolean {
  const m = mime.toLowerCase().trim();
  if (!m.startsWith("image/")) return false;
  return (
    m === "image/png" ||
    m === "image/jpeg" ||
    m === "image/jpg" ||
    m === "image/webp" ||
    m.startsWith("image/")
  );
}

export function isArchivoPreviewPdfMime(mime: string): boolean {
  return mime.toLowerCase().trim() === "application/pdf";
}

/** Abrir vista previa no modifica estatus de revisión (solo lectura). */
export function archivoPreviewEsSoloLectura(): true {
  return true;
}
