import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import {
  MESA_AVANCE_OPERATIVO_2A3_COPY,
  MESA_AVANCE_OPERATIVO_8A9_COPY,
  MESA_AVANCE_OPERATIVO_9A10_COPY,
  MESA_CIERRE_INTEGRACION_COPY,
  MESA_SOLICITAR_CORRECCION_LABEL,
  citaFirmaVisibleEnMesa,
  mostrarMesaClienteDatosPanel,
  mostrarMesaIntegracionDocsPanel,
} from "./mesa-decision-ux";

describe("mesa-decision-ux copy P3R.0", () => {
  it("cierre integración usa etiqueta aceptar", () => {
    assert.match(MESA_CIERRE_INTEGRACION_COPY.etiquetaBoton, /Aceptar integración/);
  });

  it("avance 8→9 no muestra aviso sin rechazo", () => {
    assert.equal(MESA_AVANCE_OPERATIVO_8A9_COPY.mostrarAvisoSinRechazo, undefined);
    assert.match(MESA_AVANCE_OPERATIVO_8A9_COPY.etiquetaBoton, /Aceptar retención/);
  });

  it("avances operativos 2→3 y 9→10 muestran aviso sin rechazo", () => {
    assert.equal(MESA_AVANCE_OPERATIVO_2A3_COPY.mostrarAvisoSinRechazo, true);
    assert.equal(MESA_AVANCE_OPERATIVO_9A10_COPY.mostrarAvisoSinRechazo, true);
    assert.match(MESA_AVANCE_OPERATIVO_9A10_COPY.etiquetaBoton, /Aceptar cita de firma/);
  });

  it("label solicitar corrección definido", () => {
    assert.equal(MESA_SOLICITAR_CORRECCION_LABEL, "Solicitar corrección");
  });
});

describe("mostrarMesaIntegracionDocsPanel", () => {
  it("siempre visible en etapa 1", () => {
    assert.equal(
      mostrarMesaIntegracionDocsPanel({ etapaActual: 1, archivosResumen: [] }),
      true,
    );
  });

  it("oculto en etapa 8 sin correcciones", () => {
    assert.equal(
      mostrarMesaIntegracionDocsPanel({ etapaActual: 8, archivosResumen: [] }),
      false,
    );
  });

  it("visible fuera de etapa 1 con doc rechazado", () => {
    const archivos: ExpedienteArchivoResumen[] = [
      {
        tipo_documento: "nss",
        estatus_revision: "rechazado",
      } as ExpedienteArchivoResumen,
    ];
    assert.equal(
      mostrarMesaIntegracionDocsPanel({ etapaActual: 8, archivosResumen: archivos }),
      true,
    );
  });
});

describe("mostrarMesaClienteDatosPanel", () => {
  it("oculto sin datos", () => {
    assert.equal(
      mostrarMesaClienteDatosPanel({ etapaActual: 1, estado: "completo", tieneDatos: false }),
      false,
    );
  });

  it("visible etapa 1 con datos", () => {
    assert.equal(
      mostrarMesaClienteDatosPanel({ etapaActual: 1, estado: "completo", tieneDatos: true }),
      true,
    );
  });

  it("visible etapa 8 si datos no validados", () => {
    assert.equal(
      mostrarMesaClienteDatosPanel({ etapaActual: 8, estado: "completo", tieneDatos: true }),
      true,
    );
  });

  it("oculto etapa 5 con datos validados", () => {
    assert.equal(
      mostrarMesaClienteDatosPanel({ etapaActual: 5, estado: "validado", tieneDatos: true }),
      false,
    );
  });

  it("visible cualquier etapa si rechazado", () => {
    assert.equal(
      mostrarMesaClienteDatosPanel({ etapaActual: 5, estado: "rechazado", tieneDatos: true }),
      true,
    );
  });
});

describe("citaFirmaVisibleEnMesa", () => {
  it("etapas 9 y 10", () => {
    assert.equal(citaFirmaVisibleEnMesa(9), true);
    assert.equal(citaFirmaVisibleEnMesa(10), true);
    assert.equal(citaFirmaVisibleEnMesa(8), false);
  });
});
