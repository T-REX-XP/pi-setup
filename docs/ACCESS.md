# Cloudflare Access (Zero Trust) Setup

**REQ-UI-002:** The fleet dashboard MUST be secured via Cloudflare Access (Zero Trust).

Cloudflare Access sits in front of the Pages deployment and requires authentication before serving any page — no credentials ever reach the browser unauthenticated.

---

## What Cloudflare Access does

- Blocks unauthenticated requests at the Cloudflare edge before they reach your Pages app
- Supports identity providers: Google, GitHub, Microsoft, one-time PIN (email), and more
- Issues short-lived JWTs to authenticated browsers (15-minute default)
- Free tier covers unlimited seats for self-hosted applications

---

## Setup (one-time, ~5 minutes)

### 1. Add your domain to Cloudflare (if not already)

Your `*.pages.dev` domain is automatically on Cloudflare. If you use a custom domain, add it to your Cloudflare account and proxy it (orange cloud).

### 2. Create an Access Application

1. Go to [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com) → **Access** → **Applications** → **Add an application**
2. Choose **Self-hosted**
3. Fill in:
   - **Application name:** `pi fleet dashboard`
   - **Session duration:** `24 hours` (or your preference)
   - **Application domain:** your Pages URL, e.g. `pi-fleet-dashboard.pages.dev`
   - **Path:** leave empty (protect the whole app)
4. Click **Next**

### 3. Create an Access Policy

1. **Policy name:** `fleet admins`
2. **Action:** Allow
3. **Include rule:**
   - Choose **Emails** and add your email address(es)
   - Or choose a Google/GitHub group if you have an IdP configured
4. Click **Next** → **Add application**

### 4. Configure an Identity Provider (optional but recommended)

By default, Cloudflare Access uses one-time PIN (email magic link). To use Google or GitHub:

1. In Zero Trust → **Settings** → **Authentication** → **Login methods** → **Add new**
2. Choose **Google** (or GitHub, Microsoft, etc.)
3. Follow the OAuth app setup instructions Cloudflare provides
4. Save and enable the provider

---

## Verifying it works

1. Open your Pages URL in an incognito window
2. You should see the Cloudflare Access login screen
3. Sign in with your configured identity
4. You should be redirected to the fleet dashboard

---

## Service tokens (for API / daemon access)

If any automated tool needs to access the Pages URL directly (unlikely — the dashboard is browser-only), create a **Service Token**:

1. Zero Trust → **Access** → **Service Auth** → **Service Tokens** → **Create Service Token**
2. Copy the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers
3. Include them in HTTP requests: `CF-Access-Client-Id: ...` and `CF-Access-Client-Secret: ...`

The fleet daemon talks directly to the **Worker** (`PI_SETUP_WORKER_URL`), not through the Pages app, so no service token is needed for normal fleet operation.

---

## Bypass for local development

When running the dashboard locally (`npm run dev` → `http://localhost:5173`), Cloudflare Access is **not** in the path. No changes needed for local dev.

---

## Notes

- The Cloudflare Worker (`pi-setup-secrets`) is **not** behind Access — it uses its own `PI_SETUP_BOOTSTRAP_TOKEN` for auth. Do not expose the worker URL publicly without understanding that the bootstrap token is the only protection.
- If you want to put the Worker behind Access too (optional, advanced), you can create a second Access application pointing to your `workers.dev` URL and use a Service Token from the daemon.

---

## See also

- [Cloudflare Access docs](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/)
- [`SETUP.md`](SETUP.md) — Pages deployment
- [`CLOUDFLARE.md`](CLOUDFLARE.md) — Worker API and bootstrap token
