/**
 * Lightweight one-shot callback so CropScreen can hand a cropped URI back to
 * AddEntryScreen without polluting the navigation stack with extra params or
 * extra screen instances.
 *
 * Usage:
 *   AddEntryScreen calls setCropCallback() before navigating to Crop.
 *   CropScreen calls consumeCropCallback() then navigation.goBack().
 */

let _cb: ((uri: string) => void) | null = null;

export function setCropCallback(cb: (uri: string) => void): void {
  _cb = cb;
}

/** Calls the registered callback with the cropped URI and clears it. */
export function consumeCropCallback(uri: string): void {
  if (_cb) {
    _cb(uri);
    _cb = null;
  }
}
