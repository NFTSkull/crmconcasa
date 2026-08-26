-- P211 ROLLBACK (NO ejecutar automáticamente)
-- Generado desde definiciones Cloud PRE-apply (max=210).
-- Restaura RPCs pre-211; drop trigger; assert inert.
-- NO borra docs / NO mueve etapas / columnas nullable pueden quedar.

BEGIN;

DROP TRIGGER IF EXISTS trg_expedientes_vigencia_documental_biu ON public.expedientes;

CREATE OR REPLACE FUNCTION public.assert_expediente_vigencia_documental_ok(p_expediente_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object('applicable', false, 'reason', 'p211_disabled');
$$;

COMMENT ON FUNCTION public.assert_expediente_vigencia_documental_ok(UUID) IS
  'P211 DISABLED (rollback contención).';


-- Restore agenda_sheet_apply_operational_result(p_organization_id uuid, p_spreadsheet_id text, p_sheet_id bigint, p_sheet_row integer, p_booking_date date, p_kind text, p_location_id text, p_booking_id uuid, p_expediente_id uuid, p_biometric_result_class text, p_biometric_result_raw text, p_notification_result_class text, p_notification_result_raw text, p_signature_result_class text, p_signature_result_raw text, p_notes_raw text, p_fingerprint text, p_biometric_cell_red boolean, p_notification_cell_red boolean, p_signature_cell_red boolean, p_operational_red_veto boolean)
CREATE OR REPLACE FUNCTION public.agenda_sheet_apply_operational_result(p_organization_id uuid, p_spreadsheet_id text, p_sheet_id bigint, p_sheet_row integer, p_booking_date date, p_kind text, p_location_id text, p_booking_id uuid, p_expediente_id uuid, p_biometric_result_class text, p_biometric_result_raw text, p_notification_result_class text, p_notification_result_raw text, p_signature_result_class text, p_signature_result_raw text, p_notes_raw text DEFAULT NULL::text, p_fingerprint text DEFAULT NULL::text, p_biometric_cell_red boolean DEFAULT false, p_notification_cell_red boolean DEFAULT false, p_signature_cell_red boolean DEFAULT false, p_operational_red_veto boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kind TEXT;
  v_fp TEXT;
  v_fp_in TEXT;
  v_ops public.agenda_sheet_operational_results%ROWTYPE;
  v_book public.agenda_bookings%ROWTYPE;
  v_exp public.expedientes%ROWTYPE;
  v_bio TEXT;
  v_notif TEXT;
  v_sig TEXT;
  v_notes TEXT;
  v_motivo TEXT;
  v_etapa_antes SMALLINT;
  v_sub_antes public.operativo_subestado;
  v_etapa_despues SMALLINT;
  v_sub_despues public.operativo_subestado;
  v_outcome TEXT;
  v_actions TEXT[] := ARRAY[]::TEXT[];
  v_booking_id UUID;
  v_fecha_cita TIMESTAMPTZ;
  v_mutated BOOLEAN := false;
  v_reject_done BOOLEAN := false;
  v_tmp JSONB;
  v_bio_red BOOLEAN := false;
  v_notif_red BOOLEAN := false;
  v_sig_red BOOLEAN := false;
  v_red_veto BOOLEAN := false;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  v_kind := lower(btrim(COALESCE(p_kind, '')));
  IF v_kind NOT IN ('biometricos', 'firmas') THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'NO_APPLY', 'reason', 'kind_invalid');
  END IF;

  IF p_organization_id IS NULL
     OR NULLIF(btrim(COALESCE(p_spreadsheet_id, '')), '') IS NULL
     OR p_sheet_id IS NULL
     OR p_sheet_row IS NULL
     OR p_sheet_row <= 0
     OR p_booking_date IS NULL
     OR NULLIF(btrim(COALESCE(p_location_id, '')), '') IS NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'NO_APPLY', 'reason', 'input_incomplete');
  END IF;

  -- Identidad obligatoria para mutar
  IF p_booking_id IS NULL OR p_expediente_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'NO_APPLY', 'reason', 'missing_pq');
  END IF;

  v_bio := upper(btrim(COALESCE(p_biometric_result_class, 'PENDING')));
  v_notif := upper(btrim(COALESCE(p_notification_result_class, 'PENDING')));
  v_sig := upper(btrim(COALESCE(p_signature_result_class, 'PENDING')));
  v_notes := NULLIF(btrim(COALESCE(p_notes_raw, '')), '');
  v_bio_red := COALESCE(p_biometric_cell_red, false);
  v_notif_red := COALESCE(p_notification_cell_red, false);
  v_sig_red := COALESCE(p_signature_cell_red, false);
  v_red_veto := COALESCE(p_operational_red_veto, false);

  v_fp := public.agenda_sheet_ops_fingerprint(
    p_spreadsheet_id, p_sheet_id, p_sheet_row,
    p_expediente_id, p_booking_id, v_kind,
    v_bio, p_biometric_result_raw,
    v_notif, p_notification_result_raw,
    v_sig, p_signature_result_raw,
    v_notes,
    v_bio_red, v_notif_red, v_sig_red, v_red_veto
  );
  v_fp_in := NULLIF(btrim(COALESCE(p_fingerprint, '')), '');
  IF v_fp_in IS NOT NULL AND v_fp_in IS DISTINCT FROM v_fp THEN
    -- Edge envió fingerprint distinto: autoridad = servidor
    NULL;
  END IF;

  -- Identidad P/Q/kind/org ANTES de cualquier write (no mutación parcial / no FK inválida)
  SELECT * INTO v_book
  FROM public.agenda_bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_book.expediente_id IS DISTINCT FROM p_expediente_id
     OR v_book.organization_id IS DISTINCT FROM p_organization_id
     OR v_book.kind::text IS DISTINCT FROM v_kind
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'LINK_MISMATCH',
      'fingerprint', v_fp,
      'reason', 'booking_pq_kind_org'
    );
  END IF;

  SELECT * INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'outcome', 'SKIPPED_TERMINAL',
      'reason', 'deleted_or_missing', 'fingerprint', v_fp
    );
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM p_organization_id THEN
    RETURN jsonb_build_object(
      'ok', true, 'outcome', 'LINK_MISMATCH',
      'reason', 'org_mismatch', 'fingerprint', v_fp
    );
  END IF;


  -- P172: booking bajo contingencia activa → nunca mutar expediente (prioridad sobre COMPLETED/FAILED/X/SI/CESI)
  IF public.agenda_booking_has_contingency(p_booking_id) THEN
    -- Observación Sheet permanece (upsert projection) pero apply_outcome = SKIPPED_CONTINGENCY
    INSERT INTO public.agenda_sheet_operational_results AS t (
      organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
      kind, location_id, booking_id, expediente_id,
      biometric_result_class, biometric_result_raw,
      notification_result_class, notification_result_raw,
      signature_result_class, signature_result_raw,
      notes_raw,
      biometric_cell_red, notification_cell_red, signature_cell_red, operational_red_veto,
      last_seen_at
    ) VALUES (
      p_organization_id, btrim(p_spreadsheet_id), p_sheet_id, '(apply)', p_booking_date, p_sheet_row,
      v_kind, lower(btrim(p_location_id)), p_booking_id, p_expediente_id,
      v_bio, NULLIF(btrim(COALESCE(p_biometric_result_raw, '')), ''),
      v_notif, NULLIF(btrim(COALESCE(p_notification_result_raw, '')), ''),
      v_sig, NULLIF(btrim(COALESCE(p_signature_result_raw, '')), ''),
      v_notes,
      v_bio_red, v_notif_red, v_sig_red, v_red_veto,
      NOW()
    )
    ON CONFLICT (spreadsheet_id, sheet_id, sheet_row) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      booking_date = EXCLUDED.booking_date,
      kind = EXCLUDED.kind,
      location_id = EXCLUDED.location_id,
      booking_id = EXCLUDED.booking_id,
      expediente_id = EXCLUDED.expediente_id,
      biometric_result_class = EXCLUDED.biometric_result_class,
      biometric_result_raw = EXCLUDED.biometric_result_raw,
      notification_result_class = EXCLUDED.notification_result_class,
      notification_result_raw = EXCLUDED.notification_result_raw,
      signature_result_class = EXCLUDED.signature_result_class,
      signature_result_raw = EXCLUDED.signature_result_raw,
      notes_raw = EXCLUDED.notes_raw,
      biometric_cell_red = EXCLUDED.biometric_cell_red,
      notification_cell_red = EXCLUDED.notification_cell_red,
      signature_cell_red = EXCLUDED.signature_cell_red,
      operational_red_veto = EXCLUDED.operational_red_veto,
      last_seen_at = NOW(),
      updated_at = NOW();

    UPDATE public.agenda_sheet_operational_results
    SET last_applied_fingerprint = v_fp,
        last_applied_at = NOW(),
        apply_outcome = 'SKIPPED_CONTINGENCY',
        updated_at = NOW()
    WHERE spreadsheet_id = btrim(p_spreadsheet_id)
      AND sheet_id = p_sheet_id
      AND sheet_row = p_sheet_row;

    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'SKIPPED_CONTINGENCY',
      'fingerprint', v_fp,
      'expediente_id', p_expediente_id,
      'booking_id', p_booking_id,
      'kind', v_kind,
      'mutated', false,
      'reason', 'booking_under_contingency'
    );
  END IF;

  -- Upsert proyección fila (observación) sin tocar apply metadata salvo al final
  INSERT INTO public.agenda_sheet_operational_results AS t (
    organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
    kind, location_id, booking_id, expediente_id,
    biometric_result_class, biometric_result_raw,
    notification_result_class, notification_result_raw,
    signature_result_class, signature_result_raw,
    notes_raw, last_seen_at
  ) VALUES (
    p_organization_id, btrim(p_spreadsheet_id), p_sheet_id, '(apply)', p_booking_date, p_sheet_row,
    v_kind, lower(btrim(p_location_id)), p_booking_id, p_expediente_id,
    v_bio, NULLIF(btrim(COALESCE(p_biometric_result_raw, '')), ''),
    v_notif, NULLIF(btrim(COALESCE(p_notification_result_raw, '')), ''),
    v_sig, NULLIF(btrim(COALESCE(p_signature_result_raw, '')), ''),
    v_notes, NOW()
  )
  ON CONFLICT (spreadsheet_id, sheet_id, sheet_row) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    booking_date = EXCLUDED.booking_date,
    kind = EXCLUDED.kind,
    location_id = EXCLUDED.location_id,
    booking_id = EXCLUDED.booking_id,
    expediente_id = EXCLUDED.expediente_id,
    biometric_result_class = EXCLUDED.biometric_result_class,
    biometric_result_raw = EXCLUDED.biometric_result_raw,
    notification_result_class = EXCLUDED.notification_result_class,
    notification_result_raw = EXCLUDED.notification_result_raw,
    signature_result_class = EXCLUDED.signature_result_class,
    signature_result_raw = EXCLUDED.signature_result_raw,
    notes_raw = EXCLUDED.notes_raw,
    biometric_cell_red = EXCLUDED.biometric_cell_red,
    notification_cell_red = EXCLUDED.notification_cell_red,
    signature_cell_red = EXCLUDED.signature_cell_red,
    operational_red_veto = EXCLUDED.operational_red_veto,
    last_seen_at = NOW(),
    updated_at = NOW();

  SELECT * INTO v_ops
  FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id = btrim(p_spreadsheet_id)
    AND sheet_id = p_sheet_id
    AND sheet_row = p_sheet_row
  FOR UPDATE;

  -- Idempotencia
  IF v_ops.last_applied_fingerprint IS NOT NULL
     AND v_ops.last_applied_fingerprint = v_fp THEN
    UPDATE public.agenda_sheet_operational_results
    SET last_applied_at = NOW(), apply_outcome = 'NO_OP', updated_at = NOW()
    WHERE id = v_ops.id;
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'NO_OP',
      'fingerprint', v_fp,
      'expediente_id', p_expediente_id,
      'reason', 'same_fingerprint'
    );
  END IF;

  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo' THEN
    UPDATE public.agenda_sheet_operational_results
    SET last_applied_fingerprint = v_fp, last_applied_at = NOW(),
        apply_outcome = 'SKIPPED_TERMINAL', updated_at = NOW()
    WHERE id = v_ops.id;
    RETURN jsonb_build_object('ok', true, 'outcome', 'SKIPPED_TERMINAL', 'reason', 'ciclo_inactivo', 'fingerprint', v_fp);
  END IF;

  v_etapa_antes := v_exp.etapa_actual;
  v_sub_antes := v_exp.subestado;
  v_etapa_despues := v_exp.etapa_actual;
  v_sub_despues := v_exp.subestado;

  -- Motivo rechazo
  v_motivo := COALESCE(
    v_notes,
    NULLIF(btrim(COALESCE(
      CASE
        WHEN v_kind = 'biometricos' AND v_bio = 'FAILED_OR_NOT_ATTENDED' THEN p_biometric_result_raw
        WHEN v_kind = 'biometricos' AND v_notif = 'FAILED_OR_NOT_ATTENDED' THEN p_notification_result_raw
        WHEN v_kind = 'firmas' AND v_sig = 'FAILED_OR_NOT_ATTENDED' THEN p_signature_result_raw
        ELSE NULL
      END, '')), ''),
    'Resultado operativo no exitoso registrado en CITAS 2026'
  );

  ------------------------------------------------------------------
  -- BIOMÉTRICOS
  ------------------------------------------------------------------
  IF v_kind = 'biometricos' THEN
    -- D) bio FAILED → rechazo sin avance
    IF v_bio = 'FAILED_OR_NOT_ATTENDED' THEN
      IF v_exp.subestado = 'rechazado' THEN
        v_outcome := 'NO_OP';
      ELSIF v_exp.submitted_to_mesa IS NOT TRUE THEN
        v_outcome := 'SKIPPED_GATE';
      ELSE
        BEGIN
          v_tmp := public.expediente_rechazar_operativo_internal(
            p_expediente_id, v_motivo, NULL, 'desconocida', NULL, NULL,
            NULL, NULL, 'google_sheet',
            p_spreadsheet_id, p_sheet_id, p_sheet_row, p_booking_id,
            true
          );
          v_reject_done := true;
          v_mutated := true;
          v_actions := array_append(v_actions, 'reject');
          v_sub_despues := 'rechazado';
          v_outcome := 'APPLIED';
        EXCEPTION WHEN OTHERS THEN
          v_outcome := 'SKIPPED_GATE';
        END;
      END IF;

    ELSIF v_bio = 'COMPLETED' THEN
      -- X→verde / expediente ya rechazado: no auto-reactiva
      IF v_exp.subestado = 'rechazado' THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp, last_applied_at = NOW(),
            apply_outcome = 'REQUIRES_HUMAN_REACTIVATION', updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true,
          'outcome', 'REQUIRES_HUMAN_REACTIVATION',
          'fingerprint', v_fp,
          'etapa_actual', v_exp.etapa_actual,
          'subestado', v_exp.subestado
        );
      END IF;

      -- P173: COLOR_VETO bloquea positivos; textual FAILED notif sigue flujo P170/P172
      IF v_red_veto AND v_notif IS DISTINCT FROM 'FAILED_OR_NOT_ATTENDED' THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp,
            last_applied_at = NOW(),
            apply_outcome = 'COLOR_VETO',
            updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true,
          'outcome', 'COLOR_VETO',
          'fingerprint', v_fp,
          'expediente_id', p_expediente_id,
          'booking_id', p_booking_id,
          'kind', v_kind,
          'mutated', false,
          'reason', 'operational_red_veto',
          'biometric_cell_red', v_bio_red,
          'notification_cell_red', v_notif_red,
          'signature_cell_red', v_sig_red,
          'operational_red_veto', v_red_veto,
          'etapa_actual', v_exp.etapa_actual,
          'subestado', v_exp.subestado
        );
      END IF;

      IF v_exp.submitted_to_mesa IS NOT TRUE THEN
        v_outcome := 'SKIPPED_GATE';
      ELSE
        -- A/B/C: asegurar hasta 5 si corresponde (orden P170/P172)
        IF v_exp.etapa_actual < 3 THEN
          v_outcome := 'SKIPPED_STAGE';
        ELSIF v_exp.etapa_actual IN (3, 4) THEN
          v_fecha_cita := v_exp.fecha_cita;
          IF v_fecha_cita IS NULL OR v_book.status IS DISTINCT FROM 'booked' THEN
            v_outcome := 'SKIPPED_GATE';
          ELSE
            IF v_exp.etapa_actual = 3 THEN
              UPDATE public.expedientes
              SET etapa_actual = 4, subestado = 'en_proceso', updated_at = NOW()
              WHERE id = p_expediente_id;
              PERFORM public.log_action(
                p_organization_id, NULL, NULL,
                'agenda_sheet.operational.bio_advance',
                'expediente', p_expediente_id,
                jsonb_build_object(
                  'source', 'google_sheet', 'spreadsheet_id', p_spreadsheet_id,
                  'sheet_id', p_sheet_id, 'sheet_row', p_sheet_row,
                  'booking_id', p_booking_id, 'fingerprint', v_fp,
                  'etapa_anterior', 3, 'etapa_nueva', 4,
                  'transition', '3_4_sheet_bio'
                )
              );
              v_actions := array_append(v_actions, 'bio_advance');
              v_mutated := true;
              v_exp.etapa_actual := 4;
            END IF;

            -- 4→5 (gates espejo avanzar)
            IF v_exp.etapa_actual = 4 THEN
              UPDATE public.expedientes
              SET etapa_actual = 5, subestado = 'en_proceso', updated_at = NOW()
              WHERE id = p_expediente_id;
              PERFORM public.log_action(
                p_organization_id, NULL, NULL,
                'agenda_sheet.operational.bio_advance',
                'expediente', p_expediente_id,
                jsonb_build_object(
                  'source', 'google_sheet', 'spreadsheet_id', p_spreadsheet_id,
                  'sheet_id', p_sheet_id, 'sheet_row', p_sheet_row,
                  'booking_id', p_booking_id, 'fingerprint', v_fp,
                  'etapa_anterior', 4, 'etapa_nueva', 5,
                  'transition', '4_5', 'kind', 'biometricos'
                )
              );
              v_actions := array_append(v_actions, 'bio_advance');
              v_mutated := true;
              v_exp.etapa_actual := 5;
              v_etapa_despues := 5;
              v_outcome := 'APPLIED';
            END IF;
          END IF;
        ELSIF v_exp.etapa_actual >= 5 THEN
          v_outcome := 'NO_OP'; -- no downgrade
          v_etapa_despues := v_exp.etapa_actual;
        END IF;

        -- B) notif COMPLETED → target 8 (5→8)
        IF v_notif = 'COMPLETED' AND v_outcome IS DISTINCT FROM 'SKIPPED_GATE'
           AND v_outcome IS DISTINCT FROM 'SKIPPED_STAGE' THEN
          SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
          IF v_exp.etapa_actual = 5 THEN
            IF v_exp.subestado IS DISTINCT FROM 'en_proceso'
               OR v_exp.fecha_cita IS NULL
               OR v_exp.fecha_cita > NOW()
               OR v_book.status IS DISTINCT FROM 'booked' THEN
              IF v_outcome IS NULL OR v_outcome = 'NO_OP' THEN
                v_outcome := 'SKIPPED_GATE';
              END IF;
            ELSE
              UPDATE public.expedientes
              SET etapa_actual = 8, subestado = 'en_proceso', updated_at = NOW()
              WHERE id = p_expediente_id;
              PERFORM public.log_action(
                p_organization_id, NULL, NULL,
                'agenda_sheet.operational.notification_close',
                'expediente', p_expediente_id,
                jsonb_build_object(
                  'source', 'google_sheet', 'spreadsheet_id', p_spreadsheet_id,
                  'sheet_id', p_sheet_id, 'sheet_row', p_sheet_row,
                  'booking_id', p_booking_id, 'fingerprint', v_fp,
                  'etapa_anterior', 5, 'etapa_nueva', 8,
                  'transition', '5_8'
                )
              );
              v_actions := array_append(v_actions, 'notification_close');
              v_mutated := true;
              v_etapa_despues := 8;
              v_outcome := 'APPLIED';
            END IF;
          ELSIF v_exp.etapa_actual >= 8 THEN
            IF v_outcome IS NULL OR v_outcome = 'NO_OP' THEN
              v_outcome := 'NO_OP';
            END IF;
            v_etapa_despues := v_exp.etapa_actual;
          END IF;
        END IF;

        -- C) notif FAILED tras bio COMPLETED → rechazo (después de reconocer ≥5)
        -- P175: REAGENDA INSCRIPCION (ops.inscripcion_rebook_required) NO rechaza.
        IF v_notif = 'FAILED_OR_NOT_ATTENDED' AND NOT v_reject_done THEN
          IF COALESCE(v_ops.inscripcion_rebook_required, false) THEN
            UPDATE public.agenda_sheet_operational_results
            SET last_applied_fingerprint = v_fp,
                last_applied_at = NOW(),
                apply_outcome = 'REQUIRES_INSCRIPCION_REBOOK',
                updated_at = NOW()
            WHERE id = v_ops.id;
            RETURN jsonb_build_object(
              'ok', true,
              'outcome', 'REQUIRES_INSCRIPCION_REBOOK',
              'fingerprint', v_fp,
              'expediente_id', p_expediente_id,
              'booking_id', p_booking_id,
              'kind', v_kind,
              'mutated', false,
              'reason', 'inscripcion_rebook_required',
              'etapa_actual', v_exp.etapa_actual,
              'subestado', v_exp.subestado
            );
          END IF;
          SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
          IF v_exp.subestado = 'rechazado' THEN
            NULL;
          ELSIF v_exp.submitted_to_mesa IS NOT TRUE THEN
            IF v_outcome IS NULL THEN v_outcome := 'SKIPPED_GATE'; END IF;
          ELSE
            BEGIN
              v_tmp := public.expediente_rechazar_operativo_internal(
                p_expediente_id, v_motivo, NULL, 'desconocida', NULL, NULL,
                NULL, NULL, 'google_sheet',
                p_spreadsheet_id, p_sheet_id, p_sheet_row, p_booking_id,
                true
              );
              v_reject_done := true;
              v_mutated := true;
              v_actions := array_append(v_actions, 'reject');
              v_sub_despues := 'rechazado';
              v_etapa_despues := v_exp.etapa_actual;
              v_outcome := 'APPLIED';
            EXCEPTION WHEN OTHERS THEN
              IF v_outcome IS NULL THEN v_outcome := 'SKIPPED_GATE'; END IF;
            END;
          END IF;
        END IF;
      END IF;

    ELSE
      -- PENDING/UNKNOWN bio: COLOR_VETO si hay rojo operativo; si no, NO_APPLY
      IF v_red_veto THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp,
            last_applied_at = NOW(),
            apply_outcome = 'COLOR_VETO',
            updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true,
          'outcome', 'COLOR_VETO',
          'fingerprint', v_fp,
          'expediente_id', p_expediente_id,
          'booking_id', p_booking_id,
          'kind', v_kind,
          'mutated', false,
          'reason', 'operational_red_veto',
          'biometric_cell_red', v_bio_red,
          'notification_cell_red', v_notif_red,
          'signature_cell_red', v_sig_red,
          'operational_red_veto', v_red_veto,
          'etapa_actual', v_exp.etapa_actual,
          'subestado', v_exp.subestado
        );

      ELSE
        v_outcome := 'NO_APPLY';
      END IF;
    END IF;

  ------------------------------------------------------------------
  -- FIRMAS
  ------------------------------------------------------------------
  ELSIF v_kind = 'firmas' THEN
    IF v_sig = 'FAILED_OR_NOT_ATTENDED' THEN
      IF v_exp.subestado = 'rechazado' THEN
        v_outcome := 'NO_OP';
      ELSIF v_exp.submitted_to_mesa IS NOT TRUE THEN
        v_outcome := 'SKIPPED_GATE';
      ELSE
        BEGIN
          v_tmp := public.expediente_rechazar_operativo_internal(
            p_expediente_id, v_motivo, NULL, 'desconocida', NULL, NULL,
            NULL, NULL, 'google_sheet',
            p_spreadsheet_id, p_sheet_id, p_sheet_row, p_booking_id,
            true
          );
          v_mutated := true;
          v_actions := array_append(v_actions, 'reject');
          v_sub_despues := 'rechazado';
          v_outcome := 'APPLIED';
        EXCEPTION WHEN OTHERS THEN
          v_outcome := 'SKIPPED_GATE';
        END;
      END IF;

    ELSIF v_sig = 'COMPLETED' THEN
      IF v_exp.subestado = 'rechazado' THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp, last_applied_at = NOW(),
            apply_outcome = 'REQUIRES_HUMAN_REACTIVATION', updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true, 'outcome', 'REQUIRES_HUMAN_REACTIVATION',
          'fingerprint', v_fp, 'etapa_actual', v_exp.etapa_actual
        );
      END IF;

      IF v_red_veto THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp,
            last_applied_at = NOW(),
            apply_outcome = 'COLOR_VETO',
            updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true,
          'outcome', 'COLOR_VETO',
          'fingerprint', v_fp,
          'expediente_id', p_expediente_id,
          'booking_id', p_booking_id,
          'kind', v_kind,
          'mutated', false,
          'reason', 'operational_red_veto',
          'biometric_cell_red', v_bio_red,
          'notification_cell_red', v_notif_red,
          'signature_cell_red', v_sig_red,
          'operational_red_veto', v_red_veto,
          'etapa_actual', v_exp.etapa_actual,
          'subestado', v_exp.subestado
        );

      ELSIF v_exp.submitted_to_mesa IS NOT TRUE THEN
        v_outcome := 'SKIPPED_GATE';
      ELSIF v_exp.etapa_actual < 9 THEN
        v_outcome := 'SKIPPED_STAGE';
      ELSIF v_exp.etapa_actual >= 11 THEN
        v_outcome := 'NO_OP';
        v_etapa_despues := v_exp.etapa_actual;
      ELSE
        -- 9→10
        IF v_exp.etapa_actual = 9 THEN
          IF v_exp.subestado IS DISTINCT FROM 'en_proceso'
             OR v_exp.fecha_cita IS NULL
             OR v_book.status IS DISTINCT FROM 'booked' THEN
            v_outcome := 'SKIPPED_GATE';
          ELSE
            UPDATE public.expedientes
            SET etapa_actual = 10, subestado = 'en_proceso', updated_at = NOW()
            WHERE id = p_expediente_id;
            PERFORM public.log_action(
              p_organization_id, NULL, NULL,
              'agenda_sheet.operational.signature_complete',
              'expediente', p_expediente_id,
              jsonb_build_object(
                'source', 'google_sheet', 'spreadsheet_id', p_spreadsheet_id,
                'sheet_id', p_sheet_id, 'sheet_row', p_sheet_row,
                'booking_id', p_booking_id, 'fingerprint', v_fp,
                'etapa_anterior', 9, 'etapa_nueva', 10, 'transition', '9_10'
              )
            );
            v_actions := array_append(v_actions, 'signature_complete');
            v_mutated := true;
            v_exp.etapa_actual := 10;
          END IF;
        END IF;

        -- 10→11
        IF v_exp.etapa_actual = 10 AND (v_outcome IS NULL OR v_outcome IS DISTINCT FROM 'SKIPPED_GATE') THEN
          SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
          IF v_exp.subestado IS DISTINCT FROM 'en_proceso'
             OR v_exp.fecha_cita IS NULL
             OR v_book.status IS DISTINCT FROM 'booked' THEN
            IF NOT v_mutated THEN v_outcome := 'SKIPPED_GATE'; END IF;
          ELSE
            UPDATE public.expedientes
            SET etapa_actual = 11, subestado = 'en_proceso', updated_at = NOW()
            WHERE id = p_expediente_id;
            PERFORM public.log_action(
              p_organization_id, NULL, NULL,
              'agenda_sheet.operational.signature_complete',
              'expediente', p_expediente_id,
              jsonb_build_object(
                'source', 'google_sheet', 'spreadsheet_id', p_spreadsheet_id,
                'sheet_id', p_sheet_id, 'sheet_row', p_sheet_row,
                'booking_id', p_booking_id, 'fingerprint', v_fp,
                'etapa_anterior', 10, 'etapa_nueva', 11, 'transition', '10_11'
              )
            );
            v_actions := array_append(v_actions, 'signature_complete');
            v_mutated := true;
            v_etapa_despues := 11;
            v_outcome := 'APPLIED';
          END IF;
        END IF;
      END IF;
    ELSE
      IF v_red_veto THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp,
            last_applied_at = NOW(),
            apply_outcome = 'COLOR_VETO',
            updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true,
          'outcome', 'COLOR_VETO',
          'fingerprint', v_fp,
          'expediente_id', p_expediente_id,
          'booking_id', p_booking_id,
          'kind', v_kind,
          'mutated', false,
          'reason', 'operational_red_veto',
          'biometric_cell_red', v_bio_red,
          'notification_cell_red', v_notif_red,
          'signature_cell_red', v_sig_red,
          'operational_red_veto', v_red_veto,
          'etapa_actual', v_exp.etapa_actual,
          'subestado', v_exp.subestado
        );

      ELSE
        v_outcome := 'NO_APPLY';
      END IF;
    END IF;
  END IF;

  IF v_outcome IS NULL THEN
    v_outcome := CASE WHEN v_mutated THEN 'APPLIED' ELSE 'NO_APPLY' END;
  END IF;

  SELECT e.etapa_actual, e.subestado INTO v_etapa_despues, v_sub_despues
  FROM public.expedientes e WHERE e.id = p_expediente_id;

  -- Guard: nunca 12 por Sheet; nunca tocar firma_agendable_desde
  IF v_etapa_despues >= 12 THEN
    RAISE EXCEPTION 'agenda_sheet_apply: no debe alcanzar etapa 12'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.agenda_sheet_operational_results
  SET last_applied_fingerprint = v_fp,
      last_applied_at = NOW(),
      apply_outcome = v_outcome,
      updated_at = NOW()
  WHERE id = v_ops.id;

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', v_outcome,
    'fingerprint', v_fp,
    'expediente_id', p_expediente_id,
    'booking_id', p_booking_id,
    'kind', v_kind,
    'etapa_anterior', v_etapa_antes,
    'etapa_actual', v_etapa_despues,
    'subestado_anterior', v_sub_antes,
    'subestado', v_sub_despues,
    'actions', to_jsonb(v_actions),
    'mutated', v_mutated
  );
