import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("P218 teléfono de casa con Guardar datos", () => {
  it("no conserva botón de guardado independiente", () => {
    const src = source("src/components/asesor/AsesorTelefonoCasaSection.tsx");
    expect(src).not.toContain("Guardar teléfono de casa");
    expect(src).not.toContain("<Button");
    expect(src).toContain("setTelefonoCasaDraft");
  });

  it("save y saveCorreccion usan el RPC atómico", () => {
    const src = source("src/domain/expediente-cliente-datos/supabase.repo.ts");
    expect(src.match(/asesor_guardar_cliente_datos_con_telefono_casa/g)?.length).toBe(2);
    expect(src).toContain("p_es_correccion: false");
    expect(src).toContain("p_es_correccion: true");
    expect(src).toContain("p_telefono_casa: getTelefonoCasaDraft(idNorm) ?? null");
  });

  it("el wrapper SQL guarda generales y teléfono de casa dentro de la misma función", () => {
    const src = source("supabase/migrations/218_telefono_casa_guardar_con_datos.sql");
    expect(src).toContain("public.save_cliente_datos(");
    expect(src).toContain("public.save_cliente_datos_correccion(");
    expect(src).toContain("public.asesor_actualizar_telefono_casa(");
    expect(src).toContain("TO authenticated, postgres, service_role");
    expect(src).toContain("FROM PUBLIC, anon");
  });
});
