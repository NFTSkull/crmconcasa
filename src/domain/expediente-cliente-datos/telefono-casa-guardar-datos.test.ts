import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("P218/P220 teléfono de casa con Guardar datos", () => {
  it("no conserva botón independiente y marca teléfono de casa obligatorio", () => {
    const src = source("src/components/asesor/AsesorTelefonoCasaSection.tsx");
    assert.ok(!src.includes("Guardar teléfono de casa"));
    assert.ok(!src.includes("<Button"));
    assert.ok(src.includes("setTelefonoCasaDraft"));
    assert.ok(src.includes("required"));
    assert.ok(src.includes('aria-required="true"'));
    assert.ok(!src.includes('.select("telefono_casa")'));
    assert.ok(src.includes("value={value}"));
  });

  it("save y saveCorreccion usan el RPC atómico solo cuando requiere teléfono de casa", () => {
    const src = source("src/domain/expediente-cliente-datos/supabase.repo.ts");
    assert.ok(src.includes("clienteDatosRequiereTelefonoCasa"));
    assert.ok(src.includes("asesor_guardar_cliente_datos_con_telefono_casa"));
    assert.ok(src.includes("p_telefono_casa: getTelefonoCasaDraft(idNorm) ?? null"));
    assert.ok(src.includes('client.rpc("save_cliente_datos"'));
    assert.ok(src.includes('client.rpc("save_cliente_datos_correccion"'));
  });

  it("el wrapper base guarda generales y teléfono de casa dentro de la misma función", () => {
    const src = source("supabase/migrations/218_telefono_casa_guardar_con_datos.sql");
    assert.ok(src.includes("public.save_cliente_datos("));
    assert.ok(src.includes("public.save_cliente_datos_correccion("));
    assert.ok(src.includes("public.asesor_actualizar_telefono_casa("));
    assert.ok(src.includes("TO authenticated, postgres, service_role"));
    assert.ok(src.includes("FROM PUBLIC, anon"));
  });

  it("P220 valida Datos Generales contra el teléfono de casa objetivo y exige casa válida", () => {
    const src = source(
      "supabase/migrations/20260904022000_telefono_casa_objetivo_obligatorio.sql",
    );
    assert.ok(src.includes("concasa.pending_telefono_casa"));
    assert.ok(src.includes("TELEFONO_CASA_REQUERIDO"));
    assert.ok(src.includes("TELEFONO_CASA_INVALIDO"));
    assert.ok(src.includes("public.save_cliente_datos("));
    assert.ok(src.includes("public.save_cliente_datos_correccion("));
    assert.ok(src.includes("public.asesor_actualizar_telefono_casa("));
    assert.ok(src.includes("v_telefono_casa_objetivo"));
  });

  it("los mensajes ya no describen el teléfono de casa como un valor fijo de precalificación", () => {
    const normal = source(
      "src/domain/expediente-cliente-datos/save-cliente-datos-rpc-error.ts",
    );
    const correccion = source(
      "src/domain/expediente-cliente-datos/save-cliente-datos-correccion-rpc-error.ts",
    );
    assert.ok(normal.includes("El teléfono de casa es obligatorio."));
    assert.ok(correccion.includes("El teléfono de casa es obligatorio."));
    assert.ok(normal.includes("El celular debe ser distinto al teléfono de casa."));
    assert.ok(correccion.includes("El celular debe ser distinto al teléfono de casa."));
    assert.ok(!normal.includes("capturado en la precalificación"));
    assert.ok(!correccion.includes("capturado en la precalificación"));
  });
});
