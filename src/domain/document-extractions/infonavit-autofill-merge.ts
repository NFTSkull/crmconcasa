import {
  comparableAutofillValue,
  type AutofillValue,
  type InfonavitDocumentAutofillPatch,
} from "@/domain/document-extractions/infonavit-document-autofill";

export type InfonavitAutofillTarget = {
  cliente: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string;
    curp: string;
    genero: string;
    identificacion: {
      tipo: string;
      numero: string;
      vigencia: string;
    };
  };
  vivienda: {
    calle: string;
    noExt: string;
    noInt: string;
    lote: string;
    manzana: string;
    colonia: string;
    entidad: string;
    municipio: string;
    cp: string;
  };
  destinoRecursos: {
    clabeDerechohabiente: string;
  };
};

export type InfonavitAutofillConflict = Readonly<{
  field: string;
  current: string;
  detected: string;
  sourceLabel: string;
}>;

export type InfonavitAutofillMergeResult<T> = Readonly<{
  draft: T;
  applied: string[];
  confirmed: string[];
  conflicts: InfonavitAutofillConflict[];
  sourceByField: Readonly<Record<string, string>>;
}>;

export function autofillSourceLabel(
  candidate: AutofillValue | undefined,
): string {
  if (!candidate) return "";
  switch (candidate.source) {
    case "cliente_ine_frente":
    case "cliente_ine_reverso":
      return "INE · automático";
    case "cliente_comprobante_domicilio":
      return "Comprobante · automático";
    case "cliente_estado_cuenta":
      return "Estado de cuenta · automático";
  }
}

function sameValue(a: string, b: string): boolean {
  return comparableAutofillValue(a) === comparableAutofillValue(b);
}

export function mergeInfonavitDocumentAutofill<T extends InfonavitAutofillTarget>(
  input: T,
  patch: InfonavitDocumentAutofillPatch,
): InfonavitAutofillMergeResult<T> {
  const next = structuredClone(input) as T;
  const applied: string[] = [];
  const confirmed: string[] = [];
  const conflicts: InfonavitAutofillConflict[] = [];
  const sourceByField: Record<string, string> = {};

  const merge = (
    field: string,
    current: string,
    candidate: AutofillValue | undefined,
    assign: (value: string) => void,
  ) => {
    if (!candidate || candidate.confidence !== "high") return;
    const detected = candidate.value.trim();
    if (!detected) return;
    const sourceLabel = autofillSourceLabel(candidate);

    if (!current.trim()) {
      assign(detected);
      applied.push(field);
      sourceByField[field] = sourceLabel;
      return;
    }

    if (sameValue(current, detected)) {
      confirmed.push(field);
      sourceByField[field] = sourceLabel;
      return;
    }

    // En captura INFONAVIT el documento fuente es autoridad para estos campos.
    // Conservamos la diferencia para auditoría/UX, pero aplicamos el valor detectado.
    conflicts.push({
      field,
      current,
      detected,
      sourceLabel,
    });
    assign(detected);
    applied.push(field);
    sourceByField[field] = sourceLabel;
  };

  merge("cliente.nombres", next.cliente.nombres, patch.cliente.nombres, (v) => {
    next.cliente.nombres = v;
  });
  merge(
    "cliente.apellidoPaterno",
    next.cliente.apellidoPaterno,
    patch.cliente.apellidoPaterno,
    (v) => {
      next.cliente.apellidoPaterno = v;
    },
  );
  merge(
    "cliente.apellidoMaterno",
    next.cliente.apellidoMaterno,
    patch.cliente.apellidoMaterno,
    (v) => {
      next.cliente.apellidoMaterno = v;
    },
  );
  merge("cliente.curp", next.cliente.curp, patch.cliente.curp, (v) => {
    next.cliente.curp = v;
  });
  merge("cliente.genero", next.cliente.genero, patch.cliente.genero, (v) => {
    next.cliente.genero = v;
  });
  merge(
    "cliente.identificacion.tipo",
    next.cliente.identificacion.tipo,
    patch.cliente.identificacionTipo,
    (v) => {
      next.cliente.identificacion.tipo = v;
    },
  );
  merge(
    "cliente.identificacion.numero",
    next.cliente.identificacion.numero,
    patch.cliente.identificacionNumero,
    (v) => {
      next.cliente.identificacion.numero = v;
    },
  );
  merge(
    "cliente.identificacion.vigencia",
    next.cliente.identificacion.vigencia,
    patch.cliente.identificacionVigencia,
    (v) => {
      next.cliente.identificacion.vigencia = v;
    },
  );

  for (const key of [
    "calle",
    "noExt",
    "noInt",
    "lote",
    "manzana",
    "colonia",
    "entidad",
    "municipio",
    "cp",
  ] as const) {
    merge(
      `vivienda.${key}`,
      next.vivienda[key],
      patch.vivienda[key],
      (value) => {
        next.vivienda[key] = value;
      },
    );
  }

  merge(
    "destinoRecursos.clabeDerechohabiente",
    next.destinoRecursos.clabeDerechohabiente,
    patch.clabeDerechohabiente,
    (v) => {
      next.destinoRecursos.clabeDerechohabiente = v;
    },
  );

  return {
    draft: next,
    applied,
    confirmed,
    conflicts,
    sourceByField,
  };
}
