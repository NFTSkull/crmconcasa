/**
 * Matriz de cobertura P189 v1 — un renglón por AcroForm.
 * Categorías: A directa · B derivada segura · C parser con confidence · D propuesta · E sin fuente.
 */
import {
  BAJO_FIELD,
  PRESUPUESTO_FIELD,
  SOLICITUD_FIELD,
} from "./template-contract.ts";

export type MappingCategory = "A" | "B" | "C" | "D" | "E";

export interface FieldCoverageRow {
  document: "carta" | "presupuesto" | "solicitud";
  page: 1 | 2;
  acroForm: string;
  meaning: string;
  crmSource: string;
  transform: string;
  category: MappingCategory;
  filledIfSourceExists: boolean;
  emptyReason: string;
}

export const CARTA_COVERAGE: FieldCoverageRow[] = [
  { document: "carta", page: 1, acroForm: BAJO_FIELD.T0_LOCALIDAD, meaning: "Localidad", crmSource: "constante P189", transform: "NUEVO LEÓN", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "carta", page: 1, acroForm: BAJO_FIELD.T1_DIA, meaning: "Día", crmSource: "fecha_envio_mesa", transform: "America/Monterrey DD", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "carta", page: 1, acroForm: BAJO_FIELD.T2_MES, meaning: "Mes", crmSource: "fecha_envio_mesa", transform: "America/Monterrey MM", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "carta", page: 1, acroForm: BAJO_FIELD.T3_ANIO, meaning: "Año (2 dígitos)", crmSource: "fecha_envio_mesa", transform: "YY; plantilla imprime «20»", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "carta", page: 2, acroForm: BAJO_FIELD.T4_DESC0, meaning: "Mejora línea 1", crmSource: "datos.infonavit.mejora.descripcion | buildPropuestaMejoramiento", transform: "split 4 líneas", category: "D", filledIfSourceExists: true, emptyReason: "" },
  { document: "carta", page: 2, acroForm: BAJO_FIELD.T5_DESC1, meaning: "Mejora línea 2", crmSource: "igual T4", transform: "línea 2", category: "D", filledIfSourceExists: true, emptyReason: "" },
  { document: "carta", page: 2, acroForm: BAJO_FIELD.T6_DESC2, meaning: "Mejora línea 3", crmSource: "igual T4", transform: "línea 3", category: "D", filledIfSourceExists: true, emptyReason: "" },
  { document: "carta", page: 2, acroForm: BAJO_FIELD.T7_DESC3, meaning: "Mejora línea 4", crmSource: "igual T4", transform: "línea 4", category: "D", filledIfSourceExists: true, emptyReason: "" },
  { document: "carta", page: 2, acroForm: BAJO_FIELD.T8_NOMBRE, meaning: "Nombre (no es firma)", crmSource: "datos.nombreCliente | expedientes.cliente_nombre", transform: "completo uppercase", category: "A", filledIfSourceExists: true, emptyReason: "" },
  { document: "carta", page: 2, acroForm: BAJO_FIELD.T9_NSS, meaning: "NSS", crmSource: "expedientes.nss | datos.nss", transform: "normalize_nss_mexico", category: "B", filledIfSourceExists: true, emptyReason: "" },
];

