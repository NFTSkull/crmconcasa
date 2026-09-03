function normalizeTelefonoMexico(input: string): string {
  let digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("52")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

/**
 * Detecta el caso legado donde Datos Generales heredó automáticamente
 * `expedientes.telefono_cliente` dentro de `celular`.
 */
export function celularFueAutopopuladoDesdeTelefonoCasa(
  telefonoCasa: string,
  celular: string,
): boolean {
  const casa = normalizeTelefonoMexico(telefonoCasa);
  const cel = normalizeTelefonoMexico(celular);
  return /^\d{10}$/.test(casa) && /^\d{10}$/.test(cel) && casa === cel;
}

/**
 * Limpia solamente el input controlado de Celular cuando coincide con Casa.
 * Dispara `input` para que React actualice el estado real del formulario;
 * no escribe DB y no toca teléfonos distintos.
 */
export function clearAutopopulatedCelularInput(telefonoCasa: string): boolean {
  if (typeof document === "undefined") return false;
  const input = document.querySelector<HTMLInputElement>('[data-field="celular"] input');
  if (!input || !celularFueAutopopuladoDesdeTelefonoCasa(telefonoCasa, input.value)) {
    return false;
  }

  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) return false;

  setter.call(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
