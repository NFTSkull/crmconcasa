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
$function$

