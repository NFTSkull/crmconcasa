import type {
  EstatusRevision,
  ExpedienteArchivoResumen,
  TipoDocumentoCatalogo,
} from "./types";
import { TIPO_DOCUMENTO_CATALOGO } from "./types";
import type {
  ExpedienteArchivosRepo,
  ReplaceArchivoParams,
  ReplaceMesaDocumentoParams,
  UpdateRevisionPatch,
  UploadArchivoParams,
  UploadMesaDocumentoParams,
} from "./repo";
import { INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD, INTEGRATION_DOC_TIPOS_MESA_UPLOAD } from "./integration-docs-completos";

const DB_NAME = "concasa-crm-files";
const DB_VERSION = 1;
const STORE_NAME = "expediente_archivos";

type StoredExpedienteArchivo = {
  id: string;
  expediente_id: string;
  tipo_documento: TipoDocumentoCatalogo;
  nombre_original: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by_role: string;
  uploaded_by_email: string;
  estatus_revision: EstatusRevision;
  comentario_mesa: string | null;
  blob: Blob;
};

function ensureTipoDocumentoCatalogo(value: unknown): TipoDocumentoCatalogo | null {
  if (typeof value !== "string") return null;
  return (TIPO_DOCUMENTO_CATALOGO as readonly string[]).includes(value)
    ? (value as TipoDocumentoCatalogo)
    : null;
}

function buildArchivoId(expedienteId: string, tipo_documento: TipoDocumentoCatalogo): string {
  return `${expedienteId}::${tipo_documento}`;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Dev: invalidar conexión en memoria tras `indexedDB.deleteDatabase` (p. ej. `clearMockData`). */
export function resetMockArchivosIndexedDbConnection(): void {
  dbPromise = null;
}

async function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const openReq = window.indexedDB.open(DB_NAME, DB_VERSION);

    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("by_expediente_id", "expediente_id", { unique: false });
        store.createIndex(
          "by_expediente_tipo",
          ["expediente_id", "tipo_documento"],
          { unique: true },
        );
      }
    };

    openReq.onsuccess = () => resolve(openReq.result);
    openReq.onerror = () => reject(openReq.error);
  });

  return dbPromise;
}

function dispatchUpdated(expedienteId?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("expediente_archivos_updated", {
      detail: { expedienteId: expedienteId ?? null },
    }),
  );
}

export class MockExpedienteArchivosIndexedDbRepo implements ExpedienteArchivosRepo {
  async listByExpediente(expedienteId: string) {
    if (typeof window === "undefined") return [];

    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("by_expediente_id");
    const records = await promisifyRequest<StoredExpedienteArchivo[]>(index.getAll(expedienteId));
    return records.map((r) => ({
      expediente_id: r.expediente_id,
      tipo_documento: r.tipo_documento,
      id: r.id,
      nombre_original: r.nombre_original,
      mime_type: r.mime_type,
      size_bytes: r.size_bytes,
      created_at: r.created_at,
      uploaded_by_role: r.uploaded_by_role,
      uploaded_by_email: r.uploaded_by_email,
      estatus_revision: r.estatus_revision,
      comentario_mesa: r.comentario_mesa,
    }));
  }

  async listResumenByExpediente(expedienteId: string): Promise<ExpedienteArchivoResumen[]> {
    const db = await getDb();
    const byTipo = new Map<TipoDocumentoCatalogo, StoredExpedienteArchivo>();

    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("by_expediente_id");
    const records = await promisifyRequest<StoredExpedienteArchivo[]>(index.getAll(expedienteId));
    records.forEach((r) => byTipo.set(r.tipo_documento, r));

    /**
     * Orden fijo = `TIPO_DOCUMENTO_CATALOGO`: primero los 4 del paquete documental (misma
     * posición y shape que antes), luego `cliente_*`, luego `asesor_*`. Una fila por tipo.
     */
    const buildRow = (tipo: TipoDocumentoCatalogo): ExpedienteArchivoResumen => {
      const found = byTipo.get(tipo);
      if (!found) {
        return {
          expediente_id: expedienteId,
          tipo_documento: tipo,
          id: null,
          nombre_original: null,
          mime_type: null,
          size_bytes: null,
          created_at: null,
          uploaded_by_role: null,
          uploaded_by_email: null,
          estatus_revision: "faltante",
          comentario_mesa: null,
        };
      }
      return {
        expediente_id: found.expediente_id,
        tipo_documento: found.tipo_documento,
        id: found.id,
        nombre_original: found.nombre_original,
        mime_type: found.mime_type,
        size_bytes: found.size_bytes,
        created_at: found.created_at,
        uploaded_by_role: found.uploaded_by_role,
        uploaded_by_email: found.uploaded_by_email,
        estatus_revision: found.estatus_revision,
        comentario_mesa: found.comentario_mesa,
      };
    };

    return TIPO_DOCUMENTO_CATALOGO.map(buildRow);
  }

