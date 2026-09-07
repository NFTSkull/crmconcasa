import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClienteDatosDraftKey,
  CLIENTE_DATOS_DRAFT_VERSION,
  clienteDatosDraftDiffersFromOfficial,
  flushClienteDatosDraftSnapshot,
  parseClienteDatosDraft,
  readClienteDatosDraft,
  removeClienteDatosDraft,
  shouldAutoRestoreClienteDatosDraft,
  shouldSkipClienteDatosOfficialRehydrate,
  writeClienteDatosDraft,
  type ClienteDatosDraft,
} from "./clienteDatosDraftLocalStorage";

type LS = {
  store: Map<string, string>;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
};

function installLocalStorage(): LS {
  const store = new Map<string, string>();
  const ls: LS = {
    store,
    getItem(k) {
      return store.has(k) ? store.get(k)! : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
  };
  (globalThis as unknown as { window: { localStorage: LS } }).window = {
    localStorage: ls,
  };
  return ls;
}

function uninstallLocalStorage() {
  delete (globalThis as unknown as { window?: unknown }).window;
}

const EMPTY = {
  nombreCliente: "",
  nss: "",
  curp: "",
  rfc: "",
  celular: "",
  correo: "",
  empresa: "",
  registroPatronal: "",
  telefonoEmpresa: "",
  referencias: [] as Array<{ nombre: string; celular: string }>,
  beneficiario: { nombre: "", parentesco: "" },
  direccionEmpresa: { calle: "", colonia: "", municipio: "", cp: "" },
} as unknown as ClienteDatosDraft["clienteDatos"];

test("CASO A — captura parcial + refresh: restore automático sin click", () => {
  const ls = installLocalStorage();
  try {
    const user = "asesor@concasa.mx";
    const exp = "exp-a";
    writeClienteDatosDraft(
      user,
      exp,
      {
        ...EMPTY,
        nombreCliente: "Ana Pérez",
        celular: "5512345678",
        empresa: "ACME",
        referencias: [{ nombre: "Ref Uno", celular: "5599999999" }],
      } as ClienteDatosDraft["clienteDatos"],
      "",
    );
    const draft = readClienteDatosDraft(user, exp);
    assert.ok(draft);
    const official = { ...EMPTY };
    assert.equal(
      shouldAutoRestoreClienteDatosDraft(draft!, official, "", ""),
      true,
    );
    // No hay “Restaurar”: la decisión es apply automático.
    assert.equal(draft!.clienteDatos.nombreCliente, "Ana Pérez");
    assert.equal(draft!.clienteDatos.empresa, "ACME");
  } finally {
    uninstallLocalStorage();
    void ls;
  }
});

test("CASO B — flush antes del debounce conserva última tecla", () => {
  installLocalStorage();
  try {
    const user = "asesor@concasa.mx";
    const exp = "exp-b";
    const snap = {
      clienteDatos: {
        ...EMPTY,
        nombreCliente: "ÚltimaTecla",
      } as ClienteDatosDraft["clienteDatos"],
      direccionOpcional: "Calle 1",
      telefonoCasa: "8111111111",
    };
    flushClienteDatosDraftSnapshot(user, exp, snap, {
      persistTelefonoCasa: true,
    });
    const draft = readClienteDatosDraft(user, exp);
    assert.equal(draft?.clienteDatos.nombreCliente, "ÚltimaTecla");
    assert.equal(draft?.telefonoCasa, "8111111111");
  } finally {
    uninstallLocalStorage();
  }
});

test("CASO C — salir y volver mismo user+expediente recupera borrador", () => {
  installLocalStorage();
  try {
    const user = "asesor@concasa.mx";
    const exp = "exp-c";
    writeClienteDatosDraft(user, exp, {
      ...EMPTY,
      nombreCliente: "Vuelta",
    } as ClienteDatosDraft["clienteDatos"]);
    // Simula unmount/remount: solo re-read.
    const again = readClienteDatosDraft(user, exp);
    assert.equal(again?.clienteDatos.nombreCliente, "Vuelta");
  } finally {
    uninstallLocalStorage();
  }
});

test("CASO D — aislamiento user y expediente", () => {
  installLocalStorage();
  try {
    writeClienteDatosDraft("user-a@x.com", "exp-1", {
      ...EMPTY,
      nombreCliente: "A1",
    } as ClienteDatosDraft["clienteDatos"]);
    writeClienteDatosDraft("user-b@x.com", "exp-1", {
      ...EMPTY,
      nombreCliente: "B1",
    } as ClienteDatosDraft["clienteDatos"]);
    writeClienteDatosDraft("user-a@x.com", "exp-2", {
      ...EMPTY,
      nombreCliente: "A2",
    } as ClienteDatosDraft["clienteDatos"]);

    assert.equal(
      readClienteDatosDraft("user-a@x.com", "exp-1")?.clienteDatos.nombreCliente,
      "A1",
    );
    assert.equal(
      readClienteDatosDraft("user-b@x.com", "exp-1")?.clienteDatos.nombreCliente,
      "B1",
    );
    assert.equal(
      readClienteDatosDraft("user-a@x.com", "exp-2")?.clienteDatos.nombreCliente,
      "A2",
    );
    assert.notEqual(
      buildClienteDatosDraftKey("user-a@x.com", "exp-1"),
      buildClienteDatosDraftKey("user-b@x.com", "exp-1"),
    );
  } finally {
    uninstallLocalStorage();
  }
});

test("CASO E — save OK limpia borrador", () => {
  installLocalStorage();
  try {
    const user = "asesor@concasa.mx";
    const exp = "exp-e";
    writeClienteDatosDraft(user, exp, {
      ...EMPTY,
      nombreCliente: "Temp",
    } as ClienteDatosDraft["clienteDatos"]);
    assert.ok(readClienteDatosDraft(user, exp));
    removeClienteDatosDraft(user, exp);
    assert.equal(readClienteDatosDraft(user, exp), null);
  } finally {
    uninstallLocalStorage();
  }
});

test("CASO F/G — save/validación fallida: borrador permanece", () => {
  installLocalStorage();
  try {
    const user = "asesor@concasa.mx";
    const exp = "exp-f";
    writeClienteDatosDraft(user, exp, {
      ...EMPTY,
      nombreCliente: "Sigue",
    } as ClienteDatosDraft["clienteDatos"]);
    // Simula fallo: no se llama remove.
    assert.equal(
      readClienteDatosDraft(user, exp)?.clienteDatos.nombreCliente,
      "Sigue",
    );
  } finally {
    uninstallLocalStorage();
  }
});

test("CASO H — dirty bloquea rehidratación oficial auxiliar", () => {
  assert.equal(
    shouldSkipClienteDatosOfficialRehydrate({
      hydratedForExpedienteId: "exp-1",
      expedienteId: "exp-1",
      hasUserEdited: true,
      force: false,
    }),
    true,
  );
  assert.equal(
    shouldSkipClienteDatosOfficialRehydrate({
      hydratedForExpedienteId: "exp-1",
      expedienteId: "exp-1",
      hasUserEdited: true,
      force: true,
    }),
    false,
  );
  assert.equal(
    shouldSkipClienteDatosOfficialRehydrate({
      hydratedForExpedienteId: null,
      expedienteId: "exp-1",
      hasUserEdited: true,
      force: false,
    }),
    false,
  );
  assert.equal(
    shouldSkipClienteDatosOfficialRehydrate({
      hydratedForExpedienteId: "exp-1",
      expedienteId: "exp-2",
      hasUserEdited: true,
      force: false,
    }),
    false,
  );
});

test("CASO I — teléfono casa interno en borrador sobrevive", () => {
  installLocalStorage();
  try {
    const user = "asesor@concasa.mx";
    const exp = "exp-i";
    writeClienteDatosDraft(
      user,
      exp,
      { ...EMPTY, celular: "5511111111" } as ClienteDatosDraft["clienteDatos"],
      "",
      "8188888888",
    );
    const draft = readClienteDatosDraft(user, exp);
    assert.equal(draft?.telefonoCasa, "8188888888");
    assert.equal(
      shouldAutoRestoreClienteDatosDraft(
        draft!,
        { ...EMPTY, celular: "5511111111" } as ClienteDatosDraft["clienteDatos"],
        "",
        "",
      ),
      true,
    );
    // Casa distinta de celular → no colisión en snapshot.
    assert.notEqual(draft?.telefonoCasa, draft?.clienteDatos.celular);
  } finally {
    uninstallLocalStorage();
  }
});

test("CASO J — externo: telefonoCasa histórico en draft no entra a diff de validación requerida", () => {
  // El draft puede contener telefonoCasa viejo; el caller externo no lo persiste
  // en autosave (persistTelefonoCasa:false) y no monta la sección.
  installLocalStorage();
  try {
    const user = "externo@concasa.mx";
    const exp = "exp-j";
    flushClienteDatosDraftSnapshot(
      user,
      exp,
      {
        clienteDatos: {
          ...EMPTY,
          nombreCliente: "Externo",
        } as ClienteDatosDraft["clienteDatos"],
        direccionOpcional: "",
        telefonoCasa: "8111111111",
      },
      { persistTelefonoCasa: false },
    );
    const draft = readClienteDatosDraft(user, exp);
    assert.equal(draft?.clienteDatos.nombreCliente, "Externo");
    assert.equal(draft?.telefonoCasa, undefined);
  } finally {
    uninstallLocalStorage();
  }
});

test("CASO K — tras remove, refresh no reaparece borrador viejo", () => {
  installLocalStorage();
  try {
    const user = "asesor@concasa.mx";
    const exp = "exp-k";
    writeClienteDatosDraft(user, exp, {
      ...EMPTY,
      nombreCliente: "Viejo",
    } as ClienteDatosDraft["clienteDatos"]);
    removeClienteDatosDraft(user, exp);
    assert.equal(readClienteDatosDraft(user, exp), null);
  } finally {
    uninstallLocalStorage();
  }
});

test("compat v1: draft sin telefonoCasa sigue parseable", () => {
  const raw = JSON.stringify({
    expedienteId: "exp-legacy",
    updatedAt: "2026-07-06T12:00:00.000Z",
    draftVersion: CLIENTE_DATOS_DRAFT_VERSION,
    clienteDatos: { nombreCliente: "Legacy" },
    direccionOpcional: "Calle vieja",
  });
  const draft = parseClienteDatosDraft(raw);
  assert.ok(draft);
  assert.equal(draft?.telefonoCasa, undefined);
  assert.equal(draft?.clienteDatos.nombreCliente, "Legacy");
});

test("diff incluye telefonoCasa", () => {
  const base: ClienteDatosDraft = {
    expedienteId: "exp-1",
    updatedAt: "2026-07-07T10:00:00.000Z",
    draftVersion: 1,
    clienteDatos: { ...EMPTY, nombreCliente: "Ana" } as ClienteDatosDraft["clienteDatos"],
    direccionOpcional: "Calle 1",
    telefonoCasa: "8111111111",
  };
  assert.equal(
    clienteDatosDraftDiffersFromOfficial(base, base.clienteDatos, "Calle 1", ""),
    true,
  );
  assert.equal(
    clienteDatosDraftDiffersFromOfficial(
      base,
      base.clienteDatos,
      "Calle 1",
      "8111111111",
    ),
    false,
  );
});
