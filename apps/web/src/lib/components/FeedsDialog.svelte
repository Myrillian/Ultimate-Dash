<script lang="ts">
  import {
    defaultFeedTopics,
    sortTopics,
    type Feed,
    type FeedPreview,
  } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { formatAgo } from '$lib/format';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';
  import UiIcon from './UiIcon.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let feeds = $state<Feed[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  /** Feed, der gerade bearbeitet oder dessen Löschen bestätigt wird. */
  let editing = $state<{ id: number; kind: 'edit' | 'delete' } | null>(null);
  let edit = $state({ name: '', url: '', topic: '' });
  let editErrors = $state<Record<string, string>>({});
  let busy = $state<number | 'defaults' | null>(null);

  let form = $state({ url: '', name: '', topic: 'IT' });
  let formErrors = $state<Record<string, string>>({});
  let preview = $state<FeedPreview | null>(null);
  let checking = $state(false);
  let creating = $state(false);

  const topics = $derived(sortTopics([...defaultFeedTopics, ...feeds.map((feed) => feed.topic)]));
  const byTopic = $derived(
    topics
      .map((topic) => ({ topic, feeds: feeds.filter((feed) => feed.topic === topic) }))
      .filter((entry) => entry.feeds.length > 0),
  );
  const broken = $derived(feeds.filter((feed) => feed.enabled && feed.lastError).length);

  $effect(() => {
    if (!open) return;
    editing = null;
    form = { url: '', name: '', topic: 'IT' };
    formErrors = {};
    preview = null;
    void load();
  });

  async function load() {
    loading = true;
    try {
      feeds = await api.feeds();
      loadError = null;
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Laden fehlgeschlagen';
    } finally {
      loading = false;
    }
  }

  function fail(error: unknown) {
    toasts.show(error instanceof Error ? error.message : 'Aktion fehlgeschlagen', 'error');
  }

  const replace = (updated: Feed) =>
    (feeds = feeds.map((feed) => (feed.id === updated.id ? updated : feed)));

  async function check() {
    formErrors = {};
    preview = null;
    checking = true;
    try {
      preview = await api.previewFeed(form.url.trim());
      if (!form.name.trim() && preview.title) form.name = preview.title.slice(0, 80);
    } catch (error) {
      formErrors =
        error instanceof ApiError && error.issues.length > 0
          ? error.fieldErrors()
          : { url: error instanceof Error ? error.message : 'Prüfung fehlgeschlagen' };
    } finally {
      checking = false;
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    formErrors = {};
    creating = true;
    try {
      const created = await api.createFeed({
        url: form.url.trim(),
        name: form.name.trim(),
        topic: form.topic.trim(),
      });
      feeds = [...feeds, created];
      toasts.show(
        created.lastError
          ? `${created.name} angelegt, Abruf fehlgeschlagen: ${created.lastError}`
          : `${created.name} angelegt (${created.itemCount} Meldungen)`,
        created.lastError ? 'error' : undefined,
      );
      form = { url: '', name: '', topic: form.topic };
      preview = null;
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) formErrors = error.fieldErrors();
      else if (error instanceof ApiError && error.status === 400)
        formErrors = { url: error.message };
      else fail(error);
    } finally {
      creating = false;
    }
  }

  function startEdit(feed: Feed, kind: 'edit' | 'delete') {
    editing = editing?.id === feed.id && editing.kind === kind ? null : { id: feed.id, kind };
    edit = { name: feed.name, url: feed.url, topic: feed.topic };
    editErrors = {};
  }

  async function saveEdit(event: SubmitEvent, feed: Feed) {
    event.preventDefault();
    editErrors = {};
    busy = feed.id;
    try {
      replace(
        await api.updateFeed(feed.id, {
          name: edit.name.trim(),
          url: edit.url.trim(),
          topic: edit.topic.trim(),
        }),
      );
      editing = null;
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) editErrors = error.fieldErrors();
      else if (error instanceof ApiError && error.status === 400)
        editErrors = { url: error.message };
      else fail(error);
    } finally {
      busy = null;
    }
  }

  async function toggle(feed: Feed) {
    busy = feed.id;
    try {
      replace(await api.updateFeed(feed.id, { enabled: !feed.enabled }));
    } catch (error) {
      fail(error);
    } finally {
      busy = null;
    }
  }

  async function refresh(feed: Feed) {
    busy = feed.id;
    try {
      const updated = await api.refreshFeed(feed.id);
      replace(updated);
      toasts.show(
        updated.lastError
          ? `Abruf fehlgeschlagen: ${updated.lastError}`
          : `${updated.name} abgerufen`,
        updated.lastError ? 'error' : undefined,
      );
    } catch (error) {
      fail(error);
    } finally {
      busy = null;
    }
  }

  async function remove(feed: Feed) {
    busy = feed.id;
    try {
      await api.deleteFeed(feed.id);
      feeds = feeds.filter((entry) => entry.id !== feed.id);
      editing = null;
      toasts.show(`${feed.name} entfernt`);
    } catch (error) {
      fail(error);
    } finally {
      busy = null;
    }
  }

  async function restoreDefaults() {
    busy = 'defaults';
    try {
      const { added } = await api.restoreDefaultFeeds();
      toasts.show(
        added === 0
          ? 'Alle Standardfeeds sind schon eingetragen'
          : `${added} Standardfeed${added === 1 ? '' : 's'} wieder angelegt`,
      );
      await load();
    } catch (error) {
      fail(error);
    } finally {
      busy = null;
    }
  }
