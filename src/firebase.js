// ═══════════════════════════════════════════════════════════════
// firebase.js  —  GasLedger Firebase layer
//
// SETUP (one time):
//   npm install firebase
//
// Then replace the firebaseConfig object below with your own
// values from Firebase Console → Project Settings → Your apps
// ═══════════════════════════════════════════════════════════════

import { initializeApp }                          from "firebase/app";
import { getAuth, RecaptchaVerifier,
         signInWithPhoneNumber, signOut,
         onAuthStateChanged,
         createUserWithEmailAndPassword,
         signInWithEmailAndPassword,
         sendPasswordResetEmail,
         EmailAuthProvider,
         reauthenticateWithCredential,
         updatePassword, updateEmail }             from "firebase/auth";
import { getFirestore, collection, doc,
         addDoc, setDoc, deleteDoc, updateDoc,
         onSnapshot, query, orderBy, where, getDocs,
         serverTimestamp, Timestamp }             from "firebase/firestore";

// ─── 1. YOUR CONFIG ────────────────────────────────────────
// Replace with values from Firebase Console →
// Project Settings → General → Your apps → Web app → SDK setup
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// ═══════════════════════════════════════════════════════════════
// FIRESTORE DATA MODEL
//
// /plants/{plantId}/
//    name, ownerId, createdAt
//
// /plants/{plantId}/entries/{entryId}
//    date, openMeter, closeMeter, cashSales, posSales,
//    expenses: [{cat, amt}], notes, createdAt
//
// /plants/{plantId}/deliveries/{deliveryId}
//    date, kg, supplier, pricePerKg, note, createdAt
//
// /plants/{plantId}/prices/{priceId}
//    date, pricePerKg, note, createdAt
//
// /users/{uid}
//    phone, plantId, role: "owner"|"staff", displayName
// ═══════════════════════════════════════════════════════════════

// ─── Helpers ───────────────────────────────────────────────
// Convert Firestore Timestamp → ISO date string "YYYY-MM-DD"
export const tsToDate = (ts) => {
  if (!ts) return "";
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
  return d.toISOString().split("T")[0];
};

// Convert ISO date string → Firestore Timestamp
export const dateToTs = (iso) => Timestamp.fromDate(new Date(iso));

// Normalise a Firestore doc snapshot → plain JS object with id
const snap = (doc) => ({ id: doc.id, ...doc.data() });

// ─── Collection paths ──────────────────────────────────────
export const entriesCol    = (plantId) => collection(db, "plants", plantId, "entries");
export const deliveriesCol = (plantId) => collection(db, "plants", plantId, "deliveries");
export const pricesCol     = (plantId) => collection(db, "plants", plantId, "prices");
export const plantDoc      = (plantId) => doc(db, "plants", plantId);
export const userDoc       = (uid)     => doc(db, "users", uid);

// ═══════════════════════════════════════════════════════════════
// REAL-TIME HOOKS  (use inside React components)
// Each returns { data, loading, error }
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";

const useCollection = (colRef, orderField = "date", dir = "desc") => {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!colRef) return;
    const q = query(colRef, orderBy(orderField, dir));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setData(snapshot.docs.map(snap));
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub; // cleanup on unmount
  }, [colRef?.path]);   // re-subscribe if plantId changes

  return { data, loading, error };
};

// Entries  — ordered newest first
export const useEntries = (plantId) =>
  useCollection(plantId ? entriesCol(plantId) : null, "date", "desc");

// Deliveries — ordered newest first
export const useDeliveries = (plantId) =>
  useCollection(plantId ? deliveriesCol(plantId) : null, "date", "desc");

// Prices — ordered newest first
export const usePrices = (plantId) =>
  useCollection(plantId ? pricesCol(plantId) : null, "date", "desc");

