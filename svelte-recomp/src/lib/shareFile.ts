// Getting a file (or a bit of text) OUT of the app, on both platforms.
//
// A browser downloads a Blob through an <a download>. Android's WebView does
// not: Capacitor installs no DownloadListener, so the same anchor click does
// nothing at all, silently. On native we write the file to the app's cache
// directory and hand its URI to the OS share sheet instead, which is also the
// more useful ending — the file goes straight to Drive, email or a chat rather
// than into a Downloads folder nobody opens.
//
// Used by BOTH the data export and the weekly-summary share, which is why it
// lives here rather than inside either of them.

import { isNativeApp as isNative } from './platform.ts';

export type DeliveryMethod = 'download' | 'share-sheet' | 'clipboard' | 'failed';

export interface DeliveryResult {
  method: DeliveryMethod;
  error?: string;
}

/**
 * Deliver a text file to the user by whatever route this platform actually
 * supports. Returns HOW it went out, so the UI can say something true ("Saved
 * to your downloads" vs "Choose where to send it") instead of a generic
 * success message that might be a lie on one of the two platforms.
 */
export async function deliverFile(
  filename: string,
  contents: string,
  mimeType = 'application/json'
): Promise<DeliveryResult> {
  if (isNative()) {
    try {
      const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'),
        import('@capacitor/share'),
      ]);
      // Cache, not Documents: this is a handoff to another app, not a library the
      // user manages. Android clears it on its own if space runs short.
      await Filesystem.writeFile({
        path: filename,
        data: contents,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
      await Share.share({ title: filename, url: uri, dialogTitle: 'Export your Slim Chance data' });
      return { method: 'share-sheet' };
    } catch (e: any) {
      // A share the user dismissed is not a failure — Capacitor rejects with
      // "Share canceled" and reporting that as an error would be a lie.
      const msg = e?.message || String(e);
      if (/cancel/i.test(msg)) return { method: 'share-sheet' };
      return { method: 'failed', error: msg.slice(0, 160) };
    }
  }

  try {
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can abort the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { method: 'download' };
  } catch (e: any) {
    return { method: 'failed', error: (e?.message || String(e)).slice(0, 160) };
  }
}

/**
 * Deliver plain text — the weekly summary — to whatever the OS offers. Native
 * gets the share sheet; the web gets navigator.share where it exists (Android
 * Chrome, iOS Safari) and the clipboard where it doesn't (most desktops).
 */
export async function deliverText(title: string, text: string): Promise<DeliveryResult> {
  if (isNative()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, dialogTitle: title });
      return { method: 'share-sheet' };
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (/cancel/i.test(msg)) return { method: 'share-sheet' };
      return { method: 'failed', error: msg.slice(0, 160) };
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return { method: 'share-sheet' };
    } catch (e: any) {
      // AbortError = the user closed the sheet. Not an error, and definitely not
      // a reason to then dump the text onto their clipboard behind their back.
      if (e?.name === 'AbortError') return { method: 'share-sheet' };
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return { method: 'clipboard' };
  } catch (e: any) {
    return { method: 'failed', error: (e?.message || String(e)).slice(0, 160) };
  }
}

/** What to tell the user after a delivery, matched to what actually happened. */
export function deliveryMessage(r: DeliveryResult, noun = 'Export'): string {
  switch (r.method) {
    case 'download': return `${noun} saved to your downloads.`;
    case 'share-sheet': return `${noun} ready — pick where to send it.`;
    case 'clipboard': return `${noun} copied to your clipboard.`;
    default: return `${noun} failed: ${r.error ?? 'unknown error'}`;
  }
}
