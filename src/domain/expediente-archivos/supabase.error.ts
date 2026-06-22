/** Error de lectura/escritura `expediente_documentos` vía Supabase. */
export class ExpedienteArchivosSupabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpedienteArchivosSupabaseError";
  }
}
