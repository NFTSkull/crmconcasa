export function shouldRecoverDraftWhenServerIsEmpty(params: {
  hasServerData: boolean;
  hasLocalDraft: boolean;
}): boolean {
  return !params.hasServerData && params.hasLocalDraft;
}
