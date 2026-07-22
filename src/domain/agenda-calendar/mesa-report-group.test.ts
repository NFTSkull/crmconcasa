import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fallbackReportGroupFromKind,
  MESA_AGENDA_REPORT_GROUP_LABELS,
  MESA_AGENDA_REPORT_GROUP_ORDER,
  resolveMesaAgendaReportGroup,
} from "./mesa-report-group";

test("fallbackReportGroupFromKind cubre los tres kind operativos", () => {
  assert.equal(fallbackReportGroupFromKind("biometricos"), "biometricos");
  assert.equal(fallbackReportGroupFromKind("firmas"), "firmas");
  assert.equal(fallbackReportGroupFromKind("notificacion"), "notificacion");
  assert.equal(fallbackReportGroupFromKind("otro"), "biometricos");
});

test("P110: resolve usa fallback de kind (ignora report_group no especial)", () => {
  assert.equal(
    resolveMesaAgendaReportGroup({
      reportGroup: "firmas",
      kind: "biometricos",
    }),
    "biometricos",
  );
  assert.equal(
    resolveMesaAgendaReportGroup({
      reportGroup: "biometricos",
      kind: "firmas",
    }),
    "firmas",
  );
  assert.equal(
    resolveMesaAgendaReportGroup({ reportGroup: null, kind: "firmas" }),
    "firmas",
  );
  assert.equal(
    resolveMesaAgendaReportGroup({ reportGroup: null, kind: "biometricos" }),
    "biometricos",
  );
  assert.equal(
    resolveMesaAgendaReportGroup({ reportGroup: null, kind: "notificacion" }),
    "notificacion",
  );
});

test("P110: conserva especiales históricos inscripción y trámite completo", () => {
  assert.equal(
    resolveMesaAgendaReportGroup({
      reportGroup: "inscripcion",
      kind: "biometricos",
    }),
    "inscripcion",
  );
  assert.equal(
    resolveMesaAgendaReportGroup({
      reportGroup: "biometricos_tramite_completo",
      kind: "biometricos",
    }),
    "biometricos_tramite_completo",
  );
});

test("labels y orden de bloques Excel", () => {
  assert.equal(
    MESA_AGENDA_REPORT_GROUP_LABELS.biometricos_tramite_completo,
    "BIOMÉTRICOS / TRÁMITE COMPLETO",
  );
  assert.deepEqual([...MESA_AGENDA_REPORT_GROUP_ORDER], [
    "biometricos_tramite_completo",
    "biometricos",
    "inscripcion",
    "firmas",
    "notificacion",
  ]);
});
