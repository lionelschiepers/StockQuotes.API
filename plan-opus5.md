# StockQuotes.API — Architecture, Security & Best-Practice Review

> Context: this API backs a **stock portfolio performance** front-end.
> Scope reviewed: `src/`, `tests/`, `host.json`, `local.settings.json`, `Dockerfile`,
> `.github/workflows/*`, `package.json`, `tsconfig*.json`, `.gitignore`.
> Date: 2026-07-31

---

## 1. Current structure

```
src/
  functions/          Azure Functions v4 HTTP triggers (programming model v4)
    yahoo-finance.ts              quotes            (GET/POST, anonymous)
    yahoo-finance-historical.ts   OHLC history      (anonymous)
    yahoo-finance-stock-options.ts options chains   (anonymous)
    exchange-rate-ecb.ts          ECB daily FX XML  (GET/POST, anonymous)
    statements.ts                 Alpha Vantage fundamentals (GET, anonymous)
  services/
    yahooFinanceService.ts   yahoo-finance2 wrapper + concurrency gate (max 2) + validators
    alphaVantageService.ts   axios + 1.1s pacing + merge income/balance/cashflow/earnings
    exchangeRateService.ts   axios -> ECB eurofxref-daily.xml, returns raw XML
    cacheService.ts          in-memory Map + optional JSON-file persistence, TTL, LRU-ish caps
    rateLimiter.ts           in-memory sliding window, two singletons (10/s and 4/s)
  di/container.ts       hand-rolled eager singleton object
tests/  8 Jest suites mirroring src/
```

**Assessment.** The layering (function → service → provider) is sound and consistently
applied; validation lives in services and is unit-tested; ESLint/Prettier/Husky/lint-staged,
Jest + Codecov, SonarQube, Trivy and Docker Scout are all wired into CI. That is a
better baseline than most projects of this size. The problems below are mostly about
**statefulness in a serverless runtime**, **exposure**, and **correctness for
performance calculations**.

---

## 2. Security findings

Severity: 🔴 high · 🟠 medium · 🟡 low

### 🔴 S1 — Secret baked into a public Docker image
`Dockerfile` uses `ARG ALPHAVANTAGE_API_KEY` → `ENV ALPHAVANTAGE_API_KEY=${...}`.
`ENV` is persisted in image metadata, so anyone running `docker inspect` /
`docker history` on `lionelschiepers/stockquote-node-api` (pushed to Docker Hub by
`build-docker.yml`) recovers the key. It is also visible to `/proc/1/environ`.

**Fix**: remove the `ARG`/`ENV` pair entirely; inject the key at *runtime*
(`docker run -e`, Compose secret, Azure App Setting, or Key Vault reference
`@Microsoft.KeyVault(SecretUri=...)` with managed identity). Rotate the current key.

### 🔴 S2 — Every endpoint is `authLevel: 'anonymous'`
All five functions are open to the internet, with no key, no JWT, no origin check.
Consequences: free proxy to Yahoo/ECB/Alpha Vantage under **your** quota and **your**
IP reputation, unbounded Azure egress/exec cost, and eventual upstream blocking.

**Fix (pick one, ideally two)**:
- `authLevel: 'function'` + key in the SPA's backend-for-frontend (never in browser JS);
- Entra ID / Easy Auth (`App Service Authentication`) validating a bearer token;
- put Azure API Management or Front Door in front (also gives quota + WAF + caching);
- if the SPA is on Azure Static Web Apps, use its linked-backend auth.

### 🔴 S3 — Rate limiting is ineffective and trivially bypassable
`rateLimiter.ts` keeps counters in a per-process `Map`.
1. **Per-instance only.** Consumption/Flex plans scale out; each instance has its own
   counter, so the real limit is `N_instances × 4/s`, and cold starts reset it.
2. **Spoofable key.** `request.headers.get('x-forwarded-for')` is attacker-controlled.
   Sending a random `X-Forwarded-For` per request gives unlimited throughput. Also
   `XFF` is a *list*; the whole string is used, so `1.2.3.4, 5.6.7.8` and `1.2.3.4`
   are different buckets.
3. **Shared `'unknown'` bucket.** When no header is present all callers collide, so
   one client can DoS everyone else.