END;
$function$;

-- Restore agenda_sheet_book_by_nss(p_organization_id uuid, p_spreadsheet_id text, p_sheet_id bigint, p_sheet_title text, p_sheet_date date, p_row_number integer, p_location_id text, p_kind booking_kind, p_slot_time time without time zone, p_slot_ordinal integer, p_nss text, p_scheduled_at timestamp with time zone, p_idempotency_key text)
CREATE OR REPLACE FUNCTION public.agenda_sheet_book_by_nss(p_organization_id uuid, p_spreadsheet_id text, p_sheet_id bigint, p_sheet_title text, p_sheet_date date, p_row_number integer, p_location_id text, p_kind booking_kind, p_slot_time time without time zone, p_slot_ordinal integer, p_nss text, p_scheduled_at timestamp with time zone, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nss TEXT;
  v_exp RECORD;
  v_asesor RECORD;
  v_booking_id UUID;
  v_link_id UUID;
  v_agenda_meta JSONB;
  v_existing_link public.agenda_sheet_slot_links%ROWTYPE;
  v_count_exp INTEGER;
  v_etapa SMALLINT;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_organization_id IS NULL
     OR NULLIF(btrim(COALESCE(p_spreadsheet_id, '')), '') IS NULL
     OR p_sheet_id IS NULL
     OR p_sheet_date IS NULL
     OR p_row_number IS NULL OR p_row_number <= 0
     OR p_slot_ordinal IS NULL OR p_slot_ordinal <= 0
     OR p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: parámetros incompletos'
      USING ERRCODE = '22023';
  END IF;

  IF p_location_id NOT IN ('monterrey', 'apodaca') THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: sede incompatible'
      USING ERRCODE = '22023';
  END IF;

  IF p_kind NOT IN ('biometricos', 'firmas') THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: tipo incompatible'
      USING ERRCODE = '22023';
  END IF;

  v_nss := public.agenda_sheet_normalize_nss(p_nss);
  IF v_nss IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: NSS inválido'
      USING ERRCODE = '22023';
  END IF;

  -- Fila ya vinculada
  SELECT * INTO v_existing_link
  FROM public.agenda_sheet_slot_links l
  WHERE l.spreadsheet_id = btrim(p_spreadsheet_id)
    AND l.sheet_id = p_sheet_id
    AND l.row_number = p_row_number
    AND l.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND AND v_existing_link.booking_id IS NOT NULL THEN
    -- Idempotencia: misma fila + mismo NSS + booking activo → devolver canónicos
    SELECT
      b.id AS booking_id,
      b.status,
      b.kind,
      b.location_id,
      b.booking_date,
      b.booking_time,
      e.id AS expediente_id,
      e.nss,
      e.cliente_nombre,
      e.asesor_id,
      e.etapa_actual,
      COALESCE(NULLIF(btrim(p.full_name), ''), p.email, '') AS asesor_nombre
    INTO v_exp
    FROM public.agenda_bookings b
    JOIN public.expedientes e ON e.id = b.expediente_id
    LEFT JOIN public.profiles p ON p.id = e.asesor_id
    WHERE b.id = v_existing_link.booking_id;

    IF FOUND
       AND v_exp.status = 'booked'
       AND public.agenda_sheet_normalize_nss(v_exp.nss) = v_nss
       AND v_existing_link.organization_id = p_organization_id THEN
      RETURN jsonb_build_object(
        'ok', true,
        'already', true,
        'booking_id', v_exp.booking_id,
        'link_id', v_existing_link.id,
        'expediente_id', v_exp.expediente_id,
        'nss', v_nss,
        'cliente_nombre', v_exp.cliente_nombre,
        'asesor_id', v_exp.asesor_id,
        'asesor_nombre', v_exp.asesor_nombre,
        'kind', v_exp.kind,
        'location_id', v_exp.location_id,
        'booking_date', v_exp.booking_date,
        'booking_time', to_char(v_exp.booking_time, 'HH24:MI'),
        'slot_ordinal', v_existing_link.slot_ordinal,
        'sync_status', v_existing_link.sync_status,
        'etapa_actual', v_exp.etapa_actual
      );
    END IF;

    RAISE EXCEPTION 'agenda_sheet_book_by_nss: Este espacio ya fue reservado en el CRM.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count_exp
  FROM public.expedientes e
  WHERE e.organization_id = p_organization_id
    AND e.nss = v_nss
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo';

  IF v_count_exp = 0 THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_count_exp > 1 THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.cliente_nombre,
    e.nss
  INTO v_exp
  FROM public.expedientes e
  WHERE e.organization_id = p_organization_id
    AND e.nss = v_nss
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo'
  FOR UPDATE;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.id, p.full_name, p.email
  INTO v_asesor
  FROM public.profiles p
  WHERE p.id = v_exp.asesor_id;

  IF p_kind = 'biometricos' THEN
    IF v_exp.etapa_actual NOT IN (3, 4, 5) THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp.id AND b.kind = 'biometricos' AND b.status = 'booked'
    ) OR EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp.id AND b.kind = 'notificacion' AND b.status = 'booked'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: La cita ya existe en otra fila u horario.'
        USING ERRCODE = '22023';
    END IF;
    IF v_exp.etapa_actual = 5 THEN
      IF v_exp.subestado <> 'en_proceso' THEN
        RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
          USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.agenda_bookings b
        WHERE b.expediente_id = v_exp.id AND b.kind = 'biometricos' AND b.status = 'cancelled'
          AND b.id = (
            SELECT b2.id FROM public.agenda_bookings b2
            WHERE b2.expediente_id = v_exp.id AND b2.kind = 'biometricos'
            ORDER BY b2.created_at DESC LIMIT 1
          )
      ) THEN
        RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    v_agenda_meta := public.agenda_biometricos_assert_slot_available(
      v_exp.organization_id, p_scheduled_at, p_location_id
    );
  ELSE
    IF v_exp.etapa_actual NOT IN (9, 10) OR v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp.id AND b.kind = 'firmas' AND b.status = 'booked'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: La cita ya existe en otra fila u horario.'
        USING ERRCODE = '22023';
    END IF;
    PERFORM public.agenda_firmas_assert_agendable_desde(
      v_exp.id, p_scheduled_at, p_location_id
    );
    v_agenda_meta := public.agenda_firmas_assert_slot_available(
      v_exp.organization_id, p_scheduled_at, p_location_id
    );
  END IF;

  -- Verifica que date/time del assert coincidan con la fila
  IF (v_agenda_meta->>'booking_date')::DATE IS DISTINCT FROM p_sheet_date
     OR (v_agenda_meta->>'booking_time')::TIME IS DISTINCT FROM p_slot_time THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: horario de fila no coincide con slot CRM'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    v_exp.organization_id, p_kind, v_exp.id,
    (v_agenda_meta->>'booking_date')::DATE,
    (v_agenda_meta->>'booking_time')::TIME,
    p_location_id, 'booked',
    'origen=google_sheets',
    v_exp.asesor_id
  )
  RETURNING id INTO v_booking_id;

  UPDATE public.expedientes
  SET fecha_cita = p_scheduled_at, updated_at = NOW()
  WHERE id = v_exp.id;

  v_etapa := v_exp.etapa_actual;
  IF p_kind = 'biometricos' AND v_exp.etapa_actual = 3 THEN
    UPDATE public.expedientes
    SET etapa_actual = 4, subestado = 'en_proceso', updated_at = NOW()
    WHERE id = v_exp.id;
    v_etapa := 4;
  END IF;

  INSERT INTO public.agenda_sheet_slot_links (
    organization_id, spreadsheet_id, sheet_id, sheet_title, sheet_date,
    row_number, location_id, kind, slot_time, slot_ordinal,
    booking_id, sync_status, sync_version, sync_source, last_synced_at
  ) VALUES (
    v_exp.organization_id, btrim(p_spreadsheet_id), p_sheet_id,
    COALESCE(NULLIF(btrim(p_sheet_title), ''), p_sheet_date::TEXT),
    p_sheet_date, p_row_number, p_location_id, p_kind, p_slot_time, p_slot_ordinal,
    v_booking_id, 'SINCRONIZADO', 1, 'sheets', NOW()
  )
  ON CONFLICT (spreadsheet_id, sheet_id, row_number) DO UPDATE
  SET
    booking_id = EXCLUDED.booking_id,
    location_id = EXCLUDED.location_id,
    kind = EXCLUDED.kind,
    slot_time = EXCLUDED.slot_time,
    slot_ordinal = EXCLUDED.slot_ordinal,
    sheet_date = EXCLUDED.sheet_date,
    sheet_title = EXCLUDED.sheet_title,
    sync_status = 'SINCRONIZADO',
    sync_source = 'sheets',
    last_synced_at = NOW(),
    sync_version = public.agenda_sheet_slot_links.sync_version + 1,
    deleted_at = NULL,
    updated_at = NOW()
  RETURNING id INTO v_link_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_exp.asesor_id,
    'asesor'::public.app_role,
    'agenda.sheet.book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'source', 'google_sheets',
      'nss', v_nss,
      'kind', p_kind,
      'location_id', p_location_id,
      'row_number', p_row_number,
      'sheet_id', p_sheet_id,
      'slot_ordinal', p_slot_ordinal,
      'link_id', v_link_id,
      'idempotency_key', p_idempotency_key,
      'etapa_actual', v_etapa
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'link_id', v_link_id,
    'expediente_id', v_exp.id,
    'nss', v_nss,
    'cliente_nombre', v_exp.cliente_nombre,
    'asesor_id', v_exp.asesor_id,
    'asesor_nombre', COALESCE(v_asesor.full_name, v_asesor.email, ''),
    'kind', p_kind,
    'location_id', p_location_id,
    'booking_date', (v_agenda_meta->>'booking_date'),
    'booking_time', to_char((v_agenda_meta->>'booking_time')::TIME, 'HH24:MI'),
    'slot_ordinal', p_slot_ordinal,
    'sync_status', 'SINCRONIZADO',
    'etapa_actual', v_etapa
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: Este espacio ya fue reservado en el CRM.'
      USING ERRCODE = '22023';
