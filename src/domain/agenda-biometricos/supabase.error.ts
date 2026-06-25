export class AgendaBiometricosSupabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgendaBiometricosSupabaseError";
  }
}
