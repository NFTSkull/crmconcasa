export const MESA_ORIGEN_FILTER_CAPABILITY = "ver_externos_mesa";

export function canFilterMesaOrigen(params: {
  mockRole?: string | null;
  sessionRole?: string | null;
  hasExternalCapability?: boolean;
}): boolean {
  const mockRole = String(params.mockRole ?? "").trim();
  const sessionRole = String(params.sessionRole ?? "").trim();

  if (mockRole === "mesa_control_admin" || mockRole === "mesa_control") {
    return true;
  }

  if (sessionRole === "mesa_admin" || sessionRole === "super_admin") {
    return true;
  }

  return sessionRole === "mesa_interno" && params.hasExternalCapability === true;
}
