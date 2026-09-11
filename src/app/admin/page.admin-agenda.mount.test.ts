import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Admin · integración Agenda de citas", () => {
  const adminTabs = readFileSync(
    join(process.cwd(), "src/components/admin/AdminTabs.tsx"),
    "utf8",
  );
  const adminAgendaPage = readFileSync(
    join(process.cwd(), "src/app/admin/agenda/page.tsx"),
    "utf8",
  );
  const adminAgendaHojaPage = readFileSync(
    join(process.cwd(), "src/app/admin/agenda/hoja/page.tsx"),
    "utf8",
  );
  const embed = readFileSync(
    join(process.cwd(), "src/components/admin/AdminAgendaEmbed.tsx"),
    "utf8",
  );
  const agendaFilters = readFileSync(
    join(process.cwd(), "src/components/mesa-control/MesaAgendaCitasFilters.tsx"),
    "utf8",
  );

  it("expone Agenda desde la navegación principal de Admin", () => {
    assert.match(adminTabs, /href="\/admin\/agenda"/);
    assert.match(adminTabs, />\s*Agenda\s*</);
  });

  it("reutiliza la agenda completa existente sin duplicar reglas", () => {
    assert.match(adminAgendaPage, /MesaAgendaCitasClient/);
    assert.match(adminAgendaPage, /AdminAgendaEmbed/);
  });

  it("integra también la vista tipo Drive", () => {
    assert.match(adminAgendaHojaPage, /MesaAgendaHojaOperativaClient/);
    assert.match(adminAgendaHojaPage, /hideMesaAgendaBackLink/);
  });

  it("las rutas Admin conservan el gate super_admin", () => {
    assert.match(embed, /currentUser\.role !== "super_admin"/);
    assert.match(embed, /No tienes permiso para abrir la agenda desde el panel Admin/);
  });

  it("la navegación interna permanece dentro de Admin cuando aplica", () => {
    assert.match(agendaFilters, /usePathname/);
    assert.match(agendaFilters, /startsWith\("\/admin\/agenda"\)/);
    assert.match(agendaFilters, /"\/admin\/agenda\/hoja"/);
    assert.match(agendaFilters, /"\/admin"/);
  });
});
