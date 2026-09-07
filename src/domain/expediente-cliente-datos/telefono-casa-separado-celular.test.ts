import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const migration = source(
  "supabase/migrations/20260904183000_telefono_casa_separado_celular.sql",
);
const syncMigration = source(
  "supabase/migrations/20260904183500_sync_telefono_principal_desde_cliente_datos.sql",
);

describe("P224 — teléfono de casa separado del celular principal", () => {
  it("crea telefono_casa y limita la reparación a expedientes tocados por la RPC anterior", () => {
    assert.ok(migration.includes("ADD COLUMN IF NOT EXISTS telefono_casa text"));
    assert.ok(migration.includes("action = 'expediente.telefono_casa.actualizado'"));
    assert.ok(migration.includes("telefono_cliente = c.celular_dg"));
    assert.ok(migration.includes("telefono_casa = CASE"));
  });

  it("la RPC de casa escribe telefono_casa y no reemplaza telefono_cliente", () => {
    const rpcStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.asesor_actualizar_telefono_casa",
    );
    const wrapperStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa",
    );
    const rpcBody = migration.slice(rpcStart, wrapperStart);

    assert.ok(rpcBody.includes("SET telefono_casa = v_telefono_nuevo"));
    assert.ok(!rpcBody.includes("SET telefono_cliente = v_telefono_nuevo"));
  });

  it("las defensas de unicidad se mueven a telefono_casa", () => {
    assert.ok(migration.includes("BEFORE UPDATE OF telefono_casa"));
    assert.ok(migration.includes("e.telefono_casa::text"));
    assert.ok(!migration.includes("BEFORE UPDATE OF telefono_cliente"));
  });

  it("sincroniza el teléfono principal cuando cambia el celular validado", () => {
    assert.ok(
      syncMigration.includes("AFTER INSERT OR UPDATE OF telefono_normalizado"),
    );
    assert.ok(syncMigration.includes("SET telefono_cliente = v_celular"));
    assert.ok(!syncMigration.includes("SET telefono_casa = v_celular"));
  });

  it("la UI y el read-model cargan la casa desde el campo dedicado", () => {
    const section = source("src/components/asesor/AsesorTelefonoCasaSection.tsx");
    const page = source("src/app/asesor/expediente/[id]/page.tsx");
    const repo = source("src/domain/expediente-cliente-datos/supabase.repo.ts");
    const mapper = source(
      "src/domain/expediente-cliente-datos/map-supabase-cliente-datos.ts",
    );

    assert.ok(!section.includes('.select("telefono_casa")'));
    assert.ok(section.includes("value={value}"));
    assert.ok(page.includes("found.telefonoCasa"));
    assert.ok(page.includes("telefonoCasaValue={telefonoCasaValue}"));
    assert.ok(repo.includes("( telefono_casa )"));
    assert.ok(mapper.includes("row.expediente?.telefono_casa"));
    assert.ok(!mapper.includes("row.expediente?.telefono_cliente"));
  });
});
