/** Mapeo canónico paso visible → etapas internas (espejo SQL P137). */

export function expandIngresosVisibleStepToEtapas(paso: number): number[] {
  switch (paso) {
    case 1:
      return [1];
    case 2:
      return [2];
    case 3:
      return [3, 4];
    case 4:
      return [5];
    case 5:
      return [6];
    case 6:
      return [7];
    case 7:
      return [8];
    case 8:
      return [9];
    case 9:
      return [10];
    case 10:
      return [11];
    case 11:
      return [12];
    default:
      return [];
  }
}

export function expandIngresosFromStepToEtapas(pasoMinimo: number): number[] {
  const set = new Set<number>();
  for (let p = pasoMinimo; p <= 11; p += 1) {
    for (const e of expandIngresosVisibleStepToEtapas(p)) set.add(e);
  }
  return [...set].sort((a, b) => a - b);
}
