# GasLedger — Firebase Setup Guide

## What you're connecting

| Feature | Firebase service |
|---|---|
| Phone OTP login | Firebase Authentication (Phone provider) |
| Live data sync | Firestore (NoSQL database) |
| Multi-user ready | Firestore security rules + user profiles |

---

## Step 1 — Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it `gasledger-prod`
3. Disable Google Analytics (not needed) → **Create project**

---

## Step 2 — Register a Web app

1. In your project dashboard, click the **</>** (Web) icon
2. App nickname: `GasLedger Web`
3. Check **Also set up Firebase Hosting** (optional but useful)
4. Click **Register app**
5. Copy the `firebaseConfig` object — it looks like this:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "gasledger-prod.firebaseapp.com",
  projectId:         "gasledger-prod",
  storageBucket:     "gasledger-prod.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123",
};
```

6. Paste it into `firebase.js` replacing the placeholder values.

---

## Step 3 — Enable Phone Authentication

1. Firebase Console → **Authentication** → **Sign-in method**
2. Click **Phone** → toggle **Enable** → Save
3. Under **Authorized domains**, add:
   - `localhost` (for development)
   - Your production domain (e.g. `gasledger.hggas.com.ng`)

> **Nigerian numbers:** Firebase supports +234 numbers natively.
> Test with your real phone — Firebase will send a real SMS.

### Test phone numbers (skip SMS during dev)

1. Authentication → Sign-in method → Phone → **Phone numbers for testing**
2. Add: `+2340000000000` with OTP `123456`
3. Use this number in dev so you don't burn SMS quota.

---

## Step 4 — Enable Firestore

1. Firebase Console → **Firestore Database** → **Create database**
2. Choose **Start in production mode** (you'll add rules next)
3. Region: **europe-west1** (closest to Nigeria with low latency)
   - Or `us-central1` if you prefer

---

## Step 5 — Firestore Security Rules

Go to **Firestore → Rules** and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // User profiles — only the owner can read/write their own
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }

    // Plants — owner can do everything
    match /plants/{plantId} {
      allow read, write: if request.auth != null
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.plantId == plantId;

      // Sub-collections inherit plant access
      match /entries/{entryId} {
        allow read, write: if request.auth != null
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.plantId == plantId;
      }
      match /deliveries/{deliveryId} {
        allow read, write: if request.auth != null
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.plantId == plantId;
      }
      match /prices/{priceId} {
        allow read, write: if request.auth != null
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.plantId == plantId;
      }
    }
  }
}
```

Click **Publish**.

---

## Step 6 — Install Firebase in your project

```bash
npm install firebase
```

Your `package.json` needs at minimum:

```json
{
  "dependencies": {
    "firebase": "^10.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

---

## Step 7 — Wire up in your React app

Replace your current `App.jsx` (or `main.jsx`) entry point:

```jsx
// main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import GasLedgerApp from './GasLedgerFirebase.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GasLedgerApp />
  </React.StrictMode>
)
```

Make sure both files are in the same folder:
```
src/
  firebase.js              ← config + hooks
  GasLedgerFirebase.jsx    ← full app
  main.jsx                 ← entry point
```

---

## Step 8 — reCAPTCHA for Phone Auth

Firebase Phone Auth requires reCAPTCHA. The app uses **invisible reCAPTCHA** — users never see a checkbox. It just fires silently when they tap "Send OTP".

The `<div id="recaptcha-container" />` in `PhoneScreen` is the anchor. No extra config needed — `setupRecaptcha()` in `firebase.js` handles it.

If you see `reCAPTCHA has already been rendered` errors during hot reload, add this to `vite.config.js`:

```js
export default {
  server: {
    hmr: { overlay: false }
  }
}
```

---

## Step 9 — Deploy to Netlify (your current host)

```bash
# Build
npm run build

# Deploy via Netlify CLI
npx netlify deploy --prod --dir=dist
```

Or push to GitHub and let Netlify auto-deploy on every commit.

---

## Firestore data structure (for reference)

```
/plants/{plantId}
  name: "Alhaji's Gas Plant"
  ownerId: "uid_abc123"
  createdAt: Timestamp

  /entries/{entryId}
    date: "2025-06-06"
    openMeter: 14820
    closeMeter: 15340
    cashSales: 156000
    posSales: 84000
    expenses: [{cat: "Salary", amt: 12000}]
    notes: "Busy Friday"
    createdAt: Timestamp

  /deliveries/{deliveryId}
    date: "2025-06-04"
    kg: 900
    supplier: "Ardova Plc"
    pricePerKg: 310
    note: "Morning truck"
    createdAt: Timestamp

  /prices/{priceId}
    date: "2025-06-04"
    pricePerKg: 340
    note: "Market rate increase"
    createdAt: Timestamp

/users/{uid}
  phone: "+2348012345678"
  plantId: "plantId_xyz"
  role: "owner"
  displayName: "Alhaji's Gas Plant"
  createdAt: Timestamp
```

---

## Common errors and fixes

| Error | Cause | Fix |
|---|---|---|
| `auth/invalid-phone-number` | Number not in E.164 format | Use `+234XXXXXXXXXX` not `08012345678` |
| `auth/too-many-requests` | SMS quota hit | Use test phone numbers in dev |
| `Missing or insufficient permissions` | Firestore rules blocking read/write | Check rules — user must be authenticated and plantId must match |
| `reCAPTCHA has already been rendered` | Hot reload double-init | Add `if (window._recaptchaVerifier) return` guard (already in firebase.js) |
| `Cannot read properties of undefined (reading 'plantId')` | User profile not yet created | SetupScreen handles this — user without a profile goes to setup flow |

---

## Next: Paystack billing

Once Firebase is live, the next step is gating the P&L and Stock screens behind a paid plan.

The pattern:
1. Add `plan: "free"` to the `/users/{uid}` document on signup
2. Add a `SubscriptionBanner` component that shows when `plan === "free"`  
3. Paystack webhook updates `plan` to `"basic"` or `"pro"` on successful payment
4. Security rules can also enforce plan limits server-side