**Fix**: enforce quotas at the edge (APIM `rate-limit-by-key`, Front Door, or
Cloudflare). If keeping it in-app, use a distributed store (Azure Cache for Redis,
`INCR`+`EXPIRE`) and derive the key from the **rightmost trusted** XFF hop, or from the
authenticated principal (see S2) rather than the IP.

### 🟠 S4 — Internal error messages leaked to clients
`yahoo-finance.ts`, `exchange-rate-ecb.ts` and `statements.ts` all end with
`jsonBody: { error: 'Internal server error', message: errorMessage }` where
`errorMessage` is the raw `Error.message` (may contain upstream URLs, the Alpha Vantage
`Information` text — which can echo the API key — stack-adjacent details).
Sonar flags this as information disclosure.

**Fix**: log the detail with `context.error` + a generated `correlationId`, return only
`{ error, correlationId }` to the caller.

### 🟠 S5 — Wildcard CORS everywhere
`Access-Control-Allow-Origin: '*'` is hardcoded in every handler, plus `"CORS": "*"` in
`local.settings.json` and `func start --cors *`. Combined with S2, any website can drive
your API from a visitor's browser.

**Fix**: allowlist the portfolio front-end origin(s) via the Function App CORS setting
and drop the hardcoded header from the handlers (or echo only allowed origins and add
`Vary: Origin`).

### 🟠 S6 — `local.settings.json` is tracked in git and shipped to Azure
It is *not* in `.gitignore` (`git ls-files` confirms it is tracked) and
`main_stock.yml` does `zip release.zip ./* -r` from the repo root, so it is deployed.
Today it only holds `ALPHAVANTAGE_API_KEY=demo`, but this is exactly how real keys leak.

**Fix**: add `local.settings.json` to `.gitignore`, `git rm --cached` it, commit a
`local.settings.sample.json`, and make the deploy package only `dist/`, `host.json`,
`package.json`, `node_modules` (prod).

### 🟠 S7 — Unvalidated symbols reach upstream URLs
- `alphaVantageService.fetchStatement/fetchEarnings` build the URL by string
  concatenation. `validateTicker` (`/^[A-Z0-9.]{1,10}$/`) currently saves it, but the
  pattern is fragile — one relaxed regex and you have parameter injection/SSRF-ish
  behaviour.
- `yahooFinanceService.validateHistoricalRequest` / `validateOptionsRequest` only check
  that the ticker is **non-empty**. Arbitrary strings are forwarded to `yahoo-finance2`.

**Fix**: use `axios.get(url, { params: {...} })` (proper encoding) and apply one shared
strict symbol regex (e.g. `/^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/i`) to *all* ticker inputs.

### 🟠 S8 — Disk cache writes attacker-influenced filenames
`cacheService.getCacheFilePath` sanitizes characters but not **length**. A 50-symbol ×
20-field quote request yields a filename of several hundred characters →
`ENAMETOOLONG`/silent write failures, and thousands of junk files (capped at 5000 by
`enforceDiskLimit`, which stats every file on every write — O(n) per request).

**Fix**: store under `sha256(key)` (fixed 64 chars) and keep the human key inside the
JSON body. Better: drop file persistence in Azure (see A4).

### 🟡 S9 — Docker/health details
- `HEALTHCHECK` calls `/api/exchange-rate-ecb` every 30 s: consumes the rate-limit
  bucket and, on cache miss, hits the ECB. Add a dedicated dependency-free
  `/api/health` (and use it here).
- `USER appuser` + `EXPOSE 80`: unprivileged users cannot bind ports < 1024 on Linux
  unless the base image sets `ASPNETCORE_URLS` to a high port or grants
  `CAP_NET_BIND_SERVICE`. Verify the container actually serves traffic; otherwise use
  port 8080.
- `curl` is installed in the runtime stage purely for the healthcheck — small extra
  attack surface; prefer a node one-liner or `wget --spider`.

### 🟡 S10 — Missing hardening basics
No `X-Content-Type-Options: nosniff`, no response size cap, `methods: ['GET','POST']`
on `yahoo-finance` and `exchange-rate-ecb` although only query parameters are read
(dead surface — restrict to `GET`). No max body size. No lint step in CI
(`pnpm run lint` is only enforced by the local Husky hook).

---

## 3. Correctness bugs worth fixing (portfolio-specific)

