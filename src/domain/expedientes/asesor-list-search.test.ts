import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  filterAsesorListBySearch,
  matchesAsesorSearch,
  normalizeSearchText,
  onlySearchDigits,
  type AsesorSearchableExpediente,
} from "./asesor-list-search";

const EXP: AsesorSearchableExpediente = {
  cliente_nombre: "María García López",
  nss: "12345678901",
  telefono_cliente: "55 1234 5678",
  programa: "Mejoravit",
};

// --- Normalización ---

test("normalizeSearchText: trim + lowercase; no-string vacío", () => {
  assert.equal(normalizeSearchText("  HOLA  "), "hola");
  assert.equal(normalizeSearchText(null), "");
  assert.equal(normalizeSearchText(undefined), "");
  assert.equal(normalizeSearchText(123), "");
});

test("onlySearchDigits: conserva solo dígitos; no-string vacío", () => {
  assert.equal(onlySearchDigits("123-45-6789-01"), "12345678901");
  assert.equal(onlySearchDigits("NSS 123"), "123");
  assert.equal(onlySearchDigits(null), "");
  assert.equal(onlySearchDigits(undefined), "");
});

// --- Casos obligatorios de NSS (guardado: 12345678901) ---

test("NSS completo coincide", () => {
  assert.equal(matchesAsesorSearch(EXP, "12345678901"), true);
});

test("NSS parcial (prefijo) coincide", () => {
  assert.equal(matchesAsesorSearch(EXP, "123456"), true);
});

test("NSS parcial (sufijo) coincide", () => {
  assert.equal(matchesAsesorSearch(EXP, "678901"), true);
});

test("NSS con espacios coincide", () => {
  assert.equal(matchesAsesorSearch(EXP, "123 456 789 01"), true);
});

test("NSS con guiones coincide", () => {
  assert.equal(matchesAsesorSearch(EXP, "123-45-6789-01"), true);
});

test("NSS inexistente (00000000000) no coincide", () => {
  assert.equal(matchesAsesorSearch(EXP, "00000000000"), false);
});

test("'NSS 12345678901' coincide por sus dígitos", () => {
  // La parte textual "nss 12345678901" no coincide con ningún campo de texto,
  // pero digitsTerm = "12345678901" sí coincide con el NSS almacenado.
  assert.equal(matchesAsesorSearch(EXP, "NSS 12345678901"), true);
});

test("'NSS 00000000000' no genera falso positivo", () => {
  assert.equal(matchesAsesorSearch(EXP, "NSS 00000000000"), false);
});

// --- Regresión: nombre, teléfono, programa ---

test("nombre completo coincide", () => {
  assert.equal(matchesAsesorSearch(EXP, "María García López"), true);
});

test("fragmento del nombre coincide", () => {
  assert.equal(matchesAsesorSearch(EXP, "garcía"), true);
});

test("nombre con mayúsculas/minúsculas mezcladas coincide", () => {
  assert.equal(matchesAsesorSearch(EXP, "mArÍa GaRcÍa"), true);
});

test("teléfono completo coincide", () => {
  assert.equal(matchesAsesorSearch(EXP, "5512345678"), true);
});

test("teléfono con espacios o guiones coincide", () => {
  assert.equal(matchesAsesorSearch(EXP, "55 1234 5678"), true);
  assert.equal(matchesAsesorSearch(EXP, "55-1234-5678"), true);
});

test("programa coincide (case-insensitive)", () => {
  assert.equal(matchesAsesorSearch(EXP, "mejoravit"), true);
});

test("término alfabético inexistente NO devuelve el registro", () => {
  // Bug original: term.replace(/\D/g,"") = "" y "12345678901".includes("") === true,
  // por lo que cualquier texto sin dígitos coincidía con todos los expedientes.
  assert.equal("12345678901".includes(""), true); // premisa del bug
  assert.equal(matchesAsesorSearch(EXP, "zzz inexistente"), false);
});

test("término sin dígitos no activa coincidencias vacías de NSS/teléfono", () => {
  const soloNumeros: AsesorSearchableExpediente = {
    cliente_nombre: "Otro Cliente",
    nss: "99988877766",
    telefono_cliente: "5599887766",
    programa: "Tradicional",
  };
  assert.equal(matchesAsesorSearch(soloNumeros, "garcía"), false);
});

test("búsqueda vacía o con solo espacios devuelve todos", () => {
  assert.equal(matchesAsesorSearch(EXP, ""), true);
  assert.equal(matchesAsesorSearch(EXP, "   "), true);
});

test("campos null/undefined/vacíos no provocan errores", () => {
  const vacio: AsesorSearchableExpediente = {
    cliente_nombre: null,
    nss: undefined,
    telefono_cliente: "",
    programa: null,
  };
  assert.equal(matchesAsesorSearch(vacio, "algo"), false);
  assert.equal(matchesAsesorSearch(vacio, ""), true);
  assert.equal(matchesAsesorSearch({}, "123"), false);
});