</script>

<datalist id="feed-topics">
  {#each topics as topic (topic)}<option value={topic}></option>{/each}
</datalist>

<Dialog {open} title="Feeds verwalten" {onclose}>
  <div class="grid gap-6">
    <form class="grid gap-3" onsubmit={create} novalidate>
      <h3 class="text-sm font-semibold">Feed hinzufügen</h3>
      <div>
        <label class="field-label" for="feed-url">Adresse des RSS- oder Atom-Feeds</label>
        <div class="flex gap-2">
          <input
            id="feed-url"
            class="input"
            type="url"
            inputmode="url"
            placeholder="https://example.org/feed.xml"
            bind:value={form.url}
            aria-invalid={!!formErrors.url}
            aria-describedby={formErrors.url ? 'feed-url-err' : undefined}
          />
          <button
            type="button"
            class="btn shrink-0"
            disabled={!form.url.trim() || checking}
            onclick={check}
          >
            {checking ? 'Prüft …' : 'Prüfen'}
          </button>
        </div>
        {#if formErrors.url}<p id="feed-url-err" class="field-error">{formErrors.url}</p>{/if}
      </div>
      {#if preview}
        <div class="rounded-xl border border-line bg-muted/50 p-3 text-sm">
          <p class="font-medium">{preview.title ?? 'Feed ohne Titel'}</p>
          {#if preview.items.length === 0}
            <p class="text-fg-muted">Der Feed ist lesbar, enthält aber gerade keine Meldungen.</p>
          {:else}
            <ul class="mt-1 grid gap-0.5 text-fg-muted">
              {#each preview.items.slice(0, 3) as entry, index (index)}
                <li class="truncate">· {entry.title}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
      <div class="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div>
          <label class="field-label" for="feed-name">Name</label>
          <input id="feed-name" class="input" bind:value={form.name} maxlength="80" />
          {#if formErrors.name}<p class="field-error">{formErrors.name}</p>{/if}
        </div>
        <div>
          <label class="field-label" for="feed-topic">Thema</label>
          <input
            id="feed-topic"
            class="input"
            list="feed-topics"
            bind:value={form.topic}
            maxlength="40"
          />
          {#if formErrors.topic}<p class="field-error">{formErrors.topic}</p>{/if}
        </div>
      </div>
      <div>
        <button
          type="submit"
          class="btn btn-primary"
          disabled={creating || !form.url.trim() || !form.name.trim()}
        >
          <UiIcon name="plus" size={16} />
          {creating ? 'Wird angelegt …' : 'Hinzufügen'}
        </button>
      </div>
    </form>

    <div class="grid gap-4">
      <div class="flex items-baseline justify-between gap-3">
        <h3 class="text-sm font-semibold">
          Eingetragene Feeds <span class="font-normal text-fg-muted">({feeds.length})</span>
        </h3>
        {#if broken > 0}
          <p class="text-xs text-down">{broken} mit Abruffehler</p>
        {/if}
      </div>
      {#if loading && feeds.length === 0}
        <p class="text-sm text-fg-muted">Lädt …</p>
      {:else if loadError}
        <p class="text-sm text-down" role="alert">{loadError}</p>
      {:else if feeds.length === 0}
        <p class="text-sm text-fg-muted">Noch keine Feeds eingetragen.</p>
      {/if}
      {#each byTopic as group (group.topic)}
        <section class="grid gap-1" aria-label={group.topic}>
          <h4 class="text-[11px] tracking-wide text-fg-muted uppercase">{group.topic}</h4>
          <ul class="grid divide-y divide-line rounded-xl border border-line">
            {#each group.feeds as feed (feed.id)}
              <li class="grid gap-2 px-3 py-2">
                <div class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    class="size-4 shrink-0 accent-[var(--accent)]"
                    checked={feed.enabled}
                    disabled={busy === feed.id}
                    aria-label="{feed.name} anzeigen"
                    onchange={() => toggle(feed)}
                  />
                  <div class="min-w-0 flex-1" class:opacity-50={!feed.enabled}>
                    <p class="truncate text-sm font-medium">{feed.name}</p>
                    <p class="truncate text-xs text-fg-muted" title={feed.url}>
                      {#if feed.lastError}
                        <span class="text-down">Fehler: {feed.lastError}</span>
                      {:else if feed.lastFetchedAt}
                        {feed.itemCount} Meldungen · abgerufen {formatAgo(feed.lastFetchedAt)}
                      {:else}
                        Noch nicht abgerufen
                      {/if}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="{feed.name} jetzt abrufen"
                    title="Jetzt abrufen"
                    disabled={busy === feed.id || !feed.enabled}
                    onclick={() => refresh(feed)}
                  >
                    <UiIcon name="refresh" size={16} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="{feed.name} bearbeiten"
                    aria-expanded={editing?.id === feed.id && editing.kind === 'edit'}
                    onclick={() => startEdit(feed, 'edit')}
                  >
                    <UiIcon name="pencil" size={16} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn hover:text-down"
                    aria-label="{feed.name} entfernen"
                    aria-expanded={editing?.id === feed.id && editing.kind === 'delete'}
                    onclick={() => startEdit(feed, 'delete')}
                  >
                    <UiIcon name="trash" size={16} />
                  </button>
                </div>
                {#if editing?.id === feed.id && editing.kind === 'edit'}
                  <form
                    class="grid gap-2 pb-1"
                    onsubmit={(event) => saveEdit(event, feed)}
                    novalidate
                  >
                    <div class="grid gap-2 sm:grid-cols-[1fr_10rem]">
                      <div>
                        <label class="field-label" for="edit-name-{feed.id}">Name</label>
                        <input
                          id="edit-name-{feed.id}"
                          class="input"
                          bind:value={edit.name}
                          maxlength="80"
                        />
                        {#if editErrors.name}<p class="field-error">{editErrors.name}</p>{/if}
                      </div>
                      <div>
                        <label class="field-label" for="edit-topic-{feed.id}">Thema</label>
                        <input
                          id="edit-topic-{feed.id}"
                          class="input"
                          list="feed-topics"
                          bind:value={edit.topic}
                          maxlength="40"
                        />
                        {#if editErrors.topic}<p class="field-error">{editErrors.topic}</p>{/if}
                      </div>
                    </div>
                    <div>
                      <label class="field-label" for="edit-url-{feed.id}">Adresse</label>
                      <input
                        id="edit-url-{feed.id}"
                        class="input"
                        type="url"
                        bind:value={edit.url}
                      />
                      {#if editErrors.url}<p class="field-error">{editErrors.url}</p>{/if}
                    </div>
                    <div class="flex justify-end gap-2">
                      <button type="button" class="btn py-1.5" onclick={() => (editing = null)}
                        >Abbrechen</button
                      >
                      <button
                        type="submit"
                        class="btn btn-primary py-1.5"
                        disabled={busy === feed.id}>Speichern</button
                      >
                    </div>
                  </form>
                {:else if editing?.id === feed.id && editing.kind === 'delete'}
                  <div class="flex flex-wrap items-center justify-end gap-2 pb-1 text-sm">
                    <span class="mr-auto text-fg-muted"
                      >„{feed.name}“ mit allen Meldungen entfernen?</span
                    >
                    <button type="button" class="btn py-1.5" onclick={() => (editing = null)}
                      >Abbrechen</button
                    >
                    <button
                      type="button"
                      class="btn btn-danger py-1.5"
                      disabled={busy === feed.id}
                      onclick={() => remove(feed)}>Entfernen</button
                    >
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  </div>

  {#snippet footer()}
    <button
      type="button"
      class="btn mr-auto"
      disabled={busy === 'defaults'}
      onclick={restoreDefaults}
      title="Legt gelöschte Feeds aus der mitgelieferten Liste wieder an"
    >
      <UiIcon name="rss" size={16} /> Standardfeeds wiederherstellen
    </button>
    <button type="button" class="btn" onclick={onclose}>Schließen</button>
  {/snippet}
</Dialog>
