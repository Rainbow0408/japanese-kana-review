export function resolveFlashcardSpaceAction({
  repeat = false,
  flashcardsActive = false,
  editable = false,
  dialogOpen = false,
  revealAvailable = false,
  knownAvailable = false,
} = {}) {
  if (repeat || !flashcardsActive || editable || dialogOpen) return null;
  if (revealAvailable) return 'reveal';
  if (knownAvailable) return 'known';
  return null;
}
