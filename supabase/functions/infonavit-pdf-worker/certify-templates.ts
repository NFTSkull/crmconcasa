/**
 * Certifica SHA256 de plantillas v1 leídas como las leería la Edge Function.
 * Ejecutar desde supabase/functions/infonavit-pdf-worker.
 */
import { certifyBundledTemplateShas } from "./templates.ts";
import {
  BAJO_PROTESTA_CONTRACT,
  PRESUPUESTO_CONTRACT,
  SOLICITUD_CONTRACT,
} from "../_shared/infonavit-pdf/template-contract.ts";

const EXPECTED = {
  carta_bajo_protesta: BAJO_PROTESTA_CONTRACT.expectedSha256,
  presupuesto_mejoramiento: PRESUPUESTO_CONTRACT.expectedSha256,
  solicitud_inscripcion_credito: SOLICITUD_CONTRACT.expectedSha256,
} as const;

const actual = await certifyBundledTemplateShas();
for (const [k, sha] of Object.entries(EXPECTED)) {
  const got = actual[k as keyof typeof actual];
  if (got !== sha) {
    console.error("TEMPLATE_SHA_MISMATCH", k);
    Deno.exit(1);
  }
}
console.log("P189 B4 bundled template SHA: PASS");
