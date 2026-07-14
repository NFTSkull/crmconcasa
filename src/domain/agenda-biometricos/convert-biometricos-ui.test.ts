import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  canShowConvertBiometricosToNotificacion,
} from "./biometricos-booking-actions";
import { isAsesorPendienteAgendarBiometricos } from "@/lib/asesorTareasPendientes";

describe("P070 convert UI gates + card wiring", () => {
  it("etapa 4 con bio activo muestra conversión; sin bio no", () => {
    assert.equal(
      canShowConvertBiometricosToNotificacion({
        etapaActual: 4,
        hasActiveBiometricosBooking: true,
      }),
      true,
    );
    assert.equal(
      canShowConvertBiometricosToNotificacion({
        etapaActual: 4,
        hasActiveBiometricosBooking: false,
      }),
      false,
    );
  });

  it("etapa 3 legacy con bio activo muestra conversión", () => {
    assert.equal(
      canShowConvertBiometricosToNotificacion({
        etapaActual: 3,
        hasActiveBiometricosBooking: true,
      }),
      true,
    );
  });

  it("etapa 5 no muestra conversión", () => {
    assert.equal(
      canShowConvertBiometricosToNotificacion({
        etapaActual: 5,
        hasActiveBiometricosBooking: true,
      }),
      false,
    );
  });

  it("notif activa excluye chip Agendar biométricos", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos({
        expedienteId: "exp-1",
        submittedToMesa: true,
        etapaActual: 3,
        hasActiveNotificacionBooking: true,
        agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
        dataModeSupabase: true,
      }),
      false,
    );
  });

  it("AgendaBiometricosSupabaseCard: UI + una sola RPC convert", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/asesor/AgendaBiometricosSupabaseCard.tsx"),
      "utf8",
    );
    assert.match(src, /Cambiar a Notificación extraordinaria/);
    assert.match(src, /12:00 PM/);
    assert.match(src, /cancelará la cita biométrica/);
    assert.match(src, /etapa 3/);
    assert.match(src, /convertBiometricosToNotificacion/);
    assert.match(src, /canShowConvertBiometricosToNotificacion/);
    assert.match(src, /setSaving\(true\)/);
    assert.match(src, /onUpdated\(\)/);
    assert.match(src, /await load\(\)/);
    // sin llamadas separadas en el handler de conversión
    const convertBlock = src.slice(
      src.indexOf("handleConvertToNotificacion"),
      src.indexOf("showEtapa3Tabs"),
    );
    assert.match(convertBlock, /convertBiometricosToNotificacion/);
    assert.doesNotMatch(convertBlock, /cancelBiometricos\(/);
    assert.doesNotMatch(convertBlock, /bookNotificacionEtapa3\(/);
    assert.doesNotMatch(convertBlock, /driveValidated|Validado en Drive/);
  });

  it("tabs Bio/Notificación solo en etapa 3 sin bookings activos", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/asesor/AgendaBiometricosSupabaseCard.tsx"),
      "utf8",
    );
    assert.match(
      src,
      /showEtapa3Tabs = etapaActual === 3 && !activeBooking && !activeNotificacion/,
    );
  });

  it("repo convierte solo vía convert_biometricos_to_notificacion", () => {
    const src = readFileSync(
      join(process.cwd(), "src/domain/agenda-biometricos/supabase-booking.repo.ts"),
      "utf8",
    );
    const block = src.slice(
      src.indexOf("convertBiometricosToNotificacion"),
      src.indexOf("cancelNotificacionEtapa3"),
    );
    assert.match(block, /convert_biometricos_to_notificacion/);
    assert.doesNotMatch(block, /cancel_biometricos/);
    assert.doesNotMatch(block, /book_notificacion_etapa3/);
  });
});
