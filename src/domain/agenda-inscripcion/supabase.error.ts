/** Error tipado dominio inscripción. */
export class AgendaInscripcionError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "AgendaInscripcionError";
    this.code = code;
  }
}
