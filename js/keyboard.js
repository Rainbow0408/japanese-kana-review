export function resolveFlashcardSpaceAction({
  repeat = false,
  flashcardsActive = false,
  editable = false,
  dialogOpen = false,
  otherControlFocused = false,
  revealAvailable = false,
  knownAvailable = false,
} = {}) {
  if (repeat || !flashcardsActive || editable || dialogOpen || otherControlFocused) return null;
  if (revealAvailable) return 'reveal';
  if (knownAvailable) return 'known';
  return null;
}
