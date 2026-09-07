import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REFERENCIAS_ESTRUCTURADAS_KEY,
  buildReferenciasEstructuradasForSave,
  referenciaCumpleContratoActual,
  referenciaCamposFaltantesContrato,
  referenciaLegacyAmbiguoSinPartes,
} from "./referencias-estructuradas";
import {
  buildSaveClienteDatosRpcPayload,
  mapSupabaseRowToExpedienteClienteDatos,
} from "./map-supabase-cliente-datos";
import { getClienteDatosCamposFaltantes } from "@/lib/clienteDatosFormCompleteness";
import { validateClienteDatos } from "@/lib/clienteDatosValidation";
import type { ExpedienteClienteDatos } from "./types";
import { emptyInfonavitClienteDatosV1 } from "./infonavit-datos";

function baseCompleto(
  refs: ExpedienteClienteDatos["datos"]["referencias"],
): ExpedienteClienteDatos["datos"] {
  return {
    nombreCliente: "CLIENTE DEMO",
    nss: "12345678901",
    curp: "AAAA900101HDFRRN09",
    rfc: "AAAA900101AAA",
    celular: "8111111111",
    correo: "a@b.co",
    empresa: "ACME",
    registroPatronal: "RP123",
    telefonoEmpresa: "8188888888",
    referencias: refs,
    beneficiario: { nombre: "BENEFICIO", parentesco: "HIJO" },
    direccionEmpresa: {
      calle: "CALLE 1",
      colonia: "COL",
      municipio: "MTY",
      cp: "64000",
    },
    montoMejoravit: "",
    plazo: "",
    porcentajeCobro: "12.5",
    montoCalculado: "21750",
    metodoPago: "transferencia",
    notaMesa: "",
    infonavit: emptyInfonavitClienteDatosV1(),
  };
}

function simulateCloudAfterSave(params: {
  p_datos: Record<string, unknown>;
  p_referencias: { nombre: string; telefono: string }[];
}): { datos: Record<string, unknown>; referenciasCol: unknown } {
  const v_referencias_norm = params.p_referencias.map((r) => ({
    nombre: r.nombre,
    telefono: r.telefono,
    celular: r.telefono,
  }));
  return {
    datos: {
      ...params.p_datos,
      referencias: v_referencias_norm,
    },
    referenciasCol: v_referencias_norm,
  };
}

