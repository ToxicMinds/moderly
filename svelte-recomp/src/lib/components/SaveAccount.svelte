<script lang="ts">
  // Saving a trial: an email and a password turn it into a normal account in
  // place (same data, nothing moves), so it survives a lost phone and works on
  // a second device.
  import Modal from './Modal.svelte';
  import { saveAccount } from '$lib/stores/user';

  let { open = false, onclose }: { open?: boolean; onclose: () => void } = $props();
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let err = $state('');
  let done = $state(false);

  async function save() {
    err = '';
    busy = true;
    try { await saveAccount(email, password); done = true; }
    catch (e: any) { err = e?.message || 'Could not save the account. Nothing was lost; try again.'; }
    finally { busy = false; }
  }
</script>

<Modal {open} {onclose}>
  {#if done}
    <div class="sa-h">Saved</div>
    <p class="sa-p">Your account is <b>{email.trim()}</b> now. Log in with it on any device and everything is there.</p>
    <button class="btn bp bfl" onclick={onclose}>Done</button>
  {:else}
    <div class="sa-h">Save your account</div>
    <p class="sa-p">
      Right now your account lives on this device only: clear the browser or lose the phone and it's gone, and a trial
      nobody uses for 30 days is deleted. With an email and a password it's yours anywhere.
    </p>
    {#if err}<div class="sa-err" role="alert">{err}</div>{/if}
    <label class="flbl" for="sa-email">Email</label>
    <input id="sa-email" type="email" autocomplete="email" bind:value={email} placeholder="you@example.com">
    <label class="flbl" for="sa-pass">Password</label>
    <input id="sa-pass" type="password" autocomplete="new-password" bind:value={password} placeholder="At least 8 characters"
      onkeydown={(e) => e.key === 'Enter' && save()}>
    <p class="sa-note">Slim Chance can't email you a reset link yet, so keep the password somewhere safe, like your phone's password manager.</p>
    <button class="btn bp bfl" onclick={save} disabled={busy || !email || !password}>{busy ? 'Saving…' : 'Save my account'}</button>
  {/if}
</Modal>

<style>
  .sa-h{font-family:var(--font-display);font-size:1.5rem;font-weight:700;color:var(--text);margin-bottom:8px}
  .sa-p{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 12px}
  .sa-note{font-size:0.75rem;line-height:1.45;color:var(--muted);margin:2px 0 14px}
  .sa-err{background:var(--rb);color:var(--led-bad);font-size:0.8125rem;font-weight:600;padding:8px 10px;border-radius:var(--r-sm);margin-bottom:12px}
  input{margin-bottom:10px}
</style>