export const PRESUPUESTO_COVERAGE: FieldCoverageRow[] = [
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T0_NOMBRE, meaning: "Nombre línea 1", crmSource: "nombreCliente | cliente_nombre", transform: "completo; overflow T11 si >26", category: "A", filledIfSourceExists: true, emptyReason: "" },
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T11_NOMBRE_OVERFLOW, meaning: "Nombre overflow", crmSource: "igual T0", transform: "resto del nombre", category: "A", filledIfSourceExists: true, emptyReason: "vacío si el nombre cabe en T0" },
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T1_NSS, meaning: "NSS", crmSource: "expedientes.nss | datos.nss", transform: "normalize_nss_mexico", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T2_DIR0, meaning: "Dirección línea 1", crmSource: "expedientes.direccion_opcional", transform: "direccionCompleta wrap 3 líneas", category: "A", filledIfSourceExists: true, emptyReason: "" },
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T3_DIR1, meaning: "Dirección línea 2", crmSource: "igual T2", transform: "wrap", category: "A", filledIfSourceExists: true, emptyReason: "vacío si cabe en T2" },
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T4_DIR2, meaning: "Dirección línea 3", crmSource: "igual T2", transform: "wrap", category: "A", filledIfSourceExists: true, emptyReason: "vacío si cabe en T2-T3" },
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T5_DESC0, meaning: "Mejora línea 1", crmSource: "misma descripción que Carta", transform: "split 4 líneas", category: "D", filledIfSourceExists: true, emptyReason: "" },
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T6_DESC1, meaning: "Mejora línea 2", crmSource: "igual Carta", transform: "línea 2", category: "D", filledIfSourceExists: true, emptyReason: "" },
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T7_DESC2, meaning: "Mejora línea 3", crmSource: "igual Carta", transform: "línea 3", category: "D", filledIfSourceExists: true, emptyReason: "" },
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T8_DESC3, meaning: "Mejora línea 4", crmSource: "igual Carta", transform: "línea 4", category: "D", filledIfSourceExists: true, emptyReason: "" },
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T9_MONTO, meaning: "Presupuesto estimado", crmSource: "resolve_monto_operativo_mejoravit", transform: "formatMoneyMx sin $ (plantilla tiene $)", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "presupuesto", page: 1, acroForm: PRESUPUESTO_FIELD.T10_FECHA, meaning: "Fecha (la firma es línea en blanco del PDF)", crmSource: "fecha_envio_mesa", transform: "DD/MM/AA", category: "B", filledIfSourceExists: true, emptyReason: "" },
];

