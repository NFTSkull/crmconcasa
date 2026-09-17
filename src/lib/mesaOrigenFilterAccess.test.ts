import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isMesaAdminOrigenFilterRole,
  isSaraKassOrigenOperator,
  shouldShowMesaOperatorOrigenFilter,
} from "./mesaOrigenFilterAccess";

describe("mesaOrigenFilterAccess", () => {
  it("reconoce únicamente a Sara y Kass como operadores internos con filtro", () => {
    assert.equal(
      isSaraKassOrigenOperator({
        email: "mesa.interno03@concasa.mx",
        role: "mesa_control_interno",
      }),
      true,
    );
    assert.equal(
      isSaraKassOrigenOperator({
        email: "MESA.INTERNO04@CONCASA.MX",
        role: "mesa_control_interno",
      }),
      true,
    );
    assert.equal(
      isSaraKassOrigenOperator({
        email: "mesa.interno02@concasa.mx",
        role: "mesa_control_interno",
      }),
      false,
    );
    assert.equal(
      isSaraKassOrigenOperator({
        email: "mesa.interno03@concasa.mx",
        role: "mesa_control_admin",
      }),
      false,
    );
  });

  it("muestra el filtro de Sara/Kass solo en Disponibles y Todo Mesa", () => {
    const base = {
      email: "mesa.interno03@concasa.mx",
      role: "mesa_control_interno",
    };
    assert.equal(
      shouldShowMesaOperatorOrigenFilter({ ...base, opsFilter: "sin_asignar" }),
      true,
    );
    assert.equal(
      shouldShowMesaOperatorOrigenFilter({ ...base, opsFilter: "todo_mesa" }),
      true,
    );
    assert.equal(
      shouldShowMesaOperatorOrigenFilter({ ...base, opsFilter: "mi_bandeja" }),
      false,
    );
    assert.equal(
      shouldShowMesaOperatorOrigenFilter({ ...base, opsFilter: "en_trabajo" }),
      false,
    );
  });

  it("preserva roles administrativos existentes", () => {
    assert.equal(isMesaAdminOrigenFilterRole("mesa_control_admin"), true);
    assert.equal(isMesaAdminOrigenFilterRole("mesa_control"), true);
    assert.equal(isMesaAdminOrigenFilterRole("mesa_control_interno"), false);
    assert.equal(isMesaAdminOrigenFilterRole("mesa_control_externo"), false);
  });
});
