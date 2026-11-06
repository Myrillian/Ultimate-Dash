<script lang="ts">
  import { formatAgo } from '$lib/format';

  interface Props {
    /** null = noch nicht per Ping geprüft */
    alive: boolean | null;
    lastSeen?: string | null;
    /** Text neben dem Punkt zeigen (sonst nur für Screenreader) */
    label?: boolean;
  }
  let { alive, lastSeen = null, label = true }: Props = $props();

  const text = $derived(alive === null ? 'Nicht geprüft' : alive ? 'Online' : 'Offline');
  const title = $derived(
    alive
      ? 'Antwortet auf Ping'
      : lastSeen
        ? `Antwortet nicht auf Ping, zuletzt gesehen ${formatAgo(lastSeen)}`
        : alive === false
          ? 'Antwortet nicht auf Ping (Geräte können Ping auch blockieren)'
          : 'Dieses Netz wurde noch nicht per Ping geprüft',
  );
</script>

<span class="inline-flex items-center gap-1.5 whitespace-nowrap" {title}>
  <!-- Form zusätzlich zur Farbe: gefüllt = online, Ring = offline, gestrichelt = unbekannt -->
  <span
    class="inline-block size-2.5 shrink-0 rounded-full border-2"
    class:border-up={alive === true}
    class:bg-up={alive === true}
    class:border-down={alive === false}
    class:border-dashed={alive === null}
    class:border-unknown={alive === null}
    aria-hidden="true"
  ></span>
  <span class={label ? 'text-xs' : 'sr-only'} class:text-fg-muted={alive !== true}>{text}</span>
</span>
