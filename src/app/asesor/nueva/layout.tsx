"use client";

import type { ReactNode } from "react";

import { isAnetteNssOnlyEmail } from "@/domain/expedientes/anette-nss-only";
import { useSessionRepo } from "@/domain/session";
import { AnetteNssOnlyPrecalPage } from "./anette-nss-only-page";

export default function NuevaPrecalificacionLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { currentUser } = useSessionRepo();

  if (currentUser === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  if (
    currentUser?.role === "asesor" &&
    isAnetteNssOnlyEmail(currentUser.email)
  ) {
    return <AnetteNssOnlyPrecalPage />;
  }

  return <>{children}</>;
}
