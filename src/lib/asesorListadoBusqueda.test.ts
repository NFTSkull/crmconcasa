import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesAsesorListadoBusqueda } from "./asesorListadoBusqueda";

const ernesto = {
  cliente_nombre: "Ernesto García",
  nss: "1234-567-8901",
  telefono_cliente: "81 1234 5678",
  programa: "Mejoravit",
};

const maria = {
  cliente_nombre: "María López",
  nss: "98765432101",
  telefono_cliente: "5550001111",
  programa: "Compra de casa",
};

describe("matchesAsesorListadoBusqueda", () => {
  it("término vacío coincide con todos", () => {
    assert.equal(matchesAsesorListadoBusqueda(ernesto, ""), true);
    assert.equal(matchesAsesorListadoBusqueda(ernesto, "   "), true);
  });

  it("filtra por nombre sin coincidir con todos (bug P091 / includes(\"\"))", () => {
    assert.equal(matchesAsesorListadoBusqueda(ernesto, "ernesto"), true);
    assert.equal(matchesAsesorListadoBusqueda(maria, "ernesto"), false);
  });

  it("filtra por programa", () => {
    assert.equal(matchesAsesorListadoBusqueda(ernesto, "mejoravit"), true);
    assert.equal(matchesAsesorListadoBusqueda(maria, "mejoravit"), false);
  });

  it("P088: busca NSS por dígitos ignorando guiones/espacios", () => {
    assert.equal(matchesAsesorListadoBusqueda(ernesto, "12345678901"), true);
    assert.equal(matchesAsesorListadoBusqueda(ernesto, "567-890"), true);
    assert.equal(matchesAsesorListadoBusqueda(maria, "12345678901"), false);
  });

  it("P088: busca teléfono por dígitos", () => {
    assert.equal(matchesAsesorListadoBusqueda(ernesto, "811234"), true);
    assert.equal(matchesAsesorListadoBusqueda(maria, "811234"), false);
  });

  it("no usa match vacío de dígitos cuando el término es solo letras", () => {
    // Si se hiciera digitsOnly("ernesto") === "" y "".includes(""), fallaría.
    assert.equal(matchesAsesorListadoBusqueda(maria, "xyznoexiste"), false);
  });
});
