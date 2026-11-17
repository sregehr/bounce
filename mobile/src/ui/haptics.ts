// Touch feedback. On an iPhone these are the system's own taps; in a browser they are a short
// buzz where the device has one and nothing where it does not. None of them can fail the app.
import * as Haptics from 'expo-haptics';

const quiet = (p: Promise<void>) => void p.catch(() => {});

/** A control took effect: a switch, a pick, a slider snapping back to rest. */
export const tick = () => quiet(Haptics.selectionAsync());
/** Something started or stopped: recording, a capture, a take. */
export const thump = () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
/** It worked: a take saved, a song finished, a file shared. */
export const success = () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
/** Stop and look: about to delete, or the mic clipped. */
export const warn = () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
/** It did not work. */
export const fail = () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