  async uploadArchivo(params: UploadArchivoParams): Promise<void> {
    if (typeof window === "undefined") return;
    const { expedienteId, tipo_documento, file, uploaded_by_email, uploaded_by_role } = params;

    const tipo = ensureTipoDocumentoCatalogo(tipo_documento);
    if (!tipo) throw new Error("tipo_documento inválido");

    if (!(file instanceof Blob)) throw new Error("file debe ser un Blob/File");

    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const id = buildArchivoId(expedienteId, tipo);
    const nowIso = new Date().toISOString();

    const record: StoredExpedienteArchivo = {
      id,
      expediente_id: expedienteId,
      tipo_documento: tipo,
      nombre_original: file.name ?? "archivo",
      mime_type: file.type ?? "application/octet-stream",
      size_bytes: file.size ?? 0,
      created_at: nowIso,
      uploaded_by_role: uploaded_by_role,
      uploaded_by_email: uploaded_by_email,
      estatus_revision: "subido",
      comentario_mesa: null,
      blob: file,
    };

    await promisifyRequest(store.put(record));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    dispatchUpdated(expedienteId);
  }

  async replaceArchivo(params: ReplaceArchivoParams): Promise<void> {
    if (typeof window === "undefined") return;
    const { expedienteId, tipo_documento, file, uploaded_by_email, uploaded_by_role } = params;

    const tipo = ensureTipoDocumentoCatalogo(tipo_documento);
    if (!tipo) throw new Error("tipo_documento inválido");
    if (!(file instanceof Blob)) throw new Error("file debe ser un Blob/File");

    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const id = buildArchivoId(expedienteId, tipo);
    const nowIso = new Date().toISOString();

    const existing = await promisifyRequest<StoredExpedienteArchivo | undefined>(store.get(id));
    const prev = existing?.estatus_revision;
    const nextStatus: EstatusRevision =
      prev === "rechazado" || prev === "resubido" ? "resubido" : "subido";

    const record: StoredExpedienteArchivo = {
      id,
      expediente_id: expedienteId,
      tipo_documento: tipo,
      nombre_original: file.name ?? "archivo",
      mime_type: file.type ?? "application/octet-stream",
      size_bytes: file.size ?? 0,
      created_at: nowIso,
      uploaded_by_role: uploaded_by_role,
      uploaded_by_email: uploaded_by_email,
      estatus_revision: nextStatus,
      comentario_mesa: null,
      blob: file,
    };

    await promisifyRequest(store.put(record));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    dispatchUpdated(expedienteId);
  }

  async getArchivoBlob(id: string): Promise<Blob> {
    if (typeof window === "undefined") {
      throw new Error("getArchivoBlob solo disponible en cliente");
    }
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const found = await promisifyRequest<StoredExpedienteArchivo | undefined>(store.get(id));
    if (!found) throw new Error("Archivo no encontrado");
    return found.blob;
  }

  async updateRevision(id: string, patch: UpdateRevisionPatch): Promise<void> {
    if (typeof window === "undefined") return;
    if (!patch.estatus_revision) throw new Error("estatus_revision requerido");
    if (
      patch.estatus_revision === "rechazado" &&
      (!patch.comentario_mesa || patch.comentario_mesa.trim() === "")
    ) {
      throw new Error("comentario_mesa es obligatorio cuando el estatus es rechazado");
    }

    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const found = await promisifyRequest<StoredExpedienteArchivo | undefined>(store.get(id));
    if (!found) throw new Error("Archivo no encontrado");

    const comentario_mesa =
      patch.estatus_revision === "rechazado"
        ? patch.comentario_mesa ?? found.comentario_mesa ?? null
        : null;

    const updated: StoredExpedienteArchivo = {
      ...found,
      estatus_revision: patch.estatus_revision,
      comentario_mesa,
    };

    await promisifyRequest(store.put(updated));

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    dispatchUpdated(found.expediente_id);
  }

  private assertMesaUploadTipo(tipo: string): asserts tipo is (typeof INTEGRATION_DOC_TIPOS_MESA_UPLOAD)[number] {
    if (!(INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes(tipo)) {
      throw new Error("tipo_documento no permitido para Mesa");
    }
  }

  async uploadMesaDocumento(params: UploadMesaDocumentoParams): Promise<void> {
    this.assertMesaUploadTipo(params.tipo_documento);
    await this.uploadArchivo({
      expedienteId: params.expedienteId,
      tipo_documento: params.tipo_documento,
      file: params.file,
      uploaded_by_email: "mesa@mock",
      uploaded_by_role: "mesa_control",
    });
  }

  async replaceMesaDocumento(params: ReplaceMesaDocumentoParams): Promise<void> {
    this.assertMesaUploadTipo(params.tipo_documento);
    await this.replaceArchivo({
      expedienteId: params.expedienteId,
      tipo_documento: params.tipo_documento,
      file: params.file,
      uploaded_by_email: "mesa@mock",
      uploaded_by_role: "mesa_control",
    });
  }

  private assertAsesorUploadTipo(tipo: string): asserts tipo is (typeof INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD)[number] {
    if (!(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes(tipo)) {
      throw new Error("tipo_documento no permitido para asesor");
    }
  }


  async deleteArchivo(id: string): Promise<void> {
    if (typeof window === "undefined") return;

    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const found = await promisifyRequest<StoredExpedienteArchivo | undefined>(store.get(id));
    await promisifyRequest(store.delete(id));

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    dispatchUpdated(found?.expediente_id ?? undefined);
  }
}

