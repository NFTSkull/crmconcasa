/**
 * Probe local de constancia CURP (flags only, sin PII en stdout).
 * Uso: npx tsx scripts/probe-curp-constancia-local.ts [/ruta/al.pdf]
 * Default: /tmp/curp-certificada-prueba.pdf
 */
import { readFileSync, existsSync } from "node:fs";
import {
  extractPdfEmbeddedText,
  parseConstanciaCurpText,
  buildConstanciaResultadoResumido,
} from "../src/domain/identidad-curp";

async function main() {
  const path = process.argv[2] ?? "/tmp/curp-certificada-prueba.pdf";
  if (!existsSync(path)) {
    console.log(JSON.stringify({ ok: false, reason: "file_missing", pathHint: "provided" }));
    process.exit(1);
  }
  const buf = readFileSync(path);
  const extracted = await extractPdfEmbeddedText(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  if (!extracted.ok) {
    console.log(
      JSON.stringify({
        ok: true,
        textEmbedded: false,
        reason: extracted.reason,
        certificacionRegistroCivil: false,
        certificacionOtraAutoridad: false,
        camposReconocidos: [],
        camposNoDisponibles: [],
      }),
    );
    return;
  }
  const parsed = parseConstanciaCurpText(extracted.text);
  const resumen = buildConstanciaResultadoResumido(parsed);
  const presentes = (resumen.campos_presentes ?? {}) as Record<string, boolean>;
  const camposReconocidos = Object.entries(presentes)
    .filter(([, v]) => v)
    .map(([k]) => k);
  const camposNoDisponibles = Object.entries(presentes)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  console.log(
    JSON.stringify({
      ok: true,
      textEmbedded: true,
      textLen: extracted.text.length,
      certificacionRegistroCivil: parsed.extracted.certificadaRegistroCivil === true,
      certificacionOtraAutoridad: parsed.extracted.certificacionOtraAutoridad === true,
      status: parsed.status,
      camposReconocidos,
      camposNoDisponibles,
      mutuallyExclusiveCert:
        !(
          parsed.extracted.certificadaRegistroCivil &&
          parsed.extracted.certificacionOtraAutoridad
        ),
      // never print CURP/nombre/fecha/RFC values
    }),
  );
}

main().catch((err) => {
  console.log(
    JSON.stringify({
      ok: false,
      reason: "probe_error",
      message: err instanceof Error ? err.message : "unknown",
    }),
  );
  process.exit(1);
});
