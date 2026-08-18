import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  DIRECCION_PARITY_FIELDS,
  PARSE_DIRECCION_MX_FIXTURES,
  normalizeSqlText,
  toParityFields,
  type DireccionParityFields,
} from "./parse-direccion-mx.fixtures.ts";
import { parseDireccionMxParaSolicitud } from "./parse-direccion-mx.ts";

const DB_HOST = process.env.SUPABASE_DB_HOST ?? "127.0.0.1";
const DB_PORT = process.env.SUPABASE_DB_PORT ?? "54322";
const DB_USER = process.env.SUPABASE_DB_USER ?? "postgres";
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD ?? "postgres";
const DB_NAME = process.env.SUPABASE_DB_NAME ?? "postgres";

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlParse(raw: string): DireccionParityFields {
  const proc = spawnSync(
    "psql",
    [
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      DB_HOST,
      "-p",
      DB_PORT,
      "-U",
      DB_USER,
      "-d",
      DB_NAME,
      "-t",
      "-A",
      "-c",
      `SELECT public.infonavit_parse_direccion_mx(${sqlLiteral(raw)}::text);`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: DB_PASSWORD },
    },
  );
  if (proc.status !== 0) {
    throw new Error(
      `psql infonavit_parse_direccion_mx failed: ${proc.stderr || proc.stdout}`,
    );
  }
  const line = (proc.stdout ?? "").trim();
  const json = JSON.parse(line) as Record<string, unknown>;
  return {
    direccionCompleta: normalizeSqlText(json.direccionCompleta),
    calle: normalizeSqlText(json.calle),
    noExt: normalizeSqlText(json.noExt),
    noInt: normalizeSqlText(json.noInt),
    lote: normalizeSqlText(json.lote),
    manzana: normalizeSqlText(json.manzana),
    colonia: normalizeSqlText(json.colonia),
    cp: normalizeSqlText(json.cp),
    municipio: normalizeSqlText(json.municipio),
    entidad: normalizeSqlText(json.entidad),
  };
}

describe("P189 parse dirección SQL ↔ TS parity — 18 fixtures", () => {
  it("suite tiene exactamente 18 fixtures", () => {
    assert.equal(PARSE_DIRECCION_MX_FIXTURES.length, 18);
  });

  for (const fx of PARSE_DIRECCION_MX_FIXTURES) {
    it(`parity ${fx.id}`, () => {
      const ts = toParityFields(parseDireccionMxParaSolicitud(fx.raw));
      const sql = sqlParse(fx.raw);
      for (const key of DIRECCION_PARITY_FIELDS) {
        assert.equal(ts[key], fx.expected[key], `TS ${fx.id}.${key}`);
        assert.equal(sql[key], fx.expected[key], `SQL ${fx.id}.${key}`);
        assert.equal(sql[key], ts[key], `SQL↔TS ${fx.id}.${key}`);
      }
    });
  }
});
