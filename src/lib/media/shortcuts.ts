export function playerShortcut(
  key: string,
  target: EventTarget | null,
): 'toggle' | 'forward' | 'backward' | null {
  if (
    target instanceof Element &&
    target.closest('input,textarea,select,button,a,[contenteditable="true"]')
  )
    return null;
  return key === ' ' || key.toLowerCase() === 'k'
    ? 'toggle'
    : key === 'ArrowRight'
      ? 'forward'
      : key === 'ArrowLeft'
        ? 'backward'
        : null;
}
