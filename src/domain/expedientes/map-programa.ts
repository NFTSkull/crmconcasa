import type { ExpedienteProgramaUi } from "./create-expediente.input";

const PROGRAMA_DB_TO_UI: Readonly<Record<string, ExpedienteProgramaUi>> = {
  mejoravit: "Mejoravit",
  subcuenta: "Subcuenta",
  compro_tu_casa: "Compro tu casa",
};

const PROGRAMA_UI_TO_DB: Readonly<Record<ExpedienteProgramaUi, string>> = {
  Mejoravit: "mejoravit",
  Subcuenta: "subcuenta",
  "Compro tu casa": "compro_tu_casa",
};

export function mapProgramaDbToUi(programa: string): string {
  const key = programa.trim().toLowerCase();
  return PROGRAMA_DB_TO_UI[key] ?? programa;
}

export function isProgramaMejoravit(programa: string): boolean {
  return mapProgramaUiToDb(programa) === "mejoravit";
}

export function mapProgramaUiToDb(programa: string): string {
  const trimmed = programa.trim();
  if (trimmed in PROGRAMA_UI_TO_DB) {
    return PROGRAMA_UI_TO_DB[trimmed as ExpedienteProgramaUi];
  }
  const key = trimmed.toLowerCase().replace(/\s+/g, "_");
  if (key in PROGRAMA_DB_TO_UI) {
    return key;
  }
  return trimmed.toLowerCase();
}
