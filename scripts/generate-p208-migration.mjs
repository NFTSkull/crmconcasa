#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const migrationsDir = "supabase/migrations";
const outName = "20260901192000_asesor_integrate_for_any_advisor_p208.sql";
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql") && f !== outName)
  .sort();

function extractFunction(source, fnName) {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}(`;
  const start = source.lastIndexOf(marker);
  if (start < 0) return null;
  const tail = source.slice(start);
  const endMatch = tail.match(/\n\$\w*\$;/);
  if (!endMatch) return null;
  return tail.slice(0, endMatch.index + endMatch[0].length);
}

function patchOwnerGate(body) {
  let out = body;
  out = out.replace(
    /IF v_exp\.asesor_id IS DISTINCT FROM v_actor_id THEN\s*\n\s*RAISE EXCEPTION '([^']+)'[\s\S]*?USING ERRCODE = '42501';\s*\n\s*END IF;/g,
    `IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN\n    RAISE EXCEPTION '$1'\n      USING ERRCODE = '42501';\n  END IF;`,
  );
  out = out.replace(
    /IF NOT FOUND OR v_exp\.deleted_at IS NOT NULL\s*\n\s*OR v_exp\.asesor_id IS DISTINCT FROM v_actor_id/g,
    `IF NOT FOUND OR v_exp.deleted_at IS NOT NULL\n     OR NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id)`,
  );
  out = out.replace(
    /IF NOT FOUND OR v_exp\.deleted_at IS NOT NULL THEN\s*\n\s*RETURN false;\s*\n\s*END IF;\s*\n\s*\n\s*IF v_exp\.asesor_id IS DISTINCT FROM v_actor_id THEN\s*\n\s*RETURN false;\s*\n\s*END IF;/g,
    `IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN\n    RETURN false;\n  END IF;\n\n  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id) THEN\n    RETURN false;\n  END IF;`,
  );
  out = out.replace(
    /IF NOT FOUND OR v_exp\.organization_id IS DISTINCT FROM v_org OR v_exp\.asesor_id IS DISTINCT FROM v_actor THEN/g,
    `IF NOT FOUND OR v_exp.organization_id IS DISTINCT FROM v_org OR NOT public.asesor_can_operate_expediente_as(v_actor, p_expediente_id) THEN`,
  );
  out = out.replace(
    /IF NOT FOUND OR v_exp\.asesor_id IS DISTINCT FROM v_actor OR v_exp\.organization_id IS DISTINCT FROM v_org THEN/g,
    `IF NOT FOUND OR NOT public.asesor_can_operate_expediente_as(v_actor, p_expediente_id) OR v_exp.organization_id IS DISTINCT FROM v_org THEN`,
  );
  out = out.replace(
    /IF v_role = 'asesor' AND v_exp\.asesor_id IS DISTINCT FROM v_actor THEN/g,
    `IF v_role = 'asesor' AND NOT public.asesor_can_operate_expediente_as(v_actor, p_expediente_id) THEN`,
  );
  out = out.replace(
    /IF v_exp\.asesor_id IS DISTINCT FROM v_actor_id\s*\n\s*AND NOT public\.profile_has_capability\(v_actor_id, 'integrate_for_any_advisor'\) THEN/g,
    `IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN`,
  );
  out = out.replace(
    /IF v_exp\.asesor_id <> v_actor_id\s*\n\s*AND NOT public\.profile_has_capability\(v_actor_id, 'integrate_for_any_advisor'\) THEN/g,
    `IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN`,
  );
  out = out.replace(
    /IF v_exp\.asesor_id IS DISTINCT FROM v_actor_id\s*\n\s*AND NOT public\.profile_has_capability\(v_actor_id, 'integrate_for_any_advisor'\)\s*\n\s*OR v_exp\.organization_id IS DISTINCT FROM v_actor\.organization_id/g,
    `IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id)\n     OR v_exp.organization_id IS DISTINCT FROM v_actor.organization_id`,
  );
  out = out.replace(
    /\(\s*\n\s*v_exp\.asesor_id IS DISTINCT FROM v_actor_id\s*\n\s*AND NOT public\.profile_has_capability\(v_actor_id, 'integrate_for_any_advisor'\)\s*\n\s*\)/g,
    `(NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id))`,
  );
  return out;
}

const targets = [
  "save_cliente_datos",
  "enviar_a_mesa",
  "register_expediente_documento",
  "register_expediente_documento_pre_reingreso",
  "save_cliente_datos_correccion",
  "register_expediente_documento_correccion",
  "register_expediente_documento_retencion",
  "asesor_enviar_reingreso_a_mesa",
  "asesor_registrar_validacion_identidad",
  "asesor_list_validaciones_identidad",
  "asesor_invalidar_validaciones_identidad",
  "expediente_documento_storage_asesor_upload_allowed",
  "expediente_documento_storage_asesor_post_mesa_upload_allowed",
  "expediente_documento_storage_asesor_correccion_allowed",
  "expediente_documento_storage_asesor_retencion_upload_allowed",
];

const found = {};
for (const fn of targets) {
  let last = null;
  for (const f of files) {
    const src = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    const ex = extractFunction(src, fn);
    if (ex) last = { file: f, body: ex };
  }
  found[fn] = last;
}

const header = `-- ConCasa CRM — P208: captura delegada Equipo Silvia (Adriana/Hector).
-- Team-scoped via asesor_comparten_equipo_activo + asesor_can_operate_expediente_as.
-- 0 writers tablas; CREATE OR REPLACE helpers/RLS/storage/RPCs.
-- NO editar 20260831205958 (ya aplicada Cloud).