test("el helper no muta el expediente recibido", () => {
  const original = {
    cliente_nombre: "  Juan Pérez  ",
    nss: "111-22-333",
    telefono_cliente: "55 0000 0000",
    programa: "Mejoravit",
  };
  const copia = { ...original };
  matchesAsesorSearch(original, "juan");
  assert.deepEqual(original, copia);
});

// --- Composición del listado: búsqueda → filtros → orden → paginación ---

const PAGE_SIZE = 50;

type Row = AsesorSearchableExpediente & {
  id: string;
  createdAt: string;
  resultadoReal: string;
};

function buildLista(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 60; i += 1) {
    rows.push({
      id: `exp-${i}`,
      cliente_nombre: `Cliente ${i}`,
      nss: `0000000${String(1000 + i)}`,
      telefono_cliente: `55000000${String(10 + i)}`,
      programa: i % 2 === 0 ? "Mejoravit" : "Tradicional",
      // createdAt ascendente: exp-0 es el más antiguo.
      createdAt: new Date(2026, 0, 1 + i).toISOString(),
      resultadoReal: i === 55 ? "rechazado_mesa" : "en_tramite",
    });
  }
  return rows;
}

/** Replica el orden de composición de /asesor: búsqueda → filtros → orden desc → slice. */
function componer(
  lista: Row[],
  buscar: string,
  quickPredicate?: (row: Row) => boolean,
  page = 1,
): { pagina: Row[]; filteredTotalCount: number } {
  let filtrados = filterAsesorListBySearch(lista, buscar);
  if (quickPredicate) filtrados = filtrados.filter(quickPredicate);
  const filteredTotalCount = filtrados.length;
  const ordenados = filtrados
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const from = (page - 1) * PAGE_SIZE;
  return { pagina: ordenados.slice(from, from + PAGE_SIZE), filteredTotalCount };
}

test("composición: NSS ubicado después de los primeros 50 aparece en la página 1", () => {
  const lista = buildLista();
  // exp-55 quedaría en la segunda página sin filtro (60 filas, orden desc → posición 5…
  // pero con orden asc de llegada estaría en índice 55 > PAGE_SIZE).
  const targetNss = lista[55]!.nss!;
  const sinBusqueda = componer(lista, "");
  assert.equal(sinBusqueda.filteredTotalCount, 60);
  const { pagina, filteredTotalCount } = componer(lista, targetNss);
  assert.equal(filteredTotalCount, 1);
  assert.equal(pagina.length, 1);
  assert.equal(pagina[0]!.id, "exp-55");
});

test("composición: la búsqueda se aplica antes del slice (no busca solo en la página)", () => {
  const lista = buildLista();
  // Orden desc por createdAt → la página 1 sin búsqueda contiene exp-59..exp-10.
  // exp-5 NO está en la página 1, pero la búsqueda debe encontrarlo.
  const paginaSinBusqueda = componer(lista, "").pagina;
  assert.equal(paginaSinBusqueda.some((r) => r.id === "exp-5"), false);
  const { pagina } = componer(lista, lista[5]!.nss!);
  assert.equal(pagina.some((r) => r.id === "exp-5"), true);
});

test("composición: búsqueda por NSS con filtro rápido activo conserva la intersección", () => {
  const lista = buildLista();
  const targetNss = lista[55]!.nss!; // exp-55 es rechazado_mesa
  const chipEnTramite = (r: Row) => r.resultadoReal === "en_tramite";
  const conChip = componer(lista, targetNss, chipEnTramite);
  // Correctamente excluido por la intersección con el chip, no por fallo del NSS.
  assert.equal(conChip.filteredTotalCount, 0);
  const chipRechazados = (r: Row) => r.resultadoReal === "rechazado_mesa";
  const conChipCorrecto = componer(lista, targetNss, chipRechazados);
  assert.equal(conChipCorrecto.filteredTotalCount, 1);
  assert.equal(conChipCorrecto.pagina[0]!.id, "exp-55");
});

test("composición: filteredTotalCount refleja los resultados reales y no altera la lista base", () => {
  const lista = buildLista();
  const totalCount = lista.length;
  const { filteredTotalCount } = componer(lista, "Mejoravit");
  assert.equal(filteredTotalCount, 30);
  assert.equal(lista.length, totalCount); // totalCount (lista completa) no cambia
});

test("composición: el orden desc por createdAt se conserva con búsqueda activa", () => {
  const lista = buildLista();
  const { pagina } = componer(lista, "Mejoravit");
  for (let i = 1; i < pagina.length; i += 1) {
    assert.ok(
      new Date(pagina[i - 1]!.createdAt).getTime() >=
        new Date(pagina[i]!.createdAt).getTime(),
    );
  }
});

