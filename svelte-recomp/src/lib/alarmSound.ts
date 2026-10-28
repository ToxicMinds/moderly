// Plays a short, distinct alarm "melody" using the Web Audio API --
// synthesized on the fly (no audio file to download, no copyright
// concerns) so it reads as "this is an alarm" rather than a generic
// notification ping. Triggered from the service worker's 'push' handler
// (via postMessage to any open client) and again on notification tap,
// so opening the app after a missed alarm still gives the fuller
// "song-like" alert rather than just the one-shot system sound.
//
// Important limitation (see conversation): this can only play once the
// page/app is actually open (foreground or a backgrounded tab) -- the
// Web Notification API has no way to attach a custom sound file to the
// system-level notification banner itself when the app is fully closed;
// that one always uses the OS's default notification sound. This is a
// real improvement for the "app open" and "tap to open" cases, not a
// full replacement for the OS-level constraint.
let ctx: AudioContext | null = null;
let stopFlag = false;

function getCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
}

function playNote(freq: number, startTime: number, duration: number, gain = 0.2) {
  const audioCtx = getCtx();
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gainNode.gain.setValueAtTime(gain, startTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

// A short, cheerful ascending 8-note phrase (C-E-G-C-G-E-C-G, roughly),
// repeated a few times -- reads as "a little tune" rather than a beep.
const MELODY = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 523.25, 783.99];

export function playAlarmMelody(repeats = 3) {
  stopFlag = false;
  const audioCtx = getCtx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const noteDuration = 0.22;
  let t = audioCtx.currentTime;
  for (let r = 0; r < repeats; r++) {
    if (stopFlag) break;
    for (const freq of MELODY) {
      playNote(freq, t, noteDuration);
      t += noteDuration * 0.9;
    }
    t += 0.3; // brief pause between repeats
  }
}

export function stopAlarmMelody() {
  stopFlag = true;
}
