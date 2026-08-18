/**
 * Modelo de impresión compartido P189.
 * Una sola derivación desde InfonavitPdfSnapshotInput (post-adapter B3→B1).
 * PDF y DOCX deben leer estos valores; no re-resolver monto/nombre/dirección.
 *
 * No toca flatten. El PDF sigue usando fill-* + flattenAndSave.
 */

import {
  blankable,
  formatBajoProtestaDateParts,
  formatMoneyMx,
  formatNombreCompleto,
  formatPresupuestoFecha,
  formatSolicitudCierreDateParts,
} from "./formatters.ts";
import type {
  InfonavitBeneficiarioInput,
  InfonavitPdfSnapshotInput,
  InfonavitReferenciaInput,
} from "./types.ts";

export interface InfonavitPersonaPrint {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombreCompleto: string;
}

export interface InfonavitReferenciaPrint extends InfonavitPersonaPrint {
  lada: string;
  telefono: string;
  celular: string;
}

export interface InfonavitPrintModel {
  fechaDocumento: string;
  localidad: string;
  ciudadCierre: string;
  cartaFecha: { day: string; month: string; year2: string };
  presupuestoFecha: string;
  solicitudFecha: { day: string; monthName: string; year2: string };
  nombreCompleto: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nss: string;
  curp: string;
  rfc: string;
  celular: string;
  correo: string;
  telefono: string;
  ladaTelefono: string;
  identificacionTipo: string;
  identificacionNumero: string;
  identificacionVigencia: string;
  empresaNombre: string;
  registroPatronal: string;
  empresaLada: string;
  empresaTelefono: string;
  empresaExtension: string;
  domicilioLibre: string;
  calle: string;
  noExt: string;
  noInt: string;
  lote: string;
  manzana: string;
  colonia: string;
  entidad: string;
  municipio: string;
  cp: string;
  propuesta: string;
  propuestaLines: string[];
  montoMejoravit: string;
  plazo: string;
  ref1: InfonavitReferenciaPrint;
  ref2: InfonavitReferenciaPrint;
  beneficiario: InfonavitPersonaPrint & { parentesco: string };
}

function personaFromParts(p: {
  nombres?: string | null;
  apellidoPaterno?: string | null;
  apellidoMaterno?: string | null;
  nombreCompleto?: string | null;
}): InfonavitPersonaPrint {
  const nombres = blankable(p.nombres);
  const apellidoPaterno = blankable(p.apellidoPaterno);
  const apellidoMaterno = blankable(p.apellidoMaterno);
  const composed = formatNombreCompleto({
    nombres,
    apellidoPaterno,
    apellidoMaterno,
    nombreCompleto: p.nombreCompleto,
  });
  return { nombres, apellidoPaterno, apellidoMaterno, nombreCompleto: composed };
}

function mapRef(r: InfonavitReferenciaInput | undefined): InfonavitReferenciaPrint {
  const p = personaFromParts(r ?? {});
  return {
    ...p,
    lada: blankable(r?.lada),
    telefono: blankable(r?.telefono),
    celular: blankable(r?.celular),
  };
}

function mapBen(
  b: InfonavitBeneficiarioInput | null | undefined,
): InfonavitPersonaPrint & { parentesco: string } {
  return {
    ...personaFromParts(b ?? {}),
    parentesco: blankable(b?.parentesco),
  };
}

/**
 * Misma composición que fill-presupuesto.composeDireccionLibre.
 * Preferir direccionLibre; si no, armar desde campos estructurados.
 */
export function composeDireccionLibre(snapshot: InfonavitPdfSnapshotInput): string {
  const v = snapshot.vivienda;
  const libre = blankable(v?.direccionLibre, { collapseSpaces: true });
  if (libre) return libre;
  const parts = [
    blankable(v?.calle, { collapseSpaces: true }),
    blankable(v?.noExt) ? `No. ${blankable(v?.noExt)}` : "",
    blankable(v?.noInt) ? `Int. ${blankable(v?.noInt)}` : "",
    blankable(v?.colonia)
      ? `COL. ${blankable(v?.colonia, { collapseSpaces: true })}`
      : "",
    blankable(v?.municipio, { collapseSpaces: true }),
    blankable(v?.entidad, { collapseSpaces: true }),
    blankable(v?.cp) ? `CP ${blankable(v?.cp)}` : "",
  ].filter((p) => p.length > 0);
  return parts.join(", ");
}

