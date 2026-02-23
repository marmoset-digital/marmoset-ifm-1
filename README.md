# 🐒 Marmoset Hub — Integration Engine

> Custom Zapier replacement for Aoun Constructions  
> Connects **Gravity Forms → eWAY → ServiceM8 → Xero**

Built by [Marmoset](https://marmoset.com.au) as a fully custom, vibe-coded integration engine to replace Zapier with a faster, more reliable, and fully auditable system.

---

## How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Gravity Forms│────▶│ Marmoset Hub │────▶│  ServiceM8   │     │     Xero     │
│ (Order Form) │     │  (Next.js)   │────▶│  (Field Mgmt)│     │ (Accounting) │
└──────────────┘     └──────┬───────┘     └──────────────┘     └──────────────┘
                            │                                         ▲
                            ▼                                         │
                     ┌──────────────┐                                 │
                     │     eWAY     │─────────────────────────────────┘
                     │  (Payments)  │
                     └──────────────┘
```

### Order Flow

1. **Customer submits order** on the WordPress site via Gravity Forms
2. **Webhook fires** to `POST /api/webhooks/gravity-forms`
3. **Engine validates** the order (including $20K bank transfer threshold)
4. **Payment processing:**
   - **Credit card** → eWAY processes immediately → proceed to step 5
   - **Bank transfer** → Order saved as `payment_pending` → Xero draft invoice created → **STOP** (ServiceM8 job deferred until payment confirmed)
5. **ServiceM8 sync** → Creates client + job with full specs, materials, and notes
6. **Xero sync** → Creates contact + itemised invoice (AUTHORISED for CC, DRAFT for bank transfer)
7. **All steps logged** to `sync_logs` for full audit trail

### Payment Rules

| Total Amount | Payment Options |
|---|---|
| Under $20,000 | Credit card only (enforced by form + server) |
| $20,000+ | Credit card OR bank transfer |

### Bank Transfer Flow

Bank transfer orders use the Gravity Forms unique ID (e.g. `SW100`) as the payment reference. When the transfer clears:

1. Call `POST /api/webhooks/eway` with `{ "order_id": "...", "confirmation_type": "bank_transfer" }`
2. Engine creates the ServiceM8 job (deferred from order time)
3. Xero invoice updated from DRAFT → AUTHORISED

---

## Tech Stack

| Technology | Purpose |
|---|---|
| **Next.js 14** | API routes + future dashboard |
| **Supabase** | PostgreSQL database + auth |
| **Vercel** | Hosting + serverless deployment |
| **TypeScript** | Type safety across all API integrations |

---

## Project Structure

```
marmoset-hub/
├── src/
│   ├── app/api/
│   │   ├── webhooks/
│   │   │   ├── gravity-forms/route.ts   # Main webhook entry point
│   │   │   └── eway/route.ts            # Payment confirmations
│   │   ├── retry/[orderId]/route.ts     # Retry failed syncs
│   │   └── orders/
│   │       ├── route.ts                  # List orders (GET)
│   │       └── [id]/route.ts            # Order detail (GET)
│   ├── lib/
│   │   ├── orchestrator.ts              # Main flow coordinator
│   │   ├── supabase.ts                  # Database client
│   │   ├── sync-logger.ts              # Audit trail logger
│   │   ├── mappers/
│   │   │   ├── gravity-forms.ts         # GF payload → ParsedOrder
│   │   │   ├── servicem8.ts             # ParsedOrder → SM8 payloads
│   │   │   └── xero.ts                 # ParsedOrder → Xero payloads
│   │   ├── services/
│   │   │   ├── eway.ts                  # eWAY payment processing
│   │   │   ├── servicem8.ts             # ServiceM8 API client
│   │   │   └── xero.ts                 # Xero API client
│   │   └── validators/
│   │       └── order.ts                 # Order validation rules
│   └── types/
│       └── index.ts                     # All TypeScript types
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql       # Database schema
├── .env.example                         # Environment variables template
├── package.json
├── tsconfig.json
└── next.config.js
```

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url> marmoset-hub
cd marmoset-hub
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the migration: go to SQL Editor and paste the contents of `supabase/migrations/001_initial_schema.sql`
3. Copy your project URL and service role key

### 3. Configure environment variables

```bash
cp .env.example .env.local
# Fill in all values in .env.local
```

### 4. Set up API credentials

- **eWAY**: Get API key + password from your [eWAY merchant portal](https://go.eway.io/)
- **ServiceM8**: Register an app at [developer.servicem8.com](https://developer.servicem8.com/) and get OAuth tokens
- **Xero**: Create an app at [developer.xero.com](https://developer.xero.com/) and complete the OAuth2 flow

### 5. Configure the Gravity Forms webhook

In your WordPress admin:
1. Go to Forms → Settings → Webhooks
2. Add a new webhook for your order form
3. URL: `https://your-app.vercel.app/api/webhooks/gravity-forms?secret=YOUR_SECRET`
4. Method: POST
5. Format: JSON
6. Map all fields

### 6. Deploy to Vercel

```bash
npm i -g vercel
vercel
# Follow the prompts, then add all env vars in the Vercel dashboard
```

### 7. Test

```bash
# Health check
curl https://your-app.vercel.app/api/webhooks/gravity-forms

# Submit a test order through the form and monitor:
# - Vercel function logs
# - Supabase sync_logs table
# - ServiceM8 job list
# - Xero invoice list
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/webhooks/gravity-forms` | Receives order form submissions |
| `GET` | `/api/webhooks/gravity-forms` | Health check |
| `POST` | `/api/webhooks/eway` | Confirm bank transfer payments |
| `POST` | `/api/retry/:orderId?service=servicem8` | Retry failed ServiceM8 sync |
| `POST` | `/api/retry/:orderId?service=xero` | Retry failed Xero sync |
| `GET` | `/api/orders` | List all orders |
| `GET` | `/api/orders/:id` | Order detail with sync logs |

---

## Error Handling

- Each sync step (eWAY, ServiceM8, Xero) runs independently
- If one service fails, others still complete
- All API calls logged to `sync_logs` with full request/response
- Failed syncs can be retried via the `/api/retry` endpoint
- Phase 2 dashboard will surface errors visually

---

## Phase 2 Roadmap

- [ ] Dashboard UI with real-time order monitoring
- [ ] Automatic retry with exponential backoff
- [ ] Xero OAuth2 token auto-refresh
- [ ] ServiceM8 OAuth2 token auto-refresh
- [ ] Email notifications for failed syncs
- [ ] Webhook signature verification (HMAC)
- [ ] Multi-client support (reusable for future Marmoset clients)

---

Built with 🤎 by Marmoset