`;

const helpers = `-- =============================================================================
-- Helpers P208 (team-scoped)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.asesor_pertenece_equipo_activo(
  p_team_id uuid,
  p_asesor_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.asesor_equipos t
    WHERE t.id = p_team_id
      AND t.active = true
      AND (
        t.leader_id = p_asesor_id
        OR EXISTS (
          SELECT 1
          FROM public.asesor_equipo_miembros m
          WHERE m.team_id = t.id
            AND m.asesor_id = p_asesor_id
            AND m.active = true
        )
      )
  );
$$;

COMMENT ON FUNCTION public.asesor_pertenece_equipo_activo(uuid, uuid) IS
  'P208: asesor es líder o miembro activo del equipo.';

CREATE OR REPLACE FUNCTION public.asesor_comparten_equipo_activo(
  p_actor_id uuid,
  p_target_asesor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_target_asesor_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_actor_id = p_target_asesor_id THEN
    RETURN true;
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles p
  WHERE p.id = p_actor_id AND p.active = true;

  SELECT * INTO v_target
  FROM public.profiles p
  WHERE p.id = p_target_asesor_id AND p.active = true;

  IF NOT FOUND OR v_actor.app_role <> 'asesor' OR v_target.app_role <> 'asesor' THEN
    RETURN false;
  END IF;

  IF v_actor.organization_id IS DISTINCT FROM v_target.organization_id THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.asesor_equipos t
    WHERE t.active = true
      AND t.organization_id = v_actor.organization_id
      AND public.asesor_pertenece_equipo_activo(t.id, p_actor_id)
      AND public.asesor_pertenece_equipo_activo(t.id, p_target_asesor_id)
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_comparten_equipo_activo(uuid, uuid) IS
  'P208: actor y target asesor activos same-org en el mismo equipo activo (sin hardcode).';

GRANT EXECUTE ON FUNCTION public.asesor_pertenece_equipo_activo(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_comparten_equipo_activo(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.asesor_can_operate_expediente_as(
  p_actor_id uuid,
  p_expediente_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_exp public.expedientes%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_expediente_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles p
  WHERE p.id = p_actor_id AND p.active = true;

  IF NOT FOUND OR v_actor.app_role <> 'asesor' THEN
    RETURN false;
  END IF;

  SELECT * INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_actor.organization_id THEN
    RETURN false;
  END IF;

  IF v_exp.asesor_id = p_actor_id THEN
    RETURN true;
  END IF;

  RETURN public.profile_has_capability(p_actor_id, 'integrate_for_any_advisor')
    AND public.asesor_comparten_equipo_activo(p_actor_id, v_exp.asesor_id);
END;
$$;

COMMENT ON FUNCTION public.asesor_can_operate_expediente_as(uuid, uuid) IS
  'P208: owner OR delegate integrate_for_any_advisor en equipo activo compartido.';

CREATE OR REPLACE FUNCTION public.asesor_can_operate_expediente(p_expediente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.asesor_can_operate_expediente_as(public.current_profile_id(), p_expediente_id);
$$;

COMMENT ON FUNCTION public.asesor_can_operate_expediente(uuid) IS
  'P208: wrapper CAN_OPERATE para actor JWT.';

GRANT EXECUTE ON FUNCTION public.asesor_can_operate_expediente_as(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_can_operate_expediente(uuid) TO authenticated;

`;

const canSee = fs.readFileSync(path.join(migrationsDir, "002_rls_policies.sql"), "utf8");
const canSeeFn = extractFunction(canSee, "can_see_expediente");
if (!canSeeFn) throw new Error("can_see_expediente not found");
const canSeePatched = canSeeFn.replace(
  `    WHEN 'asesor' THEN\n      RETURN v_exp.asesor_id = auth.uid();`,
  `    WHEN 'asesor' THEN\n      RETURN v_exp.asesor_id = auth.uid()\n        OR (\n          public.profile_has_capability(auth.uid(), 'integrate_for_any_advisor')\n          AND public.asesor_comparten_equipo_activo(auth.uid(), v_exp.asesor_id)\n        );`,
);

const parts = [header, helpers, "-- can_see_expediente P208\n", canSeePatched, "\n"];

for (const fn of targets) {
  const item = found[fn];
  if (!item) {
    parts.push(`-- MISSING ${fn}\n`);
    continue;
  }
  parts.push(`-- from ${item.file}\n`);
  parts.push(patchOwnerGate(item.body), "\n\n");
}

const mig058 = fs.readFileSync(
  path.join(migrationsDir, "20260831205958_asesor_equipo_lider_capabilities.sql"),
  "utf8",
);

let createForAsesor = extractFunction(mig058, "create_expediente_for_asesor");
if (!createForAsesor) throw new Error("create_expediente_for_asesor not found");
createForAsesor = createForAsesor.replace(
  `  IF NOT FOUND THEN\n    RAISE EXCEPTION 'create_expediente_for_asesor: asesor destino inválido o fuera de organización'\n      USING ERRCODE = '42501';\n  END IF;`,
  `  IF NOT FOUND THEN\n    RAISE EXCEPTION 'create_expediente_for_asesor: asesor destino inválido o fuera de organización'\n      USING ERRCODE = '42501';\n  END IF;\n\n  IF p_asesor_id IS DISTINCT FROM v_actor_id\n     AND NOT public.asesor_comparten_equipo_activo(v_actor_id, p_asesor_id) THEN\n    RAISE EXCEPTION 'create_expediente_for_asesor: asesor destino fuera de equipo compartido'\n      USING ERRCODE = '42501';\n  END IF;`,
);
parts.push("-- create_expediente_for_asesor P208 team scope\n", createForAsesor, "\n\n");

let listOrg = extractFunction(mig058, "list_asesores_activos_org");
if (!listOrg) throw new Error("list_asesores_activos_org not found");
listOrg = listOrg.replace(
  `  'Lista asesores activos de la org [{id, full_name, email}]. Requiere create_for_any_advisor (no exige ser líder de equipo).';`,
  `  'P208: asesores activos team-scoped para create_for_any_advisor (líder + miembros de equipos compartidos).';`,
);
listOrg = listOrg.replace(
  `  FROM public.profiles p\n  WHERE p.organization_id = v_org_id\n    AND p.active = true\n    AND p.app_role = 'asesor';`,
  `  FROM public.profiles p\n  WHERE p.organization_id = v_org_id\n    AND p.active = true\n    AND p.app_role = 'asesor'\n    AND public.asesor_comparten_equipo_activo(v_actor_id, p.id);`,
);
parts.push("-- list_asesores_activos_org P208 team scope\n", listOrg, "\n\n");

const list210 = fs.readFileSync(
  path.join(migrationsDir, "210_asesor_correccion_accionable_reenvio.sql"),
  "utf8",
);
let listFn = extractFunction(list210, "asesor_list_expedientes_page");
if (!listFn) throw new Error("asesor_list_expedientes_page not found");
listFn = listFn.replace(
  "p_quick_filter TEXT DEFAULT 'todos'\n)",
  "p_quick_filter TEXT DEFAULT 'todos',\n  p_owner_asesor_id UUID DEFAULT NULL\n)",
);
listFn = listFn.replace(
  `  v_quick TEXT;\n  v_total BIGINT;\n  v_items JSONB;`,
  `  v_quick TEXT;\n  v_owner UUID;\n  v_total BIGINT;\n  v_items JSONB;`,
);
listFn = listFn.replace(
  `  v_quick := lower(trim(coalesce(nullif(p_quick_filter, ''), 'todos')));`,
  `  v_quick := lower(trim(coalesce(nullif(p_quick_filter, ''), 'todos')));

  v_owner := coalesce(p_owner_asesor_id, v_actor);
  IF v_owner IS DISTINCT FROM v_actor THEN
    IF NOT public.profile_has_capability(v_actor, 'integrate_for_any_advisor') THEN
      RAISE EXCEPTION 'asesor_list_expedientes_page: sin capability integrate_for_any_advisor'
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.asesor_comparten_equipo_activo(v_actor, v_owner) THEN
      RAISE EXCEPTION 'asesor_list_expedientes_page: asesor titular fuera de equipo compartido'
        USING ERRCODE = '42501';
    END IF;
  END IF;`,
);
listFn = listFn.replace("AND e.asesor_id = v_actor", "AND e.asesor_id = v_owner");
parts.push("-- asesor_list_expedientes_page P208 p_owner_asesor_id\n", listFn, "\n");

const outPath = path.join(migrationsDir, outName);
fs.writeFileSync(outPath, parts.join("\n"));
console.log("Wrote", outPath, "bytes", fs.statSync(outPath).size);
for (const fn of targets) {
  console.log(fn, found[fn] ? found[fn].file : "MISSING");
}