// Current user's profile from /users/{uid}
export const useUserProfile = (uid) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setProfile(null); setLoading(false); return; }
    const unsub = onSnapshot(userDoc(uid), (d) => {
      setProfile(d.exists() ? { id: d.id, ...d.data() } : null);
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  return { profile, loading };
};

// ═══════════════════════════════════════════════════════════════
// WRITE HELPERS  (async functions — call from event handlers)
// ═══════════════════════════════════════════════════════════════

// --- Entries ---
export const addEntry = async (plantId, entry) => {
  const { id: _ignore, ...data } = entry; // strip local id
  await addDoc(entriesCol(plantId), {
    ...data,
    createdAt: serverTimestamp(),
  });
};

export const deleteEntry = (plantId, entryId) =>
  deleteDoc(doc(db, "plants", plantId, "entries", entryId));

export const updateEntry = (plantId, entryId, data) => {
  const { id: _ignore, createdAt: _ca, ...rest } = data;
  return updateDoc(doc(db, "plants", plantId, "entries", entryId), {
    ...rest,
    updatedAt: serverTimestamp(),
  });
};

// --- Deliveries ---
export const addDelivery = async (plantId, delivery) => {
  const { id: _ignore, ...data } = delivery;
  await addDoc(deliveriesCol(plantId), {
    ...data,
    createdAt: serverTimestamp(),
  });
};

export const deleteDelivery = (plantId, deliveryId) =>
  deleteDoc(doc(db, "plants", plantId, "deliveries", deliveryId));

export const updateDelivery = (plantId, deliveryId, data) => {
  const { id: _ignore, createdAt: _ca, ...rest } = data;
  return updateDoc(doc(db, "plants", plantId, "deliveries", deliveryId), {
    ...rest,
    updatedAt: serverTimestamp(),
  });
};

// --- Prices ---
export const addPrice = async (plantId, price) => {
  const { id: _ignore, ...data } = price;
  await addDoc(pricesCol(plantId), {
    ...data,
    createdAt: serverTimestamp(),
  });
};

// --- Plant ---
export const createPlant = async (uid, name, phone) => {
  // Create plant doc with auto-id
  const plantRef = await addDoc(collection(db, "plants"), {
    name,
    ownerId: uid,
    createdAt: serverTimestamp(),
  });
  // Create user profile pointing to this plant
  await setDoc(userDoc(uid), {
    phone,
    plantId: plantRef.id,
    role: "owner",
    displayName: name,
    createdAt: serverTimestamp(),
  });
  return plantRef.id;
};

export const updatePlantName = (plantId, name) =>
  updateDoc(plantDoc(plantId), { name });

// ═══════════════════════════════════════════════════════════════
// PHONE AUTH HELPERS
// ═══════════════════════════════════════════════════════════════

// Call once when the Send OTP button mounts.
// containerId: id of the <div> where reCAPTCHA renders (invisible is fine).
export const setupRecaptcha = (containerId) => {
  // Prevent double-init on hot reload
  if (window._recaptchaVerifier) return window._recaptchaVerifier;
  window._recaptchaVerifier = new RecaptchaVerifier(
    auth,
    containerId,
    { size: "invisible" }
  );
  return window._recaptchaVerifier;
};

// Returns a confirmationResult; store it in state, then call
// confirmationResult.confirm(otp) to complete sign-in.
export const sendOTP = async (phoneNumber) => {
  // phoneNumber must be E.164 format: "+2348012345678"
  const verifier = setupRecaptcha("recaptcha-container");
  return signInWithPhoneNumber(auth, phoneNumber, verifier);
};

export const signOutUser = () => signOut(auth);

// Email / password auth
export const registerUser  = (email, pw) => createUserWithEmailAndPassword(auth, email, pw);
export const loginUser     = (email, pw) => signInWithEmailAndPassword(auth, email, pw);
export const resetPassword = (email)     => sendPasswordResetEmail(auth, email);

// Re-authenticate then update password (requires current password)
export const reauthAndUpdatePassword = async (currentPw, newPw) => {
  const user = auth.currentUser;
  const cred = EmailAuthProvider.credential(user.email, currentPw);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPw);
};

// Re-authenticate then update email (requires current password)
export const reauthAndUpdateEmail = async (currentPw, newEmail) => {
  const user = auth.currentUser;
  const cred = EmailAuthProvider.credential(user.email, currentPw);
  await reauthenticateWithCredential(user, cred);
  await updateEmail(user, newEmail);
  await updateDoc(userDoc(user.uid), { email: newEmail });
};

// ═══════════════════════════════════════════════════════════════
// STAFF INVITE SYSTEM
//
// Data model:
//   /invites/{inviteId}
//     plantId, plantName, ownerUid, email (lowercase),
//     status: "pending" | "accepted" | "revoked"
//     createdAt
//
// Flow:
//   1. Owner calls createInvite(plantId, plantName, email)
//   2. Staff registers/logs in with that email
//   3. App detects pending invite → calls acceptInvite()
//   4. acceptInvite writes /users/{uid} with role:"staff"
//      and marks invite as "accepted"
// ═══════════════════════════════════════════════════════════════

