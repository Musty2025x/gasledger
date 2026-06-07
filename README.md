# GasLedger

**Smart management software for Nigerian LPG retailers.**

GasLedger is a Progressive Web App that helps gas plant owners and attendants track daily sales, manage stock, reconcile cash, generate P&L reports, and share financial summaries — all from a phone, without installing anything.

**Live demo:** [gasledger.hggas.com.ng](https://gasledger.hggas.com.ng)

---

## The problem

Nigerian LPG retail is managed almost entirely with paper notebooks. Plant owners have no reliable way to:

- Know how much gas is left in stock at any point
- Track daily sales against meter readings to detect theft or errors
- See if their attendant's cash matches what was sold
- Generate a monthly P&L to show a bank, accountant, or family member
- Manage multiple staff with different access levels

GasLedger solves all of this in a phone-first app that works on any device, online or offline.

---

## Features

### Dashboard
- Today's total sales with Cash and POS split
- Current stock position — delivered, sold, remaining, carry-forward from previous delivery
- 7-day revenue, gross profit, gas sold, and expenses summary
- Sales trend bar chart
- Quick actions: New entry, P&L report, Stock tracker, All entries
- Onboarding checklist for new users (disappears when complete)

### Daily Entry
- Log opening and closing meter readings
- Cash and POS/transfer sales with quick-tap amount chips (₦5k, ₦10k, ₦20k, ₦50k, ₦100k)
- Live preview bar: gas dispensed, total sales, variance, gross profit
- Duplicate date guard — warns before saving a second entry for the same day
- Auto-filled selling price from Price History
- Expense tracking with multiple categories
- Notes field
- Success screen with daily summary stats and WhatsApp share button

### Stock & Refill Tracker
- Each delivery starts a new stock period
- Remaining gas from previous delivery automatically carries forward
- Active period card with sold, remaining, avg daily burn rate, and days-remaining estimate
- Reorder alert when stock drops below 5 days remaining
- All delivery periods listed with carry-forward chain
- Price History tab — log every price change with reason notes
- Margin breakdown: buy price vs sell price vs gross margin %

### P&L Report
- Date range selector: Today, This week, This month, Last month, Custom
- Revenue, Gross profit, Net profit, Expenses, Cash, POS/transfer KPI cards
- Full income statement: Revenue → Cost of Goods Sold → Gross profit → Operating expenses → Net profit
- Cost of goods uses actual supplier purchase price from last delivery
- Cash variance check: compares meter-expected revenue vs actual collected
- Day-by-day breakdown table (Date, Sales, Gas, Profit)
- Export to PDF — branded, printer-ready, A4 format with signature line
- Share via WhatsApp — pre-formatted plain text summary ready to send

### Monthly Summary
- Every month as a card: revenue, gross profit, gas sold, best day, margin badge
- SVG sparkline of daily gross profit across the month
- Year-to-date strip: total revenue, gross profit, gas sold, avg margin
- Tap any month to open that month's full P&L report

### Cash Remittance (Attendant)
- End-of-day cash drawer reconciliation
- Attendant enters physical cash count; app compares to recorded cash sales
- Live difference preview — match, surplus, or shortfall
- Shortfall flagged with amount and note for the owner to review
- Submission history with status per day

### Staff Access
- Owner invites staff by email
- Staff can log daily entries, view dashboard and history, submit cash remittance
- Staff cannot see P&L reports, prices, stock costs, or settings
- Owner can revoke staff access at any time
- Separate bottom navigation for owner vs staff
- Invite acceptance screen shows staff exactly what they can and cannot access

### Settings
- Change plant name — updates across all reports
- Default cost price — pre-fills COGS in P&L without needing a delivery entry
- Staff access management — invite, view pending, revoke
- Email address and password update with re-authentication
- Account plan display
- Version and Plant ID for support

### Authentication
- Email and password sign-in
- New account registration
- Forgot password (Firebase email reset)
- First-time setup screen — name your plant on first login

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 8 |
| Styling | Inline styles, system font stack, SVG icons |
| Database | Firebase Firestore (real-time) |
| Auth | Firebase Authentication (email/password) |
| Hosting | GitHub Pages with custom domain |
| PDF export | jsPDF + jsPDF-AutoTable (loaded from CDN) |
| CI/CD | GitHub Actions — auto-deploy on push to `main` |

No CSS framework. No component library. No external icon font. The entire UI is built from a single design token system with inline styles and hand-drawn SVG path icons.

---

## Data model

```
/plants/{plantId}
  name, ownerId, defaultCostPrice, createdAt

  /entries/{entryId}
    date, openMeter, closeMeter
    cashSales, posSales
    expenses: [{cat, amt}]
    notes, createdAt

  /deliveries/{deliveryId}
    date, kg, supplier, pricePerKg, note, createdAt

  /prices/{priceId}
    date, pricePerKg, note, createdAt

  /remittances/{remittanceId}
    date, entryId, cashInDrawer, recordedCash
    difference, status, note, submittedBy, createdAt

/users/{uid}
  email, plantId, role, displayName
  defaultCostPrice, createdAt

/invites/{inviteId}
  plantId, plantName, ownerUid, email, status, createdAt
```

---

## Firestore security rules

Access is enforced server-side:

- Owners can read and write all sub-collections under their plant
- Staff can read deliveries and prices (for auto-filled selling price) but cannot write them
- Staff can read and write entries and remittances
- Staff cannot access settings, invites, or price history writes
- Invite documents are readable only by the owner who created them or the invited email address

See `firestore.rules` for the full rule set.

---

## Local development

```bash
# Clone
git clone https://github.com/musty2025x/gasledger.git
cd gasledger

# Install
npm install

# Add Firebase config
cp .env.example .env
# Fill in your Firebase project values in .env

# Start dev server
npm run dev
```

### Environment variables

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

---

## Deployment

Every push to `main` triggers a GitHub Actions workflow that:

1. Installs dependencies (`npm ci`)
2. Builds with Vite (`npx vite build`) injecting Firebase env vars from GitHub Secrets
3. Deploys the `dist/` folder to the `gh-pages` branch via `peaceiris/actions-gh-pages`
4. Sets the CNAME to `gasledger.hggas.com.ng`

Manual deploy:

```bash
npm run build
npm run deploy
```

---

## Role permissions

| Feature | Owner | Staff |
|---|---|---|
| Dashboard | ✓ | ✓ |
| Log daily entry | ✓ | ✓ |
| View entry history | ✓ | ✓ |
| Cash remittance | ✓ | ✓ |
| Stock & deliveries | ✓ | Read only |
| Current selling price | ✓ | Read only |
| P&L reports | ✓ | ✗ |
| Monthly summary | ✓ | ✗ |
| PDF export | ✓ | ✗ |
| WhatsApp share | ✓ | ✗ |
| Supplier cost / COGS | ✓ | ✗ |
| Settings | ✓ | ✗ |
| Invite / remove staff | ✓ | ✗ |

---

## Project structure

```
gasledger/
├── src/
│   ├── main.jsx               # React entry point
│   ├── firebase.js            # Firebase config, Firestore hooks, Auth helpers
│   └── GasLedgerFirebase.jsx  # Full app — all screens and components
├── public/
│   ├── CNAME                  # Custom domain for GitHub Pages
│   └── 404.html               # SPA redirect for GitHub Pages routing
├── .github/
│   └── workflows/
│       └── deploy.yml         # CI/CD — build and deploy on push
├── firestore.rules            # Firestore security rules
├── index.html                 # Entry HTML with viewport and PWA meta
├── vite.config.js             # Vite config with base path
└── package.json
```

---

## Built by

**Ajibola Sodiq (Musty)** — DevOps & Cloud Engineer, Lagos Nigeria.

- GitHub: [github.com/musty2025x](https://github.com/musty2025x)
- Portfolio: [mustydevops.com.ng](https://mustydevops.com.ng)
- LinkedIn: [linkedin.com/in/musty2025x](https://linkedin.com/in/musty2025x)

---

## Licence

MIT — free to use and modify. Attribution appreciated.
