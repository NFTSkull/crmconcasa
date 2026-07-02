import assert from "node:assert/strict";
import test from "node:test";
import type { ExpedienteClienteDatos } from "./types";

/**
 * Tests puros de shape/normalización (sin `window`).
 * Nota: el repo real usa `localStorage` y `CustomEvent` en browser; aquí validamos el modelo
 * con objetos que representan lo que quedaría serializado.
 */

function isExpedienteClienteDatosShape(x: unknown): x is ExpedienteClienteDatos {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.expedienteId !== "string") return false;
  if (!o.datos || typeof o.datos !== "object") return false;
  const d = o.datos as Record<string, unknown>;
  return (
    typeof d.nombreCliente === "string" &&
    typeof d.nss === "string" &&
    typeof d.curp === "string" &&
    (typeof d.rfc === "string" || d.rfc === undefined) &&
    typeof d.celular === "string" &&
    typeof d.correo === "string" &&
    typeof d.empresa === "string" &&
    typeof d.registroPatronal === "string" &&
    typeof d.telefonoEmpresa === "string" &&
    Array.isArray(d.referencias) &&
    typeof d.beneficiario === "object" &&
    d.beneficiario != null &&
    typeof (d.beneficiario as Record<string, unknown>).nombre === "string" &&
    typeof (d.beneficiario as Record<string, unknown>).parentesco === "string" &&
    typeof d.direccionEmpresa === "object" &&
    d.direccionEmpresa != null &&
    typeof (d.direccionEmpresa as Record<string, unknown>).calle === "string" &&
    typeof (d.direccionEmpresa as Record<string, unknown>).colonia === "string" &&
    typeof (d.direccionEmpresa as Record<string, unknown>).municipio === "string" &&
    typeof (d.direccionEmpresa as Record<string, unknown>).cp === "string" &&
    (o.estado === "pendiente" ||
      o.estado === "completo" ||
      o.estado === "validado" ||
      o.estado === "rechazado") &&
    typeof o.updatedAt === "string" &&
    typeof o.updatedBy === "string"
  );
}

test("ExpedienteClienteDatos: shape mínimo válido", () => {
  const sample: ExpedienteClienteDatos = {
    expedienteId: "exp-1",
    datos: {
      nombreCliente: "Juan Pérez",
      nss: "12345678901",
      curp: "PEPJ800101HDFRRN09",
      rfc: "XAXX010101000",
      celular: "5512345678",
      correo: "juan@example.com",
      empresa: "ACME",
      registroPatronal: "RP-1",
      telefonoEmpresa: "5555555555",
      referencias: [{ nombre: "Ref 1", celular: "5511111111" }],
      beneficiario: { nombre: "Ana", parentesco: "Esposa" },
      direccionEmpresa: {
        calle: "Calle 1",
        colonia: "Centro",
        municipio: "CDMX",
        cp: "01000",
      },
      porcentajeCobro: "10",
      metodoPago: "transferencia",
    },
    estado: "completo",
    updatedAt: new Date().toISOString(),
    updatedBy: "asesor@test",
  };

  assert.equal(isExpedienteClienteDatosShape(sample), true);
});

