export function playerShortcut(key: string, target: EventTarget | null) {
  if (
    target instanceof Element &&
    target.closest(
      'input:not(.media-player-volume-slider),textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
    )
  )
    return null;
  switch (key.toLowerCase()) {
    case ' ':
    case 'k':
      return 'toggle';
    case 'm':
      return 'mute';
    case 'arrowright':
      return 'forward';
    case 'arrowleft':
      return 'backward';
    case 'l':
      return 'forward10';
    case 'j':
      return 'backward10';
    case 'arrowup':
      return 'volumeUp';
    case 'arrowdown':
      return 'volumeDown';
    case 'g':
      return 'subtitlesEarlier';
    case 'h':
      return 'subtitlesLater';
    case 'f':
      return 'fullscreen';
    case 't':
      return 'expanded';
    default:
      return null;
  }
}
