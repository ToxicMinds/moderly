<script lang="ts">
  // The front door: what someone sees before they have an account.
  //
  // It used to be a login box, so a stranger met a demand for an email before
  // seeing anything the app does. Now it says what Moderly is in three lines
  // and starts a trial in one tap (an anonymous account: everything works,
  // nothing to type), with consent still explicit. "I have an account" opens
  // the login.
  import { signIn, signUp, startTrial } from '$lib/stores/user';

  let mode = $state<'start' | 'login' | 'signup'>('start');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let err = $state('');
  let consent = $state(false);

  async function start() {
    err = '';
    busy = true;
    try { await startTrial(consent); }
    catch (e: any) { err = e?.message || 'Could not start. Check your connection and try again.'; }
    finally { busy = false; }
  }

  async function submit() {
    err = '';
    if (!email.trim() || !password) { err = 'Enter an email and password.'; return; }
    busy = true;
    try {
      if (mode === 'login') await signIn(email.trim(), password);
      else await signUp(email.trim(), password, consent);
    } catch (e: any) {
      err = e?.message || 'Something went wrong.';
    } finally {
      busy = false;
    }
  }
</script>

<div id="auth-gate">
  <div class="ag">
    <header class="ag-head">
      <svg class="ag-mark" viewBox="0 0 108 108" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <path d="M54 33V77" stroke-width="5"/><path d="M30 40H78" stroke-width="5"/><path d="M42 77H66" stroke-width="5"/>
          <path d="M30 40L22 57M30 40L38 57M78 40L70 57M78 40L86 57" stroke-width="2.4"/>
        </g>
        <g fill="currentColor"><circle cx="54" cy="40" r="4.2"/><path d="M19 57H41A11 6.5 0 0 1 19 57Z"/><path d="M67 57H89A11 6.5 0 0 1 67 57Z"/></g>
      </svg>
      <h1 class="ag-name">Moderly</h1>
      <p class="ag-tag">Lose weight moderately. Keep it off.</p>
      <p class="ag-sub">A calm weight-loss app for people doing it on their own. Free, private, no ads.</p>
    </header>

    {#if mode === 'start'}
      <ul class="ag-points">
        <li><b>A trend, not today's number.</b> The scale swings every day. Moderly draws the line through your mornings and says how sure it is.</li>
        <li><b>A rough food log is enough.</b> Your budget is learned from your own scale and your own log, so what you don't log cancels out.</li>
        <li><b>A plan for the hard moments.</b> Write what you'll do on a Friday night. Moderly hands it back on Friday night.</li>
      </ul>

      {#if err}<div class="ag-err" role="alert">{err}</div>{/if}
      <label class="ag-consent">
        <input type="checkbox" bind:checked={consent}>
        <span>I agree that Moderly keeps my weight, food and health data to run the app for me. <a href="/privacy.html">How it's kept</a></span>
      </label>
      <button class="btn bp bfl ag-go" onclick={start} disabled={busy || !consent}>{busy ? 'Starting…' : 'Start now'}</button>
      <p class="ag-note">No email needed to start. Save your account whenever you like.</p>
      <button class="ag-switch" onclick={() => { mode = 'login'; err = ''; }}>I have an account</button>
    {:else}
      <div class="ag-box">
        {#if err}<div class="ag-err" role="alert">{err}</div>{/if}
        <label class="flbl" for="auth-email">Email</label>
        <input id="auth-email" type="email" autocomplete="email" bind:value={email} placeholder="you@example.com">
        <label class="flbl" for="auth-pass">Password</label>
        <input id="auth-pass" type="password" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} bind:value={password} placeholder="••••••••"
          onkeydown={(e) => e.key === 'Enter' && submit()}>
        {#if mode === 'signup'}
          <label class="ag-consent">
            <input type="checkbox" bind:checked={consent}>
            <span>I agree that Moderly keeps my weight, food and health data to run the app for me. <a href="/privacy.html">How it's kept</a></span>
          </label>
        {/if}
        <button class="btn bp bfl ag-go" onclick={submit} disabled={busy || (mode === 'signup' && !consent)}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <button class="ag-switch" onclick={() => { mode = mode === 'login' ? 'signup' : 'login'; err = ''; }}>
          {mode === 'login' ? 'Create an account with email instead' : 'I already have an account'}
        </button>
        <button class="ag-switch" onclick={() => { mode = 'start'; err = ''; }}>Back</button>
      </div>
    {/if}

    <footer class="ag-links">
      <a href="/privacy.html">Privacy</a> · <a href="https://github.com/ToxicMinds/moderly" target="_blank" rel="noopener noreferrer">Open source</a>
    </footer>
  </div>
</div>

<style>
  #auth-gate{display:flex;justify-content:center;min-height:100dvh;padding:calc(var(--st) + 32px) 20px calc(var(--sb) + 28px)}
  .ag{width:100%;max-width:400px;display:flex;flex-direction:column}
  .ag-head{text-align:center;margin-bottom:22px}
  .ag-mark{width:64px;height:64px;color:var(--amber);display:block;margin:0 auto 6px}
  .ag-name{font-family:var(--font-display);font-size:3.25rem;font-weight:700;line-height:.95;margin:0;color:var(--text)}
  .ag-tag{font-family:var(--font-display);font-size:1.5rem;font-weight:600;line-height:1.2;margin:10px 0 6px;color:var(--amber);text-wrap:balance}
  .ag-sub{font-size:0.9375rem;color:var(--muted);line-height:1.5;margin:0;text-wrap:balance}
  .ag-points{list-style:none;margin:0 0 20px;padding:0;display:grid;gap:12px}
  .ag-points li{font-size:0.875rem;line-height:1.5;color:var(--muted);padding-left:14px;border-left:2px solid var(--amber)}
  .ag-points b{display:block;color:var(--text);font-size:0.9375rem;margin-bottom:1px}
  .ag-box{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 18px}
  .ag-box input{margin-bottom:12px}
  .ag-err{background:var(--rb);color:var(--led-bad);font-size:0.8125rem;font-weight:600;padding:8px 10px;border-radius:var(--r-sm);margin-bottom:12px}
  .ag-consent{display:flex;gap:10px;align-items:flex-start;font-size:0.8125rem;line-height:1.45;color:var(--text);margin:0 0 14px;cursor:pointer}
  .ag-consent input{width:20px;height:20px;flex-shrink:0;margin:1px 0 0;accent-color:var(--amber)}
  .ag-consent a,.ag-links a{color:var(--amber)}
  .ag-go{font-size:1rem;padding-block:14px}
  .ag-note{font-size:0.8125rem;color:var(--muted);text-align:center;margin:10px 0 0}
  .ag-switch{display:block;width:100%;text-align:center;background:none;border:none;color:var(--text);text-decoration:underline;text-underline-offset:3px;font-family:inherit;font-size:0.875rem;font-weight:600;margin-top:14px;cursor:pointer;padding:4px}
  .ag-links{text-align:center;font-size:0.8125rem;color:var(--muted);margin-top:auto;padding-top:28px}
</style>
