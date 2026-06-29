export class MesaOpsSupabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MesaOpsSupabaseError";
  }
}