END;
$function$;

-- Restore avanzar_etapa_operativa(p_expediente_id uuid, p_comentario text)
CREATE OR REPLACE FUNCTION public.avanzar_etapa_operativa(p_expediente_id uuid, p_comentario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
  v_editor RECORD;
  v_tipo TEXT;
BEGIN
  IF NOT public.es_reingreso_post_biometricos_valido(p_expediente_id) THEN
    RETURN public.avanzar_etapa_operativa_pre_reingreso(
      p_expediente_id, p_comentario
    );
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_id IS NULL OR NOT FOUND OR v_actor.active IS NOT TRUE
     OR v_actor.app_role NOT IN (
       'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
     ) THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  JOIN public.expediente_rechazos_operativos r
    ON r.id = e.reingreso_rechazo_id
   AND r.expediente_id = e.expediente_anterior_id
  WHERE e.id = p_expediente_id
    AND e.etapa_actual = 6
    AND e.ciclo_estado = 'activo'
    AND e.subestado = 'en_proceso'
    AND e.submitted_to_mesa = true
    AND e.deleted_at IS NULL;

  IF NOT FOUND OR (
    v_actor.app_role <> 'super_admin'
    AND v_exp.organization_id IS DISTINCT FROM v_actor.organization_id
  ) OR NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT ed.decision, ed.monto_aprobado
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND OR v_editor.decision <> 'aprobado'
     OR v_editor.monto_aprobado IS NULL OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'REENTRY_AMOUNT_PENDING: falta nueva aprobación de monto'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_tipo IN ARRAY ARRAY[
    'cliente_comprobante_domicilio', 'cliente_estado_cuenta'
  ]::TEXT[] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.expediente_documentos d
      WHERE d.expediente_id = p_expediente_id
        AND d.tipo_documento = v_tipo
        AND d.deleted_at IS NULL
        AND d.estatus_revision = 'validado'
    ) THEN
      RAISE EXCEPTION 'REENTRY_DOCUMENTS_PENDING: falta documento validado %', v_tipo
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE public.expedientes
  SET etapa_actual = 7, subestado = 'en_proceso', updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'expediente.avanzar_etapa_operativa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor.app_role,
      'etapa_anterior', 6,
      'etapa_nueva', 7,
      'subestado_anterior', v_exp.subestado,
      'subestado_nuevo', 'en_proceso',
      'comentario', NULLIF(btrim(COALESCE(p_comentario, '')), ''),
      'transition', '6_7_reingreso'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'etapa_anterior', 6,
    'etapa_actual', 7,
    'subestado', 'en_proceso',
    'operativo_subestado', 'en_proceso',
    'comentario', NULLIF(btrim(COALESCE(p_comentario, '')), '')
  );
