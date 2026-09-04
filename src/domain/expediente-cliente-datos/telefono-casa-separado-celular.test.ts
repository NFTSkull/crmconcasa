import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const migration = source(
  "supabase/migrations/20260904183000_telefono_casa_separado_celular.sql",
);

describe("P224 — teléfono de casa separado del celular principal", () => {
  it("crea telefono_casa y limita la reparación a expedientes tocados por la RPC anterior", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS telefono_casa text");
    expect(migration).toContain("action = 'expediente.telefono_casa.actualizado'");
    expect(migration).toContain("telefono_cliente = c.celular_dg");
    expect(migration).toContain("telefono_casa = CASE");
  });

  it("la RPC de casa escribe telefono_casa y no reemplaza telefono_cliente", () => {
    const rpcStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.asesor_actualizar_telefono_casa",
    );
    const wrapperStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa",
    );
    const rpcBody = migration.slice(rpcStart, wrapperStart);

    expect(rpcBody).toContain("SET telefono_casa = v_telefono_nuevo");
    expect(rpcBody).not.toContain("SET telefono_cliente = v_telefono_nuevo");
  });

  it("las defensas de unicidad se mueven a telefono_casa", () => {
    expect(migration).toContain("BEFORE UPDATE OF telefono_casa");
    expect(migration).toContain("e.telefono_casa::text");
    expect(migration).not.toContain("BEFORE UPDATE OF telefono_cliente");
  });

  it("la UI y el read-model cargan la casa desde el campo dedicado", () => {
    const section = source("src/components/asesor/AsesorTelefonoCasaSection.tsx");
    const repo = source("src/domain/expediente-cliente-datos/supabase.repo.ts");
    const mapper = source(
      "src/domain/expediente-cliente-datos/map-supabase-cliente-datos.ts",
    );

    expect(section).toContain('.select("telefono_casa")');
    expect(section).toContain("data?.telefono_casa");
    expect(repo).toContain("( telefono_casa )");
    expect(mapper).toContain("row.expediente?.telefono_casa");
    expect(mapper).not.toContain("row.expediente?.telefono_cliente");
  });
});
