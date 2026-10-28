// Client-side image downscaling for AI photo analysis.
//
// THE PROBLEM: the food + body-fat analyzers used to send the raw camera file
// as a base64 data URL untouched. A modern phone photo is 3-12 megapixels and
// several MB; base64 inflates that ~33% more. That bloats every Gemini request
// -- more image tiles to tokenise, slower uploads on mobile data, and a much
// bigger surface for the request to be throttled/rejected. None of that detail
// helps a calorie or body-fat estimate: the model tiles the image down anyway.
//
// So before any photo is sent to an edge function, we shrink it to a sane
// bound and re-encode as JPEG. This is pure browser (canvas), no dependency,
// and keeps enough resolution for the model to read a plate or a physique.

export interface ResizeOpts {
  /** Longest edge, in CSS pixels, after downscale. */
  maxEdge?: number;
  /** JPEG quality 0..1. */
  quality?: number;
}

/**
 * Read a File/Blob, downscale so its longest edge is <= maxEdge, and return a
 * JPEG data URL. If anything about the canvas path fails (e.g. an exotic image
 * type, a tainted-canvas edge case), it falls back to the original file as a
 * data URL so analysis still works -- degraded, never broken.
 */
export async function fileToDownscaledDataUrl(file: File | Blob, opts: ResizeOpts = {}): Promise<string> {
  const maxEdge = opts.maxEdge ?? 1024;
  const quality = opts.quality ?? 0.85;
  try {
    const dataUrl = await readAsDataUrl(file);
    const img = await loadImage(dataUrl);
    const { width, height } = img;
    if (!width || !height) return dataUrl;

    const longest = Math.max(width, height);
    // Already small enough -- but still re-encode to JPEG to strip any huge
    // PNG/HEIC payload, unless it's already a modest JPEG.
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/jpeg', quality);
    // Guard against a pathological case where re-encoding somehow produced a
    // larger string than the source (rare, but never send the bigger one).
    return out && out.length < dataUrl.length ? out : (scale < 1 ? out : dataUrl);
  } catch {
    // Last resort: hand back whatever we can read directly.
    try { return await readAsDataUrl(file); } catch { return ''; }
  }
}

function readAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}
