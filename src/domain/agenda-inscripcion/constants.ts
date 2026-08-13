/** P175 — Cita extraordinaria de inscripción (hora fija, sin aliases). */

export const INSCRIPCION_FIXED_TIME = "11:00" as const;
export const INSCRIPCION_FIXED_TIME_DISPLAY = "11:00 AM" as const;
export const INSCRIPCION_BOOKING_KIND = "inscripcion" as const;

/** Kill switch fail-closed para crear requisitos desde Sheet (independiente de P170). */
export const GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED =
  "GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED" as const;
export const GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE =
  "GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE" as const;