### 🔴 B1 — ETag is derived from the cache key, not from the payload
`yahoo-finance.ts`:
```ts
const etag = `"${Buffer.from(cacheKey).toString('base64')}"`;
```
The ETag depends only on `symbols`+`fields`, so it is **constant forever** for a given
query. A browser that once cached the response will receive `304 Not Modified`
indefinitely and **display stale prices**. For a portfolio performance app this is a
silent data-correctness failure.

**Fix**: `etag = '"' + sha256(JSON.stringify(payload)).slice(0,32) + '"'`, computed
after fetching, and only short-circuit with 304 when the freshly computed ETag matches.

### 🔴 B2 — Adjusted close is deliberately discarded
`yahooFinanceService.getHistoricalData` strips `adjclose`:
```ts
const { adjclose, ...rest } = quote;
```
Total return / TWR / benchmark comparison **require** split- and dividend-adjusted
prices. Without `adjclose` any performance number spanning a split (e.g. NVDA 10:1) or
a dividend is wrong.

**Fix**: return `adjclose` (optionally behind `fields=adjclose`), and expose
splits/dividends events from the `chart()` response.

### 🟠 B3 — Prices rounded to 2 decimals server-side
`Math.round(v * 100) / 100` on open/high/low/close loses precision for low-priced
instruments, FX-converted values and multi-year compounding, and introduces binary
float artifacts. Return full precision; round only in the UI.

### 🟠 B4 — Cache stampede (no single-flight)
On a cache miss, N concurrent identical requests all call upstream. The
`maxConcurrent = 2` gate in `YahooFinanceService` serialises but does not deduplicate,
and it is a **static** field shared across instances of the class — surprising for tests
and for any future multi-tenant use.

**Fix**: keep an in-flight `Map<key, Promise>` and return the same promise to
concurrent callers.

### 🟠 B5 — ECB daily file is insufficient for historical performance
`exchangeRateService` fetches `eurofxref-daily.xml` only and returns **raw XML** to the
client. Daily rates have no weekend/holiday entries and no history, so any
multi-currency portfolio valued on a past date cannot be converted correctly.

**Fix**: also consume `eurofxref-hist.xml` (or `eurofxref-hist-90d.xml`), parse
server-side into JSON `{ date, base: 'EUR', rates: {...} }`, and add
last-known-rate-carry-forward for non-business days. Add an explicit
`/api/exchange-rate?from=USD&to=EUR&date=2024-03-15` endpoint.

### 🟡 B6 — Alpha Vantage cache key uses server-local "today"
`statements-${new Date().toISOString().split('T')[0]}-${ticker}` rotates at UTC
midnight regardless of fiscal reporting; fine, but the pacing (`3 × 1100 ms` sleeps
inside the request) blocks a worker for >3.3 s per cold ticker and counts against the
5-minute `functionTimeout`. Prefer a timer-triggered pre-warm into a durable cache.

### 🟡 B7 — `applyFieldFilter` ratio branch is dead logic
In `filterRatioReport`, `reportedEPS` is copied into `filtered` unconditionally *before*
the `shouldIncludeField('ratio','reportedEPS')` check, so the check never changes the
result. Sonar will likely flag it.

---

## 4. Architecture & framework recommendations

### A1 — Extract HTTP middleware (removes ~150 duplicated lines)
Rate limiting, CORS headers, rate-limit headers and the error→HTTP mapping are copy-
pasted in all five handlers with subtle divergences. Introduce a composition helper:

```ts
export const withHttp = (opts: { limiter: RateLimiter }) =>
  (handler: Handler): HttpHandler => async (req, ctx) => { /* limit → cors → try/catch → map */ };

app.http('yahoo-finance', { methods: ['GET'], authLevel: 'function',
  handler: withHttp({ limiter: strictRateLimiter })(yahooFinanceHandler) });
```
Keep a single `mapError(error, correlationId)` used by every route.

### A2 — Replace hand-written validators with a schema library
`zod` (or `valibot`) gives declarative, composable, type-inferring validation and kills
the ~250 lines of `validateOptions*` / `validateDates` / `validateRange` boilerplate:

```ts
const QuoteQuery = z.object({
  symbols: z.string().transform(s => s.split(',')).pipe(z.array(Symbol).min(1).max(50)),
  fields:  z.string().optional().transform(...).pipe(z.array(z.string()).max(20).optional()),
});
```
Bonus: a single source of truth for the OpenAPI schema (`zod-to-openapi`).

