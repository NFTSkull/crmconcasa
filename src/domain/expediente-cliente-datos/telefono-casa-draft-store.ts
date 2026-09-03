const telefonoCasaDraftByExpediente = new Map<string, string>();

export function setTelefonoCasaDraft(expedienteId: string, value: string): void {
  const id = String(expedienteId ?? "").trim();
  if (!id) return;
  telefonoCasaDraftByExpediente.set(id, String(value ?? ""));
}

export function getTelefonoCasaDraft(expedienteId: string): string | undefined {
  const id = String(expedienteId ?? "").trim();
  if (!id) return undefined;
  return telefonoCasaDraftByExpediente.get(id);
}

export function clearTelefonoCasaDraft(expedienteId: string): void {
  const id = String(expedienteId ?? "").trim();
  if (!id) return;
  telefonoCasaDraftByExpediente.delete(id);
}
