<script lang="ts">
  import UiIcon from './UiIcon.svelte';

  interface Props {
    id: string;
    value: string;
    autocomplete: 'current-password' | 'new-password' | 'off';
    error?: string;
    hint?: string;
    placeholder?: string;
  }

  let { id, value = $bindable(), autocomplete, error, hint, placeholder }: Props = $props();
  let visible = $state(false);

  const describedBy = $derived(
    [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined,
  );
</script>

<div class="relative">
  <input
    {id}
    class="input pr-10"
    type={visible ? 'text' : 'password'}
    bind:value
    {autocomplete}
    {placeholder}
    required
    aria-invalid={!!error}
    aria-describedby={describedBy}
  />
  <button
    type="button"
    class="icon-btn absolute top-1/2 right-1 -translate-y-1/2"
    onclick={() => (visible = !visible)}
    aria-label={visible ? 'Passwort verbergen' : 'Passwort anzeigen'}
    aria-pressed={visible}
  >
    <UiIcon name={visible ? 'eye-off' : 'eye'} size={16} />
  </button>
</div>
{#if error}<p id="{id}-err" class="field-error">{error}</p>{/if}
{#if hint}<p id="{id}-hint" class="field-hint">{hint}</p>{/if}
