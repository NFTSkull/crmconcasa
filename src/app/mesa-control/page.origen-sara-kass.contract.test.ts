import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const mockUser = readFileSync(join(process.cwd(), "src/lib/mockUser.ts"), "utf8");
const agendaConfig = readFileSync(
  join(process.cwd(), "src/lib/canManageAgendaConfig.ts"),
  "utf8",
);
const mesaPage = readFileSync(
  join(process.cwd(), "src/app/mesa-control/page.tsx"),
  "utf8",
);

describe("Mesa — filtro de origen para operadoras autorizadas", () => {
  it("proyecta Sara, Kass y Mirna a la vista mixta ya soportada por la bandeja", () => {
    assert.match(mockUser, /mesa\.interno03@concasa\.mx/);
    assert.match(mockUser, /mesa\.interno04@concasa\.mx/);
    assert.match(mockUser, /mesa5@concasa\.mx/);
    assert.match(mockUser, /normalizedRole === "mesa_control_interno"/);
    assert.match(mockUser, /return "mesa_control"/);
  });

  it("la vista mixta reutiliza el selector servidor Todos / Internos / Externos", () => {
    assert.match(mesaPage, /mesaMockRole === "mesa_control_admin" \|\| mesaMockRole === "mesa_control"/);
    assert.match(mesaPage, /mapAdminOrigenTabToRpc/);
    assert.match(mesaPage, /label: "Todos"/);
    assert.match(mesaPage, /label: "Internos"/);
    assert.match(mesaPage, /label: "Externos"/);
  });

  it("no convierte la vista mixta en permiso de configuración de agenda", () => {
    assert.doesNotMatch(agendaConfig, /"mesa_control",/);
    assert.match(agendaConfig, /"mesa_control_admin"/);
    assert.match(agendaConfig, /"super_admin"/);
  });
});
