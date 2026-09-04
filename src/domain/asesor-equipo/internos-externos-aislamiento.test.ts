/**
 * Aislamiento EXTERNOS (CURP/Acta/dedupe/copy) vs INTERNOS (casa/refs/unicidad).
 * Fuente de verdad externos: asesor_paquete_documental_externos → perfil histórico
 * `asesor_equipo_silvia_simplificado` para dueños Silvia u Orlando.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS,
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS_LEGACY_7,
  parseAsesorDocumentosObligatoriosEnvio,
} from "@/domain/expediente-archivos/asesor-documentos-obligatorios-envio";
import { INTEGRATION_DOC_TIPOS_ASESOR_ENVIO } from "@/domain/expediente-archivos/integration-docs-completos";
import {
  countIntegrationDocsPresentes,
  integrationDocsCompletos,
} from "@/domain/expediente-archivos/integration-docs-completos";
import { shouldMountAsesorScopedEquipoDocumentoSection } from "@/domain/expediente-archivos/asesor-tipos-documento-visibles";
import { resolveScopedEquipoUploadHint } from "@/domain/expediente-archivos/cliente-scoped-equipo-documento";
import {
  filterIntegracionChecklistOpcionalesParaActor,
  shouldMountAsesorIntegracionOpcionalDedicado,
} from "@/domain/asesor-equipo/asesor-integracion-opcionales-visibility";
import { resolveClienteDatosPerfilCaptura, clienteDatosRequiereTelefonoCasa } from "@/domain/asesor-equipo/asesor-en-equipo-por-lider-email";
import { getClienteDatosCamposFaltantes } from "@/lib/clienteDatosFormCompleteness";
import { validateClienteDatos } from "@/lib/clienteDatosValidation";
import { emptyInfonavitClienteDatosV1 } from "@/domain/expediente-cliente-datos/infonavit-datos";

const baseInternoDatos = () => ({
  nombreCliente: "Juan Perez Lopez",
  nss: "12345678901",
  curp: "PELJ800101HDFRRN09",
  rfc: "PELJ800101XXX",
  celular: "8111111111",
  correo: "a@b.com",
  empresa: "Empresa SA",
  registroPatronal: "Y1234567890",
  telefonoEmpresa: "8222222222",
  referencias: [
    {
      nombre: "Ana Diaz Ruiz",
      nombres: "Ana",
      apellidoPaterno: "Diaz",
      apellidoMaterno: "Ruiz",
      celular: "8333333333",
    },
    {
      nombre: "Luis Soto Mora",
      nombres: "Luis",
      apellidoPaterno: "Soto",
      apellidoMaterno: "Mora",
      celular: "8444444444",
    },
  ],
  beneficiario: { nombre: "Rosa", parentesco: "Madre" },
  direccionEmpresa: {
    calle: "Calle 1",
    colonia: "Centro",
    municipio: "Monterrey",
    cp: "64000",
  },
  montoMejoravit: "",
  plazo: "",
  porcentajeCobro: "30",
  montoCalculado: "1000",
  metodoPago: "descuento_nomina",
  notaMesa: "",
  infonavit: emptyInfonavitClienteDatosV1(),
});

describe("EXTERNOS — CURP / Acta / dedupe / copy", () => {
  it("A/B: set externos 8 incluye CURP (misma lista Silvia|Orlando; autoridad SQL)", () => {
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS.length, 8);
    assert.ok(
      INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS.includes(
        "cliente_constancia_curp",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS as readonly string[]).includes(
        "cliente_acta_nacimiento_digital",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS as readonly string[]).includes(
        "cliente_ine_reverso",
      ),
    );
  });

  it("C: interno clásico no incluye CURP", () => {
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.length, 4);
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes(
        "cliente_constancia_curp",
      ),
    );
  });

  it("G/I: Acta no en envío; sí filtrada como opcional actor externo", () => {
    const opc = filterIntegracionChecklistOpcionalesParaActor(
      [
        { tipo_documento: "cliente_acta_nacimiento_digital" },
        { tipo_documento: "cliente_carta_empresa" },
      ],
      { actorPaqueteExternos: true, actorPaqueteResolved: true },
    );
    assert.deepEqual(
      opc.map((x) => x.tipo_documento),
      ["cliente_acta_nacimiento_digital"],
    );
  });

  it("CURP faltante bloquea; Acta faltante no", () => {
    const tipos = INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS;
    const sinCurp = tipos
      .filter((t) => t !== "cliente_constancia_curp")
      .map((tipo) => ({
        tipo_documento: tipo as (typeof tipos)[number],
        estatus_revision: "subido" as const,
      }));
    assert.equal(integrationDocsCompletos(sinCurp, tipos), false);
    const conCurp = [
      ...sinCurp,
      {
        tipo_documento: "cliente_constancia_curp" as const,
        estatus_revision: "subido" as const,
      },
    ];
    assert.equal(countIntegrationDocsPresentes(conCurp, tipos), 8);
    assert.equal(integrationDocsCompletos(conCurp, tipos), true);
  });

  it("H: dedupe por tipo canónico; Acta no en checklist obligatorio", () => {
    const tipos = [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS];
    for (const tipo of [
      "cliente_solicitud_credito",
      "cliente_lista_nominal",
      "cliente_bajo_protesta",
      "cliente_presupuesto",
    ]) {
      assert.equal(
        shouldMountAsesorScopedEquipoDocumentoSection({
          expedienteId: "e1",
          tipo,
          tiposVisibles: [tipo],
          tiposYaEnChecklistObligatorios: tipos,
        }),
        false,
      );
    }
    assert.equal(
      shouldMountAsesorScopedEquipoDocumentoSection({
        expedienteId: "e1",
        tipo: "cliente_acta_nacimiento_digital",
        tiposVisibles: ["cliente_acta_nacimiento_digital"],
        tiposYaEnChecklistObligatorios: tipos,
      }),
      true,
    );
  });

  it("A4: obligatorio no dice Documento opcional", () => {
    const hint = resolveScopedEquipoUploadHint({
      label: "Solicitud de crédito",
      esObligatorio: true,
      maxBytes: 15 * 1024 * 1024,
    });
    assert.match(hint, /Documento obligatorio/i);
    assert.doesNotMatch(hint, /Documento opcional/i);
  });

  it("parse: 8 con CURP; legacy 7; basura → 4", () => {
    assert.equal(
      parseAsesorDocumentosObligatoriosEnvio([
        ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS,
      ]).length,
      8,
    );
    assert.equal(
      parseAsesorDocumentosObligatoriosEnvio([
        ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS_LEGACY_7,
      ]).length,
      7,
    );
    assert.equal(parseAsesorDocumentosObligatoriosEnvio(["x"]).length, 4);
  });

  it("I: mig SQL envio tiene CURP sin Acta; upload añade Acta", () => {
    const mig = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260904230000_externos_curp_obligatorio_acta_opcional.sql",
      ),
      "utf8",
    );
    const envioBlock = mig.split("integration_doc_tipos_asesor_upload_para")[0];
    assert.match(envioBlock, /cliente_constancia_curp/);
    assert.doesNotMatch(
      envioBlock.split("RETURN ARRAY[")[1].split("]::TEXT[]")[0],
      /cliente_acta_nacimiento_digital/,
    );
    assert.match(mig, /cliente_acta_nacimiento_digital/);
    assert.match(mig, /REVOKE ALL ON FUNCTION public\.integration_doc_tipos_asesor_envio_para/);
    assert.doesNotMatch(mig, /GRANT EXECUTE[^\n]+TO anon/);
  });

  it("11: page fail-safe tiposEnvioResolved + coherencia CURP + tri-state", () => {
    const page = readFileSync(
      join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
      "utf8",
    );
    assert.match(page, /tiposEnvioResolved/);
    assert.match(page, /tiposEnvioCoherentesConDueno/);
    assert.match(page, /cliente_constancia_curp/);
    assert.match(page, /fetchAsesorEsPaqueteDocumentalExternosClasificacion/);
    assert.match(page, /duenoPaqueteClasificacion/);
    assert.match(page, /telefonoCasaValue/);
    assert.match(page, /onTelefonoCasaChange/);
    assert.match(page, /showTelefonoCasa=\{requiereTelefonoCasa\}/);
    assert.match(page, /clienteDatosRequiereTelefonoCasa/);
  });

  it("EXTERNO: sin telefonoCasa en faltantes/validación/UI mount; histórico ignorado", () => {
    assert.equal(
      clienteDatosRequiereTelefonoCasa("asesor_equipo_silvia_simplificado"),
      false,
    );
    const d = baseInternoDatos();
    d.referencias = [
      { nombre: "", nombres: "", apellidoPaterno: "", apellidoMaterno: "", celular: "" },
      { nombre: "", nombres: "", apellidoPaterno: "", apellidoMaterno: "", celular: "" },
    ];
    d.correo = "";
    d.empresa = "";
    d.registroPatronal = "";
    d.telefonoEmpresa = "";
    d.beneficiario = { nombre: "", parentesco: "" };
    d.plazo = "";
    const ctxExt = {
      montoAprobado: 100000,
      direccionOpcional: "Domicilio real",
      programaDb: "credito_infonavit" as const,
      requireInfonavit: false,
      perfilCaptura: "asesor_equipo_silvia_simplificado" as const,
      telefonoCasa: undefined as string | undefined,
    };
    assert.ok(
      !getClienteDatosCamposFaltantes(d, ctxExt).some((x) => /casa/i.test(x)),
    );
    const vEmpty = validateClienteDatos(d, { ...ctxExt, telefonoCasa: undefined });
    assert.equal(vEmpty.errors.telefonoCasa, undefined);
    assert.equal(vEmpty.isValid, true);

    // Histórico / valor accidental en ctx: requiere=false → no valida ni duplica vs casa
    const vHist = validateClienteDatos(d, {
      ...ctxExt,
      // page no pasa telefonoCasa; si se forzara, requiereTelefonoCasa lo ignora
      telefonoCasa: "8111111111",
    });
    // Con silvia, clienteDatosRequiereTelefonoCasa=false → no entra al bloque casa
    // aunque el ctx traiga un valor (defensa en depth).
    assert.equal(
      clienteDatosRequiereTelefonoCasa(ctxExt.perfilCaptura),
      false,
    );
    // Simula contrato real de page: undefined
    assert.equal(
      validateClienteDatos(d, { ...ctxExt, telefonoCasa: undefined }).isValid,
      true,
    );
    // Defensa: aunque pasen valor, no debe aplicar B1/B2 de casa
    assert.equal(vHist.errors.telefonoCasa, undefined);
    assert.equal(vHist.isValid, true);

    const wrapper = readFileSync(
      join(process.cwd(), "src/components/asesor/AsesorCurpValidacionSection.tsx"),
      "utf8",
    );
    assert.match(wrapper, /showTelefonoCasa \? \(/);
    assert.match(wrapper, /AsesorTelefonoCasaSection/);

    const repo = readFileSync(
      join(process.cwd(), "src/domain/expediente-cliente-datos/supabase.repo.ts"),
      "utf8",
    );
    assert.match(repo, /clienteDatosRequiereTelefonoCasa/);
    assert.match(repo, /save_cliente_datos/);
  });
});

describe("INTERNOS — casa / refs / unicidad", () => {
  const ctxOk = {
    montoAprobado: 100000,
    direccionOpcional: "Calle 1",
    programaDb: "credito_infonavit" as const,
    requireInfonavit: false,
    perfilCaptura: "asesor_completo" as const,
    telefonoCasa: "8555555555",
  };

  it("CONTRATO INTERNO: casa obligatoria + no duplicada + UI + wrapper", () => {
    assert.equal(clienteDatosRequiereTelefonoCasa("asesor_completo"), true);

    const d = baseInternoDatos();
    // 1) vacío → incompleto / faltante / isValid false (bloquea guardar/enviar)
    const faltantesVacios = getClienteDatosCamposFaltantes(d, {
      ...ctxOk,
      telefonoCasa: "",
    });
    assert.ok(faltantesVacios.some((x) => /Teléfono de casa/i.test(x)));
    const vVacio = validateClienteDatos(d, { ...ctxOk, telefonoCasa: "" });
    assert.equal(vVacio.isValid, false);
    assert.ok(vVacio.errors.telefonoCasa);

    // 2) válido distinto al celular → puede completar
    const vOk = validateClienteDatos(d, ctxOk);
    assert.equal(vOk.isValid, true);
    assert.equal(vOk.errors.telefonoCasa, undefined);
    assert.ok(
      !getClienteDatosCamposFaltantes(d, ctxOk).some((x) => /casa/i.test(x)),
    );

    // 4) duplicidad celular = casa → error; números distintos → ok
    const vDup = validateClienteDatos(d, {
      ...ctxOk,
      telefonoCasa: "8111111111",
    });
    assert.equal(vDup.isValid, false);
    assert.match(String(vDup.errors.telefonoCasa ?? ""), /igual|casa/i);
    assert.equal(
      validateClienteDatos(d, { ...ctxOk, telefonoCasa: "8555555555" }).isValid,
      true,
    );

    // 5) UI: page monta sección solo si requiere; wrapper condicional
    const page = readFileSync(
      join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
      "utf8",
    );
    assert.match(page, /showTelefonoCasa=\{requiereTelefonoCasa\}/);
    assert.match(page, /telefonoCasa: requiereTelefonoCasa \? telefonoCasaValue/);
    const wrapper = readFileSync(
      join(process.cwd(), "src/components/asesor/AsesorCurpValidacionSection.tsx"),
      "utf8",
    );
    assert.match(wrapper, /showTelefonoCasa \? \([\s\S]*AsesorTelefonoCasaSection/);
    const repo = readFileSync(
      join(process.cwd(), "src/domain/expediente-cliente-datos/supabase.repo.ts"),
      "utf8",
    );
    assert.match(
      repo,
      /clienteDatosRequiereTelefonoCasa\(input\.perfilCaptura\)\s*\?[\s\S]*asesor_guardar_cliente_datos_con_telefono_casa/,
    );
  });

  it("reactivo: telefonoCasa vacío→válido→vacío sin tocar otros campos", () => {
    const d = baseInternoDatos();
    const baseCtx = {
      montoAprobado: 100000,
      direccionOpcional: "Calle 1",
      programaDb: "credito_infonavit" as const,
      requireInfonavit: false,
      perfilCaptura: "asesor_completo" as const,
    };
    // A: vacío → faltante
    let faltantes = getClienteDatosCamposFaltantes(d, {
      ...baseCtx,
      telefonoCasa: "",
    });
    assert.ok(faltantes.some((x) => /casa/i.test(x)));
    assert.ok(
      validateClienteDatos(d, { ...baseCtx, telefonoCasa: "" }).errors
        .telefonoCasa,
    );
    // B: escribe válido → sin tocar otros campos → deja de ser faltante
    faltantes = getClienteDatosCamposFaltantes(d, {
      ...baseCtx,
      telefonoCasa: "8555555555",
    });
    assert.ok(!faltantes.some((x) => /casa/i.test(x)));
    assert.equal(
      validateClienteDatos(d, { ...baseCtx, telefonoCasa: "8555555555" }).errors
        .telefonoCasa,
      undefined,
    );
    // C: borra → vuelve faltante
    faltantes = getClienteDatosCamposFaltantes(d, {
      ...baseCtx,
      telefonoCasa: "",
    });
    assert.ok(faltantes.some((x) => /casa/i.test(x)));
    // D: iguala celular → error inmediato
    const eq = validateClienteDatos(d, {
      ...baseCtx,
      telefonoCasa: "81-1111-1111",
    });
    assert.match(String(eq.errors.telefonoCasa ?? ""), /igual|casa/i);
    assert.ok(
      getClienteDatosCamposFaltantes(d, {
        ...baseCtx,
        telefonoCasa: "8111111111",
      }).some((x) => /casa|celular/i.test(x)),
    );
  });

  it("12: casa vacía falla", () => {
    const v = validateClienteDatos(baseInternoDatos(), {
      ...ctxOk,
      telefonoCasa: "",
    });
    assert.equal(v.isValid, false);
    assert.ok(v.errors.telefonoCasa);
  });

  it("13/14/J: celular = casa (formatos) falla", () => {
    for (const casa of [
      "+52 81 1111 1111",
      "8111111111",
      "81-1111-1111",
      "(81) 1111 1111",
    ]) {
      const v = validateClienteDatos(baseInternoDatos(), {
        ...ctxOk,
        telefonoCasa: casa,
      });
      assert.equal(v.isValid, false, casa);
      assert.match(String(v.errors.telefonoCasa ?? ""), /igual|casa/i);
    }
  });

  it("15-17: refs estructuradas obligatorias", () => {
    const d = baseInternoDatos();
    d.referencias[0] = {
      nombre: "Ana",
      nombres: "",
      apellidoPaterno: "Diaz",
      apellidoMaterno: "Ruiz",
      celular: "8333333333",
    };
    assert.equal(validateClienteDatos(d, ctxOk).isValid, false);
    d.referencias[0] = {
      nombre: "Ana",
      nombres: "Ana",
      apellidoPaterno: "",
      apellidoMaterno: "Ruiz",
      celular: "8333333333",
    };
    assert.equal(validateClienteDatos(d, ctxOk).isValid, false);
    d.referencias[0] = {
      nombre: "Ana",
      nombres: "Ana",
      apellidoPaterno: "Diaz",
      apellidoMaterno: "",
      celular: "8333333333",
    };
    assert.equal(validateClienteDatos(d, ctxOk).isValid, false);
  });

  it("18: ref sin teléfono falla", () => {
    const d = baseInternoDatos();
    d.referencias[0] = {
      ...d.referencias[0],
      celular: "",
    };
    assert.equal(validateClienteDatos(d, ctxOk).isValid, false);
  });

  it("19: ref teléfono duplicado con celular falla", () => {
    const d = baseInternoDatos();
    d.referencias[0] = { ...d.referencias[0], celular: "8111111111" };
    const v = validateClienteDatos(d, ctxOk);
    assert.equal(v.isValid, false);
  });

  it("20: interno completo válido pasa", () => {
    assert.equal(validateClienteDatos(baseInternoDatos(), ctxOk).isValid, true);
  });
});

describe("AISLAMIENTO Silvia|Orlando vs interno", () => {
  it("D/E: dueño externo (Silvia u Orlando) → perfil silvia_simplificado; B1–B5 OFF", () => {
    // Trazabilidad: la RPC asesor_es_paquete_documental_externos cubre Silvia|Orlando;
    // tri-state externo → mismo perfil histórico.
    assert.equal(
      resolveClienteDatosPerfilCaptura({
        duenoClasificacion: "externo",
      }),
      "asesor_equipo_silvia_simplificado",
    );
    assert.equal(
      resolveClienteDatosPerfilCaptura({
        duenoEnPaqueteExternosConfirmado: true,
      }),
      "asesor_equipo_silvia_simplificado",
    );
    const d = baseInternoDatos();
    d.referencias = [
      { nombre: "", nombres: "", apellidoPaterno: "", apellidoMaterno: "", celular: "" },
      { nombre: "", nombres: "", apellidoPaterno: "", apellidoMaterno: "", celular: "" },
    ];
    d.correo = "";
    d.empresa = "";
    d.registroPatronal = "";
    d.telefonoEmpresa = "";
    d.beneficiario = { nombre: "", parentesco: "" };
    d.plazo = "";
    const v = validateClienteDatos(d, {
      montoAprobado: 100000,
      direccionOpcional: "Domicilio real",
      programaDb: "credito_infonavit",
      requireInfonavit: false,
      perfilCaptura: "asesor_equipo_silvia_simplificado",
      telefonoCasa: "",
    });
    assert.equal(v.errors.telefonoCasa, undefined);
    assert.ok(!Object.keys(v.errors).some((k) => k.startsWith("referencia")));
    assert.equal(v.isValid, true);
    assert.ok(
      !getClienteDatosCamposFaltantes(d, {
        montoAprobado: 100000,
        direccionOpcional: "Domicilio real",
        programaDb: "credito_infonavit",
        perfilCaptura: "asesor_equipo_silvia_simplificado",
        telefonoCasa: "",
      }).some((x) => /casa/i.test(x)),
    );
  });

  it("UNKNOWN ≠ INTERNO: B1–B5 OFF + incompleto para gates", () => {
    assert.equal(
      resolveClienteDatosPerfilCaptura({ duenoClasificacion: "unknown" }),
      "clasificacion_pendiente",
    );
    assert.equal(
      clienteDatosRequiereTelefonoCasa("clasificacion_pendiente"),
      false,
    );
    const faltantes = getClienteDatosCamposFaltantes(baseInternoDatos(), {
      perfilCaptura: "clasificacion_pendiente",
      telefonoCasa: undefined,
    });
    assert.ok(faltantes.some((x) => /validando perfil/i.test(x)));
    const v = validateClienteDatos(baseInternoDatos(), {
      montoAprobado: 100000,
      direccionOpcional: "Calle 1",
      programaDb: "credito_infonavit",
      requireInfonavit: false,
      perfilCaptura: "clasificacion_pendiente",
      telefonoCasa: undefined,
    });
    assert.equal(v.isValid, false);
    assert.equal(v.errors.telefonoCasa, undefined);
    // Bloqueo por clasificación pendiente, no por casa
    assert.match(v.messages.join(" "), /validando perfil/i);
  });

  it("F: interno aplica B1–B5", () => {
    assert.equal(
      resolveClienteDatosPerfilCaptura({ duenoClasificacion: "interno" }),
      "asesor_completo",
    );
    assert.equal(clienteDatosRequiereTelefonoCasa("asesor_completo"), true);
    const v = validateClienteDatos(baseInternoDatos(), {
      montoAprobado: 100000,
      direccionOpcional: "Calle 1",
      programaDb: "credito_infonavit",
      requireInfonavit: false,
      perfilCaptura: "asesor_completo",
      telefonoCasa: "",
    });
    assert.ok(v.errors.telefonoCasa);
  });

  it("interno no monta hide opcionales dedicados por ser externo", () => {
    assert.equal(
      shouldMountAsesorIntegracionOpcionalDedicado({
        actorPaqueteExternos: false,
        actorPaqueteResolved: true,
      }),
      true,
    );
  });
});

describe("HISTÓRICOS", () => {
  it("refs solo-nombre abren (faltantes hasta completar)", () => {
    const d = baseInternoDatos();
    d.referencias = [
      {
        nombre: "Ana Perez Diaz",
        nombres: "",
        apellidoPaterno: "",
        apellidoMaterno: "",
        celular: "8333333333",
      },
      {
        nombre: "Luis Soto",
        nombres: "",
        apellidoPaterno: "",
        apellidoMaterno: "",
        celular: "8444444444",
      },
    ];
    const faltantes = getClienteDatosCamposFaltantes(d, {
      montoAprobado: 100000,
      direccionOpcional: "Calle 1",
      programaDb: "credito_infonavit",
      requireInfonavit: false,
      perfilCaptura: "asesor_completo",
      telefonoCasa: "8555555555",
    });
    assert.ok(faltantes.length > 0);
  });

  it("legacy 7 parseable (expediente externo histórico abre checklist)", () => {
    assert.equal(
      parseAsesorDocumentosObligatoriosEnvio([
        ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS_LEGACY_7,
      ]).length,
      7,
    );
  });
});
