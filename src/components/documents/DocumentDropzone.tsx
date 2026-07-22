"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import {
  DOCUMENT_DROPZONE_HINT,
  filesFromDataTransfer,
  filesFromFileList,
  nextDragDepth,
  preventBrowserFileOpen,
  resolveDocumentDropzoneSelection,
} from "@/lib/documentDropzone";

export type DocumentDropzoneProps = Readonly<{
  accept?: string;
  disabled?: boolean;
  /** Bloquea nueva selección mientras hay carga en curso. */
  busy?: boolean;
  /** Por defecto false: un solo archivo. */
  multiple?: boolean;
  selectedFileName?: string | null;
  /** Error local (p. ej. múltiples archivos) o del padre. */
  error?: string | null;
  hint?: string;
  inputId?: string;
  className?: string;
  /** Compacto para filas de lista. */
  compact?: boolean;
  "aria-label"?: string;
  /** Entrega archivos ya normalizados al handler existente del cargador. */
  onFiles: (files: File[]) => void;
}>;

export function DocumentDropzone({
  accept,
  disabled = false,
  busy = false,
  multiple = false,
  selectedFileName = null,
  error = null,
  hint = DOCUMENT_DROPZONE_HINT,
  inputId,
  className = "",
  compact = false,
  "aria-label": ariaLabel,
  onFiles,
}: DocumentDropzoneProps) {
  const reactId = useId();
  const resolvedInputId = inputId ?? `document-dropzone-${reactId}`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const locked = disabled || busy;
  const isDragging = dragDepth > 0 && !locked;
  const shownError = localError ?? error;

  const deliver = useCallback(
    (raw: File[]) => {
      if (locked) return;
      const resolved = resolveDocumentDropzoneSelection({ files: raw, multiple });
      if (!resolved.ok) {
        if (resolved.reason === "too_many") {
          setLocalError(resolved.message);
        }
        return;
      }
      setLocalError(null);
      onFiles(resolved.files);
      if (inputRef.current) inputRef.current.value = "";
    },
    [locked, multiple, onFiles],
  );

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = filesFromFileList(e.target.files);
    e.target.value = "";
    deliver(files);
  };

  const onDragEnter = (e: DragEvent) => {
    preventBrowserFileOpen(e);
    if (locked) return;
    setDragDepth((d) => nextDragDepth(d, 1));
  };

  const onDragLeave = (e: DragEvent) => {
    preventBrowserFileOpen(e);
    setDragDepth((d) => nextDragDepth(d, -1));
  };

  const onDragOver = (e: DragEvent) => {
    preventBrowserFileOpen(e);
  };

  const onDrop = (e: DragEvent) => {
    preventBrowserFileOpen(e);
    setDragDepth(0);
    if (locked) return;
    deliver(filesFromDataTransfer(e.dataTransfer));
  };

  const openPicker = () => {
    if (locked) return;
    inputRef.current?.click();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openPicker();
  };

  return (
    <div className={`flex w-full flex-col gap-1 ${className}`}>
      <div
        role="button"
        tabIndex={locked ? -1 : 0}
        aria-disabled={locked || undefined}
        aria-busy={busy || undefined}
        aria-label={ariaLabel ?? hint}
        data-testid="document-dropzone"
        data-dragging={isDragging ? "true" : "false"}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={[
          "rounded-lg border-2 border-dashed text-left transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
          compact ? "px-3 py-2" : "px-4 py-5",
          locked
            ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
            : isDragging
              ? "cursor-copy border-blue-500 bg-blue-50"
              : "cursor-pointer border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50",
        ].join(" ")}
      >
        <input
          id={resolvedInputId}
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          disabled={locked}
          tabIndex={-1}
          aria-hidden
          onChange={onInputChange}
          onClick={(e) => e.stopPropagation()}
        />
        <p
          className={
            compact
              ? "text-[11px] font-medium text-slate-700"
              : "text-sm font-medium text-slate-800"
          }
        >
          {busy ? "Subiendo…" : hint}
        </p>
        {selectedFileName ? (
          <p
            className="mt-1 truncate text-[11px] text-slate-500"
            data-testid="document-dropzone-filename"
            title={selectedFileName}
          >
            Archivo: {selectedFileName}
          </p>
        ) : (
          <p className="mt-0.5 text-[10px] text-slate-400">
            Clic o teclado (Enter/Espacio) también abre el selector.
          </p>
        )}
      </div>
      {shownError ? (
        <p role="alert" className="text-xs text-red-700" data-testid="document-dropzone-error">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
