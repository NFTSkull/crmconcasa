import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("P218/P220 teléfono de casa con Guardar datos", () => {
  it("no conserva botón independiente y marca teléfono de casa obligatorio", () => {
    const src = source("src/components/asesor/AsesorTelefonoCasaSection.tsx");
    expect(src).not.toContain("Guardar teléfono de casa");
    expect(src).not.toContain("<Button");
    expect(src).toContain("setTelefonoCasaDraft");
    expect(src).toContain("required");
    expect(src).toContain('aria-required="true"');
  });

  it("save y saveCorreccion usan el RPC atómico solo cuando requiere teléfono de casa", () => {
    const src = source("src/domain/expediente-cliente-datos/supabase.repo.ts");
    expect(src).toContain("clienteDatosRequiereTelefonoCasa");
    expect(src).toContain("asesor_guardar_cliente_datos_con_telefono_casa");
    expect(src).toContain("p_telefono_casa: getTelefonoCasaDraft(idNorm) ?? null");
    expect(src).toContain('client.rpc("save_cliente_datos"');
    expect(src).toContain('client.rpc("save_cliente_datos_correccion"');
  });

  it("el wrapper base guarda generales y teléfono de casa dentro de la misma función", () => {
    const src = source("supabase/migrations/218_telefono_casa_guardar_con_datos.sql");
    expect(src).toContain("public.save_cliente_datos(");
    expect(src).toContain("public.save_cliente_datos_correccion(");
    expect(src).toContain("public.asesor_actualizar_telefono_casa(");
    expect(src).toContain("TO authenticated, postgres, service_role");
    expect(src).toContain("FROM PUBLIC, anon");
  });

  it("P220 valida Datos Generales contra el teléfono de casa objetivo y exige casa válida", () => {
    const src = source(
      "supabase/migrations/20260904022000_telefono_casa_objetivo_obligatorio.sql",
    );
    expect(src).toContain("concasa.pending_telefono_casa");
    expect(src).toContain("TELEFONO_CASA_REQUERIDO");
    expect(src).toContain("TELEFONO_CASA_INVALIDO");
    expect(src).toContain("public.save_cliente_datos(");
    expect(src).toContain("public.save_cliente_datos_correccion(");
    expect(src).toContain("public.asesor_actualizar_telefono_casa(");
    expect(src).toContain("v_telefono_casa_objetivo");
  });

  it("los mensajes ya no describen el teléfono de casa como un valor fijo de precalificación", () => {
    const normal = source(
      "src/domain/expediente-cliente-datos/save-cliente-datos-rpc-error.ts",
    );
    const correccion = source(
      "src/domain/expediente-cliente-datos/save-cliente-datos-correccion-rpc-error.ts",
    );
    expect(normal).toContain("El teléfono de casa es obligatorio.");
    expect(correccion).toContain("El teléfono de casa es obligatorio.");
    expect(normal).toContain("El celular debe ser distinto al teléfono de casa.");
    expect(correccion).toContain("El celular debe ser distinto al teléfono de casa.");
    expect(normal).not.toContain("capturado en la precalificación");
    expect(correccion).not.toContain("capturado en la precalificación");
  });
});