export function formatMontoPrint(
  amount: number | null | undefined,
): string {
  if (amount === null || amount === undefined) return "";
  return formatMoneyMx(amount, { withSymbol: false });
}

export function formatPlazoPrint(
  cred: InfonavitPdfSnapshotInput["credito"],
): string {
  const plazo =
    cred?.plazoAnios === null || cred?.plazoAnios === undefined
      ? cred?.plazoMeses
      : cred.plazoAnios;
  if (plazo === null || plazo === undefined) return "";
  return String(plazo);
}

export function buildInfonavitPrintModel(
  snapshot: InfonavitPdfSnapshotInput,
): InfonavitPrintModel {
  const c = snapshot.cliente;
  const id = c.identificacion;
  const emp = snapshot.empresa;
  const viv = snapshot.vivienda;
  const propuesta = blankable(snapshot.mejora?.descripcion);
  const propuestaLines = propuesta
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const montoCredito = formatMontoPrint(snapshot.credito?.montoSolicitado);
  const montoPres = formatMontoPrint(snapshot.mejora?.presupuestoEstimado);
  const montoMejoravit = montoPres || montoCredito;
  const refs = snapshot.referencias ?? [];

  return {
    fechaDocumento: snapshot.fechaDocumento,
    localidad: blankable(snapshot.localidad, { collapseSpaces: true }),
    ciudadCierre: blankable(snapshot.ciudadCierre || snapshot.localidad, {
      collapseSpaces: true,
    }),
    cartaFecha: formatBajoProtestaDateParts(snapshot.fechaDocumento),
    presupuestoFecha: formatPresupuestoFecha(snapshot.fechaDocumento),
    solicitudFecha: formatSolicitudCierreDateParts(snapshot.fechaDocumento),
    nombreCompleto: formatNombreCompleto(c),
    nombres: blankable(c.nombres),
    apellidoPaterno: blankable(c.apellidoPaterno),
    apellidoMaterno: blankable(c.apellidoMaterno),
    nss: blankable(c.nss),
    curp: blankable(c.curp),
    rfc: blankable(c.rfc),
    celular: blankable(c.celular),
    correo: blankable(c.correo),
    telefono: blankable(c.telefono),
    ladaTelefono: blankable(c.ladaTelefono),
    identificacionTipo: blankable(id?.tipo),
    identificacionNumero: blankable(id?.numero),
    identificacionVigencia: blankable(id?.vigencia),
    empresaNombre: blankable(emp?.nombre),
    registroPatronal: blankable(emp?.registroPatronal),
    empresaLada: blankable(emp?.lada),
    empresaTelefono: blankable(emp?.telefono),
    empresaExtension: blankable(emp?.extension),
    domicilioLibre: composeDireccionLibre(snapshot),
    calle:
      blankable(viv?.calle) ||
      blankable(viv?.direccionCompleta, { collapseSpaces: true }),
    noExt: blankable(viv?.noExt),
    noInt: blankable(viv?.noInt),
    lote: blankable(viv?.lote),
    manzana: blankable(viv?.manzana),
    colonia: blankable(viv?.colonia),
    entidad: blankable(viv?.entidad),
    municipio: blankable(viv?.municipio),
    cp: blankable(viv?.cp),
    propuesta,
    propuestaLines,
    montoMejoravit,
    plazo: formatPlazoPrint(snapshot.credito),
    ref1: mapRef(refs[0]),
    ref2: mapRef(refs[1]),
    beneficiario: mapBen(snapshot.beneficiario),
  };
}