export const invitesCol = () => collection(db, "invites");

// Owner sends an invite
export const createInvite = async (plantId, plantName, ownerUid, email) => {
  const norm = email.trim().toLowerCase();
  return addDoc(invitesCol(), {
    plantId, plantName, ownerUid,
    email: norm,
    status: "pending",
    createdAt: serverTimestamp(),
  });
};

// Owner revokes a staff member (sets their user doc role to "revoked")
export const revokeStaff = async (staffUid) => {
  await updateDoc(userDoc(staffUid), { role: "revoked" });
};

// Delete a pending invite
export const deleteInvite = (inviteId) =>
  deleteDoc(doc(db, "invites", inviteId));

// Staff accepts invite after signing in
export const acceptInvite = async (inviteId, plantId, plantName, uid, email) => {
  // Write user profile as staff
  await setDoc(userDoc(uid), {
    email,
    plantId,
    role:        "staff",
    displayName: plantName,
    createdAt:   serverTimestamp(),
  });
  // Mark invite accepted
  await updateDoc(doc(db, "invites", inviteId), { status: "accepted", acceptedAt: serverTimestamp() });
};

// Check if a logged-in user has a pending invite (called after login)
export const getPendingInvite = async (email) => {
  const norm = email.trim().toLowerCase();
  const snap = await getDocs(
    query(invitesCol(), where("email", "==", norm), where("status", "==", "pending"))
  );
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
};

// Owner: live list of all invites for a plant
export const useInvites = (plantId) => {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!plantId) return;
    const q = query(invitesCol(), where("plantId", "==", plantId), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setInvites(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [plantId]);
  return { invites, loading };
};

// Owner: live list of staff users for a plant (users with role=staff and this plantId)
export const useStaffMembers = (plantId) => {
  const [staff,   setStaff]   = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!plantId) return;
    const q = query(
      collection(db, "users"),
      where("plantId", "==", plantId),
      where("role",    "==", "staff")
    );
    const unsub = onSnapshot(q, (snap) => {
      setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [plantId]);
  return { staff, loading };
};

// ═══════════════════════════════════════════════════════════════
// REMITTANCE / CASH DRAWER
//
// /plants/{plantId}/remittances/{id}
//   date, entryId, cashInDrawer, recordedCash, difference,
//   status: "match" | "surplus" | "shortfall"
//   note, submittedBy (uid), createdAt
// ═══════════════════════════════════════════════════════════════

export const remittancesCol = (plantId) =>
  collection(db, "plants", plantId, "remittances");

export const addRemittance = async (plantId, remittance) => {
  const { id: _ignore, ...data } = remittance;
  return addDoc(remittancesCol(plantId), {
    ...data,
    createdAt: serverTimestamp(),
  });
};

export const useRemittances = (plantId) => {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!plantId) return;
    const q = query(remittancesCol(plantId), orderBy("date", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [plantId]);
  return { data, loading };
};

// ═══════════════════════════════════════════════════════════════
// STANDALONE EXPENSES
// /plants/{plantId}/standaloneExpenses/{id}
//   date, category, amount, note, createdAt
// ═══════════════════════════════════════════════════════════════
export const standaloneExpensesCol = (plantId) =>
  collection(db, "plants", plantId, "standaloneExpenses");

export const addStandaloneExpense = async (plantId, exp) => {
  const { id: _ignore, ...data } = exp;
  return addDoc(standaloneExpensesCol(plantId), { ...data, createdAt: serverTimestamp() });
};
export const updateStandaloneExpense = (plantId, id, data) =>
  updateDoc(doc(db, "plants", plantId, "standaloneExpenses", id), data);
export const deleteStandaloneExpense = (plantId, id) =>
  deleteDoc(doc(db, "plants", plantId, "standaloneExpenses", id));

export const useStandaloneExpenses = (plantId) => {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!plantId) return;
    const q = query(standaloneExpensesCol(plantId), orderBy("date", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [plantId]);
  return { data, loading };
};

// useAuth hook — gives you { user, loading } anywhere in the tree
export const useAuth = () => {
  const [user,    setUser]    = useState(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { user, loading };
};