test("composición: la fila filtrada conserva el mismo id para navegación", () => {
  const lista = buildLista();
  const { pagina } = componer(lista, lista[7]!.nss!);
  assert.equal(pagina[0]!.id, lista[7]!.id);
  assert.equal(pagina[0], lista[7]); // misma referencia: sin copias ni mutaciones
});

test("filterAsesorListBySearch: búsqueda vacía devuelve copia con todos los registros", () => {
  const lista = buildLista();
  const out = filterAsesorListBySearch(lista, "");
  assert.equal(out.length, lista.length);
  assert.notEqual(out, lista); // nueva instancia; no muta la original
});

// --- Integración estructural mínima con src/app/asesor/page.tsx ---
// Comportamientos que solo existen en el componente (reset de página, limpiar
// filtros, orden búsqueda→slice). Se validan sobre la estructura real del
// archivo, complementando las pruebas de comportamiento del helper.

const PAGE_SRC = readFileSync(
  join(process.cwd(), "src", "app", "asesor", "page.tsx"),
  "utf8",
);

test("page.tsx: el buscador usa matchesAsesorSearch dentro de expedientesFiltrados", () => {
  const filtradosIdx = PAGE_SRC.indexOf("const expedientesFiltrados = useMemo(");
  assert.ok(filtradosIdx > -1);
  const matchIdx = PAGE_SRC.indexOf("matchesAsesorSearch(p, term)");
  assert.ok(matchIdx > filtradosIdx, "la búsqueda vive en expedientesFiltrados");
  // El OR manual con includes sobre dígitos ya no existe.
  assert.equal(PAGE_SRC.includes('includes(term.replace(/\\D/g, ""))'), false);
});

test("page.tsx: la búsqueda ocurre antes de la paginación (slice en expedientesPagina)", () => {
  const filtradosIdx = PAGE_SRC.indexOf("const expedientesFiltrados = useMemo(");
  const paginaIdx = PAGE_SRC.indexOf("const expedientesPagina = useMemo(");
  const sliceIdx = PAGE_SRC.indexOf("return sorted.slice(from, from + PAGE_SIZE)");
  assert.ok(filtradosIdx > -1 && paginaIdx > -1 && sliceIdx > -1);
  assert.ok(filtradosIdx < paginaIdx && paginaIdx < sliceIdx);
  const paginaBlock = PAGE_SRC.slice(paginaIdx, sliceIdx);
  assert.ok(
    paginaBlock.includes("expedientesFiltrados"),
    "la página se deriva de la lista ya filtrada",
  );
});

test("page.tsx: cambiar la búsqueda regresa a la página 1 (updateFilters → setPage(1))", () => {
  const updateIdx = PAGE_SRC.indexOf("const updateFilters = (");
  assert.ok(updateIdx > -1);
  const updateBlock = PAGE_SRC.slice(updateIdx, updateIdx + 300);
  assert.ok(updateBlock.includes("setPage(1)"));
  // El input de búsqueda usa updateFilters (no setFilters directo).
  assert.ok(PAGE_SRC.includes("updateFilters((prev) => ({ ...prev, buscar: e.target.value }))"));
});

test("page.tsx: Limpiar filtros restaura búsqueda, chips y página", () => {
  const clearIdx = PAGE_SRC.indexOf("const handleClearFilters = () => {");
  assert.ok(clearIdx > -1);
  const clearBlock = PAGE_SRC.slice(clearIdx, clearIdx + 300);
  assert.ok(clearBlock.includes("setFilters(INITIAL_FILTERS)"));
  assert.ok(clearBlock.includes('setQuickFilter("todos")'));
  assert.ok(clearBlock.includes("setPage(1)"));
  // INITIAL_FILTERS incluye buscar: "" (la búsqueda también se limpia).
  const initIdx = PAGE_SRC.indexOf("const INITIAL_FILTERS: AsesorFiltersState = {");
  const initBlock = PAGE_SRC.slice(initIdx, initIdx + 300);
  assert.ok(initBlock.includes('buscar: ""'));
});

test("page.tsx: filteredTotalCount sale de los filtrados; KPIs y totalCount de la lista completa", () => {
  assert.ok(
    PAGE_SRC.includes("const filteredTotalCount = expedientesFiltrados.length"),
  );
  const kpisIdx = PAGE_SRC.indexOf("const kpis = useMemo(");
  assert.ok(kpisIdx > -1);
  const kpisBlock = PAGE_SRC.slice(kpisIdx, kpisIdx + 1600);
  assert.ok(kpisBlock.includes("const total = totalCount"));
  assert.equal(
    kpisBlock.includes("expedientesFiltrados"),
    false,
    "los KPIs no dependen de la búsqueda",
  );
});