END;
$function$;

-- Restore avanzar_etapa_operativa_pre_reingreso(p_expediente_id uuid, p_comentario text)
CREATE OR REPLACE FUNCTION public.avanzar_etapa_operativa_pre_reingreso(p_expediente_id uuid, p_comentario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_cliente public.cliente_datos%ROWTYPE;
  v_docs_validados INTEGER;
  v_subestado_anterior public.operativo_subestado;
  v_comentario_final TEXT;
  v_subestado_nuevo public.operativo_subestado := 'en_proceso';
  v_booking_id UUID;
  v_fecha_cita TIMESTAMPTZ;
  v_booking_date DATE;
  v_booking_time TIME;
  v_location_id TEXT;
  v_envio public.retencion_envios%ROWTYPE;
  v_opcion_efectiva public.retencion_opcion;
  v_required_docs TEXT[];
  v_tipo_doc TEXT;
  v_doc_estatus public.estatus_revision;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_comentario_final := NULLIF(btrim(COALESCE(p_comentario, '')), '');

  SELECT
    e.id,
    e.organization_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.fecha_cita,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual = 1 THEN
    IF v_exp.subestado <> 'en_validacion_mesa' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_validacion_mesa (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    SELECT cd.*
    INTO v_cliente
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: faltan datos del cliente'
        USING ERRCODE = '22023';
    END IF;

    IF v_cliente.estado <> 'validado' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: datos del cliente deben estar validados por Mesa (actual: %)', v_cliente.estado
        USING ERRCODE = '22023';
    END IF;

    v_docs_validados := public.count_integration_docs_validados(p_expediente_id);

    IF NOT public.integration_docs_todos_validados(p_expediente_id) THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: faltan documentos obligatorios validados (% de %)', v_docs_validados, cardinality(public.integration_doc_tipos_obligatorios())
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 2,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 1,
        'etapa_nueva', 2,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'documentos_obligatorios_validados_count', v_docs_validados
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 1,
      'etapa_actual', 2,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'documentos_obligatorios_validados_count', v_docs_validados
    );
  ELSIF v_exp.etapa_actual = 2 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 3,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 2,
        'etapa_nueva', 3,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'transition', '2_3'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 2,
      'etapa_actual', 3,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final
    );
  ELSIF v_exp.etapa_actual = 3 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_fecha_cita := v_exp.fecha_cita;

    IF v_fecha_cita IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta fecha de notificación'
        USING ERRCODE = '22023';
    END IF;

    SELECT b.id
    INTO v_booking_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'notificacion'
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta notificación activa'
        USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = p_expediente_id
        AND b.kind = 'biometricos'
        AND b.status = 'booked'
    ) THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: transición 3→5 solo aplica con notificación activa, no biométricos'
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 5,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 3,
        'etapa_nueva', 5,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'booking_id', v_booking_id,
        'fecha_cita', v_fecha_cita,
        'comentario', v_comentario_final,
        'transition', '3_5_notificacion',
        'booking_kind', 'notificacion'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 3,
      'etapa_actual', 5,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final
    );
  ELSIF v_exp.etapa_actual = 4 THEN
    v_fecha_cita := v_exp.fecha_cita;

    IF v_fecha_cita IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta fecha de cita biométrica'
        USING ERRCODE = '22023';
    END IF;

    SELECT b.id
    INTO v_booking_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'biometricos'
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta booking biométrico activo'
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 5,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 4,
        'etapa_nueva', 5,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'booking_id', v_booking_id,
        'fecha_cita', v_fecha_cita,
        'comentario', v_comentario_final
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 4,
      'etapa_actual', 5,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'booking_id', v_booking_id,
      'fecha_cita', v_fecha_cita
    );
  ELSIF v_exp.etapa_actual = 5 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_fecha_cita := v_exp.fecha_cita;

    IF v_fecha_cita IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta fecha de cita biométrica'
        USING ERRCODE = '22023';
    END IF;

    IF v_fecha_cita > NOW() THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: cita biométrica aún no ha ocurrido'
        USING ERRCODE = '22023';
    END IF;

    SELECT b.id
    INTO v_booking_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'biometricos'
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta booking biométrico activo'
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 8,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 5,
        'etapa_nueva', 8,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'booking_id', v_booking_id,
        'fecha_cita', v_fecha_cita,
        'comentario', v_comentario_final,
        'transition', '5_8'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 5,
      'etapa_actual', 8,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final,
      'booking_id', v_booking_id,
      'fecha_cita', v_fecha_cita
    );
  ELSIF v_exp.etapa_actual = 6 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 7,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 6,
        'etapa_nueva', 7,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'transition', '6_7'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 6,
      'etapa_actual', 7,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final
    );
  ELSIF v_exp.etapa_actual = 7 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 8,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 7,
        'etapa_nueva', 8,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'transition', '7_8'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 7,
      'etapa_actual', 8,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final
    );
  ELSIF v_exp.etapa_actual = 8 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    SELECT cd.*
    INTO v_cliente
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;

    IF NOT FOUND OR v_cliente.estado <> 'validado' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: cliente_datos no validado'
        USING ERRCODE = '22023';
    END IF;

    SELECT re.*
    INTO v_envio
    FROM public.retencion_envios re
    WHERE re.expediente_id = p_expediente_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: retención no enviada'
        USING ERRCODE = '22023';
    END IF;

    IF v_envio.enviado IS NOT TRUE THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: retención no enviada'
        USING ERRCODE = '22023';
    END IF;

    IF v_envio.estado = 'correccion_requerida' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: retención requiere corrección'
        USING ERRCODE = '22023';
    END IF;

    IF v_envio.estado <> 'enviado' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: retención no enviada'
        USING ERRCODE = '22023';
    END IF;

    v_opcion_efectiva := v_envio.opcion;

    IF v_opcion_efectiva IS NULL THEN
      SELECT ro.retencion_opcion
      INTO v_opcion_efectiva
      FROM public.retencion_opciones ro
      WHERE ro.expediente_id = p_expediente_id;
    END IF;

    IF v_opcion_efectiva IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: opción de retención no encontrada'
        USING ERRCODE = '22023';
    END IF;

    v_required_docs := public.retencion_doc_tipos_requeridos(v_opcion_efectiva);

    FOREACH v_tipo_doc IN ARRAY v_required_docs
    LOOP
      SELECT d.estatus_revision
      INTO v_doc_estatus
      FROM public.expediente_documentos d
      WHERE d.expediente_id = p_expediente_id
        AND d.tipo_documento = v_tipo_doc
        AND d.deleted_at IS NULL
      ORDER BY d.created_at DESC
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'avanzar_etapa_operativa: documento de retención faltante'
          USING ERRCODE = '22023';
      END IF;

      IF v_doc_estatus NOT IN ('subido', 'resubido', 'validado') THEN
        RAISE EXCEPTION 'avanzar_etapa_operativa: documento de retención no listo para avance (%)', v_doc_estatus
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 9,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 8,
        'etapa_nueva', 9,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'transition', '8_9',
        'retencion_opcion', v_opcion_efectiva,
        'required_documentos', to_jsonb(v_required_docs)
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 8,
      'etapa_actual', 9,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final,
      'retencion_opcion', v_opcion_efectiva,
      'required_documentos', to_jsonb(v_required_docs)
    );
  ELSIF v_exp.etapa_actual = 9 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_fecha_cita := v_exp.fecha_cita;

    IF v_fecha_cita IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta fecha de cita de firma'
        USING ERRCODE = '22023';
    END IF;

    SELECT b.id, b.booking_date, b.booking_time, b.location_id
    INTO v_booking_id, v_booking_date, v_booking_time, v_location_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'firmas'
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta booking de firma activo'
        USING ERRCODE = '22023';
    END IF;

    -- P2C-20: no comparamos fecha_cita vs booking_date/time por riesgo de timezone;
    -- basta con fecha_cita + booking activo kind=firmas status=booked (mismo patrón que 4→5).

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 10,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 9,
        'etapa_nueva', 10,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'booking_id', v_booking_id,
        'fecha_cita', v_fecha_cita,
        'booking_date', v_booking_date,
        'booking_time', v_booking_time,
        'location_id', v_location_id,
        'comentario', v_comentario_final,
        'transition', '9_10',
        'kind', 'firmas'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 9,
      'etapa_actual', 10,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final,
      'booking_id', v_booking_id,
      'fecha_cita', v_fecha_cita,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'transition', '9_10',
      'kind', 'firmas'
    );
  ELSIF v_exp.etapa_actual = 10 THEN
    -- P117: Cita para firma → Firmado (interna 10→11 / visible 9→10)
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_fecha_cita := v_exp.fecha_cita;

    IF v_fecha_cita IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta fecha de cita de firma'
        USING ERRCODE = '22023';
    END IF;

    SELECT b.id, b.booking_date, b.booking_time, b.location_id
    INTO v_booking_id, v_booking_date, v_booking_time, v_location_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'firmas'
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta booking de firma activo'
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 11,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 10,
        'etapa_nueva', 11,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'booking_id', v_booking_id,
        'fecha_cita', v_fecha_cita,
        'booking_date', v_booking_date,
        'booking_time', v_booking_time,
        'location_id', v_location_id,
        'comentario', v_comentario_final,
        'transition', '10_11',
        'kind', 'firmas'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 10,
      'etapa_actual', 11,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final,
      'booking_id', v_booking_id,
      'fecha_cita', v_fecha_cita,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'transition', '10_11',
      'kind', 'firmas'
    );

  ELSIF v_exp.etapa_actual = 11 THEN
    -- P119.4: Firmado → Pago a ConCasa (interna 11→12 / visible 10→11)
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    -- Idempotencia: si ya está en 12 (carrera), no debería llegar aquí.
    -- No muta bookings, documentos, montos ni fecha_cita.
    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 12,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id
      AND etapa_actual = 11
      AND ciclo_estado = 'activo';

    IF NOT FOUND THEN
      -- Otra sesión avanzó o estado cambió: lectura post-update
      SELECT e.etapa_actual, e.subestado
      INTO v_exp.etapa_actual, v_exp.subestado
      FROM public.expedientes e
      WHERE e.id = p_expediente_id;

      IF v_exp.etapa_actual = 12 THEN
        RETURN jsonb_build_object(
          'ok', true,
          'expediente_id', p_expediente_id,
          'etapa_anterior', 11,
          'etapa_actual', 12,
          'subestado', v_exp.subestado,
          'operativo_subestado', v_exp.subestado,
          'comentario', v_comentario_final,
          'transition', '11_12',
          'idempotent', true
        );
      END IF;

      RAISE EXCEPTION 'avanzar_etapa_operativa: no se pudo avanzar 11→12 (estado actual: %)', v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 11,
        'etapa_nueva', 12,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'transition', '11_12'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 11,
      'etapa_actual', 12,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final,
      'transition', '11_12'
    );

  ELSE
    RAISE EXCEPTION 'avanzar_etapa_operativa: transición no permitida desde etapa %', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- Restore book_biometricos(p_expediente_id uuid, p_scheduled_at timestamp with time zone, p_location_id text, p_note text)
