<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';

  export let params: Record<string, string> = {};
</script>

<header>
  <nav class="container">
    <a href="/" class="logo">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
      </svg>
      pi fleet
    </a>
    <div class="nav-links">
      <a href="/" class:active={$page.url.pathname === '/'}>Machines</a>
      <a href="/sessions" class:active={$page.url.pathname === '/sessions'}>Sessions</a>
    </div>
  </nav>
</header>

<main class="container" data-route-params={Object.keys(params).sort().join(',') || 'none'}>
  <slot />
</main>

<style>
  header {
    position: sticky; top: 0; z-index: 100;
    background: rgba(15,15,18,0.85);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--border);
    padding: 0.75rem 0;
  }
  nav { display: flex; align-items: center; gap: 2rem; }
  .logo {
    display: flex; align-items: center; gap: 8px;
    font-weight: 700; font-size: 1rem;
    color: var(--text); letter-spacing: -0.01em;
  }
  .logo:hover { text-decoration: none; }
  .nav-links { display: flex; align-items: center; gap: 0.35rem; }
  .nav-links a {
    color: var(--text-muted);
    font-size: 0.875rem;
    font-weight: 500;
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    transition: color 0.15s ease, background 0.15s ease;
  }
  .nav-links a:hover { color: var(--text); text-decoration: none; background: rgba(255, 255, 255, 0.05); }
  .nav-links a.active {
    color: var(--accent);
    background: var(--accent-dim);
    border: 1px solid var(--accent-border);
  }
  .nav-links a:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  main { padding: 2rem 1rem 3rem; }
</style>
