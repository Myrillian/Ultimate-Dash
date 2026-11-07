<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { FeedItem } from '@ultimate-dash/shared';
  import { auth } from '$lib/auth.svelte';
  import { news } from '$lib/feeds.svelte';
  import { formatAgo } from '$lib/format';
  import { menus } from '$lib/menus.svelte';
  import UiIcon from './UiIcon.svelte';

  /** sidebar = Leiste rechts (breite Bildschirme), section = Bereich unter den Gruppen */
  let { variant }: { variant: 'sidebar' | 'section' } = $props();

  let now = $state(Date.now());
  const ticker = setInterval(() => (now = Date.now()), 60_000);
  onDestroy(() => clearInterval(ticker));

  /** Bilder, die nicht geladen werden konnten: dann Buchstabe statt Bild. */
  let failed = $state<Record<number, true>>({});

  const collapsed = $derived(
    variant === 'sidebar' ? news.prefs.sidebarCollapsed : news.prefs.sectionCollapsed,
  );
  const titleId = $derived(`news-title-${variant}`);

  function toggle() {
    if (variant === 'sidebar') news.setSidebarCollapsed(!collapsed);
    else news.setSectionCollapsed(!collapsed);
  }

  /** Gleiche Quelle, gleiche Farbe. */
  function hue(name: string): number {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return hash;
  }

  const hasContent = $derived(news.status === 'ready' && news.items.length > 0);
</script>

