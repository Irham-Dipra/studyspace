import { notify } from "./notify";

type Lockable = ScreenOrientation & { lock?: (o: "landscape") => Promise<void> };

export const isFullscreen = () => !!document.fullscreenElement;

/**
 * Full screen, turned on its side where the device can (phones): for wide pages such as slides.
 * Called again, it goes back. A browser may refuse either part, so it says what happened.
 */
export async function toggleLandscape(): Promise<void> {
  const orientation = screen.orientation as Lockable | undefined;
  if (document.fullscreenElement) {
    try {
      orientation?.unlock?.();
    } catch {
      /* nothing was locked */
    }
    await document.exitFullscreen().catch(() => undefined);
    return;
  }
  const root = document.documentElement;
  if (!root.requestFullscreen) return notify("This browser can't go full screen. Turn the phone sideways instead.", "error");
  try {
    await root.requestFullscreen();
  } catch (e) {
    return notify(`Couldn't go full screen: ${(e as Error).message}`, "error");
  }
  // Only a phone or tablet can be turned; a computer just stays full screen.
  if (!orientation?.lock || !window.matchMedia("(pointer: coarse)").matches) return;
  try {
    await orientation.lock("landscape");
  } catch {
    notify("Full screen is on. This browser won't turn the page by itself: turn the phone sideways.");
  }
}
