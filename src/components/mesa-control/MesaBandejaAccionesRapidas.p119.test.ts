import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";

const ROOT = path.join(process.cwd());

describe("MesaBandejaAccionesRapidas UI wiring P119.3/P119.4/P133", () => {
  it("acciones usan stopPropagation, labels y RPCs canónicas", () => {
    const ui = readFileSync(
      path.join(ROOT, "src/components/mesa-control/MesaBandejaAccionesRapidas.tsx"),
      "utf8",
    );
    assert.match(ui, /stopPropagation/);
    assert.match(ui, /resolveMesaQuickAction/);
    assert.match(ui, /mesa-bandeja-accion-info|kind === "info"/);
    assert.match(ui, /etapa_final|Etapa final|siguiente\.label/);
    assert.match(ui, /MESA_AVANZAR_11_12_CONFIRM|Pago ConCasa|Pago a ConCasa/);
    assert.match(ui, /Tomar expediente/);
    assert.match(ui, /Quitar marca/);
    assert.match(ui, /Tiene documentos/);
    assert.doesNotMatch(ui, /"Tiene datos"/);
    assert.match(ui, /usesAvanzarRpc/);
    assert.doesNotMatch(ui, /avanzarEtapaOperativa\(.*3/);

    const page = readFileSync(
      path.join(ROOT, "src/app/mesa-control/page.tsx"),
      "utf8",
    );
    assert.match(page, /avanzarEtapaOperativa/);
    assert.match(page, /mesa_take_expediente|takeExpediente/);
    assert.match(page, /mesa_set_expediente_marcador|setMarcador/);
    assert.match(page, /MesaBandejaAccionesRapidas/);
    assert.match(page, /firmaAgendableDesde/);
    assert.match(page, /pagoConcasaResultado/);

    const lib = readFileSync(
      path.join(ROOT, "src/lib/mesaBandejaAccionesRapidas.ts"),
      "utf8",
    );
    assert.match(lib, /MESA_TIENE_RPC_CANONICA_11_A_12 = true/);
    assert.match(lib, /MESA_TIENE_DATOS_BADGE_LABEL = "📌 Tiene documentos"/);
    assert.doesNotMatch(lib, /📌 Tiene datos/);
    assert.match(lib, /decidir Sí pagó \/ No pagó|Sí pagó \/ No pagó/);
    assert.doesNotMatch(lib, /label:\s*"Pasar a Pago a ConCasa"/);
    assert.match(lib, /Pasar a Acuse/);
    assert.match(lib, /Esperando carga de Acuse por el asesor/);
    assert.match(lib, /Esperando agenda del asesor/);
    assert.match(lib, /Marcar firma como completada/);
    assert.match(lib, /resolveMesaQuickAction/);
    assert.doesNotMatch(lib, /label:\s*"Agendar firma"/);
    assert.doesNotMatch(lib, /fromView\(\s*5,\s*7/);
    assert.match(lib, /5:\s*8/);

    const detalle = readFileSync(
      path.join(ROOT, "src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx"),
      "utf8",
    );
    assert.match(detalle, /MesaPagoConcasaDecisionSection/);
    assert.match(detalle, /handleDecidirPagoConcasa/);
    assert.match(detalle, /deriveAvanceOperativo11a12View/);
    assert.match(detalle, /mostrar: false/);
  });
});