CREATE OR REPLACE FUNCTION public.book_biometricos(p_expediente_id uuid, p_scheduled_at timestamp with time zone, p_location_id text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_booking_id UUID;
  v_location_id TEXT;
  v_note TEXT;
  v_booking_date DATE;
  v_booking_time TIME;
  v_kind public.booking_kind := 'biometricos';
  v_status public.booking_status := 'booked';
  v_agenda_meta JSONB;
  v_etapa_actual SMALLINT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_biometricos: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'book_biometricos: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: scheduled_at es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: location_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'book_biometricos: la cita debe ser en fecha/hora futura'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_biometricos: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_biometricos: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'book_biometricos: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'book_biometricos: solo el asesor dueño puede agendar biométricos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'book_biometricos: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'book_biometricos: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual NOT IN (3, 4, 5) THEN
    RAISE EXCEPTION 'book_biometricos: solo se puede agendar en etapa 3, 4 o 5 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = v_kind
      AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'book_biometricos: ya existe una cita biométrica activa para este expediente'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'notificacion'
      AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'book_biometricos: ya existe una notificación activa para este expediente'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual = 5 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'book_biometricos: etapa 5 requiere subestado en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.agenda_bookings b
      WHERE b.expediente_id = p_expediente_id
        AND b.kind = v_kind
        AND b.status = 'cancelled'
        AND b.id = (
          SELECT b2.id
          FROM public.agenda_bookings b2
          WHERE b2.expediente_id = p_expediente_id
            AND b2.kind = v_kind
          ORDER BY b2.created_at DESC
          LIMIT 1
        )
    ) THEN
      RAISE EXCEPTION 'book_biometricos: etapa 5 requiere que la última cita biométrica esté cancelada'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_agenda_meta := public.agenda_biometricos_assert_slot_available(
    v_exp.organization_id,
    p_scheduled_at,
    v_location_id
  );

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;
  v_etapa_actual := v_exp.etapa_actual;

  BEGIN
    INSERT INTO public.agenda_bookings (
      organization_id,
      kind,
      expediente_id,
      booking_date,
      booking_time,
      location_id,
      status,
      note,
      created_by
    ) VALUES (
      v_exp.organization_id,
      v_kind,
      p_expediente_id,
      v_booking_date,
      v_booking_time,
      v_location_id,
      v_status,
      v_note,
      v_actor_id
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'book_biometricos: ya existe una cita biométrica activa para este expediente'
        USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET
    fecha_cita = p_scheduled_at,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  IF v_exp.etapa_actual = 3 THEN
    UPDATE public.expedientes
    SET etapa_actual = 4, updated_at = NOW()
    WHERE id = p_expediente_id;
    v_etapa_actual := 4;
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.biometricos.book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'asesor_id', v_exp.asesor_id,
      'organization_id', v_exp.organization_id,
      'scheduled_at', p_scheduled_at,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'note', v_note,
      'booking_kind', v_kind,
      'booking_status', v_status,
      'agenda_config_applied', true,
      'capacity_per_slot', v_agenda_meta->'capacity_per_slot',
      'booked_count_before', v_agenda_meta->'booked_count_before'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'expediente_id', p_expediente_id,
    'scheduled_at', p_scheduled_at,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'status', v_status,
    'kind', v_kind,
    'etapa_actual', v_etapa_actual
  );