### A3 — Type the Yahoo provider
`yahooFinanceService` uses `any` in ~15 places with `eslint-disable` comments.
`yahoo-finance2` v4 ships full types (`Quote`, `ChartResultArray`, `OptionsResult`).
Define an internal `MarketDataProvider` interface and let the concrete class satisfy it;
this also makes provider fallback (A6) possible and removes the Sonar `any` smells.

### A4 — Move cache and rate-limit state out of the process
In-memory + local-disk state is the core architectural mismatch with Functions:
per-instance, lost on scale-in/cold start, and on Consumption the "disk" is a shared
network file share (slow, and `fs.*Sync` blocks the event loop — `enforceDiskLimit`
does `readdirSync` + `statSync` per file on **every** `set`).

**Recommended**: Azure Cache for Redis (or Azure Table/Blob for the cheap option) behind
the existing `CacheService` interface — the abstraction is already there, only the
implementation changes. Keep the in-memory map as a short-TTL L1.
At minimum, switch all `fs.*Sync` calls to `fs/promises`.

### A5 — Real DI
`di/container.ts` instantiates every service eagerly at module load (so importing any
function file constructs the Alpha Vantage client and starts two `setInterval`s).
Either use factory functions with lazy memoisation, or adopt `tsyringe`/`awilix`.
Also: services export both a class *and* a module-level singleton
(`export const alphaVantageService = new AlphaVantageService()`), which is instantiated
in addition to the container's copy — remove the duplicates.

### A6 — Resilience around upstreams
None of the providers has retry, backoff, timeout budget or a circuit breaker; Yahoo
Finance in particular is an unofficial, ToS-restricted, frequently-breaking source and
is a single point of failure for the whole portfolio view.
- add `axios-retry` (exponential backoff + jitter, retry only 5xx/429/network);
- add a circuit breaker (`opossum`) so a Yahoo outage fails fast and serves stale cache;
- implement **stale-while-revalidate**: on upstream failure, return the last good cached
  payload with `X-Cache: STALE` rather than a 502 — a portfolio screen showing
  yesterday's close beats an error page;
- design a `MarketDataProvider` port with Yahoo primary and a paid fallback
  (Alpha Vantage / Twelve Data / EOD Historical / Finnhub) — and budget for a paid tier
  if this is anything more than a personal project.

### A7 — Observability
Beyond `context.log`, add: an App Insights custom metric per provider call
(latency, cache hit ratio, upstream error rate), a `correlationId` propagated into every
log line and error response, and an availability test. Consider
`@azure/monitor-opentelemetry`. Also add `/api/health` (liveness) and `/api/ready`.

### A8 — Delivery pipeline gaps
- `pnpm run lint` and a `tsc --noEmit` type-check are **not** in either workflow — add
  them (Husky only protects local commits).
- `main_stock.yml` zips the whole repo (`./*`) including `node_modules` with dev
  dependencies, `tests/`, `.cache/`, `local.settings.json`. Build a lean artifact:
  `pnpm install --prod --frozen-lockfile` into a clean dir + `dist/` + `host.json` +
  `package.json`. Faster cold starts, smaller attack surface.
- Two pipelines deploy two different artifacts (zip to Azure, image to Docker Hub) from
  the same commit with different build steps — consolidate or document which is
  authoritative.
- Node 22 in CI vs `node:4-node24` image vs `@types/node@^26` — align the runtime
  version across `main_stock.yml`, `build-docker.yml`, `Dockerfile`, `engines` in
  `package.json` and the Function App `linuxFxVersion`.
- The "Check for Critical Vulnerabilities" step only echoes text; either make Trivy fail
  the build (`exit-code: 1`, `severity: CRITICAL,HIGH`) or delete the placeholder.
- Add Dependabot/Renovate for `yahoo-finance2` and `axios` (both fast-moving).

### A9 — API contract
- Publish an OpenAPI 3.1 document (generated from the zod schemas) and serve it at
  `/api/openapi.json`; it makes the front-end typed via `openapi-typescript`.
- Version the routes (`/api/v1/...`) before external consumers appear.
- Enable response compression (`Content-Encoding: gzip/br`) — a 5-year weekly history
  for 20 tickers is a large JSON payload.
