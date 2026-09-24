/**
 * Candado in-process por expediente: evita dos validaciones SAT concurrentes
 * (doble click / dos pestañas en la misma instancia).
 */
export function createFiscalValidationInFlightGuard(): {
  tryAcquire: (expedienteId: string) => boolean;
  release: (expedienteId: string) => void;
  isInFlight: (expedienteId: string) => boolean;
} {
  const inFlight = new Set<string>();
  return {
    tryAcquire(expedienteId: string) {
      const id = String(expedienteId ?? "").trim();
      if (!id || inFlight.has(id)) return false;
      inFlight.add(id);
      return true;
    },
    release(expedienteId: string) {
      inFlight.delete(String(expedienteId ?? "").trim());
    },
    isInFlight(expedienteId: string) {
      return inFlight.has(String(expedienteId ?? "").trim());
    },
  };
}

/** Guard compartido por el proceso de la route enviar-mesa-fiscal. */
export const fiscalValidationInFlight = createFiscalValidationInFlightGuard();
