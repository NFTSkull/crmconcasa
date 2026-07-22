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

test("resolveMesaAgendaReportGroup prioriza valor persistido", () => {
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
  assert.equal(
    resolveMesaAgendaReportGroup({ reportGroup: null, kind: "firmas" }),
    "firmas",
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
