import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const admin = readFileSync(
  join(process.cwd(), "src/app/admin/casas/page.tsx"),
  "utf8",
);

describe("Compra de casas · Bandeja Admin v2", () => {
  it("no expone borradores como opción ni como solicitudes recibidas", () => {
    assert.match(admin, /const ESTADOS_RECIBIDOS = \["enviada", "ofertada", "rechazada"\]/);
    assert.match(admin, /\.in\("estado", \[\.\.\.ESTADOS_RECIBIDOS\]\)/);
    assert.doesNotMatch(admin, /Borradores|id:\s*"borrador"|estado === "borrador"/);
    assert.match(admin, /Total recibidas/);
  });

  it("mantiene funcionalidades administrativas sin alterar el flujo", () => {
    assert.match(admin, /\.rpc\("casas_responder"/);
    assert.match(admin, /p_accion: decision/);
    assert.match(admin, /p_monto_mxn: monto/);
    assert.match(admin, /p_motivo: decision === "rechazo"/);
    assert.match(admin, /cargarFotosCasa/);
    assert.match(admin, /casas_historial/);
    assert.match(admin, /currentUser\.role !== "super_admin"/);
  });

  it("ofrece experiencia vacía de pantalla completa y selección útil", () => {
    assert.match(admin, /Aún no hay propiedades recibidas/);
    assert.match(admin, /setSelectedId\(\(prev\)/);
    assert.match(admin, /aria-pressed=\{filter === metric\.id\}/);
    assert.match(admin, /Buscar propiedades/);
    assert.match(admin, /Revisión y respuesta/);
    assert.match(admin, /Confirmar oferta/);
    assert.match(admin, /Confirmar rechazo/);
  });
});
