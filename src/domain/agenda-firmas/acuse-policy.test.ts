import { describe, expect, it } from "vitest";
import { shouldShowAcusePendienteFirmas } from "./acuse-policy";

describe("agenda firmas — política Acuse por perfil", () => {
  it("externo no muestra Acuse pendiente aunque falte", () => {
    expect(
      shouldShowAcusePendienteFirmas({
        actorClasificacion: "externo",
        acusePendienteSubir: true,
      }),
    ).toBe(false);
  });

  it("interno conserva aviso cuando falta Acuse", () => {
    expect(
      shouldShowAcusePendienteFirmas({
        actorClasificacion: "interno",
        acusePendienteSubir: true,
      }),
    ).toBe(true);
  });

  it("si no falta Acuse nunca muestra aviso", () => {
    expect(
      shouldShowAcusePendienteFirmas({
        actorClasificacion: "interno",
        acusePendienteSubir: false,
      }),
    ).toBe(false);
  });

  it("unknown no inventa requisito de Acuse", () => {
    expect(
      shouldShowAcusePendienteFirmas({
        actorClasificacion: "unknown",
        acusePendienteSubir: true,
      }),
    ).toBe(false);
  });
});