END;
$function$;

-- Restore mesa_mover_etapa_operativa(p_expediente_id uuid, p_etapa_destino smallint, p_etapa_esperada smallint, p_motivo text)
CREATE OR REPLACE FUNCTION public.mesa_mover_etapa_operativa(p_expediente_id uuid, p_etapa_destino smallint, p_etapa_esperada smallint, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_motivo TEXT;
  v_subestado_destino public.operativo_subestado;
  v_movimiento_id UUID;
  v_direccion TEXT;
  v_reactivacion JSONB := NULL;
  v_subestado_origen public.operativo_subestado;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MESA_MOVE_UNAUTHORIZED: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'MESA_MOVE_UNAUTHORIZED: perfil inactivo o rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'MESA_MOVE_NOT_FOUND: expediente_id es obligatorio'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.etapa_actual,
    e.subestado,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESA_MOVE_NOT_FOUND: expediente no encontrado o no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'MESA_MOVE_NOT_VISIBLE: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'MESA_MOVE_NOT_SUBMITTED: expediente no enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'MESA_MOVE_CYCLE_NOT_ACTIVE: ciclo no activo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'MESA_MOVE_NOT_VISIBLE: expediente no visible para el actor'
      USING ERRCODE = '42501';
  END IF;

  v_subestado_origen := v_exp.subestado;

  IF v_exp.subestado = 'rechazado' THEN
    -- Override: reactivación canónica + movimiento en la misma transacción.
    v_reactivacion := public.reactivar_expediente_rechazado(p_expediente_id);
  ELSIF v_exp.subestado NOT IN ('pendiente', 'en_validacion_mesa', 'en_proceso') THEN
    RAISE EXCEPTION 'MESA_MOVE_BAD_SUBSTATE: subestado no elegible (%)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF p_etapa_destino IS NULL OR p_etapa_destino NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_BAD_DESTINATION: etapa destino debe estar entre 1 y 12'
      USING ERRCODE = '22023';
  END IF;

  IF p_etapa_esperada IS NULL OR p_etapa_esperada NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa esperada debe estar entre 1 y 12'
      USING ERRCODE = '40001';
  END IF;

  IF v_exp.etapa_actual <> p_etapa_esperada THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa actual %, esperada %',
      v_exp.etapa_actual, p_etapa_esperada
      USING ERRCODE = '40001';
  END IF;

  IF p_etapa_destino = v_exp.etapa_actual THEN
    RAISE EXCEPTION 'MESA_MOVE_SAME_STAGE: origen y destino son iguales'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'MESA_MOVE_REASON_REQUIRED: motivo obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_motivo) > 500 THEN
    RAISE EXCEPTION 'MESA_MOVE_REASON_TOO_LONG: máximo 500 caracteres'
      USING ERRCODE = '22023';
  END IF;

  v_subestado_destino := CASE
    WHEN p_etapa_destino = 1 THEN 'en_validacion_mesa'::public.operativo_subestado
    ELSE 'en_proceso'::public.operativo_subestado
  END;

  v_direccion := CASE
    WHEN abs(p_etapa_destino - v_exp.etapa_actual) > 1 THEN 'salto'
    WHEN p_etapa_destino > v_exp.etapa_actual THEN 'avance'
    ELSE 'retroceso'
  END;

  INSERT INTO public.expediente_movimientos_mesa (
    organization_id,
    expediente_id,
    etapa_origen,
    etapa_destino,
    subestado_origen,
    subestado_destino,
    motivo,
    actor_id,
    actor_role
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_exp.etapa_actual,
    p_etapa_destino,
    v_subestado_origen,
    v_subestado_destino,
    v_motivo,
    v_actor_id,
    v_actor_role
  )
  RETURNING id INTO v_movimiento_id;

  UPDATE public.expedientes
  SET
    etapa_actual = p_etapa_destino,
    subestado = v_subestado_destino,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'mesa.expediente.mover_etapa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'movimiento_id', v_movimiento_id,
      'etapa_anterior', v_exp.etapa_actual,
      'etapa_nueva', p_etapa_destino,
      'subestado_anterior', v_subestado_origen,
      'subestado_nuevo', v_subestado_destino,
      'direccion', v_direccion,
      'motivo', v_motivo,
      'movimiento_manual', true,
      'sin_efectos_adicionales', true,
      'reactivado', (v_reactivacion IS NOT NULL),
      'reactivacion_id', CASE
        WHEN v_reactivacion IS NULL THEN NULL
        ELSE v_reactivacion ->> 'reactivacion_id'
      END
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'movimiento_id', v_movimiento_id,
    'etapa_anterior', v_exp.etapa_actual,
    'etapa_actual', p_etapa_destino,
    'subestado_anterior', v_subestado_origen,
    'subestado', v_subestado_destino,
    'direccion', v_direccion,
    'reactivado', (v_reactivacion IS NOT NULL),
    'reactivacion_id', CASE
      WHEN v_reactivacion IS NULL THEN NULL
      ELSE v_reactivacion ->> 'reactivacion_id'
    END
  );
