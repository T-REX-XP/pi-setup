<script lang="ts">
  /** Node-style platform: `darwin`, `win32`, `linux`, etc. */
  export let platform: string = '';
  export let size = 24;

  type Kind = 'darwin' | 'win32' | 'linux' | 'freebsd' | 'unknown';

  function kind(p: string): Kind {
    const x = (p || '').toLowerCase();
    if (x === 'darwin') return 'darwin';
    if (x === 'win32') return 'win32';
    if (x === 'linux') return 'linux';
    if (x.includes('bsd')) return 'freebsd';
    return 'unknown';
  }

  $: k = kind(platform);
  $: label =
    k === 'darwin'
      ? 'macOS'
      : k === 'win32'
        ? 'Windows'
        : k === 'linux'
          ? 'Linux'
          : k === 'freebsd'
            ? 'BSD'
            : platform || 'OS';
</script>

<span
  class="platform-icon kind-{k}"
  style:width="{size}px"
  style:height="{size}px"
  role="img"
  aria-label={label}
  title={platform ? `${label} (${platform})` : label}
>
  {#if k === 'darwin'}
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
      />
    </svg>
  {:else if k === 'win32'}
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5.45l7.5-1v7.35H3V5.45zm0 8.55l7.5.85V22L3 20.55v-6.55zm8.65-9.55L21 3v9.35h-9.35V4.45zM12.65 13.85L21 14.7V22l-8.35-1.35v-6.8z" />
    </svg>
  {:else if k === 'linux'}
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <ellipse cx="12" cy="16" rx="4.2" ry="5.2" />
      <ellipse cx="8.3" cy="17.2" rx="1.1" ry="1.6" />
      <ellipse cx="15.7" cy="17.2" rx="1.1" ry="1.6" />
    </svg>
  {:else if k === 'freebsd'}
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
      />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 7h6M9 11h6M9 15h4" stroke-linecap="round" />
    </svg>
  {/if}
</span>

<style>
  .platform-icon {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }
  .platform-icon.kind-darwin { color: #a8a8a8; }
  .platform-icon.kind-win32 { color: #60a5fa; }
  .platform-icon.kind-linux { color: #fbbf24; }
  .platform-icon.kind-freebsd { color: #c084fc; }
  .platform-icon svg { width: 100%; height: 100%; display: block; }
</style>