- Normalise the error shape across all endpoints (RFC 9457 `application/problem+json`).
- `exchange-rate-ecb` returning raw XML is the only non-JSON endpoint; make it JSON
  (see B5) and keep XML behind `Accept: application/xml` if needed.

---

## 5. Feature recommendations for a portfolio-performance API

The API is currently a set of thin market-data proxies; the portfolio logic presumably
lives in the client. Moving the calculations server-side gives consistency, testability
and a much smaller payload.

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/portfolio/valuation` | Positions + as-of date → market value, cost basis, unrealised P/L, per-position and total, in a chosen base currency |
| `POST /api/v1/portfolio/performance` | Transaction list → **TWR** (time-weighted, split into sub-periods at each cash flow) and **MWR/XIRR**, daily/monthly series |
| `POST /api/v1/portfolio/allocation` | Breakdown by asset class, sector, region, currency (sector/country come from `quoteSummary.assetProfile`) |
| `GET /api/v1/portfolio/dividends` | Projected and realised dividend income, yield-on-cost |
| `GET /api/v1/benchmark?symbol=^GSPC` | Normalised benchmark series for overlay + alpha/beta, Sharpe, max drawdown, volatility |
| `POST /api/v1/quotes/batch` | One request for quotes + history + FX for a whole portfolio (avoids N round-trips and N rate-limit hits) |
| `GET /api/v1/corporate-actions?ticker=` | Splits & dividends, needed to keep cost basis correct |
| `GET /api/v1/health` | Liveness + upstream provider status |

Supporting capabilities:
- **Currency normalisation** built into every response (`?baseCurrency=EUR`), using ECB
  historical rates with carry-forward (B5).
- **Total-return series** based on `adjclose` (B2) — non-negotiable for correct returns.
- **Snapshot/persistence**: a timer-triggered function that stores end-of-day closes for
  the user's watchlist in Table Storage. This decouples the app from Yahoo availability,
  makes historical charts instant, and enables backfilling.
- **Decimal arithmetic** (`decimal.js` or integer minor units) for money — never floats
  for cost basis and P/L (B3).
- **Idempotent, cacheable GETs** with content-derived ETags (B1) and
  `Cache-Control: public, max-age=60, stale-while-revalidate=600` for quotes,
  `max-age=86400, immutable` for closed historical ranges.

---

## 6. Suggested order of work

**Phase 1 — security (do first, small diffs)**
1. S1 remove the API key from the Docker image + rotate the key.
2. S6 untrack/ignore `local.settings.json`; slim the deploy artifact (A8).
3. S2 turn on `authLevel: 'function'` (or Easy Auth) and S5 restrict CORS.
4. S4 stop leaking `error.message`; add `correlationId`.
5. Add `pnpm run lint` + `tsc --noEmit` to both CI workflows.

**Phase 2 — correctness (visible to the portfolio UI)**
6. B1 content-based ETag. 7. B2 restore `adjclose`. 8. B3 stop rounding.
9. S7 one strict symbol validator everywhere; axios `params`.

**Phase 3 — architecture**
10. A1 middleware extraction. 11. A2 zod schemas. 12. A3 typed provider port.
13. A4 Redis/Table-backed cache + async fs. 14. S3 distributed or edge rate limiting.
15. A6 retry + circuit breaker + stale-while-revalidate. 16. B4 single-flight.

**Phase 4 — product**
17. `/api/v1/health`, OpenAPI + versioning, compression.
18. Portfolio valuation/performance endpoints and ECB historical FX (B5).
19. EOD snapshot timer function.

---

## 7. What is already good (keep it)

- Function → service → provider layering with validation unit-tested independently.
- Consistent use of `unknown` in `catch` and explicit error narrowing.
- Concurrency gate + upstream pacing to stay under provider limits.
- ETag/`Cache-Control`/`X-Cache` semantics (mechanism is right, the ETag *value* is the
  only bug).
- Multi-stage Dockerfile with a non-root user and `pnpm prune --prod`.
- CI with SHA-pinned actions, Codecov, SonarQube, Trivy and Docker Scout — pinning
  actions by SHA is a practice most repos skip.
- Husky + lint-staged enforcing Prettier/ESLint before commit.
