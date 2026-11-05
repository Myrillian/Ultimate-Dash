<script lang="ts">
  import { resolveIcon } from '$lib/icons';

  let { icon, name, size = 40 }: { icon: string | null; name: string; size?: number } = $props();

  let failed = $state(false);
  const resolved = $derived(failed ? resolveIcon(null, name) : resolveIcon(icon, name));

  // Neues Icon → neuer Ladeversuch.
  $effect(() => {
    void icon;
    failed = false;
  });
</script>

{#if resolved.kind === 'image'}
  <img
    src={resolved.src}
    alt=""
    width={size}
    height={size}
    loading="lazy"
    decoding="async"
    referrerpolicy="no-referrer"
    class="shrink-0 object-contain"
    style:width="{size}px"
    style:height="{size}px"
    onerror={() => (failed = true)}
  />
{:else}
  <span
    aria-hidden="true"
    class="grid shrink-0 place-items-center rounded-xl font-semibold text-white select-none"
    style:width="{size}px"
    style:height="{size}px"
    style:font-size="{Math.round(size * 0.38)}px"
    style:background="linear-gradient(135deg, hsl({resolved.hue} 65% 52%), hsl({(resolved.hue +
      40) %
      360} 65% 42%))"
  >
    {resolved.text}
  </span>
{/if}