describe("P219 grandfather referencias legacy", () => {
  it("1 legacy normal → grandfathered + completo + válido", () => {
    const mapped = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-leg-1",
      datos: { nombreCliente: "X", nss: "1", curp: "C", rfc: "R", celular: "8111111111" },
      estado: "completo",
      updated_at: "2026-09-07T00:00:00.000Z",
      referencias: [
        { nombre: "JOSE LUIS HERRERA RAMIREZ", telefono: "8111111111" },
        { nombre: "MARIA ELENA GARCIA LOPEZ", telefono: "8222222222" },
      ],
    });
    const r0 = mapped.datos.referencias[0];
    assert.equal(r0.legacyGrandfathered, true);
    assert.equal(r0.nombre, "JOSE LUIS HERRERA RAMIREZ");
    assert.equal(r0.nombres, "JOSE LUIS"); // parse UI
    assert.equal(referenciaCumpleContratoActual(r0), true);
    assert.deepEqual(referenciaCamposFaltantesContrato(r0, 1), []);

    const form = baseCompleto([
      { ...mapped.datos.referencias[0], celular: "8333333333" },
      { ...mapped.datos.referencias[1], celular: "8444444444" },
    ]);
    // Cliente y refs con teléfonos distintos (unicidad vigente).
    form.celular = "8111111111";
    form.telefonoEmpresa = "8188888888";
    const faltantes = getClienteDatosCamposFaltantes(form, {
      programaDb: "compro_tu_casa",
      direccionOpcional: "DOM",
      perfilCaptura: "asesor_completo",
    });
    assert.ok(!faltantes.some((x) => /apellido/i.test(x)));
    const v = validateClienteDatos(form, {
      programaDb: "compro_tu_casa",
      direccionOpcional: "DOM",
      perfilCaptura: "asesor_completo",
      telefonoCasa: "8555555555",
    });
    assert.equal(v.isValid, true, JSON.stringify(v.errors));
    assert.equal(v.errors.referencia1ApellidoPaterno, undefined);
  });

  it("2 legacy ambiguo → conserva nombre, completo, no inventa apellidos", () => {
    const mapped = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-leg-2",
      datos: { nombreCliente: "X", nss: "1", curp: "C", rfc: "R", celular: "8111111111" },
      estado: "completo",
      updated_at: "2026-09-07T00:00:00.000Z",
      referencias: [
        { nombre: "JOSE LUIS", telefono: "8111111111" },
        { nombre: "ANA PEREZ LOPEZ", telefono: "8222222222" },
      ],
    });
    const r0 = mapped.datos.referencias[0];
    assert.equal(r0.legacyGrandfathered, true);
    assert.equal(r0.nombre, "JOSE LUIS");
    assert.equal(r0.nombres ?? "", "");
    assert.equal(r0.apellidoPaterno ?? "", "");
    assert.equal(referenciaCumpleContratoActual(r0), true);
    assert.equal(referenciaLegacyAmbiguoSinPartes(r0), true);

    const form = baseCompleto([
      r0,
      { ...mapped.datos.referencias[1], legacyGrandfathered: true },
    ]);
    const faltantes = getClienteDatosCamposFaltantes(form, {
      programaDb: "compro_tu_casa",
      direccionOpcional: "DOM",
      perfilCaptura: "asesor_completo",
    });
    assert.ok(!faltantes.some((x) => /apellido|nombre\(s\)/i.test(x)));
  });

  it("3+4 legacy + guardar nota/RFC → sigue grandfathered", () => {
    const mapped = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-leg-3",
      datos: { nombreCliente: "X", nss: "1", curp: "C", rfc: "R", celular: "8111111111" },
      estado: "completo",
      updated_at: "2026-09-07T00:00:00.000Z",
      referencias: [
        { nombre: "JOSE LUIS", telefono: "8111111111" },
        { nombre: "ANA PEREZ LOPEZ", telefono: "8222222222" },
      ],
    });
    const form = baseCompleto(mapped.datos.referencias);
    form.notaMesa = "nota mesa";
    form.rfc = "XAXX010101000";
    const payload = buildSaveClienteDatosRpcPayload(
      "exp-leg-3",
      form,
      "DOM",
      "compro_tu_casa",
    );
    const est = payload.p_datos[REFERENCIAS_ESTRUCTURADAS_KEY] as Array<{
      legacyGrandfathered?: boolean;
      nombre: string;
    }>;
    assert.equal(est[0]?.legacyGrandfathered, true);
    assert.equal(est[0]?.nombre, "JOSE LUIS");

    const cloud = simulateCloudAfterSave({
      p_datos: payload.p_datos as Record<string, unknown>,
      p_referencias: payload.p_referencias as { nombre: string; telefono: string }[],
    });
    const again = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-leg-3",
      datos: cloud.datos,
      estado: "completo",
      updated_at: "2026-09-07T01:00:00.000Z",
      referencias: cloud.referenciasCol,
    });
    assert.equal(again.datos.referencias[0].legacyGrandfathered, true);
    assert.equal(again.datos.referencias[0].nombre, "JOSE LUIS");
    assert.equal(referenciaCumpleContratoActual(again.datos.referencias[0]), true);
  });

  it("5 legacy + editar celular → limpia grandfather → exige partes", () => {
    const r = {
      nombre: "JOSE LUIS",
      celular: "8111111111",
      legacyGrandfathered: true as const,
    };
    assert.equal(referenciaCumpleContratoActual(r), true);
    // Simula updateRef: limpia flag al editar celular
    const edited = { ...r, celular: "8111111112" };
    delete (edited as { legacyGrandfathered?: boolean }).legacyGrandfathered;
    assert.equal(referenciaCumpleContratoActual(edited), false);
    const falt = referenciaCamposFaltantesContrato(edited, 1);
    assert.ok(falt.some((x) => /nombre\(s\)/i.test(x)));
    assert.ok(falt.some((x) => /primer apellido/i.test(x)));
  });

  it("6 legacy + editar apellido → limpia grandfather", () => {
    const r = {
      nombre: "JOSE LUIS HERRERA RAMIREZ",
      nombres: "JOSE LUIS",
      apellidoPaterno: "HERRERA",
      apellidoMaterno: "RAMIREZ",
      celular: "8111111111",
      legacyGrandfathered: true as const,
    };
    const edited = { ...r, apellidoPaterno: "HERRERA Z" };
    delete (edited as { legacyGrandfathered?: boolean }).legacyGrandfathered;
    assert.equal(edited.legacyGrandfathered, undefined);
    assert.equal(referenciaCumpleContratoActual(edited), true); // aún tiene 3 partes
  });

  it("7 nueva referencia → 3 partes + celular obligatorios", () => {
    const nueva = {
      nombre: "",
      nombres: "JUAN",
      apellidoPaterno: "",
      apellidoMaterno: "",
      celular: "8333333333",
    };
    assert.equal(referenciaCumpleContratoActual(nueva), false);
    const falt = referenciaCamposFaltantesContrato(nueva, 1);
    assert.ok(falt.some((x) => /primer apellido/i.test(x)));
    assert.ok(falt.some((x) => /segundo apellido/i.test(x)));
  });

  it("8 PR #233 round-trip estructuradas nuevas lossless", () => {
    const form = baseCompleto([
      {
        nombre: "JUAN CARLOS PEREZ LOPEZ",
        nombres: "JUAN CARLOS",
        apellidoPaterno: "PEREZ",
        apellidoMaterno: "LOPEZ",
        celular: "8111111111",
      },
      {
        nombre: "MARIA ELENA GARCIA RAMIREZ",
        nombres: "MARIA ELENA",
        apellidoPaterno: "GARCIA",
        apellidoMaterno: "RAMIREZ",
        celular: "8222222222",
      },
    ]);
    const built = buildReferenciasEstructuradasForSave(form.referencias);
    assert.equal(built[0]?.legacyGrandfathered, undefined);
    const payload = buildSaveClienteDatosRpcPayload(
      "exp-new",
      form,
      "DOM",
      "compro_tu_casa",
    );
    const cloud = simulateCloudAfterSave({
      p_datos: payload.p_datos as Record<string, unknown>,
      p_referencias: payload.p_referencias as { nombre: string; telefono: string }[],
    });
    const again = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-new",
      datos: cloud.datos,
      estado: "completo",
      updated_at: "2026-09-07T00:00:00.000Z",
      referencias: cloud.referenciasCol,
    });
    assert.equal(again.datos.referencias[0].legacyGrandfathered, undefined);
    assert.equal(again.datos.referencias[0].nombres, "JUAN CARLOS");
    assert.equal(again.datos.referencias[0].apellidoPaterno, "PEREZ");
  });

  it("9 teléfonos duplicados siguen bloqueados", () => {
    const form = baseCompleto([
      {
        nombre: "A B C",
        nombres: "A",
        apellidoPaterno: "B",
        apellidoMaterno: "C",
        celular: "8111111111",
      },
      {
        nombre: "D E F",
        nombres: "D",
        apellidoPaterno: "E",
        apellidoMaterno: "F",
        celular: "8111111111",
      },
    ]);
    const v = validateClienteDatos(form, {
      programaDb: "compro_tu_casa",
      direccionOpcional: "DOM",
      perfilCaptura: "asesor_completo",
    });
    assert.equal(v.isValid, false);
    assert.ok(
      v.errors.referencia1Celular ||
        v.errors.referencia2Celular ||
        v.errors.celular,
    );
  });

  it("10 externo → no referencias obligatorias", () => {
    const form = baseCompleto([
      { nombre: "", celular: "" },
      { nombre: "", celular: "" },
    ]);
    const faltantes = getClienteDatosCamposFaltantes(form, {
      programaDb: "mejoravit",
      direccionOpcional: "DOM",
      perfilCaptura: "asesor_equipo_silvia_simplificado",
      montoAprobado: 100000,
    });
    assert.ok(!faltantes.some((x) => /referencia/i.test(x)));
    const v = validateClienteDatos(form, {
      programaDb: "mejoravit",
      direccionOpcional: "DOM",
      perfilCaptura: "asesor_equipo_silvia_simplificado",
      montoAprobado: 100000,
    });
    assert.equal(v.errors.referencia1Nombres, undefined);
    assert.equal(v.errors.referencia1Celular, undefined);
  });
});
