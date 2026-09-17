/**
 * Shared Edge: DocumentExtractionProvider + Shadow (P3).
 */

export type DocumentExtractionPayloadNormalized = Readonly<{
  fields: Readonly<Record<string, unknown>>;
}>;

export type DocumentExtractionProviderInput = Readonly<{
  documentType: string;
  documentId: string;
  documentVersion: number;
  mimeType?: string | null;
  bytes?: Uint8Array | null;
}>;

export type DocumentExtractionProviderResult = Readonly<{
  provider: string;
  providerVersion: string;
  raw: Record<string, unknown> | null;
  normalized: DocumentExtractionPayloadNormalized;
}>;

export interface DocumentExtractionProvider {
  readonly name: string;
  readonly version: string;
  extract(
    input: DocumentExtractionProviderInput,
  ): Promise<DocumentExtractionProviderResult>;
}

export class ShadowDocumentExtractionProvider
  implements DocumentExtractionProvider
{
  readonly name = "shadow";
  readonly version = "p3";

  async extract(
    _input: DocumentExtractionProviderInput,
  ): Promise<DocumentExtractionProviderResult> {
    return {
      provider: this.name,
      providerVersion: this.version,
      raw: null,
      normalized: { fields: {} },
    };
  }
}

export function resolveDocumentExtractionProvider(
  provider: string,
): DocumentExtractionProvider | null {
  if (provider === "shadow") return new ShadowDocumentExtractionProvider();
  return null;
}
