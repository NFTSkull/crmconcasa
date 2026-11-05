import type { ReactNode } from "react";

/** Compra de casas: módulo del asesor, con autenticación y RLS en cada pantalla. */
export default function CasasAsesoresLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
