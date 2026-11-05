<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth.svelte';
  import AuthScreen from '$lib/components/AuthScreen.svelte';
  import Toaster from '$lib/components/Toaster.svelte';

  let { children } = $props();

  onMount(() => void auth.load());
</script>

{#if !auth.ready}
  <div class="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Lädt"></div>
{:else if auth.error && !auth.user}
  <main class="grid min-h-dvh place-items-center px-4">
    <div
      class="max-w-md rounded-2xl border border-down/40 bg-elevated p-6 text-center"
      role="alert"
    >
      <p class="font-medium">Der Server ist nicht erreichbar.</p>
      <p class="mt-1 text-sm text-fg-muted">{auth.error}</p>
      <button type="button" class="btn mt-4" onclick={() => auth.load()}>Erneut versuchen</button>
    </div>
  </main>
{:else if auth.setupRequired}
  <AuthScreen mode="setup" />
{:else if !auth.user}
  <AuthScreen mode="login" />
{:else}
  {@render children()}
{/if}
<Toaster />
