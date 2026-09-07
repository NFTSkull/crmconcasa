import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoSource = readFileSync(
  join(process.cwd(), "src/domain/expediente-cliente-datos/supabase.repo.ts"),
  "utf8",
);

function saveCorreccionBlock(): string {
  const start = repoSource.indexOf("async saveCorreccion(");
  const end = repoSource.indexOf("async updateEstado(", start);
  assert.ok(start >= 0, "saveCorreccion debe existir");
  assert.ok(end > start, "updateEstado debe seguir a saveCorreccion");
  return repoSource.slice(start, end);
}

test("externos: corrección omite p_estado al llamar save_cliente_datos_correccion", () => {
  const block = saveCorreccionBlock();
  assert.match(
    block,
    /const \{ p_estado: estadoSoloWrapper, \.\.\.rpcArgsCorreccion \} = rpcArgs;/,
  );
  assert.ok(block.includes('client.rpc("save_cliente_datos_correccion", rpcArgsCorreccion)'));
  assert.ok(!block.includes('client.rpc("save_cliente_datos_correccion", rpcArgs)'));
});

test("internos: corrección conserva p_estado mediante el wrapper atómico", () => {
  const block = saveCorreccionBlock();
  assert.match(
    block,
    /client\.rpc\("asesor_guardar_cliente_datos_con_telefono_casa", \{[\s\S]*\.\.\.rpcArgs,[\s\S]*p_es_correccion: true/,
  );
});