END;
$function$;

-- Restore register_expediente_documento_retencion(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
CREATE OR REPLACE FUNCTION public.register_expediente_documento_retencion(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
  v_mime TEXT;
  v_principal BOOLEAN;
  v_opcion public.retencion_opcion;
  v_etapa_anterior SMALLINT;
  v_etapa_nueva SMALLINT;
  v_avance_8_9 BOOLEAN := false;
  v_fecha_envio TIMESTAMPTZ;
  v_fecha_local DATE;
  v_firma_desde DATE;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.retencion_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: tipo_documento no permitido para retención (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_mime := lower(btrim(COALESCE(p_mime_type, '')));
  IF v_mime = 'image/jpg' THEN
    v_mime := 'image/jpeg';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(v_mime, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  v_principal := v_tipo IN (
    'retencion_acuse_con_sello',
    'retencion_carta_sin_sello'
  );

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at,
    e.firma_agendable_desde
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: solo el asesor dueño puede registrar documentos de retención'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: el expediente aún no fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF v_principal THEN
    IF v_exp.etapa_actual < 8 THEN
      RAISE EXCEPTION 'register_expediente_documento_retencion: expediente debe estar en etapa 8 o posterior (actual: %)', v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_exp.etapa_actual <> 8 THEN
      RAISE EXCEPTION 'register_expediente_documento_retencion: expediente debe estar en etapa 8 (actual: %)', v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  -- Hotfix Acuse: el dueño puede reemplazar el archivo activo (incl. validado)
  -- sin exigir rechazo Mesa. Soft-delete deja una sola versión activa.
  IF FOUND THEN
    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id,
    expediente_id,
    tipo_documento,
    storage_path,
    nombre_original,
    mime_type,
    size_bytes,
    version,
    estatus_revision,
    comentario_mesa,
    uploaded_by,
    uploaded_by_role
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_tipo,
    btrim(p_storage_path),
    btrim(p_nombre_original),
    v_mime,
    p_size_bytes,
    v_new_version,
    v_new_estatus,
    NULL,
    v_actor_id,
    'asesor'
  )
  RETURNING id INTO v_new_id;

  v_etapa_anterior := v_exp.etapa_actual;
  v_etapa_nueva := v_exp.etapa_actual;
  v_avance_8_9 := false;
  v_opcion := NULL;
  v_fecha_envio := NULL;
  v_firma_desde := v_exp.firma_agendable_desde;

  -- P132-acuse / P117: principal canónico + etapa exacta 8 → avance atómico 8→9
  -- + firma_agendable_desde solo si NULL (= hoy Monterrey; sin mínimo de 5 hábiles).
  IF v_principal AND v_exp.etapa_actual = 8 THEN
    v_opcion := CASE
      WHEN v_tipo = 'retencion_acuse_con_sello' THEN 'con_sello'::public.retencion_opcion
      ELSE 'sin_sello'::public.retencion_opcion
    END;
    v_fecha_envio := NOW();
    v_etapa_nueva := 9;
    v_avance_8_9 := true;
    v_fecha_local := (NOW() AT TIME ZONE 'America/Monterrey')::DATE;
    IF v_exp.firma_agendable_desde IS NULL THEN
      v_firma_desde := v_fecha_local;
    END IF;

    INSERT INTO public.retencion_opciones (
      expediente_id,
      organization_id,
      retencion_opcion,
      updated_by
    ) VALUES (
      p_expediente_id,
      v_exp.organization_id,
      v_opcion,
      v_actor_id
    )
    ON CONFLICT (expediente_id) DO UPDATE SET
      retencion_opcion = EXCLUDED.retencion_opcion,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW();

    INSERT INTO public.retencion_envios (
      expediente_id,
      organization_id,
      enviado,
      fecha_envio_mesa,
      opcion,
      estado
    ) VALUES (
      p_expediente_id,
      v_exp.organization_id,
      true,
      v_fecha_envio,
      v_opcion,
      'enviado'
    )
    ON CONFLICT (expediente_id) DO UPDATE SET
      enviado = true,
      fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
      opcion = EXCLUDED.opcion,
      estado = 'enviado',
      updated_at = NOW();

    UPDATE public.expedientes
    SET
      etapa_actual = 9,
      subestado = 'en_proceso',
      firma_agendable_desde = COALESCE(firma_agendable_desde, v_firma_desde),
      updated_at = NOW()
    WHERE id = p_expediente_id;
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.register_retencion',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', v_mime,
      'size_bytes', p_size_bytes,
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL,
      'avance_8_9', v_avance_8_9,
      'etapa_anterior', v_etapa_anterior,
      'etapa_nueva', v_etapa_nueva,
      'retencion_opcion', v_opcion,
      'firma_agendable_desde', v_firma_desde,
      'fecha_carga_local', v_fecha_local
    )
  );

  IF v_avance_8_9 THEN
    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.enviar_retencion_mesa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'retencion_opcion', v_opcion,
        'required_documentos', to_jsonb(public.retencion_doc_tipos_requeridos(v_opcion)),
        'is_resend', false,
        'estado_nuevo', 'enviado',
        'etapa_anterior', v_etapa_anterior,
        'etapa_nueva', v_etapa_nueva,
        'transition', '8_9_acuse',
        'p132_acuse_libera_firma', true,
        'documento_id', v_new_id,
        'tipo_documento', v_tipo,
        'firma_agendable_desde', v_firma_desde,
        'fecha_carga_local', v_fecha_local,
        'timezone', 'America/Monterrey'
      )
    );

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 8,
        'etapa_nueva', 9,
        'subestado_anterior', v_exp.subestado,
        'subestado_nuevo', 'en_proceso',
        'transition', '8_9_acuse',
        'evento', '8_9_acuse',
        'documento_id', v_new_id,
        'tipo_documento', v_tipo,
        'firma_agendable_desde', v_firma_desde,
        'fecha_carga_local', v_fecha_local,
        'timezone', 'America/Monterrey'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path),
    'mime_type', v_mime,
    'avance_8_9', v_avance_8_9,
    'etapa_anterior', v_etapa_anterior,
    'etapa_actual', v_etapa_nueva,
    'retencion_opcion', v_opcion,
    'firma_agendable_desde', v_firma_desde
  );
END;
$function$;

-- Restore repair_retencion_enviada_a_etapa_9(p_expediente_id uuid)
CREATE OR REPLACE FUNCTION public.repair_retencion_enviada_a_etapa_9(p_expediente_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_moved int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT e.id, e.organization_id
    FROM public.expedientes e
    WHERE e.deleted_at IS NULL
      AND e.etapa_actual = 8
      AND (p_expediente_id IS NULL OR e.id = p_expediente_id)
      AND public.expediente_has_retencion_enviada_valida(e.id)
    FOR UPDATE OF e
  LOOP
    UPDATE public.expedientes
    SET
      etapa_actual = 9,
      subestado = 'en_proceso',
      updated_at = NOW()
    WHERE id = r.id
      AND etapa_actual = 8;

    IF FOUND THEN
      v_moved := v_moved + 1;
      PERFORM public.log_action(
        r.organization_id,
        NULL,
        NULL,
        'expediente.retencion_repair_etapa_9',
        'expediente',
        r.id,
        jsonb_build_object(
          'etapa_anterior', 8,
          'etapa_nueva', 9,
          'razon_tecnica', 'acuse_enviado_etapa_8_inconsistente',
          'version', '145'
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'moved', v_moved);
END;
$function$;

COMMIT;
