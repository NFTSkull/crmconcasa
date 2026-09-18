"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  isArchivoPreviewImageMime,
  isArchivoPreviewPdfMime,
} from "@/lib/archivoPreviewMime";

export type MesaArchivoPreviewState = {
  url: string;
  mime_type: string;
  nombre_original: string;
};

type MesaArchivoPreviewDialogProps = {
  preview: MesaArchivoPreviewState;
  onClose: () => void;
  onOpenInNewTab: (blobUrl: string) => void;
};

export function MesaArchivoPreviewDialog({
  preview,
  onClose,
  onOpenInNewTab,
}: MesaArchivoPreviewDialogProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [preview.url]);

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Vista previa: ${preview.nombre_original}`}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
          <p className="min-w-0 truncate text-sm font-medium text-gray-900">
            {preview.nombre_original}
          </p>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 px-2 py-1 text-xs"
            onClick={onClose}
          >
            Cerrar
          </Button>
        </div>
        {isArchivoPreviewImageMime(preview.mime_type) ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-3 py-2">
            <Button
              type="button"
              variant="outline"
              className="px-2 py-1 text-xs"
              disabled={zoom <= 1}
              onClick={() => setZoom((value) => Math.max(1, value - 0.25))}
              aria-label="Alejar imagen"
            >
              −
            </Button>
            <span className="min-w-12 text-center text-xs font-medium text-gray-700">
              {zoomPercent}%
            </span>
            <Button
              type="button"
              variant="outline"
              className="px-2 py-1 text-xs"
              disabled={zoom >= 2}
              onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
              aria-label="Acercar imagen"
            >
              +
            </Button>
            <Button
              type="button"
              variant="outline"
              className="px-2 py-1 text-xs"
              onClick={() => setRotation((value) => value - 90)}
            >
              Girar izq.
            </Button>
            <Button
              type="button"
              variant="outline"
              className="px-2 py-1 text-xs"
              onClick={() => setRotation((value) => value + 90)}
            >
              Girar der.
            </Button>
            <Button
              type="button"
              variant="outline"
              className="px-2 py-1 text-xs"
              disabled={zoom === 1 && rotation === 0}
              onClick={() => {
                setZoom(1);
                setRotation(0);
              }}
            >
              Restablecer
            </Button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-3">
          {isArchivoPreviewImageMime(preview.mime_type) ? (
            <div
              className={[
                "flex min-h-full justify-center",
                Math.abs(rotation % 180) === 90 ? "py-24" : "",
              ].join(" ")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- blob URL modal */}
              <img
                src={preview.url}
                alt={preview.nombre_original}
                className="h-auto object-contain transition-transform duration-150"
                style={{
                  width: `${zoom * 100}%`,
                  maxWidth: "none",
                  transform: `rotate(${rotation}deg)`,
                }}
              />
            </div>
          ) : isArchivoPreviewPdfMime(preview.mime_type) ? (
            <iframe
              title={preview.nombre_original}
              src={preview.url}
              className="h-[min(70vh,720px)] w-full border-0 bg-white"
            />
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-600">
                Vista previa no disponible para este tipo de archivo.
              </p>
              <Button
                type="button"
                variant="primary"
                className="mt-3 px-3 py-1.5 text-xs"
                onClick={() => onOpenInNewTab(preview.url)}
              >
                Abrir archivo
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function openBlobUrlInNewTab(blobUrl: string): void {
  if (typeof window === "undefined" || !blobUrl) return;
  const opened = window.open(blobUrl, "_blank", "noopener,noreferrer");
  if (opened != null) return;
  const a = document.createElement("a");
  a.href = blobUrl;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