{#snippet item(entry: FeedItem)}
  <li>
    <a
      href={entry.link}
      target="_blank"
      rel="noopener noreferrer"
      class="group flex gap-3 rounded-xl p-2 transition hover:bg-muted"
      title={entry.summary ?? entry.title}
    >
      {#if entry.hasImage && !failed[entry.id]}
        <img
          src="/api/feeds/images/{entry.id}"
          alt=""
          loading="lazy"
          decoding="async"
          class="h-12 w-16 shrink-0 rounded-lg bg-muted object-cover"
          onerror={() => (failed = { ...failed, [entry.id]: true })}
        />
      {:else}
        <span
          class="grid h-12 w-16 shrink-0 place-items-center rounded-lg text-lg font-semibold"
          style:background-color="hsl({hue(entry.feedName)} 70% 50% / 0.14)"
          style:color="hsl({hue(entry.feedName)} 60% 45%)"
          aria-hidden="true">{entry.feedName.slice(0, 1).toUpperCase()}</span
        >
      {/if}
      <span class="min-w-0 flex-1">
        <span class="line-clamp-2 text-sm leading-snug font-medium group-hover:text-accent">
          {entry.title}
        </span>
        <span class="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
          {#if news.isNew(entry)}
            <span class="size-1.5 shrink-0 rounded-full bg-accent" title="Neu"></span>
            <span class="sr-only">Neu:</span>
          {/if}
          <span class="truncate">{entry.feedName}</span>
          <span aria-hidden="true">·</span>
          <time class="shrink-0" datetime={entry.publishedAt}
            >{formatAgo(entry.publishedAt, now)}</time
          >
        </span>
      </span>
    </a>
  </li>
{/snippet}

{#snippet body()}
  {#if news.topics.length > 1}
    <div class="flex flex-wrap gap-1" role="group" aria-label="Thema">
      {#each [null, ...news.topics] as topic (topic ?? '')}
        {@const active = news.prefs.topic === topic}
        <button
          type="button"
          class="rounded-full border px-2 py-1 text-xs font-medium transition {active
            ? 'border-accent bg-accent text-accent-contrast'
            : 'border-line hover:bg-muted'}"
          aria-pressed={active}
          onclick={() => news.setTopic(topic)}
        >
          {topic ?? 'Alle'}
        </button>
      {/each}
    </div>
  {/if}

  {#if news.status === 'loading' || news.status === 'idle'}
    <ul class="grid gap-1" aria-busy="true" aria-label="Lädt">
      {#each { length: 5 } as _, index (index)}
        <li class="flex gap-3 p-2">
          <span class="h-12 w-16 animate-pulse rounded-lg bg-muted"></span>
          <span class="grid flex-1 gap-1.5">
            <span class="h-3.5 animate-pulse rounded bg-muted"></span>
            <span class="h-3 w-2/3 animate-pulse rounded bg-muted"></span>
          </span>
        </li>
      {/each}
    </ul>
  {:else if news.status === 'error'}
    <div class="grid justify-items-start gap-2 py-2 text-sm" role="alert">
      <p class="text-fg-muted">Meldungen konnten nicht geladen werden: {news.error}</p>
      <button type="button" class="btn" onclick={() => news.load()}>Erneut versuchen</button>
    </div>
  {:else if news.items.length === 0}
    <p class="py-4 text-sm text-fg-muted">
      Noch keine Meldungen. Neue Feeds werden im Hintergrund abgerufen, das kann ein paar Minuten
      dauern.
    </p>
  {:else}
    <ul class="-mx-2 grid gap-0.5">
      {#each news.items as entry (entry.id)}
        {@render item(entry)}
      {/each}
    </ul>
    {#if news.hasMore}
      <button
        type="button"
        class="btn w-full"
        disabled={news.loadingMore}
        onclick={() => news.loadMore()}
      >
        {news.loadingMore ? 'Lädt …' : 'Mehr laden'}
      </button>
    {/if}
  {/if}
{/snippet}

{#snippet actions()}
  {#if auth.isAdmin}
    <button
      type="button"
      class="icon-btn"
      aria-label="Feeds verwalten"
      title="Feeds verwalten"
      onclick={() => (menus.feedsOpen = true)}
    >
      <UiIcon name="settings" size={16} />
    </button>
  {/if}
{/snippet}

{#if variant === 'sidebar'}
  {#if collapsed}
    <button
      type="button"
      class="sticky top-4 flex w-11 flex-col items-center gap-2 rounded-2xl border border-line bg-elevated py-3 text-fg-muted transition hover:text-fg"
      aria-label="Neuigkeiten ausklappen{news.unseen ? ` (${news.unseen} neu)` : ''}"
      title="Neuigkeiten ausklappen"
      onclick={toggle}
    >
      <UiIcon name="news" />
      {#if news.unseen > 0}
        <span
          class="min-w-5 rounded-full bg-accent px-1 text-center text-[11px] leading-5 font-semibold text-accent-contrast tabular-nums"
          >{news.unseen > 99 ? '99+' : news.unseen}</span
        >
      {/if}
    </button>
  {:else}
    <section
      class="sticky top-4 flex max-h-[calc(100dvh-2rem)] w-[22rem] flex-col rounded-2xl border border-line bg-elevated"
      aria-labelledby={titleId}
    >
      <div class="flex items-center gap-2 border-b border-line py-2 pr-2 pl-4">
        <h2 id={titleId} class="flex flex-1 items-center gap-2 text-sm font-semibold">
          <UiIcon name="news" size={16} class="text-fg-muted" /> Neuigkeiten
        </h2>
        {@render actions()}
        <button
          type="button"
          class="icon-btn"
          aria-label="Neuigkeiten einklappen"
          title="Einklappen"
          onclick={toggle}
        >
          <UiIcon name="panel-close" size={16} />
        </button>
      </div>
      <div class="grid min-h-0 content-start gap-3 overflow-y-auto overscroll-contain p-4">
        {@render body()}
      </div>
    </section>
  {/if}
{:else}
  <section
    class="grid min-w-0 gap-3 rounded-2xl border border-line bg-elevated px-3 py-2 sm:px-4"
    aria-labelledby={titleId}
  >
    <div class="flex items-center gap-2">
      <h2 id={titleId} class="flex-1">
        <button
          type="button"
          class="flex w-full items-center gap-2 py-1 text-left text-sm font-semibold"
          aria-expanded={!collapsed}
          onclick={toggle}
        >
          <UiIcon name="news" size={16} class="text-fg-muted" />
          Neuigkeiten
          {#if collapsed && news.unseen > 0}
            <span class="text-xs font-normal text-fg-muted">({news.unseen} neu)</span>
          {:else if collapsed && hasContent}
            <span class="truncate text-xs font-normal text-fg-muted">{news.items[0]!.title}</span>
          {/if}
          <UiIcon
            name="chevron"
            size={16}
            class="ml-auto shrink-0 text-fg-muted transition {collapsed ? '' : 'rotate-180'}"
          />
        </button>
      </h2>
      {#if !collapsed}{@render actions()}{/if}
    </div>
    {#if !collapsed}
      <div class="grid gap-3 pb-2">
        {@render body()}
      </div>
    {/if}
  </section>
{/if}
