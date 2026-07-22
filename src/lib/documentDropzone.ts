/**
 * Helpers puros P103 — dropzone documental (sin I/O).
 * La UI `DocumentDropzone` delega validación/subida al callback del cargador.
 */

export const DOCUMENT_DROPZONE_HINT =
  "Arrastra el archivo aquí o haz clic para seleccionarlo";

export const DOCUMENT_DROPZONE_MULTI_REJECT_SINGLE =
  "Solo se permite un archivo. Quita los extras e intenta de nuevo.";

export function filesFromFileList(list: FileList | null | undefined): File[] {
  if (!list || list.length === 0) return [];
  return Array.from(list);
}

export function filesFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
): File[] {
  if (!dataTransfer?.files?.length) return [];
  return Array.from(dataTransfer.files);
}

/**
 * Normaliza selección/drop según contrato single/multiple.
 * - single: solo el primero; si hay >1 → error claro (sin llamar al handler).
 * - multiple: entrega todos.
 */
export function resolveDocumentDropzoneSelection(opts: {
  files: readonly File[];
  multiple: boolean;
}):
  | { ok: true; files: File[] }
  | { ok: false; reason: "empty" | "too_many"; message: string | null } {
  const files = opts.files.filter(Boolean);
  if (files.length === 0) {
    return { ok: false, reason: "empty", message: null };
  }
  if (!opts.multiple && files.length > 1) {
    return {
      ok: false,
      reason: "too_many",
      message: DOCUMENT_DROPZONE_MULTI_REJECT_SINGLE,
    };
  }
  if (!opts.multiple) {
    return { ok: true, files: [files[0]!] };
  }
  return { ok: true, files: [...files] };
}

/** Impide que el navegador abra el archivo al soltar. */
export function preventBrowserFileOpen(e: {
  preventDefault: () => void;
  stopPropagation?: () => void;
}): void {
  e.preventDefault();
  e.stopPropagation?.();
}

export function nextDragDepth(current: number, delta: 1 | -1): number {
  return Math.max(0, current + delta);
}