export const SOLICITUD_COVERAGE: FieldCoverageRow[] = [
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T0_NSS, meaning: "NSS", crmSource: "expedientes.nss | datos.nss", transform: "normalize_nss_mexico", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T1_CURP, meaning: "CURP", crmSource: "datos.curp", transform: "uppercase", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T2_RFC, meaning: "RFC", crmSource: "datos.rfc", transform: "uppercase", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T3_AP_PATERNO, meaning: "Apellido paterno", crmSource: "nombreCliente | cliente_nombre", transform: "parseNombrePersonaMx si confidence=high", category: "C", filledIfSourceExists: true, emptyReason: "vacío si confidence=none" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T4_AP_MATERNO, meaning: "Apellido materno", crmSource: "igual T3", transform: "parser confidence", category: "C", filledIfSourceExists: true, emptyReason: "vacío si confidence=none" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T5_NOMBRES, meaning: "Nombre(s)", crmSource: "igual T3", transform: "given names o nombre completo si none", category: "C", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T6_TIPO_ID, meaning: "Tipo identificación", crmSource: "ninguna en CRM actual (B8 no captura infonavit.titular)", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "sin fuente; Fase 2 INE" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T7_NUM_ID, meaning: "Número identificación", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "REQUIERE DECISIÓN DE NEGOCIO (clave elector vs OCR vs CIC)" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T8_VIGENCIA, meaning: "Vigencia identificación", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "Fase 2 INE si vigencia explícita" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T9_LADA, meaning: "LADA teléfono fijo titular", crmSource: "no hay teléfono fijo distinto", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "solo existe datos.celular" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T10_TELEFONO, meaning: "Teléfono fijo titular", crmSource: "no hay", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "no duplicar celular" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T11_CELULAR, meaning: "Celular titular", crmSource: "datos.celular", transform: "cliente_datos_telefono_canonico 10 dígitos", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T12_CORREO, meaning: "Correo", crmSource: "datos.correo", transform: "trim", category: "A", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.C0_GENERO_F, meaning: "Género F", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "no inferir de CURP; Fase 2 INE" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.C1_GENERO_M, meaning: "Género M", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "no inferir de CURP" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T13_EMPRESA, meaning: "Empresa", crmSource: "datos.empresa", transform: "trim", category: "A", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T14_REG_PATRONAL, meaning: "Registro patronal", crmSource: "datos.registroPatronal", transform: "trim", category: "A", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T15_EMP_LADA, meaning: "LADA empresa", crmSource: "datos.telefonoEmpresa (10 dígitos canónicos)", transform: "NO se parte LADA (81/55/228 no es fiable)", category: "E", filledIfSourceExists: false, emptyReason: "decisión: LADA vacía; número completo en T16" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T16_EMP_TEL, meaning: "Teléfono empresa", crmSource: "datos.telefonoEmpresa", transform: "10 dígitos canónicos en NÚMERO", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T17_EMP_EXT, meaning: "Extensión empresa", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "CRM no guarda extensión" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.C6_SOLTERO, meaning: "Soltero", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "sin fuente" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.C7_CASADO, meaning: "Casado", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "sin fuente" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.C2_REGIMEN_SEPARACION, meaning: "Separación de bienes", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "sin fuente" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.C3_REGIMEN_SOCIEDAD, meaning: "Sociedad conyugal", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "sin fuente" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T18_CALLE, meaning: "Calle", crmSource: "expedientes.direccion_opcional", transform: "parser calle high o direccionCompleta fallback", category: "C", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T19_NO_EXT, meaning: "No. exterior", crmSource: "direccion_opcional", transform: "solo si confidence=high", category: "C", filledIfSourceExists: true, emptyReason: "vacío si no hay número seguro" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T20_NO_INT, meaning: "No. interior", crmSource: "direccion_opcional", transform: "solo INT/INTERIOR etiquetado", category: "C", filledIfSourceExists: false, emptyReason: "no inventar" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T21_LOTE, meaning: "Lote", crmSource: "ninguna salvo etiqueta LOTE", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "no inventar" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T22_MANZANA, meaning: "Manzana", crmSource: "ninguna salvo etiqueta MZ", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "no inventar" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T23_COLONIA, meaning: "Colonia", crmSource: "direccion_opcional", transform: "COL/COL./COLONIA + terminador CP o entidad", category: "C", filledIfSourceExists: true, emptyReason: "vacío sin evidencia COL" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T24_ENTIDAD, meaning: "Entidad", crmSource: "direccion_opcional", transform: "N.L./NL/NUEVO LEON → NUEVO LEÓN", category: "C", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T25_MUNICIPIO, meaning: "Municipio", crmSource: "direccion_opcional", transform: "último token post-número solo si hay CP o entidad", category: "C", filledIfSourceExists: true, emptyReason: "vacío sin ancla geográfica" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T26_CP, meaning: "Código postal", crmSource: "direccion_opcional", transform: "exactamente 5 dígitos", category: "C", filledIfSourceExists: true, emptyReason: "vacío si no hay CP" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.C8_PROP_PROPIA, meaning: "Propiedad propia", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "sin fuente" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.C4_PROP_CONYUGE, meaning: "Propiedad cónyuge/concubino", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "sin fuente" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.C5_PROP_FAMILIAR, meaning: "Propiedad familiar", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "sin fuente" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T27_MONTO, meaning: "Monto crédito solicitado", crmSource: "resolve_monto_operativo_mejoravit", transform: "formatMoneyMx; NO monto_aprobado", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T29_PLAZO, meaning: "Plazo años", crmSource: "datos.plazo", transform: "solo 1–10; si inválido vacío + mappingWarnings.plazo_invalido", category: "B", filledIfSourceExists: true, emptyReason: "vacío si ausente o inválido" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T31_BLANK, meaning: "% titulación (máx 30%)", crmSource: "ninguna", transform: "MUST_STAY_BLANK", category: "E", filledIfSourceExists: false, emptyReason: "destino de recursos no capturado" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T32_BLANK, meaning: "CLABE notaría", crmSource: "ninguna", transform: "MUST_STAY_BLANK", category: "E", filledIfSourceExists: false, emptyReason: "sin CLABE" },
  { document: "solicitud", page: 1, acroForm: SOLICITUD_FIELD.T33_BLANK, meaning: "CLABE derechohabiente", crmSource: "ninguna", transform: "MUST_STAY_BLANK", category: "E", filledIfSourceExists: false, emptyReason: "sin CLABE" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T30_REF1_AP_PAT, meaning: "Ref1 paterno", crmSource: "referencias[0].nombre", transform: "parseNombrePersonaMx confidence", category: "C", filledIfSourceExists: true, emptyReason: "vacío si none" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T34_REF1_AP_MAT, meaning: "Ref1 materno", crmSource: "referencias[0].nombre", transform: "parser", category: "C", filledIfSourceExists: true, emptyReason: "vacío si none" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T35_REF1_NOMBRES, meaning: "Ref1 nombres", crmSource: "referencias[0].nombre", transform: "parser o completo", category: "C", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T36_REF1_LADA, meaning: "Ref1 LADA fijo", crmSource: "ninguna distinta de celular", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "no duplicar celular" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T37_REF1_TEL, meaning: "Ref1 teléfono fijo", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "solo referencias[].celular" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T38_REF1_CEL, meaning: "Ref1 celular", crmSource: "referencias[0].celular", transform: "canonico 10 dígitos", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T39_REF2_AP_PAT, meaning: "Ref2 paterno", crmSource: "referencias[1].nombre", transform: "parser", category: "C", filledIfSourceExists: true, emptyReason: "vacío si none" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T40_REF2_AP_MAT, meaning: "Ref2 materno", crmSource: "referencias[1].nombre", transform: "parser", category: "C", filledIfSourceExists: true, emptyReason: "vacío si none" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T41_REF2_NOMBRES, meaning: "Ref2 nombres", crmSource: "referencias[1].nombre", transform: "parser o completo", category: "C", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T42_REF2_LADA, meaning: "Ref2 LADA fijo", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "no duplicar celular" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T43_REF2_TEL, meaning: "Ref2 teléfono fijo", crmSource: "ninguna", transform: "—", category: "E", filledIfSourceExists: false, emptyReason: "solo celular" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T44_REF2_CEL, meaning: "Ref2 celular", crmSource: "referencias[1].celular", transform: "canonico", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T45_BEN_PARENTESCO, meaning: "Parentesco beneficiario", crmSource: "datos.beneficiario.parentesco", transform: "uppercase", category: "A", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T46_BEN_AP_PAT, meaning: "Bene paterno", crmSource: "datos.beneficiario.nombre", transform: "parser confidence", category: "C", filledIfSourceExists: true, emptyReason: "vacío si none" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T47_BEN_AP_MAT, meaning: "Bene materno", crmSource: "datos.beneficiario.nombre", transform: "parser", category: "C", filledIfSourceExists: true, emptyReason: "vacío si none" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T48_BEN_NOMBRES, meaning: "Bene nombres", crmSource: "datos.beneficiario.nombre", transform: "parser o completo", category: "C", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T49_PROMOTOR_BLANK, meaning: "Número promotor", crmSource: "ninguna", transform: "MUST_STAY_BLANK", category: "E", filledIfSourceExists: false, emptyReason: "promotor no aplica" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T50_PROMOTOR_BLANK, meaning: "Promotor paterno", crmSource: "ninguna", transform: "MUST_STAY_BLANK", category: "E", filledIfSourceExists: false, emptyReason: "promotor no aplica" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T51_PROMOTOR_BLANK, meaning: "Promotor materno", crmSource: "ninguna", transform: "MUST_STAY_BLANK", category: "E", filledIfSourceExists: false, emptyReason: "promotor no aplica" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T52_PROMOTOR_BLANK, meaning: "Promotor nombres", crmSource: "ninguna", transform: "MUST_STAY_BLANK", category: "E", filledIfSourceExists: false, emptyReason: "promotor no aplica" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T53_PROMOTOR_BLANK, meaning: "Promotor LADA", crmSource: "ninguna", transform: "MUST_STAY_BLANK", category: "E", filledIfSourceExists: false, emptyReason: "promotor no aplica" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T54_PROMOTOR_BLANK, meaning: "Promotor teléfono", crmSource: "ninguna", transform: "MUST_STAY_BLANK", category: "E", filledIfSourceExists: false, emptyReason: "promotor no aplica" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T55_CREDITO_INFONAVIT_BLANK, meaning: "Número crédito INFONAVIT", crmSource: "ninguna (lo llena INFONAVIT)", transform: "MUST_STAY_BLANK", category: "E", filledIfSourceExists: false, emptyReason: "dato INFONAVIT" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T56_CIUDAD, meaning: "Ciudad de cierre", crmSource: "constante P189", transform: "NUEVO LEÓN (ciudadCierre)", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T57_DIA, meaning: "Día cierre", crmSource: "fechaDocumento", transform: "DD", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T58_MES, meaning: "Mes cierre", crmSource: "fechaDocumento", transform: "nombre ES MAYÚSCULAS", category: "B", filledIfSourceExists: true, emptyReason: "" },
  { document: "solicitud", page: 2, acroForm: SOLICITUD_FIELD.T59_ANIO, meaning: "Año cierre (2 dígitos)", crmSource: "fechaDocumento", transform: "YY; plantilla tiene «de 20» impreso → se lee 2026", category: "B", filledIfSourceExists: true, emptyReason: "" },
];

export const ALL_COVERAGE: FieldCoverageRow[] = [
  ...CARTA_COVERAGE,
  ...PRESUPUESTO_COVERAGE,
  ...SOLICITUD_COVERAGE,
];
