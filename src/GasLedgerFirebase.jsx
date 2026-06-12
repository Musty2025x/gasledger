// ═══════════════════════════════════════════════════════════════
// GasLedgerFirebase.jsx  —  Clean native rebuild
// System font · SVG icons · Full-viewport layout · No emoji
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import {
  useAuth, useUserProfile,
  useEntries, useDeliveries, usePrices,
  useInvites, useStaffMembers, useRemittances,
  useStandaloneExpenses,
  useStaffExpenses,
  usePlant,
  addEntry              as fbAddEntry,
  addDelivery           as fbAddDelivery,
  addPrice              as fbAddPrice,
  deletePrice           as fbDeletePrice,
  updatePrice           as fbUpdatePrice,
  addRemittance         as fbAddRemittance,
  addStandaloneExpense  as fbAddStandaloneExpense,
  updateStandaloneExpense as fbUpdateStandaloneExpense,
  deleteStandaloneExpense as fbDeleteStandaloneExpense,
  addShiftExpense       as fbAddShiftExpense,
  updateEntry           as fbUpdateEntry,
  updateDelivery        as fbUpdateDelivery,
  deleteEntry           as fbDeleteEntry,
  deleteDelivery        as fbDeleteDelivery,
  createPlant, createInvite, acceptInvite,
  getPendingInvite, deleteInvite, revokeStaff,
  loginUser, registerUser, resetPassword, signOutUser,
} from "./firebase.js";

// ── Billing stubs (Paystack not yet active) ──────────────────
const getPlan             = (profile) => profile?.plan || "free";
const fbUpdatePlan        = async () => {};
const getPlanLimits = (plan) => {
  if (plan === "pro")   return { maxStaff:Infinity, maxEntries:Infinity, pdf:true,  whatsapp:true,  notifications:true  };
  if (plan === "basic") return { maxStaff:2,        maxEntries:Infinity, pdf:true,  whatsapp:true,  notifications:true  };
  return                       { maxStaff:0,        maxEntries:30,       pdf:false, whatsapp:false, notifications:false };
};
const fbUpdateNotifSettings = async (plantId, creds) => {
  // Dynamically import to avoid circular deps
  const { updateNotifSettings } = await import("./firebase.js");
  return updateNotifSettings(plantId, creds);
};


// ── Tokens ───────────────────────────────────────────────────
const T = {
  primary:  "#0d3b2e", p2: "#145c44", p3: "#1a7a5a",
  gold:     "#e6a817", goldFg: "#0d3b2e",
  surface:  "#ffffff", bg: "#f1f4f2", bg2: "#e8edea",
  text:     "#111a17", text2: "#3d5248", muted: "#6b7f78",
  border:   "#d4e0da", borderMid: "#bccec7",
  danger:   "#c0392b", success: "#1a7a3a", warning: "#b45309",
  overlay:  "rgba(10,30,22,0.65)",
};
// Native system font stack — no Google Fonts import needed
const F = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const R = { sm:6, md:10, lg:14, xl:18, pill:99 };

// ── Helpers ──────────────────────────────────────────────────
const fmt   = (n) => "₦" + Math.round(n).toLocaleString("en-NG");
const fmtKg = (n) => Math.round(n).toLocaleString("en-NG") + " kg";
const fmtD  = (d) => new Date(d).toLocaleDateString("en-NG",{weekday:"short",day:"numeric",month:"short"});
const fmtShort = (d) => new Date(d).toLocaleDateString("en-NG",{day:"numeric",month:"short"});
// Default fallback price — overridden by live Price History in all screens
const DEFAULT_SELL_PRICE = 320;
const DEFAULT_COST_PRICE = 0;

// calcEntry now accepts optional selling and cost prices
// sellingPrice — used for expected revenue and variance (what you charge customers)
// costPrice    — used for COGS (what you paid the supplier per kg)
const calcEntry = (e, sellingPrice = DEFAULT_SELL_PRICE, costPrice = DEFAULT_COST_PRICE) => {
  const gas     = (e.closeMeter||0) - (e.openMeter||0);
  const sales   = (e.cashSales||0) + (e.posSales||0);
  const exp     = (e.expenses||[]).reduce((s,x)=>s+x.amt, 0);
  const expRev  = gas * sellingPrice;          // expected revenue at selling price
  const cogs    = gas * costPrice;             // cost of goods sold
  const grossP  = sales - cogs;               // gross profit (before operating expenses)
  const netP    = grossP - exp;               // net profit (after expenses)
  const variance= sales - expRev;             // cash variance (meter vs collected)
  return { gas, sales, exp, expRev, cogs, grossProfit: grossP, profit: netP, variance };
};

// ── Date-aware price helpers ─────────────────────────────────
// Returns the selling price that was active ON a given date
// (the most recent price record on or before that date)
const priceOnDate = (prices, date) => {
  if (!prices || !prices.length) return DEFAULT_SELL_PRICE;
  const d = new Date(date);
  const active = [...prices]
    .filter(p => new Date(p.date) <= d)
    .sort((a,b) => new Date(b.date) - new Date(a.date));
  return active.length ? active[0].pricePerKg : DEFAULT_SELL_PRICE;
};

// Returns the supplier cost price that was active ON a given date
// (the most recent delivery purchase price on or before that date)
const costOnDate = (deliveries, date) => {
  if (!deliveries || !deliveries.length) return DEFAULT_COST_PRICE;
  const d = new Date(date);
  const active = [...deliveries]
    .filter(del => del.pricePerKg > 0 && new Date(del.date) <= d)
    .sort((a,b) => new Date(b.date) - new Date(a.date));
  return active.length ? active[0].pricePerKg : DEFAULT_COST_PRICE;
};

// Convenience: calcEntry using historically correct prices for that date
const calcEntryOnDate = (e, prices, deliveries) =>
  calcEntry(e, priceOnDate(prices, e.date), costOnDate(deliveries, e.date));

const buildStockPeriods = (entries, deliveries) => {
  if (!deliveries.length) return { periods:[], current:null };
  const sorted = [...deliveries].sort((a,b)=>new Date(a.date)-new Date(b.date));
  let carry = 0;
  const periods = sorted.map((del,idx) => {
    const ps = new Date(del.date);
    const pe = idx < sorted.length-1 ? new Date(sorted[idx+1].date) : null;
    const sold = entries
      .filter(e=>{ const d=new Date(e.date); return d>=ps&&(pe===null||d<pe); })
      .reduce((s,e)=>s+(e.closeMeter-e.openMeter),0);
    const available = carry + del.kg;
    const remaining = Math.max(0, available - sold);
    const cf = carry;
    carry = remaining;
    return { delivery:del, available, sold, carryForward:cf, remaining, isOpen:pe===null };
  });
  const cur = periods[periods.length-1];
  const pct = cur.available>0 ? Math.round((cur.remaining/cur.available)*100) : 0;
  return { periods:[...periods].reverse(), current:{...cur, pct} };
};

// Current selling price from most recent Price History record
const latestPrice = (prices) =>
  prices.length
    ? [...prices].sort((a,b)=>new Date(b.date)-new Date(a.date))[0].pricePerKg
    : DEFAULT_SELL_PRICE;

// Current cost price from most recent delivery purchase price
const latestCostPrice = (deliveries) => {
  const withPrice = deliveries.filter(d => d.pricePerKg > 0);
  if (!withPrice.length) return DEFAULT_COST_PRICE;
  return [...withPrice].sort((a,b)=>new Date(b.date)-new Date(a.date))[0].pricePerKg;
};

// ── SVG Icon set (no emoji, no external font) ────────────────
const Icon = ({ n, s=20, c="currentColor" }) => {
  const paths = {
    home:     "M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z M9 21V12h6v9",
    entry:    "M12 5v14M5 12h14",
    stock:    "M3 8l7.89-5.26a2 2 0 012.22 0L21 8M5 9.5V19a1 1 0 001 1h12a1 1 0 001-1V9.5 M9 21V12h6v9",
    pnl:      "M3 3v18h18 M7 16l4-4 4 4 4-8",
    history:  "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    back:     "M19 12H5M12 5l-7 7 7 7",
    plus:     "M12 5v14M5 12h14",
    check:    "M20 6L9 17l-5-5",
    alert:    "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
    eye:      "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 100 6 3 3 0 000-6z",
    eyeoff:   "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22",
    logout:   "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
    gas:      "M6 2h9l3 5v13a2 2 0 01-2 2H5a2 2 0 01-2-2V4a2 2 0 012-2h1z M9 2v5h6",
    truck:    "M1 3h15v13H1z M16 8h4l3 3v5h-7V8z M5.5 21a1.5 1.5 0 100-3 1.5 1.5 0 000 3z M18.5 21a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
    price:    "M12 2H6a2 2 0 00-2 2v6l8.59 8.59a2 2 0 002.82 0l4.59-4.59a2 2 0 000-2.82L12 2z M7 7h.01",
    settings: "M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
    people:  "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75",
    invite:  "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M19 8v6M22 11h-6",
    remove:  "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M22 11h-6",
    user:    "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 11a4 4 0 100-8 4 4 0 000 8z",
    shield:  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    chevron: "M9 18l6-6-6-6",
    plant:   "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10",
    mail:    "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6",
    lock:    "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z M7 11V7a5 5 0 0110 0v4",
    edit:    "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7 M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
    copy:    "M8 17.929H6c-1.105 0-2-.912-2-2.036V5.036C4 3.91 4.895 3 6 3h8c1.105 0 2 .911 2 2.036v1.866m-6 .17h8c1.105 0 2 .91 2 2.035v10.857C20 21.09 19.105 22 18 22h-8c-1.105 0-2-.911-2-2.036V9.107c0-1.124.895-2.036 2-2.036z",
    flame:   "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z M12 7v5l3 3",
    share:   "M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8 M16 6l-4-4-4 4 M12 2v13",
    cash:    "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    wallet:  "M2 8h20v12a2 2 0 01-2 2H4a2 2 0 01-2-2V8z M2 8l10-6 10 6 M12 12h.01",
  };
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[n]||paths.gas}/>
    </svg>
  );
};

// ── Primitives ───────────────────────────────────────────────
const Divider = ({my=0}) => <div style={{borderTop:`1px solid ${T.border}`,margin:`${my}px 0`}}/>;

const Badge = ({label, variant="default"}) => {
  const v = {
    default:  {bg:T.bg2,      c:T.muted},
    success:  {bg:"#dcfce7",  c:"#166534"},
    danger:   {bg:"#fee2e2",  c:"#991b1b"},
    warning:  {bg:"#fef3c7",  c:"#92400e"},
    gold:     {bg:"#fef3c0",  c:"#92640a"},
    primary:  {bg:`${T.primary}18`, c:T.primary},
  }[variant]||{bg:T.bg2,c:T.muted};
  return <span style={{background:v.bg,color:v.c,fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:R.pill,fontFamily:F,whiteSpace:"nowrap",letterSpacing:.2}}>{label}</span>;
};

const SLabel = ({children, mt=20}) => (
  <div style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.8,margin:`${mt}px 0 6px`,fontFamily:F}}>{children}</div>
);

const Card = ({children, style={}, onClick, pad="0"}) => (
  <div onClick={onClick} style={{background:T.surface,borderRadius:R.lg,border:`1px solid ${T.border}`,overflow:"hidden",padding:pad,cursor:onClick?"pointer":"default",transition:onClick?"background .12s":"none",...style}}
    onMouseEnter={e=>{if(onClick)e.currentTarget.style.background=T.bg}}
    onMouseLeave={e=>{if(onClick)e.currentTarget.style.background=T.surface}}>
    {children}
  </div>
);

const Input = ({label,value,onChange,type="text",placeholder,prefix,hint,error,onEnter}) => (
  <div style={{marginBottom:14}}>
    {label&&<div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:5,fontFamily:F}}>{label}</div>}
    <div style={{position:"relative",display:"flex",alignItems:"center"}}>
      {prefix&&<span style={{position:"absolute",left:12,fontSize:14,color:T.muted,fontFamily:F,pointerEvents:"none",fontWeight:500}}>{prefix}</span>}
      <input value={value} onChange={e=>onChange&&onChange(e.target.value)} type={type} placeholder={placeholder||""}
        onKeyDown={e=>e.key==="Enter"&&onEnter&&onEnter()}
        style={{width:"100%",padding:prefix?"11px 12px 11px 30px":"11px 12px",border:`1.5px solid ${error?T.danger:T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box",transition:"border-color .15s"}}
        onFocus={e=>e.target.style.borderColor=T.primary}
        onBlur={e=>e.target.style.borderColor=error?T.danger:T.borderMid}
      />
    </div>
    {hint&&!error&&<div style={{fontSize:11,color:T.muted,marginTop:3,fontFamily:F}}>{hint}</div>}
    {error&&<div style={{fontSize:11,color:T.danger,marginTop:3,fontFamily:F}}>{error}</div>}
  </div>
);

const Btn = ({label,onClick,disabled,variant="primary",full=true,loading:ld,icon,size="md"}) => {
  const v = {
    primary: {bg:T.primary, c:"#fff", border:"transparent"},
    gold:    {bg:T.gold,    c:T.goldFg, border:"transparent"},
    outline: {bg:"transparent", c:T.primary, border:T.borderMid},
    ghost:   {bg:"transparent", c:T.muted, border:"transparent"},
    danger:  {bg:T.danger, c:"#fff", border:"transparent"},
  }[variant]||{bg:T.primary,c:"#fff",border:"transparent"};
  const pad = size==="sm" ? "7px 14px" : size==="lg" ? "14px 20px" : "11px 16px";
  const fs  = size==="sm" ? 13 : 14;
  return (
    <button onClick={onClick} disabled={disabled||ld}
      style={{width:full?"100%":"auto",padding:pad,background:disabled||ld?T.bg2:v.bg,color:disabled||ld?T.muted:v.c,border:`1.5px solid ${disabled||ld?T.border:v.border}`,borderRadius:R.md,fontSize:fs,fontWeight:600,fontFamily:F,cursor:disabled||ld?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:7,transition:"opacity .15s",opacity:ld?.7:1}}>
      {ld?"Please wait…":<>{icon&&<Icon n={icon} s={16} c="currentColor"/>}{label}</>}
    </button>
  );
};

const BackBtn = ({onClick,dark=true}) => (
  <button onClick={onClick} style={{width:36,height:36,borderRadius:"50%",background:dark?"rgba(255,255,255,.13)":T.bg2,border:"none",cursor:"pointer",color:dark?"#fff":T.text,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
    <Icon n="back" s={18} c={dark?"#fff":T.text}/>
  </button>
);

const Spinner = () => (
  <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:T.bg}}>
    <div style={{textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
      <div style={{width:36,height:36,border:`3px solid ${T.border}`,borderTopColor:T.primary,borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <div style={{fontSize:13,color:T.muted,fontFamily:F}}>Loading…</div>
    </div>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
);

const ErrBanner = ({msg}) => (
  <div style={{margin:"8px 16px",background:"#fee2e2",border:`1px solid #fca5a5`,borderRadius:R.md,padding:"10px 14px",fontSize:13,color:"#991b1b",fontFamily:F}}>{msg}</div>
);

// ── Top bar ──────────────────────────────────────────────────
const TopBar = ({title, left, right, dark=true}) => (
  <div style={{
    background: dark ? T.primary : T.surface,
    paddingTop: "max(12px, env(safe-area-inset-top))",
    paddingBottom: "12px",
    paddingLeft: "16px",
    paddingRight: "16px",
    display:"flex", alignItems:"center", gap:12, flexShrink:0,
    borderBottom: dark ? "none" : `1px solid ${T.border}`,
  }}>
    <div style={{width:36,flexShrink:0}}>{left||null}</div>
    <div style={{flex:1,textAlign:"center",fontSize:16,fontWeight:600,color:dark?"#fff":T.text,fontFamily:F}}>{title}</div>
    <div style={{width:36,flexShrink:0,display:"flex",justifyContent:"flex-end"}}>{right||null}</div>
  </div>
);

// ── Bottom nav ───────────────────────────────────────────────
const BottomNav = ({active, onChange, role="owner"}) => {
  const ownerTabs = [
    {id:"dashboard",  icon:"home",     label:"Home"},
    {id:"entryhub",   icon:"entry",    label:"Entry"},
    {id:"stock",      icon:"truck",    label:"Stock"},
    {id:"expenses",   icon:"cash",     label:"Expenses"},
    {id:"settings",   icon:"settings", label:"Settings"},
  ];
  const staffTabs = [
    {id:"dashboard",    icon:"home",     label:"Home"},
    {id:"entryhub",     icon:"entry",    label:"Entry"},
    {id:"staffexpense", icon:"cash",     label:"Expenses"},
    {id:"staffaccount", icon:"settings", label:"Account"},
  ];
  const tabs = role === "staff" ? staffTabs : ownerTabs;
  return (
    <div style={{background:T.surface,borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"space-around",padding:"8px 0 env(safe-area-inset-bottom, 8px)",flexShrink:0}}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>onChange(t.id)}
          style={{background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"4px 10px",minWidth:52}}>
          <Icon n={t.icon} s={22} c={active===t.id?T.primary:T.muted}/>
          <span style={{fontSize:10,fontWeight:active===t.id?600:400,color:active===t.id?T.primary:T.muted,fontFamily:F,transition:"color .15s"}}>{t.label}</span>
          {active===t.id&&<div style={{width:4,height:4,borderRadius:"50%",background:T.primary}}/>}
        </button>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// AUTH  — Sign in / Create account / Forgot password
// ═══════════════════════════════════════════════════════════════
const AuthScreen = ({onAuthed}) => {
  const [mode,    setMode]    = useState("login");
  const [email,   setEmail]   = useState("");
  const [pw,      setPw]      = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw,  setShowPw]  = useState(false);
  const [ld,      setLd]      = useState(false);
  const [err,     setErr]     = useState("");
  const [sent,    setSent]    = useState(false);

  const clear = () => setErr("");

  const submit = async () => {
    setErr(""); setLd(true);
    try {
      if (mode==="login") {
        await loginUser(email.trim(), pw);
        onAuthed();
      } else if (mode==="register") {
        if (pw!==confirm)  { setErr("Passwords do not match."); setLd(false); return; }
        if (pw.length < 6) { setErr("Password must be at least 6 characters."); setLd(false); return; }
        await registerUser(email.trim(), pw);
        onAuthed();
      } else {
        await resetPassword(email.trim());
        setSent(true);
      }
    } catch(e) {
      const map = {
        "auth/user-not-found":       "No account found with this email.",
        "auth/wrong-password":       "Incorrect password.",
        "auth/email-already-in-use": "An account already exists with this email.",
        "auth/invalid-email":        "Please enter a valid email address.",
        "auth/weak-password":        "Password must be at least 6 characters.",
        "auth/too-many-requests":    "Too many attempts. Try again later.",
        "auth/invalid-credential":   "Incorrect email or password.",
      };
      setErr(map[e.code]||e.message);
    } finally { setLd(false); }
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",background:T.bg,fontFamily:F}}>
      {/* Header */}
      <div style={{background:T.primary,paddingTop:"max(48px, env(safe-area-inset-top, 48px))",paddingLeft:"24px",paddingRight:"24px",paddingBottom:"32px"}}>
        <div style={{width:44,height:44,borderRadius:R.lg,background:T.gold,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:16}}>
          <Icon n="gas" s={24} c={T.goldFg}/>
        </div>
        <div style={{fontSize:24,fontWeight:700,color:"#fff",lineHeight:1.2}}>GasLedger</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,.55)",marginTop:4}}>LPG plant management</div>
      </div>

      {/* Card */}
      <div style={{flex:1,padding:20,overflowY:"auto"}}>
        {/* Tabs */}
        <div style={{display:"flex",background:T.bg2,borderRadius:R.md,padding:3,gap:3,marginBottom:20}}>
          {[["login","Sign in"],["register","Create account"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>{setMode(id);clear();setSent(false);}}
              style={{flex:1,padding:"9px",background:mode===id?T.surface:"transparent",color:mode===id?T.text:T.muted,border:mode===id?`1px solid ${T.border}`:"1px solid transparent",borderRadius:R.sm,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:F,transition:"all .2s"}}>
              {lbl}
            </button>
          ))}
        </div>

        {sent ? (
          <div style={{textAlign:"center",padding:"32px 0"}}>
            <div style={{width:48,height:48,borderRadius:"50%",background:`${T.primary}15`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
              <Icon n="mail" s={24} c={T.primary}/>
            </div>
            <div style={{fontSize:17,fontWeight:600,color:T.text,marginBottom:8}}>Check your inbox</div>
            <div style={{fontSize:13,color:T.muted,lineHeight:1.6}}>A password reset link has been sent to {email}.</div>
            <button onClick={()=>{setMode("login");setSent(false);}} style={{marginTop:20,background:"none",border:"none",color:T.primary,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:F}}>Back to sign in</button>
          </div>
        ) : (
          <>
            <Input label="Email address" value={email} onChange={v=>{setEmail(v);clear();}} type="email" placeholder="you@example.com" onEnter={submit}/>

            {mode!=="reset"&&(
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:5,fontFamily:F}}>Password</div>
                <div style={{position:"relative"}}>
                  <input value={pw} onChange={e=>{setPw(e.target.value);clear();}} onKeyDown={e=>e.key==="Enter"&&submit()} type={showPw?"text":"password"} placeholder="••••••••"
                    style={{width:"100%",padding:"11px 40px 11px 12px",border:`1.5px solid ${err?T.danger:T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box"}}
                    onFocus={e=>e.target.style.borderColor=T.primary}
                    onBlur={e=>e.target.style.borderColor=err?T.danger:T.borderMid}
                  />
                  <button onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:T.muted,display:"flex",alignItems:"center"}}>
                    <Icon n={showPw?"eyeoff":"eye"} s={17} c={T.muted}/>
                  </button>
                </div>
              </div>
            )}

            {mode==="register"&&(
              <Input label="Confirm password" value={confirm} onChange={v=>{setConfirm(v);clear();}} type={showPw?"text":"password"} placeholder="••••••••" onEnter={submit}/>
            )}

            {mode==="login"&&(
              <div style={{textAlign:"right",marginBottom:16,marginTop:-8}}>
                <button onClick={()=>{setMode("reset");clear();}} style={{background:"none",border:"none",color:T.primary,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:F}}>Forgot password?</button>
              </div>
            )}

            {err&&(
              <div style={{background:"#fee2e2",borderRadius:R.md,padding:"10px 12px",marginBottom:14,fontSize:13,color:"#991b1b",fontFamily:F}}>{err}</div>
            )}

            <Btn label={mode==="login"?"Sign in":mode==="register"?"Create account":"Send reset link"} onClick={submit} loading={ld} disabled={!email||(!pw&&mode!=="reset")} size="lg"/>

            {mode==="reset"&&(
              <button onClick={()=>{setMode("login");clear();}} style={{width:"100%",marginTop:10,background:"none",border:"none",color:T.muted,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:F,padding:"8px"}}>Cancel</button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── Invite acceptance (staff first login) ───────────────────
const InviteAcceptScreen = ({ user, invite, onAccepted }) => {
  const [ld,  setLd]  = useState(false);
  const [err, setErr] = useState("");

  const accept = async () => {
    setLd(true); setErr("");
    try {
      await acceptInvite(invite.id, invite.plantId, invite.plantName, user.uid, user.email);
      onAccepted();
    } catch(e) {
      setErr(e.message || "Failed to accept invite. Please try again.");
      setLd(false);
    }
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",background:T.bg,fontFamily:F}}>
      <div style={{background:T.primary,paddingTop:"max(48px, env(safe-area-inset-top, 48px))",paddingLeft:"24px",paddingRight:"24px",paddingBottom:"32px"}}>
        <div style={{width:44,height:44,borderRadius:R.lg,background:T.gold,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:16}}>
          <Icon n="invite" s={24} c={T.goldFg}/>
        </div>
        <div style={{fontSize:22,fontWeight:700,color:"#fff",lineHeight:1.2}}>You're invited</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,.55)",marginTop:6,lineHeight:1.5}}>
          You've been added as staff to a gas plant.
        </div>
      </div>
      <div style={{flex:1,padding:24,display:"flex",flexDirection:"column",justifyContent:"center",gap:16}}>
        <div style={{background:T.surface,borderRadius:R.lg,border:`1px solid ${T.border}`,padding:"16px 18px"}}>
          <div style={{fontSize:11,color:T.muted,textTransform:"uppercase",letterSpacing:.6,marginBottom:6,fontWeight:600}}>Plant</div>
          <div style={{fontSize:18,fontWeight:700,color:T.text}}>{invite.plantName}</div>
          <div style={{marginTop:12,height:1,background:T.border}}/>
          <div style={{marginTop:12,fontSize:13,color:T.muted,lineHeight:1.6}}>
            As staff, you can log daily entries and view the dashboard and history. The owner manages P&L, stock, and settings.
          </div>
        </div>
        {/* Staff can-do list */}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[
            ["check","Log daily meter entries",    true],
            ["check","View dashboard & history",   true],
            ["check","Access current selling price",true],
            ["close","View P&L reports",           false],
            ["close","Manage stock & deliveries",  false],
            ["close","Change prices or settings",  false],
          ].map(([icon,label,allowed])=>(
            <div key={label} style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:20,height:20,borderRadius:"50%",background:allowed?`${T.success}15`:`${T.danger}10`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <Icon n={icon} s={11} c={allowed?T.success:T.danger}/>
              </div>
              <span style={{fontSize:13,color:allowed?T.text:T.muted,fontFamily:F}}>{label}</span>
            </div>
          ))}
        </div>
        {err&&<div style={{background:`${T.danger}10`,borderRadius:R.md,padding:"10px 12px",fontSize:13,color:T.danger}}>{err}</div>}
        <Btn label="Accept & join plant" onClick={accept} loading={ld} size="lg" icon="check"/>
        <Btn label="Sign out instead"    onClick={signOutUser} variant="outline" size="lg"/>
      </div>
    </div>
  );
};

// ── Plant setup ──────────────────────────────────────────────
const SetupScreen = ({user}) => {
  const [name, setName] = useState("");
  const [ld,   setLd]   = useState(false);
  const [err,  setErr]  = useState("");

  const create = async () => {
    if (!name.trim()) return;
    setLd(true); setErr("");
    try { await createPlant(user.uid, name.trim(), user.email); }
    catch(e) { setErr(e.message||"Failed. Try again."); setLd(false); }
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",background:T.bg,fontFamily:F}}>
      <div style={{background:T.primary,paddingTop:"max(48px, env(safe-area-inset-top, 48px))",paddingLeft:"24px",paddingRight:"24px",paddingBottom:"32px"}}>
        <div style={{fontSize:22,fontWeight:700,color:"#fff"}}>Welcome</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,.55)",marginTop:4}}>Set up your gas plant to get started.</div>
      </div>
      <div style={{flex:1,padding:24,display:"flex",flexDirection:"column",justifyContent:"center"}}>
        <Input label="Plant name" value={name} onChange={setName} placeholder="e.g. Hageez Gas Plant" hint="This will appear on all your reports." error={err} onEnter={create}/>
        <Btn label="Create plant" onClick={create} loading={ld} disabled={!name.trim()} size="lg" icon="check"/>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
// ── Notifications panel — slides over dashboard ──────────────
const NotificationsPanel = ({ notifs, onClose, onMarkRead }) => (
  <div style={{position:"absolute",inset:0,background:T.overlay,zIndex:200,display:"flex",flexDirection:"column"}}>
    <div style={{background:T.surface,flex:1,display:"flex",flexDirection:"column",maxHeight:"100%",overflow:"hidden"}}>
      {/* Header */}
      <div style={{background:T.primary,padding:"16px 16px 14px",paddingTop:"max(16px,env(safe-area-inset-top))",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:16,fontWeight:700,color:"#fff",fontFamily:F}}>Notifications</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {notifs.length>0&&(
            <button onClick={onMarkRead} style={{fontSize:11,color:"rgba(255,255,255,.7)",background:"rgba(255,255,255,.1)",border:"none",borderRadius:R.pill,padding:"4px 10px",cursor:"pointer",fontFamily:F}}>
              Mark all read
            </button>
          )}
          <button onClick={onClose} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:"50%",width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Icon n="close" s={14} c="#fff"/>
          </button>
        </div>
      </div>
      {/* List */}
      <div style={{flex:1,overflowY:"auto",padding:"8px 0"}}>
        {notifs.length===0?(
          <div style={{textAlign:"center",padding:"48px 20px",color:T.muted,fontFamily:F}}>
            <div style={{fontSize:28,marginBottom:10}}>🔔</div>
            <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:4}}>All caught up</div>
            <div style={{fontSize:12}}>Staff activity will appear here when they log entries or expenses</div>
          </div>
        ):(
          notifs.map((n,i)=>(
            <div key={n.id} style={{display:"flex",gap:12,padding:"12px 16px",borderBottom:`1px solid ${T.border}`}}>
              <div style={{width:38,height:38,borderRadius:R.md,background:n.type==="entry"?`${T.primary}12`:`${T.warning}12`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <Icon n={n.icon} s={18} c={n.type==="entry"?T.primary:T.warning}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>{n.text}</div>
                <div style={{fontSize:12,color:T.muted,marginTop:2,fontFamily:F}}>{n.detail}</div>
                <div style={{fontSize:10,color:T.muted,marginTop:4,fontFamily:F}}>
                  {new Date(n.time).toLocaleString("en-NG",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// WHATSAPP NOTIFICATION
// Primary: UltraMsg API (free tier 500 msgs/month, works in Nigeria)
// Fallback: opens WhatsApp with pre-filled message on owner's device
// ═══════════════════════════════════════════════════════════════
const sendWhatsAppNotif = async (phone, token, instanceId, message) => {
  if (!phone) return;

  // If UltraMsg credentials exist, use the API
  if (token && instanceId) {
    try {
      await fetch(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    new URLSearchParams({ token, to: phone, body: message }),
      });
      return;
    } catch(e) {
      console.warn("UltraMsg failed:", e.message);
    }
  }

  // Fallback: no API — show a WhatsApp link the owner can tap
  // (useful when API not set up yet)
  console.log("WhatsApp notif (no API):", message);
};

// ── Notification hook — watches for staff activity since last visit ──
const useNotifications = (plantId, ownerUid, entries, standaloneExpenses, role) => {
  const getStorageKey = () => plantId ? `gasledger_last_seen_${plantId}` : null;

  const getLastSeen = () => {
    const key = getStorageKey();
    if (!key) return new Date(0).toISOString();
    try { return localStorage.getItem(key) || new Date(0).toISOString(); }
    catch { return new Date(0).toISOString(); }
  };

  // Use a counter to force re-evaluation after markAllRead
  const [readCount,  setReadCount]  = useState(0);
  const [notifs,     setNotifs]     = useState([]);
  const [unread,     setUnread]     = useState(0);

  useEffect(() => {
    if (role !== "owner" || !plantId || !ownerUid) return;

    const lastSeen = getLastSeen();
    const items = [];

    const toISO = (ts) => {
      if (!ts) return null;
      if (ts?.toDate) return ts.toDate().toISOString();
      if (typeof ts === "string") return ts;
      return null;
    };

    // Staff entries logged after lastSeen
    entries.forEach(e => {
      const createdAt = toISO(e.createdAt);
      if (!createdAt) return;
      if (createdAt <= lastSeen) return;
      if (!e.staffUid || e.staffUid === ownerUid) return;
      const sales = (e.cashSales||0) + (e.posSales||0);
      const gas   = (e.closeMeter||0) - (e.openMeter||0);
      items.push({
        id:     `entry_${e.id}`,
        type:   "entry",
        text:   `New daily entry — ${fmtD(e.date)}`,
        detail: `₦${sales.toLocaleString("en-NG")} sales · ${fmtKg(gas)}`,
        time:   createdAt,
        icon:   "entry",
      });
    });

    // Staff expenses logged after lastSeen
    standaloneExpenses.forEach(e => {
      const createdAt = toISO(e.createdAt);
      if (!createdAt) return;
      if (createdAt <= lastSeen) return;
      if (e.source !== "staff") return;
      if (e.submittedBy === ownerUid) return;
      items.push({
        id:     `exp_${e.id}`,
        type:   "expense",
        text:   `Staff expense: ${e.category}`,
        detail: `₦${(e.amount||0).toLocaleString("en-NG")}${e.note?` · ${e.note}`:""}`,
        time:   createdAt,
        icon:   "cash",
      });
    });

    items.sort((a,b) => b.time.localeCompare(a.time));
    setNotifs(items);
    setUnread(items.length);
  // readCount in deps forces re-run after markAllRead
  }, [entries, standaloneExpenses, role, plantId, ownerUid, readCount]);

  const markAllRead = () => {
    const key = getStorageKey();
    const now = new Date().toISOString();
    if (key) {
      try { localStorage.setItem(key, now); } catch {}
    }
    // Force the effect to re-run by incrementing readCount
    setReadCount(c => c + 1);
    setUnread(0);
    setNotifs([]);
  };

  return { unread, notifs, markAllRead };
};

const Dashboard = ({entries, stock, plantName, goEntry, goDayDetail, goStock, goSetPrice, sellPrice, costPrice, standaloneExpenses=[], role="owner", onSignOut, notifs=[], unread=0, onMarkRead}) => {
  const [hide,        setHide]        = useState(false);
  const [showNotifs,  setShowNotifs]  = useState(false);
  const SP = sellPrice || DEFAULT_SELL_PRICE;
  const CP = costPrice || DEFAULT_COST_PRICE;

  // 7-day window dates
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

  const entryTotals = entries.slice(0,7).reduce((a,e)=>{
    const c=calcEntry(e, SP, CP);
    return {rev:a.rev+c.sales, gas:a.gas+c.gas, profit:a.profit+c.profit, grossP:a.grossP+c.grossProfit, exp:a.exp+c.exp};
  },{rev:0,gas:0,profit:0,grossP:0,exp:0});

  // Standalone expenses in last 7 days
  const standaloneExp7 = standaloneExpenses
    .filter(e => e.date >= sevenDaysAgoStr)
    .reduce((s,e) => s + (e.amount||0), 0);

  // Merged totals
  const totals = {
    ...entryTotals,
    exp:    entryTotals.exp    + standaloneExp7,
    profit: entryTotals.profit - standaloneExp7,
  };

  const today  = entries[0];
  const todayC = today ? calcEntry(today, SP, CP) : null;

  const MiniBar = ({data}) => {
    const max = Math.max(...data.map(d=>d.v), 1);
    return (
      <div style={{display:"flex",gap:4,alignItems:"flex-end",height:64,padding:"4px 0"}}>
        {data.map((d,i)=>(
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
            <div style={{width:"100%",borderRadius:"3px 3px 0 0",background:i===data.length-1?T.primary:T.bg2,height:Math.max(3,(d.v/max)*56),transition:"height .3s"}}/>
            <span style={{fontSize:9,color:T.muted,fontFamily:F}}>{d.l}</span>
          </div>
        ))}
      </div>
    );
  };

  const chartData = [...entries].reverse().slice(-7).map(e=>({
    l: new Date(e.date).toLocaleDateString("en-NG",{day:"numeric",month:"short"}),
    v: calcEntry(e, SP, CP).sales,
  }));

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg}}>
      {/* Header */}
      <div style={{background:T.primary,padding:"16px 16px 20px",paddingTop:"max(16px, env(safe-area-inset-top))",flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.5)",fontFamily:F,marginBottom:2}}>{role==="staff"?"Staff account":"Good day"}</div>
            <div style={{fontSize:18,fontWeight:700,color:"#fff",fontFamily:F}}>{plantName||"Your Plant"}</div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {role==="staff"&&onSignOut&&(
              <button onClick={onSignOut} style={{background:"rgba(255,255,255,.1)",border:"none",borderRadius:R.md,padding:"7px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,color:"rgba(255,255,255,.7)"}}>
                <Icon n="logout" s={14} c="rgba(255,255,255,.7)"/>
                <span style={{fontSize:12,fontFamily:F,fontWeight:500}}>Sign out</span>
              </button>
            )}
            {/* Notification bell — owner only */}
            {role==="owner"&&(
              <button onClick={()=>setShowNotifs(true)} style={{background:"rgba(255,255,255,.1)",border:"none",borderRadius:R.md,padding:"7px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,color:"rgba(255,255,255,.7)",position:"relative"}}>
                <Icon n="alert" s={15} c="rgba(255,255,255,.7)"/>
                {unread>0&&(
                  <div style={{position:"absolute",top:4,right:4,width:16,height:16,borderRadius:"50%",background:T.danger,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #0d3b2e"}}>
                    <span style={{fontSize:9,fontWeight:700,color:"#fff"}}>{unread>9?"9+":unread}</span>
                  </div>
                )}
              </button>
            )}
            <button onClick={()=>setHide(h=>!h)} style={{background:"rgba(255,255,255,.1)",border:"none",borderRadius:R.md,padding:"7px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,color:"rgba(255,255,255,.7)"}}>
              <Icon n={hide?"eye":"eyeoff"} s={15} c="rgba(255,255,255,.7)"/>
              <span style={{fontSize:12,fontFamily:F,fontWeight:500}}>{hide?"Show":"Hide"}</span>
            </button>
          </div>
        </div>
        {/* Balance tile */}
        <div style={{background:"rgba(255,255,255,.08)",borderRadius:R.lg,padding:"14px 16px",border:"1px solid rgba(255,255,255,.1)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontSize:11,color:"rgba(255,255,255,.5)",fontFamily:F,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Today's sales</span>
            <button onClick={()=>setHide(h=>!h)} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.5)",display:"flex",alignItems:"center"}}>
              <Icon n={hide?"eye":"eyeoff"} s={15} c="rgba(255,255,255,.5)"/>
            </button>
          </div>
          <div style={{fontSize:28,fontWeight:700,color:T.gold,fontFamily:F,letterSpacing:-.5}}>
            {todayC ? (hide?"₦ ——":fmt(todayC.sales)) : "No entry today"}
          </div>
          {todayC&&<div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginTop:4,fontFamily:F}}>{fmtKg(todayC.gas)} dispensed · {fmtD(today.date)}</div>}
          {todayC&&(
            <div style={{display:"flex",gap:8,marginTop:12}}>
              {[["Cash",today.cashSales],["POS",today.posSales]].map(([l,v])=>(
                <div key={l} style={{flex:1,background:"rgba(255,255,255,.07)",borderRadius:R.sm,padding:"8px 10px"}}>
                  <div style={{fontSize:10,color:"rgba(255,255,255,.4)",fontFamily:F,marginBottom:2}}>{l}</div>
                  <div style={{fontSize:13,fontWeight:600,color:"#fff",fontFamily:F}}>{hide?"——":fmt(v)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{flex:1,overflow:"auto",padding:"16px 16px 16px"}}>

        {/* Onboarding checklist — owner only */}
        {role==="owner"&&(()=>{
          const hasDelivery = stock.periods.length > 0;
          const hasPrice    = SP > DEFAULT_SELL_PRICE || (sellPrice && sellPrice > 0);
          const hasEntry    = entries.length > 0;
          const allDone     = hasDelivery && hasPrice && hasEntry;

          // Dismiss permanently after first entry using localStorage
          const dismissKey = `gasledger_setup_done_${plantName}`;
          const dismissed  = (() => { try { return !!localStorage.getItem(dismissKey); } catch { return false; } })();
          if (dismissed) return null;
          if (allDone) {
            try { localStorage.setItem(dismissKey, "1"); } catch {}
            return null;
          }

          // After delivery + price set → show celebration + CTA to log first entry
          if (hasDelivery && hasPrice && !hasEntry) return (
            <div style={{marginBottom:16}}>
              <Card pad="0">
                <div style={{background:T.primary,borderRadius:`${R.lg}px ${R.lg}px 0 0`,padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,.15)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <Icon n="check" s={18} c={T.gold}/>
                  </div>
                  <div>
                    <div style={{fontSize:14,fontWeight:700,color:"#fff",fontFamily:F}}>Plant is ready! 🎉</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,.6)",marginTop:2,fontFamily:F}}>Delivery and price set — log your first entry to start tracking profit</div>
                  </div>
                </div>
                <div style={{padding:"12px 16px"}}>
                  <button onClick={goEntry}
                    style={{width:"100%",padding:"11px",background:T.primary,border:"none",borderRadius:R.md,fontSize:13,fontWeight:600,color:"#fff",cursor:"pointer",fontFamily:F,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                    <Icon n="plus" s={15} c="#fff"/>
                    Log today's entry
                  </button>
                </div>
              </Card>
            </div>
          );

          const steps = [
            {done:hasDelivery,num:1,title:"Log your first delivery",  sub:"Record how much gas you received and the supplier cost per kg.", cta:"Add delivery",fn:goStock},
            {done:hasPrice,   num:2,title:"Set your selling price",   sub:"Enter the current price per kg. This auto-fills every daily entry.",cta:"Set price",   fn:goSetPrice},
            {done:hasEntry,   num:3,title:"Log your first daily entry",sub:"Record today's meter readings and cash collected.",               cta:"New entry",   fn:goEntry},
          ];
          const doneCount = steps.filter(s=>s.done).length;
          const pct       = Math.round((doneCount/3)*100);
          return (
            <div style={{marginBottom:16}}>
              <Card pad="0">
                <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${T.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>Getting started</div>
                    <span style={{fontSize:11,fontWeight:600,color:T.primary,fontFamily:F}}>{doneCount} of 3 done</span>
                  </div>
                  <div style={{height:5,borderRadius:R.pill,background:T.bg2,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${pct}%`,background:T.primary,borderRadius:R.pill,transition:"width .4s ease"}}/>
                  </div>
                </div>
                {steps.map((s,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"12px 16px",borderBottom:i<2?`1px solid ${T.border}`:"none",opacity:s.done?0.55:1}}>
                    <div style={{width:28,height:28,borderRadius:"50%",flexShrink:0,marginTop:1,background:s.done?T.success:`${T.primary}12`,border:`1.5px solid ${s.done?T.success:T.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {s.done?<Icon n="check" s={14} c="#fff"/>:<span style={{fontSize:11,fontWeight:700,color:T.primary,fontFamily:F}}>{s.num}</span>}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:s.done?400:600,color:T.text,fontFamily:F,textDecoration:s.done?"line-through":"none"}}>{s.title}</div>
                      {!s.done&&<div style={{fontSize:11,color:T.muted,fontFamily:F,marginTop:2,lineHeight:1.5}}>{s.sub}</div>}
                    </div>
                    {!s.done&&<button onClick={s.fn} style={{flexShrink:0,padding:"6px 12px",background:T.primary,border:"none",borderRadius:R.md,fontSize:12,fontWeight:600,color:"#fff",cursor:"pointer",fontFamily:F,whiteSpace:"nowrap",marginTop:1}}>{s.cta}</button>}
                  </div>
                ))}
              </Card>
            </div>
          );
        })()}

        {/* Stock summary — staff sees kg remaining + % bar only, no delivery cost info */}
        {stock.current&&(()=>{
          const {delivery,remaining,pct,carryForward,sold}=stock.current;
          const bc=pct>40?T.success:pct>15?T.warning:T.danger;
          return (
            <div style={{marginBottom:16}}>
              {carryForward>0&&role==="owner"&&(
                <div style={{background:"#fffbeb",border:"1px solid #f59e0b",borderRadius:R.lg,padding:"10px 14px",marginBottom:8,display:"flex",gap:10,alignItems:"flex-start"}}>
                  <Icon n="alert" s={16} c="#b45309"/>
                  <div style={{fontSize:12,color:"#92400e",fontFamily:F,lineHeight:1.5}}><strong>{fmtKg(carryForward)}</strong> carry-forward from previous delivery included.</div>
                </div>
              )}
              <Card>
                <div style={{padding:"12px 14px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <span style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>{role==="staff"?"Stock level":"Stock — current period"}</span>
                    <Badge label={`${pct}% remaining`} variant={pct>40?"success":pct>15?"warning":"danger"}/>
                  </div>
                  {role==="owner"?(
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                      {[["Delivered",fmtKg(delivery.kg),false],["Sold",fmtKg(sold),false],["Remaining",fmtKg(remaining),true]].map(([l,v,hi])=>(
                        <div key={l} style={{background:hi?T.primary:T.bg,borderRadius:R.md,padding:"10px 8px",textAlign:"center"}}>
                          <div style={{fontSize:14,fontWeight:700,color:hi?T.gold:T.text,fontFamily:F}}>{v}</div>
                          <div style={{fontSize:10,color:hi?"rgba(255,255,255,.5)":T.muted,fontFamily:F,marginTop:2,textTransform:"uppercase",letterSpacing:.3}}>{l}</div>
                        </div>
                      ))}
                    </div>
                  ):(
                    <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:10}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:24,fontWeight:700,color:bc,fontFamily:F}}>{fmtKg(remaining)}</div>
                        <div style={{fontSize:11,color:T.muted,marginTop:2,fontFamily:F}}>remaining in tank</div>
                      </div>
                      <div style={{fontSize:32,fontWeight:800,color:bc,fontFamily:F,opacity:.15}}>{pct}%</div>
                    </div>
                  )}
                  <div style={{height:6,borderRadius:R.pill,background:T.bg2,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${Math.max(2,pct)}%`,background:bc,borderRadius:R.pill,transition:"width .4s"}}/>
                  </div>
                </div>
              </Card>
            </div>
          );
        })()}

        {/* 7-day stats — staff: gas dispensed + total sales only */}
        <SLabel>7-day summary</SLabel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          {(role==="staff"?[
            {l:"Gas dispensed",v:fmtKg(totals.gas), vc:T.gold,bg:T.primary,sub:`avg ${fmtKg(Math.round(totals.gas/Math.max(1,Math.min(7,entries.length))))} /day`},
            {l:"Total sales",  v:fmt(totals.rev),   vc:T.text,bg:T.surface,sub:"cash + POS"},
          ]:[
            {l:"Revenue",     v:fmt(totals.rev),    vc:T.gold,                             bg:T.primary,sub:"all days"},
            {l:"Gas sold",    v:fmtKg(totals.gas),  vc:T.text,                             bg:T.surface,sub:`avg ${fmtKg(Math.round(totals.gas/Math.max(1,Math.min(7,entries.length))))} /day`},
            {l:"Gross profit",v:fmt(totals.grossP), vc:totals.grossP>=0?T.success:T.danger,bg:T.surface,sub:CP>0?`₦${SP-CP}/kg margin`:"add cost in Stock"},
            {l:"Expenses",    v:fmt(totals.exp),    vc:T.text,                             bg:T.surface,sub:"operating costs"},
          ]).map(({l,v,vc,bg,sub})=>(
            <div key={l} style={{background:bg,borderRadius:R.lg,border:`1px solid ${bg===T.primary?"transparent":T.border}`,padding:"12px 14px"}}>
              <div style={{fontSize:11,color:bg===T.primary?"rgba(255,255,255,.5)":T.muted,fontFamily:F,fontWeight:500,textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>{l}</div>
              <div style={{fontSize:18,fontWeight:700,color:vc,fontFamily:F}}>{v}</div>
              <div style={{fontSize:11,color:bg===T.primary?"rgba(255,255,255,.4)":T.muted,marginTop:3,fontFamily:F}}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Sales trend chart — owner only */}
        {role==="owner"&&(
          <Card pad="14px" style={{marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>Sales trend</span>
              <span style={{fontSize:11,color:T.muted,fontFamily:F}}>Last 7 days</span>
            </div>
            <MiniBar data={chartData}/>
          </Card>
        )}

        {/* Quick actions — role-aware */}
        <SLabel>Quick actions</SLabel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          {(role==="staff"?[
            {icon:"entry", label:"New entry",   fn:()=>window.__setScreen&&window.__setScreen("entryhub")},
            {icon:"cash",   label:"My expenses",  fn:()=>window.__setScreen&&window.__setScreen("staffexpense")},
          ]:[
            {icon:"history",label:"All entries",     fn:()=>window.__setScreen&&window.__setScreen("history")},
            {icon:"pnl",    label:"P&L report",      fn:()=>window.__setScreen&&window.__setScreen("pnl")},
            {icon:"truck",  label:"Stock tracker",   fn:()=>window.__setScreen&&window.__setScreen("stock")},
            {icon:"history",label:"Monthly summary",  fn:()=>window.__setScreen&&window.__setScreen("monthly")},
          ]).map(a=>(
            <div key={a.label} onClick={a.fn}
              style={{background:T.surface,borderRadius:R.lg,border:`1px solid ${T.border}`,padding:"13px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,transition:"background .12s"}}
              onMouseEnter={e=>e.currentTarget.style.background=T.bg}
              onMouseLeave={e=>e.currentTarget.style.background=T.surface}>
              <div style={{width:34,height:34,borderRadius:R.md,background:`${T.primary}10`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <Icon n={a.icon} s={18} c={T.primary}/>
              </div>
              <span style={{fontSize:13,fontWeight:500,color:T.text,fontFamily:F}}>{a.label}</span>
            </div>
          ))}
        </div>

        {/* Recent entries — staff: no profit column, no expense count */}
        <SLabel>Recent entries</SLabel>
        {entries.length===0?(
          <div style={{textAlign:"center",padding:"32px 0",color:T.muted,fontFamily:F,fontSize:13}}>No entries yet. Tap Entry below to start.</div>
        ):(
          <Card>
            {entries.slice(0,5).map((e,i)=>{
              const c=calcEntry(e,SP,CP);
              return (
                <div key={e.id} onClick={()=>goDayDetail(e)}
                  style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderBottom:i<Math.min(4,entries.length-1)?`1px solid ${T.border}`:"none",cursor:"pointer"}}
                  onMouseEnter={ev=>ev.currentTarget.style.background=T.bg}
                  onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                  <div style={{width:40,height:40,borderRadius:R.md,background:`${T.primary}12`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <span style={{fontSize:14,fontWeight:700,color:T.primary,fontFamily:F,lineHeight:1}}>{new Date(e.date).getDate()}</span>
                    <span style={{fontSize:9,color:T.muted,fontFamily:F}}>{new Date(e.date).toLocaleDateString("en-NG",{month:"short"})}</span>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>{fmt(c.sales)}</div>
                    <div style={{fontSize:11,color:T.muted,fontFamily:F,marginTop:1}}>{fmtKg(c.gas)}{role==="owner"?` · ${(e.expenses||[]).length} expense(s)`:""}</div>
                  </div>
                  {role==="owner" ? (
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:13,fontWeight:700,color:c.grossProfit>=0?T.success:T.danger,fontFamily:F}}>{fmt(c.grossProfit)}</div>
                      <div style={{fontSize:10,color:T.muted,fontFamily:F}}>gross profit</div>
                    </div>
                  ) : (
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>{fmtKg(c.gas)}</div>
                      <div style={{fontSize:10,color:T.muted,fontFamily:F}}>dispensed</div>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        )}
        <div style={{height:16}}/>
      </div>
      {/* Notifications panel overlay */}
      {showNotifs&&(
        <NotificationsPanel
          notifs={notifs}
          onClose={()=>setShowNotifs(false)}
          onMarkRead={()=>{ onMarkRead&&onMarkRead(); setShowNotifs(false); }}
        />
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// DAILY ENTRY
// ═══════════════════════════════════════════════════════════════
const DailyEntry = ({back, onSave, lastEntry, allEntries=[], allPrices=[], allDeliveries=[], pricePerKg, costPerKg, existingDates=[], role="owner"}) => {
  const now = new Date().toISOString().split("T")[0];

  // Find the closest entry before a given date for opening meter auto-fill
  const getPrevEntry = (selectedDate) => {
    if (!allEntries.length) return lastEntry;
    return [...allEntries].sort((a,b)=>b.date.localeCompare(a.date)).find(e=>e.date < selectedDate) || null;
  };

  // Get the selling price and cost price active on a given date
  const getPriceForDate = (d) => allPrices.length  ? priceOnDate(allPrices, d)    : (pricePerKg || DEFAULT_SELL_PRICE);
  const getCostForDate  = (d) => allDeliveries.length ? costOnDate(allDeliveries, d) : (costPerKg  || DEFAULT_COST_PRICE);

  const [date,  setDate]  = useState(now);
  const [open,  setOpen]  = useState(String(lastEntry?.closeMeter||""));
  const [close, setClose] = useState("");

  // Derived: price and cost for currently selected date
  const GP = getPriceForDate(date);
  const CP = getCostForDate(date);

  // When user changes the date, auto-update opening meter and prices
  const handleDateChange = (newDate) => {
    setDate(newDate);
    const prev = getPrevEntry(newDate);
    if (prev) setOpen(String(prev.closeMeter));
    else setOpen("");
  };
  const [cash,  setCash]  = useState("");
  const [pos,   setPos]   = useState("");
  const [exps,  setExps]  = useState([{cat:"",amt:""}]);
  const [notes, setNotes] = useState("");
  const [ld,    setLd]    = useState(false);
  const [done,  setDone]  = useState(false);
  const [err,   setErr]   = useState("");

  const gas       = (Number(close)||0)-(Number(open)||0);
  const sales     = (Number(cash)||0)+(Number(pos)||0);
  const expRev    = gas*GP;
  const cogs      = gas*CP;
  const grossP    = sales - cogs;
  const variance  = sales-expRev;
  const totalExp  = exps.reduce((s,x)=>s+(Number(x.amt)||0),0);
  const netProfit = grossP - totalExp;
  const valid     = close&&open&&Number(close)>Number(open)&&(cash||pos);

  // Duplicate date check
  const isDuplicate = existingDates.includes(date);

  const setE = (i,k,v) => setExps(p=>p.map((x,j)=>j===i?{...x,[k]:v}:x));

  const save = async () => {
    // Staff cannot overwrite an existing entry — block at save time
    if (role==="staff" && isDuplicate) {
      setErr("An entry already exists for this date. Contact the plant owner to make changes.");
      return;
    }
    setLd(true); setErr("");
    try {
      await onSave({date,openMeter:Number(open),closeMeter:Number(close),cashSales:Number(cash)||0,posSales:Number(pos)||0,expenses:exps.filter(x=>x.cat&&x.amt).map(x=>({cat:x.cat,amt:Number(x.amt)})),notes});
      setDone(true);
    } catch(e) { setErr(e.message||"Save failed. Try again."); }
    finally { setLd(false); }
  };

  if (done) {
    const savedGross = grossP;
    const savedSales = sales;
    const savedGas   = gas;
    const waText = encodeURIComponent(
      `*GasLedger Daily Summary*\n` +
      `Plant: ${window.__plantName||"Gas Plant"}\n` +
      `Date: ${new Date(date).toLocaleDateString("en-NG",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}\n` +
      `---\n` +
      `Gas dispensed: ${Math.round(savedGas).toLocaleString("en-NG")} kg\n` +
      `Total sales: NGN ${Math.round(savedSales).toLocaleString("en-NG")}\n` +
      `Cash: NGN ${Math.round(Number(cash)||0).toLocaleString("en-NG")}\n` +
      `POS: NGN ${Math.round(Number(pos)||0).toLocaleString("en-NG")}\n` +
      `---\n` +
      `Gross profit: NGN ${Math.round(savedGross).toLocaleString("en-NG")}\n` +
      `Margin: NGN ${GP-CP}/kg\n` +
      `_Sent from GasLedger_`
    );
    return (
      <div style={{flex:1,display:"flex",flexDirection:"column",background:T.bg,fontFamily:F}}>
        <div style={{background:T.primary,padding:"32px 24px 28px",display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
          <div style={{width:56,height:56,borderRadius:"50%",background:"rgba(255,255,255,.12)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Icon n="check" s={28} c={T.gold}/>
          </div>
          <div style={{fontSize:20,fontWeight:700,color:"#fff",textAlign:"center"}}>Entry saved</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,.55)",textAlign:"center"}}>{fmtD(date)}</div>
        </div>
        {/* Stats */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,padding:"16px 16px 0"}}>
          {[
            ["Gas dispensed", fmtKg(savedGas)],
            ["Total sales",   fmt(savedSales)],
            ["Gross profit",  fmt(savedGross)],
            ["Margin/kg",     `₦${GP-CP}`],
          ].map(([l,v])=>(
            <div key={l} style={{background:T.surface,borderRadius:R.lg,border:`1px solid ${T.border}`,padding:"12px 14px"}}>
              <div style={{fontSize:11,color:T.muted,textTransform:"uppercase",letterSpacing:.5,marginBottom:3,fontFamily:F}}>{l}</div>
              <div style={{fontSize:17,fontWeight:700,color:T.text,fontFamily:F}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{padding:"16px 16px 0",display:"flex",flexDirection:"column",gap:8}}>
          {/* WhatsApp share */}
          <a href={`https://wa.me/?text=${waText}`} target="_blank" rel="noopener noreferrer"
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"13px",background:"#25d366",borderRadius:R.md,fontSize:14,fontWeight:600,color:"#fff",textDecoration:"none"}}>
            <Icon n="share" s={18} c="#fff"/>
            Share via WhatsApp
          </a>
          <Btn label="Back to dashboard" onClick={back} size="lg" variant="outline"/>
        </div>
      </div>
    );
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title="Daily entry" left={<BackBtn onClick={back}/>}/>
      {/* Live preview bar */}
      {(gas>0||sales>0)&&(
        <div style={{background:T.primary,padding:"8px 16px",display:"flex",gap:6}}>
          {[
            [fmtKg(gas),                              "Gas"],
            [fmt(sales),                              "Sales"],
            [(variance>=0?"+":"")+fmt(variance),      "Variance"],
            [CP>0?fmt(grossP):fmt(netProfit),         CP>0?"Gross P":"Net P"],
          ].map(([v,l])=>(
            <div key={l} style={{flex:1,background:"rgba(255,255,255,.08)",borderRadius:R.sm,padding:"7px 6px",textAlign:"center"}}>
              <div style={{fontSize:11,fontWeight:600,color:l==="Gross P"||l==="Net P"?(CP>0?grossP:netProfit)>=0?"#6ee7b7":"#fca5a5":"#fff",fontFamily:F}}>{v}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.45)",fontFamily:F,textTransform:"uppercase",letterSpacing:.4,marginTop:1}}>{l}</div>
            </div>
          ))}
        </div>
      )}
      {/* Duplicate date warning */}
      {isDuplicate&&(
        <div style={{background:"#fef3c7",borderBottom:`1px solid #f59e0b`,padding:"10px 16px",display:"flex",gap:10,alignItems:"center"}}>
          <Icon n="alert" s={16} c="#b45309"/>
          <div style={{fontSize:12,color:"#92400e",fontFamily:F,flex:1}}>
            An entry already exists for <strong>{fmtD(date)}</strong>. Saving will create a duplicate — consider editing the existing entry instead.
          </div>
        </div>
      )}
      {err&&<ErrBanner msg={err}/>}
      <div style={{flex:1,overflow:"auto",padding:"16px 16px 24px"}}>
        <SLabel mt={0}>Date</SLabel>
        <Input value={date} onChange={handleDateChange} type="date"/>

        <SLabel>Meter readings</SLabel>
        <Card pad="14px" style={{marginBottom:12}}>
          {(()=>{
            const prevE = getPrevEntry(date);
            return (<>
              <Input label="Opening meter (kg)" value={open} onChange={setOpen} type="number" placeholder="e.g. 14820"
                hint={prevE ? `Last close (${prevE.date}): ${prevE.closeMeter} kg` : "No previous entry found"}/>
              <Input label="Closing meter (kg)" value={close} onChange={setClose} type="number" placeholder="e.g. 15340" error={close&&Number(close)<=Number(open)?"Must be greater than opening":""}/>
              {gas>0&&<div style={{background:T.bg,borderRadius:R.sm,padding:"9px 12px",display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:13,color:T.muted}}>Gas dispensed</span><span style={{fontSize:13,fontWeight:700,color:T.text}}>{fmtKg(gas)}</span></div>}
            </>);
          })()}
        </Card>

        <SLabel>Sales</SLabel>
        <Card pad="14px" style={{marginBottom:12}}>
          <div style={{background:T.bg,borderRadius:R.sm,padding:"8px 12px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,color:T.muted}}>Current price (auto-filled)</span>
            <span style={{fontSize:13,fontWeight:600,color:T.text}}>₦{GP}/kg</span>
          </div>
          <Input label="Cash sales" value={cash} onChange={setCash} type="number" prefix="₦" placeholder="0"/>
          {/* Quick amount chips for cash */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:-8,marginBottom:12}}>
            {[5000,10000,20000,50000,100000].map(v=>(
              <button key={v} onClick={()=>setCash(String((Number(cash)||0)+v))}
                style={{padding:"4px 10px",background:T.bg2,border:`1px solid ${T.border}`,borderRadius:R.pill,fontSize:11,fontWeight:500,color:T.muted,cursor:"pointer",fontFamily:F,transition:"background .12s"}}
                onMouseEnter={e=>e.currentTarget.style.background=T.borderMid}
                onMouseLeave={e=>e.currentTarget.style.background=T.bg2}>
                +{v>=1000?(v/1000)+"k":v}
              </button>
            ))}
          </div>
          <Input label="POS / transfer" value={pos} onChange={setPos} type="number" prefix="₦" placeholder="0"/>
          {/* Quick amount chips for POS */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:-8,marginBottom:4}}>
            {[5000,10000,20000,50000,100000].map(v=>(
              <button key={v} onClick={()=>setPos(String((Number(pos)||0)+v))}
                style={{padding:"4px 10px",background:T.bg2,border:`1px solid ${T.border}`,borderRadius:R.pill,fontSize:11,fontWeight:500,color:T.muted,cursor:"pointer",fontFamily:F,transition:"background .12s"}}
                onMouseEnter={e=>e.currentTarget.style.background=T.borderMid}
                onMouseLeave={e=>e.currentTarget.style.background=T.bg2}>
                +{v>=1000?(v/1000)+"k":v}
              </button>
            ))}
          </div>
          {sales>0&&expRev>0&&(
            <div style={{background:Math.abs(variance/expRev)<.05?`${T.success}10`:`${T.danger}10`,borderRadius:R.sm,padding:"9px 12px",marginBottom:4}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:12,color:T.muted}}>Expected</span><span style={{fontSize:12,fontWeight:600,color:T.text}}>{fmt(expRev)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,color:T.muted}}>Variance</span><span style={{fontSize:12,fontWeight:700,color:variance>=0?T.success:T.danger}}>{variance>=0?"+":""}{fmt(variance)}</span></div>
            </div>
          )}
        </Card>

        {/* Expenses — owner only. Staff do not manage expenses. */}
        {role==="owner"&&(<>
        <SLabel>Expenses</SLabel>
        {/* Expense manager — card list with add/edit/delete */}
        {(()=>{
          const CATS = ["Salary","Utility","Maintenance","Repairs","Transport","Miscellaneous","Security","Generator","Office","Other"];
          const [showExpModal, setShowExpModal]   = useState(false);
          const [editIdx,      setEditIdx]        = useState(null); // null = new
          const [expCat,       setExpCat]         = useState("");
          const [expAmt,       setExpAmt]         = useState("");
          const [expErr,       setExpErr]         = useState("");

          const openAdd  = () => { setEditIdx(null); setExpCat(""); setExpAmt(""); setExpErr(""); setShowExpModal(true); };
          const openEdit = (i) => { setEditIdx(i); setExpCat(exps[i].cat); setExpAmt(String(exps[i].amt)); setExpErr(""); setShowExpModal(true); };
          const saveExp  = () => {
            if (!expCat.trim()) { setExpErr("Enter a category."); return; }
            if (!expAmt || Number(expAmt)<=0) { setExpErr("Enter a valid amount."); return; }
            if (editIdx!==null) {
              setExps(p=>p.map((x,i)=>i===editIdx?{cat:expCat.trim(),amt:expAmt}:x));
            } else {
              setExps(p=>[...p.filter(x=>x.cat||x.amt), {cat:expCat.trim(),amt:expAmt}]);
            }
            setShowExpModal(false);
          };
          const delExp = (i) => setExps(p=>p.filter((_,j)=>j!==i));

          const filledExps = exps.filter(x=>x.cat&&x.amt);

          return (
            <>
              <Card style={{marginBottom:12}}>
                {filledExps.length===0 ? (
                  <div style={{padding:"16px",textAlign:"center",color:T.muted,fontSize:13}}>
                    No expenses yet. Tap below to add one.
                  </div>
                ) : (
                  filledExps.map((ex,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",borderBottom:i<filledExps.length-1?`1px solid ${T.border}`:"none"}}>
                      {/* Category icon dot */}
                      <div style={{width:36,height:36,borderRadius:R.md,background:`${T.primary}10`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span style={{fontSize:11,fontWeight:700,color:T.primary,fontFamily:F}}>{ex.cat.slice(0,2).toUpperCase()}</span>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>{ex.cat}</div>
                        <div style={{fontSize:12,color:T.danger,fontWeight:600,marginTop:1}}>−{fmt(Number(ex.amt))}</div>
                      </div>
                      {/* Edit button */}
                      <button onClick={()=>openEdit(i)} style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:R.sm,padding:"5px 10px",cursor:"pointer",fontSize:12,color:T.text,fontFamily:F,fontWeight:500}}>Edit</button>
                      {/* Delete button */}
                      <button onClick={()=>delExp(i)} style={{background:"#fee2e2",border:"none",borderRadius:R.sm,width:32,height:32,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <Icon n="close" s={13} c={T.danger}/>
                      </button>
                    </div>
                  ))
                )}
                {/* Total row */}
                {filledExps.length>0&&(
                  <div style={{padding:"10px 14px",background:T.bg,display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:`1px solid ${T.border}`}}>
                    <span style={{fontSize:12,color:T.muted,fontFamily:F}}>Total expenses</span>
                    <span style={{fontSize:14,fontWeight:700,color:T.danger,fontFamily:F}}>−{fmt(totalExp)}</span>
                  </div>
                )}
              </Card>

              {/* Add expense button */}
              <button onClick={openAdd} style={{width:"100%",padding:"11px",background:T.surface,border:`1.5px dashed ${T.borderMid}`,borderRadius:R.lg,fontSize:13,fontWeight:600,color:T.primary,cursor:"pointer",fontFamily:F,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                <Icon n="plus" s={15} c={T.primary}/>
                Add expense
              </button>

              {/* Add / Edit expense bottom sheet */}
              {showExpModal&&(
                <div style={{position:"absolute",inset:0,background:T.overlay,display:"flex",alignItems:"flex-end",zIndex:200}}>
                  <div style={{background:T.surface,borderRadius:"16px 16px 0 0",padding:"20px 16px 32px",width:"100%",fontFamily:F}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                      <span style={{fontSize:16,fontWeight:600,color:T.text}}>{editIdx!==null?"Edit expense":"Add expense"}</span>
                      <button onClick={()=>setShowExpModal(false)} style={{background:T.bg2,border:"none",borderRadius:"50%",width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <Icon n="close" s={14} c={T.muted}/>
                      </button>
                    </div>

                    {/* Category label */}
                    <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:6}}>Category</div>
                    <input value={expCat} onChange={e=>{setExpCat(e.target.value);setExpErr("");}}
                      placeholder="e.g. Salary"
                      style={{width:"100%",padding:"11px 12px",border:`1.5px solid ${expErr&&!expCat?T.danger:T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box",marginBottom:8}}
                      onFocus={e=>e.target.style.borderColor=T.primary}
                      onBlur={e=>e.target.style.borderColor=expErr&&!expCat?T.danger:T.borderMid}
                    />
                    {/* Quick category chips */}
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                      {CATS.map(c=>(
                        <button key={c} onClick={()=>{setExpCat(c);setExpErr("");}}
                          style={{padding:"4px 10px",background:expCat===c?T.primary:T.bg2,color:expCat===c?"#fff":T.muted,border:"none",borderRadius:R.pill,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:F,transition:"all .12s"}}>
                          {c}
                        </button>
                      ))}
                    </div>

                    {/* Amount */}
                    <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:6}}>Amount</div>
                    <div style={{position:"relative",marginBottom:8}}>
                      <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",fontSize:14,color:T.muted,fontFamily:F,fontWeight:500,pointerEvents:"none"}}>₦</span>
                      <input value={expAmt} onChange={e=>{setExpAmt(e.target.value);setExpErr("");}} type="number"
                        placeholder="0"
                        style={{width:"100%",padding:"11px 12px 11px 28px",border:`1.5px solid ${expErr&&!expAmt?T.danger:T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box"}}
                        onFocus={e=>e.target.style.borderColor=T.primary}
                        onBlur={e=>e.target.style.borderColor=expErr&&!expAmt?T.danger:T.borderMid}
                      />
                    </div>
                    {/* Quick amount chips */}
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                      {[5000,10000,15000,20000,50000].map(v=>(
                        <button key={v} onClick={()=>{setExpAmt(String(v));setExpErr("");}}
                          style={{padding:"4px 10px",background:Number(expAmt)===v?T.primary:T.bg2,color:Number(expAmt)===v?"#fff":T.muted,border:"none",borderRadius:R.pill,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:F}}>
                          {v>=1000?(v/1000)+"k":v}
                        </button>
                      ))}
                    </div>

                    {expErr&&<div style={{background:`${T.danger}10`,borderRadius:R.sm,padding:"8px 12px",marginBottom:12,fontSize:12,color:T.danger}}>{expErr}</div>}

                    <div style={{display:"flex",gap:8}}>
                      {editIdx!==null&&(
                        <button onClick={()=>{delExp(editIdx);setShowExpModal(false);}} style={{padding:"12px",background:"#fee2e2",border:"none",borderRadius:R.md,fontSize:13,fontWeight:600,color:T.danger,cursor:"pointer",fontFamily:F}}>Delete</button>
                      )}
                      <button onClick={saveExp} style={{flex:1,padding:"13px",background:T.primary,border:"none",borderRadius:R.md,fontSize:14,fontWeight:600,color:"#fff",cursor:"pointer",fontFamily:F}}>
                        {editIdx!==null?"Save changes":"Add expense"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}
        </>)}

        <SLabel>Notes</SLabel>
        <Card pad="12px 14px" style={{marginBottom:20}}>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Any notes for today…" rows={3} style={{width:"100%",border:"none",outline:"none",fontSize:13,fontFamily:F,color:T.text,resize:"none",background:"transparent",boxSizing:"border-box"}}/>
        </Card>

        <Btn label="Save entry" onClick={save} disabled={!valid} loading={ld} size="lg" icon="check"/>
        <div style={{marginTop:8}}><Btn label="Cancel" onClick={back} variant="outline" size="lg"/></div>
        <div style={{height:16}}/>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// STOCK & REFILL
// ═══════════════════════════════════════════════════════════════
// Modal — bottom sheet for forms (must be top-level to prevent remount on state change)
const Modal = ({title, onClose, children}) => (
  <div style={{position:"absolute",inset:0,background:T.overlay,display:"flex",alignItems:"flex-end",zIndex:100}}>
    <div style={{background:T.surface,borderRadius:"16px 16px 0 0",padding:"20px 16px 32px",width:"100%",maxHeight:"85%",overflowY:"auto",fontFamily:F}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <span style={{fontSize:16,fontWeight:600,color:T.text}}>{title}</span>
        <button onClick={onClose} style={{background:T.bg2,border:"none",borderRadius:"50%",width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <Icon n="close" s={14} c={T.muted}/>
        </button>
      </div>
      {children}
    </div>
  </div>
);

const StockScreen = ({stock, prices, onAddDelivery, onAddPrice, onUpdateDelivery, onDeleteDelivery, onDeletePrice, onUpdatePrice, back, loading=false}) => {
  // Auto-switch to prices tab if navigated from onboarding "Set price" CTA
  const initTab = window.__stockTab || "deliveries";
  const [tab, setTab] = useState(initTab);
  useEffect(() => { delete window.__stockTab; }, []);
  const [showDel,   setShowDel]   = useState(false);
  const [showPx,    setShowPx]    = useState(false);
  // Price edit state
  const [pxEditOpen, setPxEditOpen] = useState(false);
  const [pxEditId,   setPxEditId]   = useState(null);
  const [pxEditVal,  setPxEditVal]  = useState("");
  const [pxEditDate, setPxEditDate] = useState("");
  const [pxEditNote, setPxEditNote] = useState("");
  const [pxEditLd,   setPxEditLd]   = useState(false);
  const [editDel,   setEditDel]   = useState(null); // delivery being edited
  const [ld,        setLd]        = useState(false);
  const [delKg,     setDelKg]     = useState("");
  const [delDate,   setDelDate]   = useState(new Date().toISOString().split("T")[0]);
  const [delSup,    setDelSup]    = useState("");
  const [delPx,     setDelPx]     = useState("");
  const [delNote,   setDelNote]   = useState("");
  const [pxDate,    setPxDate]    = useState(new Date().toISOString().split("T")[0]);
  const [pxPrice,   setPxPrice]   = useState("");
  const [pxNote,    setPxNote]    = useState("");

  // edit delivery state
  const [editKg,    setEditKg]    = useState("");
  const [editDate,  setEditDate]  = useState("");
  const [editSup,   setEditSup]   = useState("");
  const [editPx,    setEditPx]    = useState("");
  const [editNote,  setEditNote]  = useState("");

  const cur = stock.current;
  const lp  = prices.length ? [...prices].sort((a,b)=>new Date(b.date)-new Date(a.date))[0] : null;
  // Most recent delivery purchase price (for margin calc)
  const latestDeliveryCost = stock.periods.length
    ? ([...stock.periods].sort((a,b)=>new Date(b.delivery.date)-new Date(a.delivery.date))
        .find(p=>p.delivery.pricePerKg>0)?.delivery.pricePerKg || 0)
    : 0;

  const saveDel = async () => {
    if(!delKg||!delSup) return; setLd(true);
    try {
      await onAddDelivery({date:delDate,kg:Number(delKg),supplier:delSup,pricePerKg:Number(delPx)||0,note:delNote});
      // Small delay so Firestore snapshot arrives before modal closes
      await new Promise(r=>setTimeout(r,600));
      setShowDel(false); setDelKg(""); setDelSup(""); setDelPx(""); setDelNote("");
    } finally { setLd(false); }
  };

  const saveEditDel = async () => {
    if(!editKg||!editSup) return; setLd(true);
    try {
      await onUpdateDelivery(editDel.id, {
        date:editDate, kg:Number(editKg),
        supplier:editSup, pricePerKg:Number(editPx)||0, note:editNote,
      });
      await new Promise(r=>setTimeout(r,600));
      setEditDel(null);
    } finally { setLd(false); }
  };

  const handleDeleteDelivery = async (del) => {
    if (!window.confirm(`Delete delivery of ${del.kg} kg from ${del.supplier}? This cannot be undone.`)) return;
    setLd(true);
    try { await onDeleteDelivery(del.id); }
    catch(e) { alert(e.message); }
    finally { setLd(false); }
  };

  const savePx = async () => {
    if(!pxPrice) return; setLd(true);
    try {
      await onAddPrice({date:pxDate,pricePerKg:Number(pxPrice),note:pxNote});
      await new Promise(r=>setTimeout(r,600));
      setShowPx(false); setPxPrice(""); setPxNote("");
    } finally { setLd(false); }
  };

  const openEditDel = (del) => {
    setEditDel(del);
    setEditKg(String(del.kg));
    setEditDate(del.date);
    setEditSup(del.supplier||"");
    setEditPx(String(del.pricePerKg||""));
    setEditNote(del.note||"");
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title="Stock & refill"
        left={<BackBtn onClick={back}/>}
        right={
          <button onClick={()=>tab==="deliveries"?setShowDel(true):setShowPx(true)}
            style={{background:T.primary,border:"none",borderRadius:R.md,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,color:"#fff"}}>
            <Icon n="plus" s={14} c="#fff"/>
            <span style={{fontSize:12,fontWeight:600,fontFamily:F}}>Add</span>
          </button>
        }
      />
      {/* Sub-tabs */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,display:"flex",padding:"0 16px"}}>
        {[["deliveries","Deliveries"],["prices","Price history"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{flex:1,padding:"12px 0",background:"transparent",border:"none",borderBottom:`2px solid ${tab===id?T.primary:"transparent"}`,fontSize:13,fontWeight:tab===id?600:400,color:tab===id?T.primary:T.muted,cursor:"pointer",fontFamily:F,transition:"all .15s"}}>
            {lbl}
          </button>
        ))}
      </div>
      {/* Syncing indicator */}
      {loading&&(
        <div style={{background:`${T.primary}10`,padding:"8px 16px",display:"flex",alignItems:"center",gap:8,borderBottom:`1px solid ${T.border}`}}>
          <div style={{width:12,height:12,borderRadius:"50%",border:`2px solid ${T.primary}`,borderTopColor:"transparent",animation:"spin 0.8s linear infinite",flexShrink:0}}/>
          <span style={{fontSize:12,color:T.primary,fontFamily:F}}>Syncing data…</span>
        </div>
      )}

      <div style={{flex:1,overflow:"auto",padding:"16px 16px 24px"}}>
        {tab==="deliveries"&&(<>
          {cur&&(()=>{
            // Days-remaining estimate based on average daily burn
            const periodDays = Math.max(1, Math.ceil(
              (new Date() - new Date(cur.delivery.date)) / (1000*60*60*24)
            ));
            const avgBurnPerDay = cur.sold > 0 ? cur.sold / periodDays : 0;
            const daysLeft = avgBurnPerDay > 0 ? Math.floor(cur.remaining / avgBurnPerDay) : null;

            return (
            <Card style={{marginBottom:12,border:`1.5px solid ${T.primary}`}}>
              <div style={{padding:"12px 14px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <Badge label="Active period" variant="primary"/>
                  <div style={{fontSize:13,fontWeight:600,color:T.text,marginTop:6}}>{fmtD(cur.delivery.date)}</div>
                  <div style={{fontSize:12,color:T.muted,marginTop:2}}>{cur.delivery.supplier}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:20,fontWeight:700,color:T.text,fontFamily:F}}>{fmtKg(cur.delivery.kg)}</div>
                  {cur.delivery.pricePerKg>0&&<div style={{fontSize:11,color:T.muted}}>@ ₦{cur.delivery.pricePerKg}/kg</div>}
                </div>
              </div>
              <div style={{padding:"10px 14px"}}>
                {cur.carryForward>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}><span style={{fontSize:12,color:T.warning}}>Carry-forward</span><span style={{fontSize:12,fontWeight:600,color:T.warning}}>+{fmtKg(cur.carryForward)}</span></div>
                )}
                <div style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}><span style={{fontSize:12,color:T.muted}}>Sold</span><span style={{fontSize:12,fontWeight:600,color:T.text}}>{fmtKg(cur.sold)}</span></div>
                {avgBurnPerDay>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
                    <span style={{fontSize:12,color:T.muted}}>Avg daily burn</span>
                    <span style={{fontSize:12,fontWeight:600,color:T.text}}>{fmtKg(Math.round(avgBurnPerDay))}/day</span>
                  </div>
                )}
                <Divider my={8}/>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:13,fontWeight:600,color:T.text}}>Remaining now</span>
                  <span style={{fontSize:16,fontWeight:700,color:cur.pct<15?T.danger:cur.pct<40?T.warning:T.success}}>{fmtKg(cur.remaining)}</span>
                </div>
                <div style={{marginTop:8,height:5,borderRadius:R.pill,background:T.bg2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.max(2,cur.pct)}%`,background:cur.pct>40?T.success:cur.pct>15?T.warning:T.danger,borderRadius:R.pill}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
                  <span style={{fontSize:11,color:T.muted,fontFamily:F}}>{cur.pct}% remaining</span>
                  {daysLeft!==null&&(
                    <span style={{fontSize:11,fontWeight:600,fontFamily:F,color:daysLeft<=3?T.danger:daysLeft<=7?T.warning:T.success}}>
                      ~{daysLeft} day{daysLeft!==1?"s":""} left
                    </span>
                  )}
                </div>
                {daysLeft!==null&&daysLeft<=5&&(
                  <div style={{marginTop:8,background:daysLeft<=2?`${T.danger}12`:`${T.warning}12`,borderRadius:R.sm,padding:"8px 10px",display:"flex",gap:8,alignItems:"center"}}>
                    <Icon n="alert" s={14} c={daysLeft<=2?T.danger:T.warning}/>
                    <span style={{fontSize:12,color:daysLeft<=2?T.danger:T.warning,fontFamily:F,fontWeight:600}}>
                      {daysLeft<=2?"Stock critically low — reorder now":"Running low — consider reordering soon"}
                    </span>
                  </div>
                )}
              </div>
            </Card>
            );
          })()}
          {stock.periods.length > 1 && <SLabel mt={8}>Previous deliveries</SLabel>}
          {stock.periods.map((p,i)=>{
            // Skip the active (first) period — already shown in the hero card above
            if (i===0) return null;
            const pct=p.available>0?Math.round((p.remaining/p.available)*100):0;
            return (
              <Card key={i} style={{marginBottom:8}}>
                <div style={{padding:"11px 14px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:3}}>
                      <span style={{fontSize:13,fontWeight:600,color:T.text}}>{fmtD(p.delivery.date)}</span>
                      <Badge label={i===0?"Active":"Closed"} variant={i===0?"success":"default"}/>
                    </div>
                    <span style={{fontSize:11,color:T.muted}}>{p.delivery.supplier}{p.delivery.note?` · ${p.delivery.note}`:""}</span>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:16,fontWeight:700,color:T.text}}>{fmtKg(p.delivery.kg)}</div>
                    {p.delivery.pricePerKg>0&&<div style={{fontSize:11,color:T.muted}}>₦{p.delivery.pricePerKg}/kg</div>}
                  </div>
                </div>
                <div style={{padding:"8px 14px"}}>
                  {p.carryForward>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}><span style={{fontSize:12,color:T.warning}}>Carry-forward</span><span style={{fontSize:12,fontWeight:600,color:T.warning}}>+{fmtKg(p.carryForward)}</span></div>}
                  <div style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}><span style={{fontSize:12,color:T.muted}}>Sold</span><span style={{fontSize:12,color:T.text,fontWeight:500}}>{fmtKg(p.sold)}</span></div>
                  <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderTop:`1px solid ${T.border}`,marginTop:4}}>
                    <span style={{fontSize:12,fontWeight:600,color:T.text}}>{i===0?"Remaining now":"Carried forward"}</span>
                    <span style={{fontSize:13,fontWeight:700,color:i===0?(pct<15?T.danger:pct<40?T.warning:T.success):T.muted}}>{fmtKg(p.remaining)}</span>
                  </div>
                  {/* Edit / Delete buttons */}
                  <div style={{display:"flex",gap:8,marginTop:10,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
                    <button onClick={()=>openEditDel(p.delivery)}
                      style={{flex:1,padding:"7px",background:`${T.primary}10`,border:`1px solid ${T.primary}20`,borderRadius:R.sm,fontSize:12,fontWeight:600,color:T.primary,cursor:"pointer",fontFamily:F,display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                      <Icon n="lock" s={13} c={T.primary}/> Edit
                    </button>
                    <button onClick={()=>handleDeleteDelivery(p.delivery)}
                      style={{flex:1,padding:"7px",background:`${T.danger}10`,border:`1px solid ${T.danger}20`,borderRadius:R.sm,fontSize:12,fontWeight:600,color:T.danger,cursor:"pointer",fontFamily:F,display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                      <Icon n="close" s={13} c={T.danger}/> Delete
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </>)}

        {tab==="prices"&&(<>
          {lp&&(
            <Card pad="14px" style={{marginBottom:12,border:`1.5px solid ${T.primary}`}}>
              <Badge label="Current selling price" variant="primary"/>
              <div style={{fontSize:28,fontWeight:700,color:T.text,fontFamily:F,marginTop:8}}>₦{lp.pricePerKg}<span style={{fontSize:14,fontWeight:400,color:T.muted}}>/kg</span></div>
              <div style={{fontSize:12,color:T.muted,marginTop:3}}>Set {fmtD(lp.date)}{lp.note?` · ${lp.note}`:""}</div>
              <div style={{marginTop:10,background:T.bg,borderRadius:R.sm,padding:"8px 12px",fontSize:12,color:T.muted}}>Auto-fills the Daily Entry form.</div>
            </Card>
          )}
          {/* Margin summary — shown when cost price is known from deliveries */}
          {lp && latestDeliveryCost > 0 && (() => {
            const margin    = lp.pricePerKg - latestDeliveryCost;
            const marginPct = Math.round((margin / lp.pricePerKg) * 100);
            return (
              <Card pad="14px" style={{marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.6,marginBottom:10}}>Margin breakdown</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  {[
                    {l:"Buy price",  v:`₦${latestDeliveryCost}/kg`, c:T.danger},
                    {l:"Sell price", v:`₦${lp.pricePerKg}/kg`,      c:T.text},
                    {l:"Margin",     v:`₦${margin}/kg`,              c:margin>0?T.success:T.danger},
                  ].map(({l,v,c})=>(
                    <div key={l} style={{background:T.bg,borderRadius:R.sm,padding:"10px 8px",textAlign:"center"}}>
                      <div style={{fontSize:13,fontWeight:700,color:c,fontFamily:F}}>{v}</div>
                      <div style={{fontSize:10,color:T.muted,marginTop:2,textTransform:"uppercase",letterSpacing:.3}}>{l}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:12,color:T.muted}}>Gross margin percentage</span>
                  <span style={{fontSize:14,fontWeight:700,color:marginPct>=18?T.success:marginPct>=8?T.warning:T.danger}}>{marginPct}%</span>
                </div>
                <div style={{marginTop:6,height:5,borderRadius:R.pill,background:T.bg2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.max(2,Math.min(100,marginPct))}%`,background:marginPct>=18?T.success:marginPct>=8?T.warning:T.danger,borderRadius:R.pill}}/>
                </div>
              </Card>
            );
          })()}
          <SLabel mt={8}>Price history</SLabel>
          <Card>
            {[...prices].sort((a,b)=>new Date(b.date)-new Date(a.date)).map((p,i,arr)=>{
              const prev=arr[i+1]; const delta=prev?p.pricePerKg-prev.pricePerKg:null;
              return (
                <div key={p.id} style={{padding:"12px 14px",borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none",display:"flex",alignItems:"flex-start",gap:10}}>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0,paddingTop:3}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:i===0?T.primary:T.borderMid}}/>
                    {i<arr.length-1&&<div style={{width:1,height:24,background:T.border,marginTop:3}}/>}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontSize:16,fontWeight:700,color:T.text}}>₦{p.pricePerKg}<span style={{fontSize:12,fontWeight:400,color:T.muted}}>/kg</span></div>
                        <div style={{fontSize:11,color:T.muted,marginTop:2}}>{fmtD(p.date)}{p.note?` · ${p.note}`:""}</div>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                        {i===0&&<Badge label="Current" variant="success"/>}
                        {delta!==null&&<span style={{fontSize:11,fontWeight:600,color:delta>0?T.danger:T.success}}>{delta>0?"▲":"▼"} ₦{Math.abs(delta)}/kg</span>}
                        {/* Edit/Delete buttons */}
                        <div style={{display:"flex",gap:6,marginTop:4}}>
                          <button onClick={()=>{ setPxEditId(p.id); setPxEditVal(String(p.pricePerKg)); setPxEditDate(p.date); setPxEditNote(p.note||""); setPxEditOpen(true); }}
                            style={{fontSize:11,padding:"3px 8px",background:T.bg2,border:`1px solid ${T.border}`,borderRadius:R.sm,cursor:"pointer",color:T.muted,fontFamily:F}}>Edit</button>
                          <button onClick={async()=>{ if(!window.confirm("Delete this price?"))return; try{await onDeletePrice(p.id);}catch(e){alert(e.message);} }}
                            style={{fontSize:11,padding:"3px 8px",background:"#fee2e2",border:`1px solid #fca5a5`,borderRadius:R.sm,cursor:"pointer",color:T.danger,fontFamily:F}}>Delete</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
        </>)}
        <div style={{height:16}}/>
      </div>

      {showDel&&(
        <Modal title="Log delivery" onClose={()=>setShowDel(false)}>
          <Input label="Date" value={delDate} onChange={setDelDate} type="date"/>
          <Input label="Quantity (kg)" value={delKg} onChange={setDelKg} type="number" placeholder="e.g. 1200"/>
          <Input label="Supplier" value={delSup} onChange={setDelSup} placeholder="e.g. Ardova Plc"/>
          <Input label="Purchase price per kg" value={delPx} onChange={setDelPx} type="number" prefix="₦" placeholder="e.g. 310" hint="Optional — for margin tracking"/>
          <Input label="Note" value={delNote} onChange={setDelNote} placeholder="e.g. Morning truck"/>
          <Btn label="Save delivery" onClick={saveDel} loading={ld} disabled={!delKg||!delSup} size="lg" icon="check"/>
        </Modal>
      )}

      {pxEditOpen&&(
        <Modal title="Edit price" onClose={()=>setPxEditOpen(false)}>
          <Input label="Selling price per kg" value={pxEditVal} onChange={setPxEditVal} type="number" prefix="₦" placeholder="e.g. 2000"/>
          <Input label="Effective date" value={pxEditDate} onChange={setPxEditDate} type="date"/>
          <Input label="Note (optional)" value={pxEditNote} onChange={setPxEditNote} placeholder="e.g. Price increase"/>
          <Btn label="Save changes" loading={pxEditLd} onClick={async()=>{
            if(!pxEditVal||Number(pxEditVal)<=0){alert("Enter a valid price.");return;}
            setPxEditLd(true);
            try{
              await onUpdatePrice(pxEditId,{pricePerKg:Number(pxEditVal),date:pxEditDate,note:pxEditNote.trim()});
              setPxEditOpen(false);
            }catch(e){alert(e.message||"Failed");}
            finally{setPxEditLd(false);}
          }} size="lg" icon="check"/>
        </Modal>
      )}

      {editDel&&(
        <Modal title="Edit delivery" onClose={()=>setEditDel(null)}>
          <div style={{background:`${T.warning}12`,borderRadius:R.md,padding:"9px 12px",marginBottom:14,fontSize:12,color:T.warning,fontFamily:F}}>
            Editing this delivery will recalculate all stock periods and carry-forwards automatically.
          </div>
          <Input label="Date" value={editDate} onChange={setEditDate} type="date"/>
          <Input label="Quantity (kg)" value={editKg} onChange={setEditKg} type="number" placeholder="e.g. 1200"/>
          <Input label="Supplier" value={editSup} onChange={setEditSup} placeholder="e.g. Ardova Plc"/>
          <Input label="Purchase price per kg" value={editPx} onChange={setEditPx} type="number" prefix="₦" placeholder="e.g. 1600" hint="Used for COGS calculation in P&L"/>
          <Input label="Note" value={editNote} onChange={setEditNote} placeholder="e.g. Morning truck"/>
          <Btn label="Save changes" onClick={saveEditDel} loading={ld} disabled={!editKg||!editSup} size="lg" icon="check"/>
          <div style={{marginTop:8}}>
            <Btn label="Delete this delivery" onClick={()=>{ setEditDel(null); handleDeleteDelivery(editDel); }} variant="danger" size="lg"/>
          </div>
        </Modal>
      )}
      {showPx&&(
        <Modal title="Update selling price" onClose={()=>setShowPx(false)}>
          <Input label="Effective date" value={pxDate} onChange={setPxDate} type="date"/>
          <Input label="New price per kg" value={pxPrice} onChange={setPxPrice} type="number" prefix="₦" placeholder="e.g. 350"/>
          <Input label="Reason / note" value={pxNote} onChange={setPxNote} placeholder="e.g. Market rate increase"/>
          <Btn label="Save price" onClick={savePx} loading={ld} disabled={!pxPrice} size="lg" icon="check"/>
        </Modal>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// P&L REPORT
// ═══════════════════════════════════════════════════════════════
const PnLScreen = ({entries, prices=[], deliveries=[], back, sellPrice, costPrice, initialMonth, standaloneExpenses=[], canExportPdf=true, onUpgrade}) => {
  const SP = sellPrice || DEFAULT_SELL_PRICE;
  const CP = costPrice || DEFAULT_COST_PRICE;
  const [pdfLoading, setPdfLoading] = useState(false);
  // ── date helpers ─────────────────────────────────────────
  const todayISO  = () => new Date().toISOString().split("T")[0];
  const daysAgo   = (n) => { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split("T")[0]; };
  const monthStart= (offset=0) => {
    const d=new Date(); d.setDate(1);
    d.setMonth(d.getMonth()+offset);
    return d.toISOString().split("T")[0];
  };
  const monthEnd  = (offset=0) => {
    const d=new Date(); d.setDate(1);
    d.setMonth(d.getMonth()+offset+1);
    d.setDate(0);
    return d.toISOString().split("T")[0];
  };

  const PRESETS = [
    { id:"today",     label:"Today",      from:todayISO(),    to:todayISO()    },
    { id:"thisweek",  label:"This week",  from:daysAgo(6),    to:todayISO()    },
    { id:"thismonth", label:"This month", from:monthStart(0), to:todayISO()    },
    { id:"lastmonth", label:"Last month", from:monthStart(-1),to:monthEnd(-1)  },
  ];

  // If opened from Monthly screen, pre-select that month
  const initFrom = initialMonth ? initialMonth+"-01" : PRESETS[1].from;
  const initTo   = initialMonth ? (()=>{ const d=new Date(initialMonth+"-01"); d.setMonth(d.getMonth()+1); d.setDate(0); return d.toISOString().split("T")[0]; })() : PRESETS[1].to;
  const [preset,   setPreset]   = useState(initialMonth?"custom":"thisweek");
  const [fromDate, setFromDate] = useState(initFrom);
  const [toDate,   setToDate]   = useState(initTo);
  const [showPicker, setShowPicker] = useState(false);
  const [draftFrom, setDraftFrom]   = useState(fromDate);
  const [draftTo,   setDraftTo]     = useState(toDate);

  const applyPreset = (p) => {
    setPreset(p.id);
    setFromDate(p.from);
    setToDate(p.to);
  };

  const applyCustom = () => {
    if (!draftFrom || !draftTo) return;
    const f = draftFrom <= draftTo ? draftFrom : draftTo;
    const t = draftFrom <= draftTo ? draftTo   : draftFrom;
    setPreset("custom");
    setFromDate(f);
    setToDate(t);
    setShowPicker(false);
  };

  // ── filter entries to date range ─────────────────────────
  const filtered = entries.filter(e => e.date >= fromDate && e.date <= toDate);
  const days     = filtered.length;

  const totals = filtered.reduce((a,e)=>{
    // Use the price/cost that was active on this entry's date
    const sp = prices.length    ? priceOnDate(prices, e.date)     : SP;
    const cp = deliveries.length? costOnDate(deliveries, e.date)  : CP;
    const c  = calcEntry(e, sp, cp);
    return {
      rev:       a.rev       + c.sales,
      gas:       a.gas       + c.gas,
      exp:       a.exp       + c.exp,
      profit:    a.profit    + c.profit,
      grossP:    a.grossP    + c.grossProfit,
      cogs:      a.cogs      + c.cogs,
      cash:      a.cash      + e.cashSales,
      pos:       a.pos       + e.posSales,
      variance:  a.variance  + c.variance,
      expRev:    a.expRev    + c.expRev,
    };
  },{rev:0,gas:0,exp:0,profit:0,grossP:0,cogs:0,cash:0,pos:0,variance:0,expRev:0});

  // Standalone expenses in the selected date range
  const standaloneFiltered = standaloneExpenses.filter(e => e.date >= fromDate && e.date <= toDate);
  const standaloneTotal    = standaloneFiltered.reduce((s,e) => s+(e.amount||0), 0);

  // Merged totals — add standalone expenses to entry-level expenses
  const mergedTotals = {
    ...totals,
    exp:    totals.exp    + standaloneTotal,
    profit: totals.profit - standaloneTotal,
  };

  const margin      = mergedTotals.rev>0  ? Math.round((mergedTotals.profit/mergedTotals.rev)*100)  : 0;
  const grossMargin = mergedTotals.rev>0  ? Math.round((mergedTotals.grossP/mergedTotals.rev)*100)  : 0;
  const avgDaily    = days>0              ? mergedTotals.rev/days : 0;

  // Build expense breakdown from both entry expenses and standalone
  const expBd = {};
  filtered.forEach(e=>(e.expenses||[]).forEach(x=>{expBd[x.cat]=(expBd[x.cat]||0)+x.amt;}));
  standaloneFiltered.forEach(e=>{ expBd[e.category]=(expBd[e.category]||0)+(e.amount||0); });
  const expList = Object.entries(expBd).sort((a,b)=>b[1]-a[1]);

  // ── range label for header ────────────────────────────────
  const rangeLabel = preset==="custom"
    ? `${fmtShort(fromDate)} – ${fmtShort(toDate)}`
    : PRESETS.find(p=>p.id===preset)?.label || "";

  // ── PDF helper: format numbers without ₦ (jsPDF Helvetica lacks the glyph) ──
  const pdfFmt = (n) => "NGN " + Math.round(n).toLocaleString("en-NG");

  // ── PDF export using jsPDF (loaded from CDN at export time) ──
  const exportPDF = async () => {
    setPdfLoading(true);
    try {
      if (!window.jspdf) {
        await new Promise((res,rej) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      if (!window.jspdf?.jsPDF?.prototype?.autoTable) {
        await new Promise((res,rej) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const mg = 16;

      // ── Header ──────────────────────────────────────────────
      doc.setFillColor(13, 59, 46);
      doc.rect(0, 0, pageW, 38, "F");
      doc.setTextColor(245, 200, 66);
      doc.setFontSize(20); doc.setFont("helvetica","bold");
      doc.text("GasLedger P&L Report", mg, 14);
      doc.setTextColor(255,255,255);
      doc.setFontSize(10); doc.setFont("helvetica","normal");
      // Plant name on second line
      const plantNamePDF = mergedTotals.rev > 0 ? (window.__plantName||"Gas Plant") : "Gas Plant";
      doc.text(plantNamePDF, mg, 22);
      doc.setFontSize(9);
      doc.text(`${rangeLabel}  ·  ${days} day${days!==1?"s":""}  ·  Generated ${new Date().toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"})}`, mg, 29);
      // Right-align avg/day
      doc.setTextColor(245,200,66);
      doc.text(`Avg/day: ${pdfFmt(avgDaily)}`, pageW-mg, 22, {align:"right"});

      let y = 48;

      // ── KPI boxes ──────────────────────────────────────────
      doc.setFont("helvetica","normal");
      const kpis = [
        ["Revenue",      pdfFmt(mergedTotals.rev)],
        ["Gross profit", pdfFmt(mergedTotals.grossP)],
        ["Net profit",   pdfFmt(mergedTotals.profit)],
        ["Gas sold",     fmtKg(totals.gas)],
        ["Cash",         pdfFmt(mergedTotals.cash)],
        ["POS/transfer", pdfFmt(mergedTotals.pos)],
      ];
      const kpiW = (pageW - mg*2 - 10) / 3;
      kpis.forEach(([l,v],i) => {
        const col = i%3, row = Math.floor(i/3);
        const x = mg + col*(kpiW+5);
        const ky = y + row*20;
        doc.setFillColor(241,244,242);
        doc.roundedRect(x, ky, kpiW, 16, 2, 2, "F");
        doc.setTextColor(107,127,120); doc.setFontSize(7); doc.setFont("helvetica","normal");
        doc.text(l.toUpperCase(), x+4, ky+5);
        doc.setTextColor(17,26,23); doc.setFontSize(9); doc.setFont("helvetica","bold");
        // Clip value to fit box width
        const maxW = kpiW - 8;
        doc.text(v, x+4, ky+12, {maxWidth: maxW});
        doc.setFont("helvetica","normal");
      });
      y += 48;

      // ── Income statement ─────────────────────────────────
      doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(13,59,46);
      doc.text("Income Statement", mg, y); y += 5;
      const incomeRows = [
        ["Cash sales",     pdfFmt(mergedTotals.cash), false],
        ["POS / transfer", pdfFmt(mergedTotals.pos),  false],
        ["Gross revenue",  pdfFmt(mergedTotals.rev),  true],
      ];
      if (CP > 0) {
        incomeRows.push([`Supplier cost (${fmtKg(totals.gas)} x NGN ${CP}/kg)`, pdfFmt(mergedTotals.cogs), false]);
        incomeRows.push(["Gross profit", pdfFmt(mergedTotals.grossP), true]);
      }
      expList.forEach(([cat,amt]) => incomeRows.push([cat, pdfFmt(amt), false]));
      incomeRows.push(["Total expenses", pdfFmt(mergedTotals.exp), true]);
      incomeRows.push([`NET PROFIT  (margin: ${Math.round((mergedTotals.profit/mergedTotals.rev)*100)||0}%)`, pdfFmt(mergedTotals.profit), true]);
      doc.autoTable({
        startY: y, margin:{left:mg, right:mg},
        head: [["Description","Amount"]],
        body: incomeRows.map(([d,v]) => [d, v]),
        styles: {fontSize:9, cellPadding:3, font:"helvetica"},
        headStyles: {fillColor:[13,59,46], textColor:255, fontStyle:"bold"},
        bodyStyles: {textColor:[17,26,23]},
        columnStyles: {0:{cellWidth:"auto"}, 1:{halign:"right", cellWidth:42}},
        didParseCell: (data) => {
          if (incomeRows[data.row.index]?.[2] && data.section==="body") {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fillColor = [232,237,234];
          }
        },
      });
      y = doc.lastAutoTable.finalY + 8;

      // ── Variance check ──────────────────────────────────
      doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(13,59,46);
      doc.text("Cash Variance Check", mg, y); y += 4;
      doc.autoTable({
        startY: y, margin:{left:mg, right:mg},
        body: [
          [`Expected (${fmtKg(totals.gas)} x NGN ${SP}/kg)`, pdfFmt(totals.expRev)],
          ["Actual collected",                                  pdfFmt(mergedTotals.rev)],
          ["Variance", (totals.variance===0 ? "Exact match — all gas accounted for" : (totals.variance>=0?"+":"-")+" "+pdfFmt(Math.abs(totals.variance)))],
        ],
        styles: {fontSize:9, cellPadding:3},
        columnStyles: {0:{cellWidth:"auto"}, 1:{halign:"right", cellWidth:52}},
      });
      y = doc.lastAutoTable.finalY + 8;

      // ── Day-by-day ──────────────────────────────────────
      if (filtered.length > 0) {
        doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(13,59,46);
        doc.text("Day-by-Day Breakdown", mg, y); y += 4;
        doc.autoTable({
          startY: y, margin:{left:mg, right:mg},
          head: [["Date","Sales (NGN)","Gas","Gross Profit (NGN)"]],
          body: filtered.map(e => {
            const sp = prices.length?priceOnDate(prices,e.date):SP;
            const cp = deliveries.length?costOnDate(deliveries,e.date):CP;
            const c  = calcEntry(e, sp, cp);
            // Use full numbers — no abbreviation
            return [
              fmtShort(e.date),
              Math.round(c.sales).toLocaleString("en-NG"),
              fmtKg(c.gas),
              Math.round(c.grossProfit).toLocaleString("en-NG"),
            ];
          }).concat([[
            `Total (${days}d)`,
            Math.round(mergedTotals.rev).toLocaleString("en-NG"),
            fmtKg(totals.gas),
            Math.round(mergedTotals.grossP).toLocaleString("en-NG"),
          ]]),
          styles: {fontSize:9, cellPadding:3},
          headStyles: {fillColor:[13,59,46], textColor:255},
          // Let autoTable size columns automatically — no fixed widths
          columnStyles: {
            0:{cellWidth:25},
            1:{halign:"right"},
            2:{halign:"right", cellWidth:22},
            3:{halign:"right"},
          },
          didParseCell: (data) => {
            if (data.row.index === filtered.length && data.section==="body") {
              data.cell.styles.fontStyle = "bold";
              data.cell.styles.fillColor = [232,237,234];
            }
          },
        });
        y = doc.lastAutoTable.finalY + 8;
      }

      // ── Prepared by / Date lines — bottom of last content page ──
      // Only add if enough space on current page, otherwise skip
      if (y + 25 < pageH - 20) {
        doc.setDrawColor(200); doc.setLineWidth(0.3);
        const sigY = y + 14;
        doc.line(mg,           sigY, mg+55,         sigY);
        doc.line(pageW/2+10,   sigY, pageW/2+65,    sigY);
        doc.setFontSize(8); doc.setFont("helvetica","normal"); doc.setTextColor(150);
        doc.text("Prepared by", mg,          sigY+5);
        doc.text("Date",        pageW/2+10,  sigY+5);
      }

      // ── Page footer ──────────────────────────────────────
      const pages = doc.getNumberOfPages();
      for (let i=1;i<=pages;i++) {
        doc.setPage(i);
        doc.setFontSize(8); doc.setFont("helvetica","normal"); doc.setTextColor(160);
        doc.text(`GasLedger  ·  ${plantNamePDF}  ·  Page ${i} of ${pages}`, pageW/2, pageH-8, {align:"center"});
      }

      doc.save(`GasLedger_PnL_${fromDate}_to_${toDate}.pdf`);
    } catch(e) {
      console.error("PDF export failed:", e);
      alert("PDF export failed. Please try again.");
    } finally { setPdfLoading(false); }
  };

  const Row = ({label,value,bold,credit,indent,last}) => (
    <div style={{display:"flex",justifyContent:"space-between",padding:indent?"9px 14px 9px 24px":"9px 14px",borderBottom:last?"none":`1px solid ${T.border}`,background:bold?T.bg:"transparent"}}>
      <span style={{fontSize:bold?13:12,fontWeight:bold?600:400,color:T.text,fontFamily:F}}>{label}</span>
      <span style={{fontSize:bold?14:12,fontWeight:bold?700:500,fontFamily:F,color:credit===true?T.success:credit===false?T.danger:T.text}}>{value}</span>
    </div>
  );

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title="P&L report" left={<BackBtn onClick={back}/>}/>

      {/* Row 1 — scrollable date chips only */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"10px 12px",overflowX:"auto",display:"flex",gap:6,flexShrink:0,WebkitOverflowScrolling:"touch",alignItems:"center"}}>
        {PRESETS.map(p=>(
          <button key={p.id} onClick={()=>applyPreset(p)}
            style={{flexShrink:0,padding:"7px 14px",background:preset===p.id?T.primary:T.bg2,color:preset===p.id?"#fff":T.muted,border:"none",borderRadius:R.pill,fontSize:12,fontWeight:preset===p.id?600:400,cursor:"pointer",fontFamily:F,transition:"all .15s",whiteSpace:"nowrap"}}>
            {p.label}
          </button>
        ))}
        <button onClick={()=>{setDraftFrom(fromDate);setDraftTo(toDate);setShowPicker(true);}}
          style={{flexShrink:0,padding:"7px 14px",background:preset==="custom"?T.primary:T.bg2,color:preset==="custom"?"#fff":T.muted,border:"none",borderRadius:R.pill,fontSize:12,fontWeight:preset==="custom"?600:400,cursor:"pointer",fontFamily:F,whiteSpace:"nowrap",transition:"all .15s"}}>
          {preset==="custom"?`${fmtShort(fromDate)} – ${fmtShort(toDate)}`:"Custom"}
        </button>
      </div>

      {/* Row 2 — fixed action bar: PDF + Share (always visible, never scroll off) */}
      {(()=>{
        const waText = encodeURIComponent(
          `*GasLedger P&L Report*\n`+
          `Plant: ${window.__plantName||"Gas Plant"}\n`+
          `Period: ${rangeLabel} (${days} days)\n`+
          `---\n`+
          `Revenue: NGN ${Math.round(mergedTotals.rev).toLocaleString("en-NG")}\n`+
          `COGS: NGN ${Math.round(mergedTotals.cogs).toLocaleString("en-NG")}\n`+
          `Gross profit: NGN ${Math.round(mergedTotals.grossP).toLocaleString("en-NG")} (${Math.round((mergedTotals.grossP/mergedTotals.rev)*100)||0}%)\n`+
          `Expenses: NGN ${Math.round(mergedTotals.exp).toLocaleString("en-NG")}\n`+
          `Net profit: NGN ${Math.round(mergedTotals.profit).toLocaleString("en-NG")}\n`+
          `---\n`+
          `Gas sold: ${Math.round(totals.gas).toLocaleString("en-NG")} kg\n`+
          `Cash: NGN ${Math.round(mergedTotals.cash).toLocaleString("en-NG")}\n`+
          `POS: NGN ${Math.round(mergedTotals.pos).toLocaleString("en-NG")}\n`+
          `_Sent from GasLedger_`
        );
        return (
          <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"8px 12px",display:"flex",gap:8,flexShrink:0}}>
            <button onClick={canExportPdf ? exportPDF : onUpgrade}
              disabled={canExportPdf && (pdfLoading||days===0)}
              style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"9px",
                background: !canExportPdf ? `${T.gold}20` : pdfLoading||days===0 ? T.bg2 : T.primary,
                border: !canExportPdf ? `1.5px solid ${T.gold}` : "none",
                borderRadius:R.md,fontSize:13,fontWeight:600,
                color: !canExportPdf ? T.gold : pdfLoading||days===0 ? T.muted : "#fff",
                cursor: !canExportPdf || (!pdfLoading&&days>0) ? "pointer" : "default",fontFamily:F}}>
              <Icon n="copy" s={15} c={!canExportPdf ? T.gold : pdfLoading||days===0 ? T.muted : "#fff"}/>
              {!canExportPdf ? "⭐ Upgrade for PDF" : pdfLoading ? "Generating…" : "Export PDF"}
            </button>
            <a href={canExportPdf && days>0 ? `https://wa.me/?text=${waText}` : "#"}
              onClick={!canExportPdf ? (ev)=>{ ev.preventDefault(); onUpgrade&&onUpgrade(); } : undefined}
              target="_blank" rel="noopener noreferrer"
              style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"9px",
                background: !canExportPdf ? `${T.gold}12` : days>0 ? "#25d366" : T.bg2,
                border: !canExportPdf ? `1.5px solid ${T.gold}` : "none",
                borderRadius:R.md,fontSize:13,fontWeight:600,
                color: !canExportPdf ? T.gold : days>0 ? "#fff" : T.muted,
                textDecoration:"none",pointerEvents:"auto",cursor:"pointer"}}>
              <Icon n="share" s={15} c={!canExportPdf ? T.gold : days>0 ? "#fff" : T.muted}/>
              {!canExportPdf ? "⭐ Upgrade" : "Share via WA"}
            </a>
          </div>
        );
      })()}

      {/* Range summary bar */}
      <div style={{background:T.primary,padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.5)",fontFamily:F,marginBottom:2}}>{rangeLabel}</div>
          <div style={{fontSize:13,fontWeight:600,color:"#fff",fontFamily:F}}>{days} day{days!==1?"s":""} · {days>0?fmtShort(filtered[filtered.length-1]?.date)+" – "+fmtShort(filtered[0]?.date):"no data"}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:10,color:"rgba(255,255,255,.45)",fontFamily:F,textTransform:"uppercase",letterSpacing:.5}}>Avg/day</div>
          <div style={{fontSize:14,fontWeight:700,color:T.gold,fontFamily:F}}>{fmt(avgDaily)}</div>
        </div>
      </div>

      <div style={{flex:1,overflow:"auto",padding:"16px 16px 24px"}}>
        {days===0 ? (
          <div style={{textAlign:"center",padding:"48px 0",color:T.muted,fontSize:13}}>
            No entries in this date range.
          </div>
        ) : (<>

          {/* KPI grid */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
            {[
              {l:"Revenue",      v:fmt(mergedTotals.rev),    color:T.gold,   bg:T.primary},
              {l:"Gross profit", v:fmt(mergedTotals.grossP), color:mergedTotals.grossP>=0?T.success:T.danger, bg:T.surface},
              {l:"Net profit",   v:fmt(mergedTotals.profit), color:mergedTotals.profit>=0?T.success:T.danger, bg:T.surface},
              {l:"Expenses",     v:fmt(mergedTotals.exp),    color:T.text,   bg:T.surface},
              {l:"Cash",         v:fmt(mergedTotals.cash),   color:T.text,   bg:T.surface},
              {l:"POS / transfer",v:fmt(mergedTotals.pos),   color:T.text,   bg:T.surface},
            ].map(({l,v,color,bg})=>(
              <div key={l} style={{background:bg,borderRadius:R.lg,border:`1px solid ${bg===T.primary?"transparent":T.border}`,padding:"11px 13px"}}>
                <div style={{fontSize:11,color:bg===T.primary?"rgba(255,255,255,.5)":T.muted,fontFamily:F,fontWeight:500,textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>{l}</div>
                <div style={{fontSize:16,fontWeight:700,color,fontFamily:F}}>{v}</div>
                {l==="Gross profit"&&<div style={{fontSize:11,color:T.muted,marginTop:2}}>{grossMargin}% gross margin</div>}
                {l==="Net profit"  &&<div style={{fontSize:11,color:T.muted,marginTop:2}}>{margin}% net margin</div>}
              </div>
            ))}
          </div>

          {/* Income statement */}
          <SLabel>Income statement</SLabel>
          <Card style={{marginBottom:16}}>
            <Row label="Cash sales"          value={fmt(mergedTotals.cash)}   indent credit={true}/>
            <Row label="POS / transfer"       value={fmt(mergedTotals.pos)}    indent credit={true}/>
            <Row label="Gross revenue"        value={fmt(mergedTotals.rev)}    bold   credit={true}/>
            {CP > 0 && <>
              <div style={{padding:"8px 14px",background:T.bg,borderBottom:`1px solid ${T.border}`}}>
                <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.5,fontFamily:F}}>Cost of goods sold</span>
              </div>
              <Row label={`Supplier cost (${fmtKg(totals.gas)} × ₦${CP}/kg)`} value={fmt(mergedTotals.cogs)} indent credit={false}/>
              <Row label="Gross profit" value={fmt(mergedTotals.grossP)} bold credit={mergedTotals.grossP>=0}/>
            </>}
            <div style={{padding:"8px 14px",background:T.bg,borderBottom:`1px solid ${T.border}`}}>
              <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.5,fontFamily:F}}>Operating expenses</span>
            </div>
            {expList.map(([cat,amt])=><Row key={cat} label={cat} value={fmt(amt)} indent credit={false}/>)}
            {expList.length===0&&<Row label="No expenses recorded" value="—" indent/>}
            <Row label="Total expenses"       value={fmt(mergedTotals.exp)}  bold credit={false}/>
            <div style={{padding:"12px 14px",background:mergedTotals.profit>=0?`${T.success}10`:`${T.danger}10`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:14,fontWeight:600,color:T.text,fontFamily:F}}>Net profit</span>
                <span style={{fontSize:18,fontWeight:700,color:mergedTotals.profit>=0?T.success:T.danger,fontFamily:F}}>{fmt(mergedTotals.profit)}</span>
              </div>
              {CP > 0 && (
                <div style={{fontSize:11,color:T.muted,marginTop:4,fontFamily:F}}>
                  ₦{CP}/kg cost · ₦{SP}/kg sold · ₦{SP-CP}/kg margin
                </div>
              )}
            </div>
          </Card>

          {/* Variance check */}
          <SLabel>Cash variance check</SLabel>
          <Card pad="14px" style={{marginBottom:16}}>
            <div style={{background:T.bg,borderRadius:R.sm,padding:"8px 10px",marginBottom:10,fontSize:11,color:T.muted,fontFamily:F,lineHeight:1.5}}>
              Compares what the meter says you dispensed (at your selling price) vs what was actually collected in cash and POS. A shortfall means gas left the plant without full payment.
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:12,color:T.muted}}>Expected ({fmtKg(totals.gas)} × ₦{SP}/kg)</span>
              <span style={{fontSize:12,fontWeight:600,color:T.text}}>{fmt(totals.expRev)}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
              <span style={{fontSize:12,color:T.muted}}>Actual collected</span>
              <span style={{fontSize:12,fontWeight:600,color:T.text}}>{fmt(mergedTotals.rev)}</span>
            </div>
            <Divider/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
              <span style={{fontSize:13,fontWeight:600,color:T.text}}>Variance</span>
              <span style={{fontSize:15,fontWeight:700,color:totals.variance>=0?T.success:T.danger}}>
                {totals.variance>=0?"+":"-"}{fmt(Math.abs(totals.variance))}
              </span>
            </div>
            <div style={{marginTop:6,fontSize:11,color:totals.variance===0?T.success:totals.variance>0?T.success:T.danger,fontFamily:F,fontWeight:600}}>
              {totals.variance===0
                ? "Exact match — all gas accounted for"
                : `${totals.expRev>0?Math.abs(totals.variance/totals.expRev*100).toFixed(1):"0"}% ${totals.variance>0?"surplus — collected more than expected":"shortfall — investigate missing payment"}`
              }
            </div>
          </Card>

          {/* Day-by-day table */}
          <SLabel>Day-by-day breakdown</SLabel>
          <Card style={{marginBottom:16}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 76px",gap:0,padding:"8px 14px",background:T.bg,borderBottom:`1px solid ${T.border}`}}>
              {["Date","Sales","Gas","Profit"].map(h=>(
                <span key={h} style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.4,fontFamily:F,textAlign:h!=="Date"?"right":"left"}}>{h}</span>
              ))}
            </div>
            {filtered.map((e,i)=>{
              const _sp=prices.length?priceOnDate(prices,e.date):SP;
              const _cp=deliveries.length?costOnDate(deliveries,e.date):CP;
              const c=calcEntry(e,_sp,_cp);
              return (
                <div key={e.id} style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 76px",gap:0,padding:"10px 14px",borderBottom:i<filtered.length-1?`1px solid ${T.border}`:"none",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:500,color:T.text,fontFamily:F}}>{fmtShort(e.date)}</div>
                    <div style={{fontSize:10,color:T.muted,fontFamily:F,marginTop:1}}>{(e.expenses||[]).length} exp</div>
                  </div>
                  <div style={{textAlign:"right",fontSize:12,fontWeight:600,color:T.text,fontFamily:F}}>{fmt(c.sales)}</div>
                  <div style={{textAlign:"right",fontSize:12,color:T.muted,fontFamily:F}}>{fmtKg(c.gas)}</div>
                  <div style={{textAlign:"right",fontSize:12,fontWeight:700,color:c.grossProfit>=0?T.success:T.danger,fontFamily:F}}>{fmt(c.grossProfit)}</div>
                </div>
              );
            })}
            {/* Totals row */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 76px",gap:0,padding:"10px 14px",background:T.bg,borderTop:`1px solid ${T.border}`}}>
              <span style={{fontSize:12,fontWeight:600,color:T.text,fontFamily:F}}>Total ({days}d)</span>
              <span style={{textAlign:"right",fontSize:12,fontWeight:700,color:T.text,fontFamily:F}}>{fmt(mergedTotals.rev)}</span>
              <span style={{textAlign:"right",fontSize:12,fontWeight:600,color:T.muted,fontFamily:F}}>{fmtKg(totals.gas)}</span>
              <span style={{textAlign:"right",fontSize:13,fontWeight:700,color:mergedTotals.grossP>=0?T.success:T.danger,fontFamily:F}}>{fmt(mergedTotals.grossP)}</span>
            </div>
          </Card>
        </>)}
        <div style={{height:16}}/>
      </div>

      {/* Custom date picker bottom sheet */}
      {showPicker&&(
        <div style={{position:"absolute",inset:0,background:T.overlay,display:"flex",alignItems:"flex-end",zIndex:100}}>
          <div style={{background:T.surface,borderRadius:"16px 16px 0 0",padding:"20px 16px 32px",width:"100%",fontFamily:F}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <span style={{fontSize:16,fontWeight:600,color:T.text}}>Custom date range</span>
              <button onClick={()=>setShowPicker(false)} style={{background:T.bg2,border:"none",borderRadius:"50%",width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon n="close" s={14} c={T.muted}/>
              </button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:5,fontFamily:F}}>From</div>
                <input type="date" value={draftFrom} onChange={e=>setDraftFrom(e.target.value)}
                  style={{width:"100%",padding:"11px 12px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:13,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box"}}/>
              </div>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:5,fontFamily:F}}>To</div>
                <input type="date" value={draftTo} onChange={e=>setDraftTo(e.target.value)}
                  style={{width:"100%",padding:"11px 12px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:13,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box"}}/>
              </div>
            </div>
            {draftFrom&&draftTo&&(
              <div style={{background:T.bg,borderRadius:R.md,padding:"9px 12px",marginBottom:14,fontSize:12,color:T.muted}}>
                {(() => {
                  const f=new Date(draftFrom), t=new Date(draftTo);
                  const n=Math.round(Math.abs(t-f)/(1000*60*60*24))+1;
                  return `${n} day${n!==1?"s":""} selected`;
                })()}
              </div>
            )}
            <Btn label="Apply range" onClick={applyCustom} disabled={!draftFrom||!draftTo} size="lg" icon="check"/>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════════════
const HistoryScreen = ({entries, prices=[], deliveries=[], back, goDayDetail, sellPrice, costPrice, role="owner"}) => {
  const SP = sellPrice || DEFAULT_SELL_PRICE;
  const CP = costPrice || DEFAULT_COST_PRICE;
  // Use historically correct price for each entry
  const calcE = (e) => prices.length && deliveries.length
    ? calcEntryOnDate(e, prices, deliveries)
    : calcE(e);
  return (
  <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
    <TopBar title="All entries" left={<BackBtn onClick={back}/>} right={<Badge label={`${entries.length} days`}/>}/>
    <div style={{flex:1,overflow:"auto",padding:"16px 16px 24px"}}>
      {entries.length===0?(
        <div style={{textAlign:"center",padding:"48px 0",color:T.muted,fontSize:13}}>No entries yet.</div>
      ):(
        <Card>
          {entries.map((e,i)=>{
            const c=calcE(e);
            return (
              <div key={e.id} onClick={()=>goDayDetail(e)}
                style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderBottom:i<entries.length-1?`1px solid ${T.border}`:"none",cursor:"pointer"}}
                onMouseEnter={ev=>ev.currentTarget.style.background=T.bg}
                onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                <div style={{width:44,height:44,borderRadius:R.md,background:T.bg2,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontSize:15,fontWeight:700,color:T.text,fontFamily:F,lineHeight:1}}>{new Date(e.date).getDate()}</span>
                  <span style={{fontSize:9,color:T.muted,fontFamily:F}}>{new Date(e.date).toLocaleDateString("en-NG",{month:"short"})}</span>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:600,color:T.text,fontFamily:F}}>{fmt(c.sales)}</div>
                  <div style={{fontSize:11,color:T.muted,fontFamily:F,marginTop:1}}>{fmtKg(c.gas)} dispensed</div>
                </div>
                {role==="owner" ? (
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:13,fontWeight:700,color:c.grossProfit>=0?T.success:T.danger,fontFamily:F}}>{fmt(c.grossProfit)}</div>
                    <div style={{fontSize:10,color:T.muted,fontFamily:F}}>gross profit</div>
                  </div>
                ) : (
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>{fmt(c.sales)}</div>
                    <div style={{fontSize:10,color:T.muted,fontFamily:F}}>collected</div>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// DAY DETAIL
// ═══════════════════════════════════════════════════════════════
const DayDetail = ({entry, back, sellPrice, costPrice, onUpdate, onDelete, isOwner}) => {
  const SP = sellPrice || DEFAULT_SELL_PRICE;
  const CP = costPrice || DEFAULT_COST_PRICE;

  const [mode,    setMode]    = useState("view"); // view | edit
  const [saving,  setSaving]  = useState(false);
  const [deleting,setDeleting]= useState(false);
  const [err,     setErr]     = useState("");
  const [ok,      setOk]      = useState("");

  // editable fields
  const [date,     setDate]     = useState(entry.date);
  const [openM,    setOpenM]    = useState(String(entry.openMeter));
  const [closeM,   setCloseM]   = useState(String(entry.closeMeter));
  const [cash,     setCash]     = useState(String(entry.cashSales));
  const [pos,      setPos]      = useState(String(entry.posSales));
  const [exps,     setExps]     = useState(entry.expenses?.length ? entry.expenses.map(x=>({...x,amt:String(x.amt)})) : [{cat:"",amt:""}]);
  const [notes,    setNotes]    = useState(entry.notes||"");

  const setE = (i,k,v) => setExps(p=>p.map((x,j)=>j===i?{...x,[k]:v}:x));

  // live calc from edited values
  const gas      = (Number(closeM)||0) - (Number(openM)||0);
  const sales    = (Number(cash)||0)   + (Number(pos)||0);
  const expTotal = exps.reduce((s,x)=>s+(Number(x.amt)||0),0);
  const expRev   = gas * SP;
  const variance = sales - expRev;
  const cogs     = gas * CP;
  const grossP   = sales - cogs;
  const netP     = grossP - expTotal;

  const saveEdit = async () => {
    if (Number(closeM) <= Number(openM)) { setErr("Closing meter must be greater than opening meter."); return; }
    setSaving(true); setErr(""); setOk("");
    try {
      await onUpdate(entry.id, {
        date, openMeter:Number(openM), closeMeter:Number(closeM),
        cashSales:Number(cash)||0, posSales:Number(pos)||0,
        expenses: exps.filter(x=>x.cat&&x.amt).map(x=>({cat:x.cat,amt:Number(x.amt)})),
        notes,
      });
      setOk("Entry updated successfully.");
      setMode("view");
    } catch(e) { setErr(e.message||"Update failed. Try again."); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this entry? This cannot be undone.")) return;
    setDeleting(true);
    try { await onDelete(entry.id); back(); }
    catch(e) { setErr(e.message||"Delete failed."); setDeleting(false); }
  };

  const c = calcEntry(entry, SP, CP); // original values for view mode

  const StatTile = ({label, value, color}) => (
    <div style={{background:T.surface,borderRadius:R.lg,border:`1px solid ${T.border}`,padding:"12px 14px"}}>
      <div style={{fontSize:11,color:T.muted,fontFamily:F,fontWeight:500,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>{label}</div>
      <div style={{fontSize:18,fontWeight:700,color:color||T.text,fontFamily:F}}>{value}</div>
    </div>
  );

  const ViewRow = ({l,v,accent}) => (
    <div style={{display:"flex",justifyContent:"space-between",padding:"11px 14px",borderBottom:`1px solid ${T.border}`}}>
      <span style={{fontSize:13,color:T.muted,fontFamily:F}}>{l}</span>
      <span style={{fontSize:13,fontWeight:600,color:accent||T.text,fontFamily:F}}>{v}</span>
    </div>
  );

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar
        title={fmtD(entry.date)}
        dark={false}
        left={<BackBtn onClick={back} dark={false}/>}
        right={isOwner && mode==="view" ? (
          <button onClick={()=>{ setMode("edit"); setErr(""); setOk(""); }}
            style={{background:T.primary,border:"none",borderRadius:R.md,padding:"6px 12px",cursor:"pointer",color:"#fff",fontSize:13,fontWeight:600,fontFamily:F}}>
            Edit
          </button>
        ) : isOwner && mode==="edit" ? (
          <button onClick={()=>setMode("view")}
            style={{background:T.bg2,border:"none",borderRadius:R.md,padding:"6px 12px",cursor:"pointer",color:T.muted,fontSize:13,fontWeight:600,fontFamily:F}}>
            Cancel
          </button>
        ) : null}
      />

      <div style={{flex:1,overflow:"auto",padding:"16px 16px 24px"}}>
        {/* Status messages */}
        {ok  && <div style={{background:`${T.success}12`,borderRadius:R.md,padding:"10px 14px",marginBottom:12,fontSize:13,color:T.success,fontFamily:F}}>{ok}</div>}
        {err && <div style={{background:`${T.danger}12`, borderRadius:R.md,padding:"10px 14px",marginBottom:12,fontSize:13,color:T.danger, fontFamily:F}}>{err}</div>}

        {/* ── VIEW MODE ── */}
        {mode==="view" && (<>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
            <StatTile label="Total sales"  value={fmt(c.sales)} color={T.text}/>
            <StatTile label="Gas dispensed" value={fmtKg(c.gas)} color={T.primary}/>
            {isOwner&&<StatTile label="Gross profit" value={fmt(c.grossProfit)} color={c.grossProfit>=0?T.success:T.danger}/>}
            {isOwner&&<StatTile label="Net profit"   value={fmt(c.profit)}      color={c.profit>=0?T.success:T.danger}/>}
          </div>
          <SLabel mt={0}>Meter</SLabel>
          <Card style={{marginBottom:12}}>
            <ViewRow l="Opening meter" v={`${Number(entry.openMeter).toLocaleString()} kg`}/>
            <ViewRow l="Closing meter" v={`${Number(entry.closeMeter).toLocaleString()} kg`}/>
            <ViewRow l="Gas dispensed" v={fmtKg(c.gas)} accent={T.primary}/>
          </Card>
          <SLabel>Sales</SLabel>
          <Card style={{marginBottom:12}}>
            <ViewRow l="Cash"          v={fmt(entry.cashSales)}/>
            <ViewRow l="POS / transfer" v={fmt(entry.posSales)}/>
            <ViewRow l="Total"         v={fmt(c.sales)} accent={T.primary}/>
            {isOwner&&<ViewRow l="Expected"     v={fmt(c.expRev)}/>}
            {isOwner&&<ViewRow l="Variance"     v={(c.variance>=0?"+":"")+fmt(c.variance)} accent={c.variance>=0?T.success:T.danger}/>}
            {isOwner&&CP>0&&<ViewRow l={`COGS (₦${CP}/kg)`} v={fmt(c.cogs)} accent={T.danger}/>}
            {isOwner&&CP>0&&<ViewRow l="Gross profit"        v={fmt(c.grossProfit)} accent={c.grossProfit>=0?T.success:T.danger}/>}
          </Card>
          {isOwner&&(entry.expenses||[]).length>0&&(<>
            <SLabel>Expenses</SLabel>
            <Card style={{marginBottom:12}}>
              {(entry.expenses||[]).map((x,i)=><ViewRow key={i} l={x.cat} v={fmt(x.amt)} accent={T.danger}/>)}
              <ViewRow l="Total" v={fmt(c.exp)} accent={T.danger}/>
            </Card>
          </>)}
          {entry.notes&&(<>
            <SLabel>Notes</SLabel>
            <Card pad="12px 14px" style={{marginBottom:12}}>
              <p style={{fontSize:13,color:T.text,lineHeight:1.6,margin:0}}>{entry.notes}</p>
            </Card>
          </>)}
          {/* Owner actions */}
          {isOwner&&(
            <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:8}}>
              <Btn label="Edit this entry" onClick={()=>{setMode("edit");setErr("");setOk("");}} size="lg" icon="lock"/>
              <Btn label="Delete entry" onClick={handleDelete} loading={deleting} variant="danger" size="lg"/>
            </div>
          )}
          <div style={{marginTop:8}}><Btn label="Back to history" onClick={back} variant="outline" size="lg"/></div>
        </>)}

        {/* ── EDIT MODE ── */}
        {mode==="edit" && (<>
          {/* Live preview bar */}
          {(gas>0||sales>0)&&(
            <div style={{background:T.primary,borderRadius:R.md,padding:"10px 14px",marginBottom:16,display:"flex",gap:8}}>
              {[[fmtKg(gas),"Gas"],[fmt(sales),"Sales"],[(variance>=0?"+":"")+fmt(variance),"Variance"],[fmt(grossP),"Gross P"]].map(([v,l])=>(
                <div key={l} style={{flex:1,textAlign:"center"}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#fff",fontFamily:F}}>{v}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,.45)",textTransform:"uppercase",letterSpacing:.3,marginTop:1}}>{l}</div>
                </div>
              ))}
            </div>
          )}

          <SLabel mt={0}>Date</SLabel>
          <Input value={date} onChange={setDate} type="date"/>

          <SLabel>Meter readings</SLabel>
          <Card pad="14px" style={{marginBottom:12}}>
            <Input label="Opening meter (kg)" value={openM} onChange={setOpenM} type="number" placeholder="e.g. 31400"/>
            <Input label="Closing meter (kg)" value={closeM} onChange={setCloseM} type="number" placeholder="e.g. 31460"
              error={closeM&&Number(closeM)<=Number(openM)?"Must be greater than opening meter":""}/>
            {gas>0&&<div style={{background:T.bg,borderRadius:R.sm,padding:"8px 12px",display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:12,color:T.muted}}>Gas dispensed</span>
              <span style={{fontSize:13,fontWeight:700,color:T.text}}>{fmtKg(gas)}</span>
            </div>}
          </Card>

          <SLabel>Sales</SLabel>
          <Card pad="14px" style={{marginBottom:12}}>
            <div style={{background:T.bg,borderRadius:R.sm,padding:"8px 12px",marginBottom:12,display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:12,color:T.muted}}>Selling price</span>
              <span style={{fontSize:13,fontWeight:600,color:T.text}}>₦{SP}/kg</span>
            </div>
            <Input label="Cash sales" value={cash} onChange={setCash} type="number" prefix="₦" placeholder="0"/>
            <Input label="POS / transfer" value={pos} onChange={setPos} type="number" prefix="₦" placeholder="0"/>
            {sales>0&&expRev>0&&(
              <div style={{background:Math.abs(variance/expRev)<.05?`${T.success}10`:`${T.danger}10`,borderRadius:R.sm,padding:"9px 12px",marginBottom:4}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:12,color:T.muted}}>Expected</span><span style={{fontSize:12,fontWeight:600,color:T.text}}>{fmt(expRev)}</span></div>
                <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,color:T.muted}}>Variance</span><span style={{fontSize:12,fontWeight:700,color:variance>=0?T.success:T.danger}}>{variance>=0?"+":""}{fmt(variance)}</span></div>
              </div>
            )}
          </Card>

          <SLabel>Expenses</SLabel>
          <Card pad="14px" style={{marginBottom:12}}>
            {exps.map((ex,i)=>(
              <div key={i} style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                <div style={{flex:2}}><Input label={i===0?"Category":""} value={ex.cat} onChange={v=>setE(i,"cat",v)} placeholder="e.g. Salary"/></div>
                <div style={{flex:1}}><Input label={i===0?"Amount":""} value={ex.amt} onChange={v=>setE(i,"amt",v)} type="number" prefix="₦" placeholder="0"/></div>
                {exps.length>1&&<button onClick={()=>setExps(p=>p.filter((_,j)=>j!==i))} style={{marginBottom:14,width:34,height:40,borderRadius:R.sm,background:"#fee2e2",border:"none",cursor:"pointer",color:T.danger,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <Icon n="close" s={14} c={T.danger}/>
                </button>}
              </div>
            ))}
            <button onClick={()=>setExps(p=>[...p,{cat:"",amt:""}])} style={{width:"100%",padding:"9px",background:T.bg,border:`1px dashed ${T.borderMid}`,borderRadius:R.sm,fontSize:13,fontWeight:500,color:T.muted,cursor:"pointer",fontFamily:F,marginBottom:4}}>+ Add expense</button>
          </Card>

          <SLabel>Notes</SLabel>
          <Card pad="12px 14px" style={{marginBottom:20}}>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={3}
              style={{width:"100%",border:"none",outline:"none",fontSize:13,fontFamily:F,color:T.text,resize:"none",background:"transparent",boxSizing:"border-box"}}
              placeholder="Any notes…"/>
          </Card>

          <Btn label="Save changes" onClick={saveEdit} loading={saving} disabled={!closeM||!openM||Number(closeM)<=Number(openM)} size="lg" icon="check"/>
          <div style={{marginTop:8}}><Btn label="Cancel" onClick={()=>setMode("view")} variant="outline" size="lg"/></div>
        </>)}
        <div style={{height:16}}/>
      </div>
    </div>
  );
};

// Top-level sub-screen wrapper — must be outside SettingsScreen to prevent remount on keystrokes
// Notification settings form — saves UltraMsg credentials to localStorage
const NotifSettingsForm = ({ profile, plantId, onSaved }) => {
  const safeGet = (k) => { try{ return localStorage.getItem(k)||""; }catch{ return ""; } };
  const [phone,      setPhone]      = useState(()=>safeGet("gasledger_wa_phone")||profile?.waPhone||"");
  const [token,      setToken]      = useState(()=>safeGet("gasledger_wa_token"));
  const [instanceId, setInstanceId] = useState(()=>safeGet("gasledger_wa_instanceid"));
  const [ld,         setLd]         = useState(false);
  const [ok,         setOk]         = useState("");
  const [err,        setErr]        = useState("");

  const save = async () => {
    if (!phone.trim()) { setErr("Enter your WhatsApp phone number."); return; }
    if (!token.trim() || !instanceId.trim()) { setErr("Enter your UltraMsg instance ID and token."); return; }
    setLd(true); setErr(""); setOk("");
    try {
      const safeSet = (k,v) => { try{ localStorage.setItem(k,v); }catch{} };
      safeSet("gasledger_wa_phone",      phone.trim());
      safeSet("gasledger_wa_token",      token.trim());
      safeSet("gasledger_wa_instanceid", instanceId.trim());
      // Save to Firestore plant doc so staff devices can read credentials too
      await fbUpdateNotifSettings(plantId, {
        waPhone:      phone.trim(),
        waToken:      token.trim(),
        waInstanceId: instanceId.trim(),
      });
      setOk("Saved! Staff activity will now send WhatsApp alerts to your number.");
    } catch(e) { setErr("Failed to save. Try again."); }
    finally { setLd(false); }
  };

  const test = async () => {
    const p = phone.trim(); const t = token.trim(); const i = instanceId.trim();
    if (!p||!t||!i) { setErr("Fill in all fields and save first."); return; }
    setOk("Sending test...");
    await sendWhatsAppNotif(p, t, i, "✅ GasLedger test — WhatsApp notifications are working!");
    setOk("Test sent! Check your WhatsApp.");
  };

  return (
    <div>
      <Input label="Your WhatsApp number" value={phone} onChange={setPhone}
        placeholder="e.g. 2348012345678"
        hint="International format — 234 for Nigeria, no + sign"/>
      <div style={{height:12}}/>
      <Input label="UltraMsg Instance ID" value={instanceId} onChange={setInstanceId}
        placeholder="e.g. instance12345"
        hint="Found in your UltraMsg dashboard after creating an instance"/>
      <div style={{height:12}}/>
      <Input label="UltraMsg Token" value={token} onChange={setToken}
        placeholder="e.g. abc123xyz"
        hint="Found next to your Instance ID in UltraMsg dashboard"/>
      {err&&<ErrBanner msg={err}/>}
      {ok&&<div style={{background:`${T.success}10`,borderRadius:R.md,padding:"10px 12px",fontSize:13,color:T.success,fontFamily:F,marginTop:8}}>{ok}</div>}
      <div style={{height:16}}/>
      <Btn label="Save settings" onClick={save} loading={ld} size="lg" icon="check"/>
      <div style={{marginTop:8}}><Btn label="Send test message" onClick={test} variant="outline" size="lg"/></div>
    </div>
  );
};

const SettingsSubScreen = ({ title, onBack, children }) => (
  <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
    <TopBar title={title} dark={false} left={<BackBtn onClick={onBack} dark={false}/>}/>
    <div style={{flex:1,overflow:"auto",padding:"20px 16px 32px"}}>{children}</div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// SETTINGS SCREEN
// ═══════════════════════════════════════════════════════════════
const SettingsScreen = ({ user, profile, plantId, onSignOut, invites=[], staffMembers=[], liveCost=0, planLimits={} }) => {
  const role = profile?.role || "owner";
  // ── Load Paystack script on mount ────────────────────────
  useEffect(() => {
    if (window.PaystackPop) return;
    const s = document.createElement("script");
    s.src = "https://js.paystack.co/v1/inline.js";
    s.async = true;
    document.head.appendChild(s);
  }, []);

  // ── Billing state ─────────────────────────────────────────
  const [billingLd,  setBillingLd]  = useState("");
  const [billingErr, setBillingErr] = useState("");
  const [billingOk,  setBillingOk]  = useState("");

  // sub-screens: null | "plant" | "email" | "password" | "staff" | "cost"
  const [sub,        setSub]       = useState(null);

  // Plant name
  const [plantName,  setPlantName] = useState(profile?.displayName || "");
  const [savingName, setSavingName]= useState(false);
  const [nameMsg,    setNameMsg]   = useState("");

  // Default cost price — use profile value if set, otherwise fall back to latest delivery cost
  const initCost = profile?.defaultCostPrice || liveCost || "";
  const [defCost,    setDefCost]   = useState(String(initCost || ""));
  const [costMsg,    setCostMsg]   = useState("");
  const [savingCost, setSavingCost]= useState(false);

  const saveDefCost = async () => {
    if (!defCost) return;
    setSavingCost(true); setCostMsg("");
    try {
      const { updateDoc, getFirestore, doc } = await import("firebase/firestore");
      const db = getFirestore();
      await updateDoc(doc(db,"users",user.uid), { defaultCostPrice: Number(defCost) });
      await updateDoc(doc(db,"plants",plantId),  { defaultCostPrice: Number(defCost) });
      setCostMsg(`Default cost price set to ₦${Number(defCost).toLocaleString("en-NG")}/kg`);
    } catch(e) { setCostMsg("Failed to save. Try again."); }
    finally { setSavingCost(false); }
  };

  // Email change
  const [newEmail,   setNewEmail]  = useState("");
  const [emailPw,    setEmailPw]   = useState("");
  const [showEPw,    setShowEPw]   = useState(false);
  const [emailLd,    setEmailLd]   = useState(false);
  const [emailErr,   setEmailErr]  = useState("");
  const [emailOk,    setEmailOk]   = useState(false);

  // Password change
  const [curPw,      setCurPw]     = useState("");
  const [newPw,      setNewPw]     = useState("");
  const [confPw,     setConfPw]    = useState("");
  const [showPw,     setShowPw]    = useState(false);
  const [pwLd,       setPwLd]      = useState(false);
  const [pwErr,      setPwErr]     = useState("");
  const [pwOk,       setPwOk]      = useState(false);

  const errMap = (code) => ({
    "auth/wrong-password":      "Current password is incorrect.",
    "auth/too-many-requests":   "Too many attempts. Try again later.",
    "auth/email-already-in-use":"That email is already in use.",
    "auth/invalid-email":       "Please enter a valid email address.",
    "auth/requires-recent-login":"Please sign out and sign in again before changing credentials.",
  }[code] || "Something went wrong. Please try again.");

  const savePlantName = async () => {
    if (!plantName.trim()) return;
    setSavingName(true); setNameMsg("");
    try {
      const { updatePlantName: upn, userDoc } = await import("./firebase.js");
      // update both plant doc name and user displayName
      const { updateDoc, getFirestore, doc } = await import("firebase/firestore");
      const db = getFirestore();
      await updateDoc(doc(db,"plants",plantId), { name: plantName.trim() });
      await updateDoc(doc(db,"users",user.uid),  { displayName: plantName.trim() });
      setNameMsg("Plant name updated.");
    } catch(e) { setNameMsg("Failed to update. Try again."); }
    finally { setSavingName(false); }
  };

  const saveEmail = async () => {
    setEmailErr(""); setEmailLd(true);
    try {
      const { reauthAndUpdateEmail } = await import("./firebase.js");
      await reauthAndUpdateEmail(emailPw, newEmail.trim());
      setEmailOk(true); setNewEmail(""); setEmailPw("");
    } catch(e) { setEmailErr(errMap(e.code)); }
    finally { setEmailLd(false); }
  };

  const savePassword = async () => {
    if (newPw !== confPw) { setPwErr("New passwords do not match."); return; }
    if (newPw.length < 6) { setPwErr("Password must be at least 6 characters."); return; }
    setPwErr(""); setPwLd(true);
    try {
      const { reauthAndUpdatePassword } = await import("./firebase.js");
      await reauthAndUpdatePassword(curPw, newPw);
      setPwOk(true); setCurPw(""); setNewPw(""); setConfPw("");
    } catch(e) { setPwErr(errMap(e.code)); }
    finally { setPwLd(false); }
  };

  // ── Invite / staff management state ─────────────────────
  const [inviteEmail,   setInviteEmail]   = useState("");
  const [inviteLd,      setInviteLd]      = useState(false);
  const [inviteErr,     setInviteErr]     = useState("");
  const [inviteOk,      setInviteOk]      = useState("");
  const [confirmAction, setConfirmAction] = useState(null);

  // ── shared sub-screen shell — defined outside to prevent remount ──
  const backFromSub = useCallback(() => {
    setSub(null); setNameMsg(""); setEmailErr(""); setEmailOk(false); setPwErr(""); setPwOk(false);
  }, []);

  // ── Plant name sub-screen ────────────────────────────────
  if (sub === "plant") return (
    <SettingsSubScreen title="Plant name" onBack={backFromSub}>
      <p style={{fontSize:13,color:T.muted,fontFamily:F,lineHeight:1.6,marginBottom:20}}>This name appears on your dashboard and all reports.</p>
      <Input label="Plant name" value={plantName} onChange={setPlantName} placeholder="e.g. Hageez Gas Plant" onEnter={savePlantName}/>
      {nameMsg && (
        <div style={{background: nameMsg.includes("updated") ? `${T.success}12` : `${T.danger}12`, borderRadius:R.md, padding:"10px 12px", marginBottom:14, fontSize:13, color: nameMsg.includes("updated") ? T.success : T.danger, fontFamily:F}}>
          {nameMsg}
        </div>
      )}
      <Btn label="Save plant name" onClick={savePlantName} loading={savingName} disabled={!plantName.trim()||plantName.trim()===profile?.displayName} size="lg" icon="check"/>
    </SettingsSubScreen>
  );

  // ── Change email sub-screen ──────────────────────────────
  if (sub === "email") return (
    <SettingsSubScreen title="Change email" onBack={backFromSub}>
      {emailOk ? (
        <div style={{textAlign:"center",padding:"32px 0"}}>
          <div style={{width:48,height:48,borderRadius:"50%",background:`${T.success}15`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}>
            <Icon n="check" s={24} c={T.success}/>
          </div>
          <div style={{fontSize:16,fontWeight:600,color:T.text,marginBottom:8}}>Email updated</div>
          <div style={{fontSize:13,color:T.muted,lineHeight:1.6,marginBottom:24}}>Your sign-in email has been changed successfully.</div>
          <Btn label="Back to settings" onClick={()=>setSub(null)} variant="outline" size="lg"/>
        </div>
      ) : (<>
        <p style={{fontSize:13,color:T.muted,lineHeight:1.6,marginBottom:20}}>Enter your new email and current password to confirm the change.</p>
        <div style={{background:T.bg2,borderRadius:R.md,padding:"10px 12px",marginBottom:16,fontSize:12,color:T.muted}}>
          Current email: <strong style={{color:T.text}}>{user?.email}</strong>
        </div>
        <Input label="New email address" value={newEmail} onChange={v=>{setNewEmail(v);setEmailErr("");}} type="email" placeholder="new@example.com"/>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:5}}>Current password</div>
          <div style={{position:"relative"}}>
            <input value={emailPw} onChange={e=>{setEmailPw(e.target.value);setEmailErr("");}} type={showEPw?"text":"password"} placeholder="••••••••"
              style={{width:"100%",padding:"11px 40px 11px 12px",border:`1.5px solid ${emailErr?T.danger:T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box"}}
              onFocus={e=>e.target.style.borderColor=T.primary}
              onBlur={e=>e.target.style.borderColor=emailErr?T.danger:T.borderMid}/>
            <button onClick={()=>setShowEPw(p=>!p)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center"}}>
              <Icon n={showEPw?"eyeoff":"eye"} s={17} c={T.muted}/>
            </button>
          </div>
        </div>
        {emailErr&&<div style={{background:`${T.danger}10`,borderRadius:R.md,padding:"10px 12px",marginBottom:14,fontSize:13,color:T.danger}}>{emailErr}</div>}
        <Btn label="Update email" onClick={saveEmail} loading={emailLd} disabled={!newEmail||!emailPw} size="lg" icon="check"/>
      </>)}
    </SettingsSubScreen>
  );

  // ── Change password sub-screen ───────────────────────────
  if (sub === "password") return (
    <SettingsSubScreen title="Change password" onBack={backFromSub}>
      {pwOk ? (
        <div style={{textAlign:"center",padding:"32px 0"}}>
          <div style={{width:48,height:48,borderRadius:"50%",background:`${T.success}15`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}>
            <Icon n="check" s={24} c={T.success}/>
          </div>
          <div style={{fontSize:16,fontWeight:600,color:T.text,marginBottom:8}}>Password updated</div>
          <div style={{fontSize:13,color:T.muted,lineHeight:1.6,marginBottom:24}}>Your password has been changed successfully.</div>
          <Btn label="Back to settings" onClick={()=>setSub(null)} variant="outline" size="lg"/>
        </div>
      ) : (<>
        <p style={{fontSize:13,color:T.muted,lineHeight:1.6,marginBottom:20}}>Enter your current password, then choose a new one.</p>
        {[
          {label:"Current password", val:curPw, set:setCurPw},
          {label:"New password",     val:newPw, set:setNewPw},
          {label:"Confirm new password", val:confPw, set:setConfPw},
        ].map(({label,val,set})=>(
          <div key={label} style={{marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:5}}>{label}</div>
            <div style={{position:"relative"}}>
              <input value={val} onChange={e=>{set(e.target.value);setPwErr("");}} type={showPw?"text":"password"} placeholder="••••••••"
                style={{width:"100%",padding:"11px 40px 11px 12px",border:`1.5px solid ${pwErr?T.danger:T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box"}}
                onFocus={e=>e.target.style.borderColor=T.primary}
                onBlur={e=>e.target.style.borderColor=pwErr?T.danger:T.borderMid}/>
              <button onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center"}}>
                <Icon n={showPw?"eyeoff":"eye"} s={17} c={T.muted}/>
              </button>
            </div>
          </div>
        ))}
        {pwErr&&<div style={{background:`${T.danger}10`,borderRadius:R.md,padding:"10px 12px",marginBottom:14,fontSize:13,color:T.danger}}>{pwErr}</div>}
        <Btn label="Update password" onClick={savePassword} loading={pwLd} disabled={!curPw||!newPw||!confPw} size="lg" icon="check"/>
      </>)}
    </SettingsSubScreen>
  );

  // ── Staff management state ───────────────────────────────
  // invites and staffMembers now passed as props from Root (avoids duplicate Firestore listeners)


  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    // Check plan limit
    const activeStaff  = staffMembers.length;
    const maxStaff     = planLimits.maxStaff ?? 0;
    if (activeStaff >= maxStaff) {
      const needed = maxStaff === 0 ? "Basic" : "Pro";
      setInviteErr(`Your ${getPlan(profile)} plan allows ${maxStaff === 0 ? "no" : maxStaff} staff member${maxStaff === 1 ? "" : "s"}. Upgrade to ${needed} to add more.`);
      return;
    }
    setInviteLd(true); setInviteErr(""); setInviteOk("");
    try {
      await createInvite(plantId, profile?.displayName||"", user.uid, inviteEmail.trim());
      setInviteOk(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
    } catch(e) {
      setInviteErr(e.message||"Failed to send invite.");
    } finally { setInviteLd(false); }
  };

  const handleRevoke = (staffUid, staffEmail) => {
    setConfirmAction({ type:"revoke", uid:staffUid, email:staffEmail });
  };

  const handleDeleteInvite = (inviteId, email) => {
    setConfirmAction({ type:"cancel", inviteId, email });
  };

  const executeConfirm = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.type === "revoke") {
        await revokeStaff(confirmAction.uid);
      } else {
        await deleteInvite(confirmAction.inviteId);
      }
    } catch(e) {
      setInviteErr(e.message || "Action failed. Try again.");
    } finally {
      setConfirmAction(null);
    }
  };

  // ── Staff sub-screen ─────────────────────────────────────
  if (sub === "staff") return (
    <SettingsSubScreen title="Staff access" onBack={backFromSub}>
      {/* Invite form */}
      <div style={{marginBottom:20}}>
        <p style={{fontSize:13,color:T.muted,lineHeight:1.6,marginBottom:16}}>
          Invite staff by email. They'll register or log in with that email and be automatically linked to this plant.
        </p>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:5,fontFamily:F}}>Staff email address</div>
          <input
            autoFocus
            type="email"
            value={inviteEmail}
            onChange={e=>{setInviteEmail(e.target.value);setInviteErr("");setInviteOk("");}}
            onKeyDown={e=>e.key==="Enter"&&sendInvite()}
            placeholder="staff@example.com"
            style={{width:"100%",padding:"11px 12px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor=T.primary}
            onBlur={e=>e.target.style.borderColor=T.borderMid}
          />
        </div>
        {inviteErr&&<div style={{background:`${T.danger}10`,borderRadius:R.md,padding:"9px 12px",marginBottom:12,fontSize:13,color:T.danger,fontFamily:F}}>{inviteErr}</div>}
        {inviteOk &&<div style={{background:`${T.success}10`,borderRadius:R.md,padding:"9px 12px",marginBottom:12,fontSize:13,color:T.success,fontFamily:F}}>{inviteOk}</div>}
        <Btn label="Send invite" onClick={sendInvite} loading={inviteLd} disabled={!inviteEmail.trim()} size="lg" icon="invite"/>
      </div>

      {/* Active staff */}
      {staffMembers.length > 0 && (<>
        <SLabel mt={0}>Active staff ({staffMembers.length})</SLabel>
        <Card style={{marginBottom:16}}>
          {staffMembers.map((s,i)=>(
            <div key={s.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderBottom:i<staffMembers.length-1?`1px solid ${T.border}`:"none"}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:`${T.primary}12`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={{fontSize:14,fontWeight:700,color:T.primary}}>
                  {(s.email||"?").charAt(0).toUpperCase()}
                </span>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>{s.email}</div>
                <div style={{fontSize:11,color:T.muted,marginTop:1,fontFamily:F}}>Staff · active</div>
              </div>
              <button onClick={()=>handleRevoke(s.id, s.email)}
                style={{background:`${T.danger}10`,border:"none",borderRadius:R.md,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                <Icon n="remove" s={14} c={T.danger}/>
                <span style={{fontSize:12,color:T.danger,fontFamily:F,fontWeight:600}}>Remove</span>
              </button>
            </div>
          ))}
        </Card>
      </>)}

      {/* Pending invites */}
      {invites.filter(i=>i.status==="pending").length > 0 && (<>
        <SLabel mt={staffMembers.length>0?8:0}>Pending invites</SLabel>
        <Card>
          {invites.filter(i=>i.status==="pending").map((inv,i,arr)=>(
            <div key={inv.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none"}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:`${T.warning}15`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <Icon n="mail" s={16} c={T.warning}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>{inv.email}</div>
                <div style={{fontSize:11,color:T.warning,marginTop:1,fontFamily:F}}>Pending · not yet accepted</div>
              </div>
              <button onClick={()=>handleDeleteInvite(inv.id, inv.email)}
                style={{background:T.bg2,border:"none",borderRadius:R.md,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                <Icon n="close" s={13} c={T.muted}/>
                <span style={{fontSize:12,color:T.muted,fontFamily:F}}>Cancel</span>
              </button>
            </div>
          ))}
        </Card>
      </>)}

      {staffMembers.length===0 && invites.filter(i=>i.status==="pending").length===0 && (
        <div style={{textAlign:"center",padding:"32px 0",color:T.muted,fontSize:13}}>
          No staff yet. Send an invite above.
        </div>
      )}

      {/* In-app confirm dialog — replaces window.confirm (blocked on iOS PWA) */}
      {confirmAction&&(
        <div style={{position:"absolute",inset:0,background:T.overlay,display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:24}}>
          <div style={{background:T.surface,borderRadius:R.lg,padding:24,width:"100%",maxWidth:340,fontFamily:F}}>
            <div style={{fontSize:16,fontWeight:600,color:T.text,marginBottom:10}}>
              {confirmAction.type==="revoke" ? "Remove staff member?" : "Cancel invite?"}
            </div>
            <div style={{fontSize:13,color:T.muted,lineHeight:1.6,marginBottom:20}}>
              {confirmAction.type==="revoke"
                ? `${confirmAction.email} will lose access to this plant immediately.`
                : `The pending invite for ${confirmAction.email} will be cancelled.`}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setConfirmAction(null)}
                style={{flex:1,padding:"11px",background:T.bg2,border:`1px solid ${T.border}`,borderRadius:R.md,fontSize:14,fontWeight:500,color:T.text,cursor:"pointer",fontFamily:F}}>
                Keep
              </button>
              <button onClick={executeConfirm}
                style={{flex:1,padding:"11px",background:T.danger,border:"none",borderRadius:R.md,fontSize:14,fontWeight:600,color:"#fff",cursor:"pointer",fontFamily:F}}>
                {confirmAction.type==="revoke" ? "Remove" : "Cancel invite"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsSubScreen>
  );

  // ── Default cost price sub-screen ───────────────────────
  if (sub === "notifications") return (
    <SettingsSubScreen title="Notifications" onBack={backFromSub}>
      <div style={{background:`${T.primary}08`,borderRadius:R.lg,padding:"12px 14px",marginBottom:16,display:"flex",gap:10,alignItems:"flex-start"}}>
        <Icon n="alert" s={16} c={T.primary}/>
        <div style={{fontSize:12,color:T.text2,lineHeight:1.6,fontFamily:F}}>
          Get a WhatsApp message when your staff logs a daily entry or records an expense. Uses <strong>UltraMsg</strong> — free tier, no credit card, works in Nigeria.
        </div>
      </div>

      <div style={{background:T.bg,borderRadius:R.lg,padding:"12px 14px",marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.5,marginBottom:10,fontFamily:F}}>Setup (one time — 3 minutes)</div>
        {[
          "Go to ultramsg.com and create a free account",
          "Create a new instance — scan the QR code with your WhatsApp to connect it",
          "Copy your Instance ID and Token from the dashboard",
          "Enter them below with your phone number and tap Save",
          "Tap 'Send test message' to confirm it's working",
        ].map((s,i)=>(
          <div key={i} style={{display:"flex",gap:10,marginBottom:8,alignItems:"flex-start"}}>
            <div style={{width:20,height:20,borderRadius:"50%",background:T.primary,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{fontSize:10,fontWeight:700,color:"#fff",fontFamily:F}}>{i+1}</span>
            </div>
            <span style={{fontSize:12,color:T.text2,lineHeight:1.5,fontFamily:F}}>{s}</span>
          </div>
        ))}
        <div style={{marginTop:8,padding:"8px 10px",background:`${T.success}10`,borderRadius:R.md,fontSize:11,color:T.success,fontFamily:F}}>
          Free tier: 500 messages/month. No credit card needed.
        </div>
      </div>

      <NotifSettingsForm profile={profile} plantId={plantId} onSaved={backFromSub}/>
    </SettingsSubScreen>
  );

  if (sub === "cost") return (
    <SettingsSubScreen title="Default cost price" onBack={backFromSub}>
      <p style={{fontSize:13,color:T.muted,lineHeight:1.6,marginBottom:16,fontFamily:F}}>
        Set the default purchase price per kg from your supplier. This is used to calculate gross profit and COGS across all P&L reports.
      </p>
      <div style={{background:`${T.primary}08`,borderRadius:R.md,padding:"10px 14px",marginBottom:16,fontSize:12,color:T.muted,fontFamily:F}}>
        Current: {profile?.defaultCostPrice
          ? `₦${Number(profile.defaultCostPrice).toLocaleString("en-NG")}/kg (saved)`
          : liveCost > 0
          ? `₦${Number(liveCost).toLocaleString("en-NG")}/kg (from latest delivery — tap Save to lock in)`
          : "Not set — affects P&L accuracy"}
      </div>
      <Input label="Cost price per kg" value={defCost} onChange={v=>{setDefCost(v);setCostMsg("");}} type="number" prefix="₦" placeholder="e.g. 1600" hint="This auto-fills deliveries and P&L cost calculations." onEnter={saveDefCost}/>
      {costMsg&&(
        <div style={{background:costMsg.includes("set")?`${T.success}10`:`${T.danger}10`,borderRadius:R.md,padding:"9px 12px",marginBottom:14,fontSize:13,color:costMsg.includes("set")?T.success:T.danger,fontFamily:F}}>{costMsg}</div>
      )}
      <Btn label="Save default cost price" onClick={saveDefCost} loading={savingCost} disabled={!defCost||Number(defCost)<=0} size="lg" icon="check"/>
    </SettingsSubScreen>
  );

  // ── Main settings list ───────────────────────────────────
  const Row = ({icon, label, sub, value, onClick, danger}) => (
    <div onClick={onClick} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 16px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,background:T.surface,transition:"background .12s"}}
      onMouseEnter={e=>e.currentTarget.style.background=T.bg}
      onMouseLeave={e=>e.currentTarget.style.background=T.surface}>
      <div style={{width:36,height:36,borderRadius:R.md,background:danger?`${T.danger}12`:`${T.primary}10`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <Icon n={icon} s={18} c={danger?T.danger:T.primary}/>
      </div>
      <div style={{flex:1}}>
        <div style={{fontSize:14,fontWeight:500,color:danger?T.danger:T.text,fontFamily:F}}>{label}</div>
        {sub&&<div style={{fontSize:12,color:T.muted,fontFamily:F,marginTop:2}}>{sub}</div>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {value&&<span style={{fontSize:12,color:T.muted,fontFamily:F}}>{value}</span>}
        {!danger&&<Icon n="chevron" s={16} c={T.muted}/>}
      </div>
    </div>
  );

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title="Settings" dark={false}/>
      <div style={{flex:1,overflow:"auto",padding:"0 0 24px"}}>

        {/* Account info card */}
        <div style={{background:T.primary,padding:"20px 16px 24px",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:52,height:52,borderRadius:"50%",background:T.gold,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{fontSize:20,fontWeight:700,color:T.goldFg,fontFamily:F}}>
                {(profile?.displayName||"?").charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <div style={{fontSize:16,fontWeight:600,color:"#fff",fontFamily:F}}>{profile?.displayName||"Your Plant"}</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.55)",fontFamily:F,marginTop:3}}>{user?.email}</div>
              <div style={{marginTop:6,display:"inline-block",background:`${T.gold}25`,borderRadius:R.pill,padding:"2px 10px",fontSize:11,fontWeight:600,color:T.gold}}>
                {getPlan(profile)==="pro"?"Pro plan":getPlan(profile)==="basic"?"Basic plan":"Free plan"}
              </div>
            </div>
          </div>
        </div>

        {/* Plant section */}
        <div style={{padding:"8px 16px 6px"}}>
          <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.7,fontFamily:F}}>Plant</span>
        </div>
        <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
          <Row icon="plant"  label="Plant name" sub={profile?.displayName} onClick={()=>{ setPlantName(profile?.displayName||""); setNameMsg(""); setSub("plant"); }}/>
          <Row icon="history" label="Entry history" sub="View and edit all past daily entries" onClick={()=>{ setSub(null); window.__setScreen&&window.__setScreen("history"); }}/>
          <Row icon="price"  label="Default cost price"
            sub={profile?.defaultCostPrice
              ? `₦${Number(profile.defaultCostPrice).toLocaleString("en-NG")}/kg saved`
              : liveCost > 0
              ? `₦${Number(liveCost).toLocaleString("en-NG")}/kg from latest delivery — tap to save`
              : "Not set — affects P&L accuracy"}
            onClick={()=>{ setDefCost(String(profile?.defaultCostPrice||liveCost||"")); setCostMsg(""); setSub("cost"); }}/>
          {role==="owner"&&(<>
            <Row icon="people" label="Staff access"
              sub={(()=>{
                const active  = staffMembers.length;
                const pending = invites.filter(i=>i.status==="pending").length;
                if (active > 0 && pending > 0) return `${active} active · ${pending} pending invite${pending!==1?"s":""}`;
                if (active > 0) return `${active} active staff member${active!==1?"s":""}`;
                if (pending > 0) return `${pending} pending invite${pending!==1?"s":""} — waiting for staff to sign up`;
                return "No staff yet";
              })()}
              onClick={()=>{ setInviteEmail(""); setInviteErr(""); setInviteOk(""); setSub("staff"); }}/>
            <Row icon="alert" label="Notifications"
              sub={profile?.waPhone?"WhatsApp alerts active · tap to change":"Set up WhatsApp alerts for staff activity"}
              onClick={()=>setSub("notifications")}/>
          </>)}
        </div>

        {/* Account section */}
        <div style={{padding:"20px 16px 6px"}}>
          <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.7,fontFamily:F}}>Account</span>
        </div>
        <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
          <Row icon="mail"   label="Email address"  sub={user?.email}         onClick={()=>{ setNewEmail(""); setEmailPw(""); setEmailErr(""); setEmailOk(false); setSub("email"); }}/>
          <Row icon="lock"   label="Password"       sub="Change your password" onClick={()=>{ setCurPw(""); setNewPw(""); setConfPw(""); setPwErr(""); setPwOk(false); setSub("password"); }}/>
        </div>

        {/* ── Plan & Billing section ─────────────────────── */}
        {(()=>{
          const PLANS = [
            {
              id:    "free",
              name:  "Free",
              price: 0,
              tag:   "Starter",
              color: T.muted,
              extras: ["Owner only — no staff","Max 30 entries/month","Dashboard & stock tracker","No PDF export"],
              limits: { maxStaff:0, maxEntries:30, pdf:false, whatsapp:false, notifications:false },
            },
            {
              id:    "basic",
              name:  "Basic",
              price: 3500,
              tag:   "Popular",
              color: T.primary,
              extras: ["Up to 2 staff members","Unlimited entries","PDF export & WhatsApp share","Expense tracker","Staff notifications"],
              limits: { maxStaff:2, maxEntries:Infinity, pdf:true, whatsapp:true, notifications:true },
            },
            {
              id:    "pro",
              name:  "Pro",
              price: 7500,
              tag:   "Best value",
              color: T.gold,
              extras: ["Unlimited staff members","Everything in Basic","Monthly P&L summary","Multi-plant (coming soon)","Priority support"],
              limits: { maxStaff:Infinity, maxEntries:Infinity, pdf:true, whatsapp:true, notifications:true },
            },
          ];

          const currentPlan = getPlan(profile);

          const handleUpgrade = (plan) => {
            if (plan.id === "free") return;
            if (!window.PaystackPop) {
              setBillingErr("Payment system still loading. Please wait a moment and try again.");
              return;
            }
            setBillingLd(plan.id); setBillingErr(""); setBillingOk("");
            const handler = window.PaystackPop.setup({
              key:      "pk_test_01f4b870cfd12f3a9bab18aab50a10afd4518cb9",
              email:    user.email,
              amount:   plan.price * 100,
              currency: "NGN",
              ref:      `GASLEDGER-${user.uid.slice(0,8).toUpperCase()}-${Date.now()}`,
              metadata: { uid:user.uid, plantId, plan:plan.id, email:user.email },
              callback: (response) => {
                setBillingLd("");
                setBillingOk(`Payment received! Reference: ${response.reference}. Your plan will be updated shortly.`);
              },
              onClose: () => { setBillingLd(""); },
            });
            handler.openIframe();
          };

          return (<>
            <div style={{padding:"20px 16px 6px"}}>
              <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.7,fontFamily:F}}>Plan & Billing</span>
            </div>
            <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>

              {/* Current plan pill */}
              <div style={{background:T.surface,padding:"14px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:T.text,fontFamily:F}}>{PLANS.find(p=>p.id===currentPlan)?.name||"Free"} plan</div>
                  <div style={{fontSize:12,color:T.muted,marginTop:2,fontFamily:F}}>
                    {currentPlan==="free"?"All features free during beta":`₦${PLANS.find(p=>p.id===currentPlan)?.price?.toLocaleString("en-NG")}/month`}
                  </div>
                </div>
                <span style={{background:`${T.success}15`,color:T.success,fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:R.pill,fontFamily:F}}>Active</span>
              </div>

              {/* Compact 3-column plan selector */}
              <div style={{padding:"14px 16px"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                  {PLANS.map(plan=>{
                    const isActive  = currentPlan===plan.id;
                    const isLoading = billingLd===plan.id;
                    return (
                      <div key={plan.id}
                        onClick={()=>!isActive&&handleUpgrade(plan)}
                        style={{
                          background: isActive?T.primary:T.surface,
                          border:`${isActive?"2px":"1px"} solid ${isActive?T.primary:T.border}`,
                          borderRadius:R.lg,padding:"12px 10px",
                          cursor:isActive?"default":"pointer",
                          textAlign:"center",
                          transition:"all .15s",
                          position:"relative",
                        }}>
                        {/* Active checkmark */}
                        {isActive&&<div style={{position:"absolute",top:6,right:6,width:16,height:16,borderRadius:"50%",background:T.gold,display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <Icon n="check" s={9} c="#000"/>
                        </div>}
                        {/* Plan tag */}
                        <div style={{fontSize:9,fontWeight:600,color:isActive?"rgba(255,255,255,.6)":plan.id==="pro"?T.gold:T.muted,marginBottom:4,fontFamily:F,textTransform:"uppercase",letterSpacing:.4}}>{plan.tag}</div>
                        {/* Plan name */}
                        <div style={{fontSize:14,fontWeight:700,color:isActive?"#fff":T.text,fontFamily:F,marginBottom:4}}>{plan.name}</div>
                        {/* Price */}
                        <div style={{fontSize:plan.price===0?13:15,fontWeight:800,color:isActive?T.gold:plan.id==="pro"?T.gold:T.primary,fontFamily:F,lineHeight:1}}>
                          {plan.price===0?"Free":`₦${(plan.price/1000)}k`}
                        </div>
                        {plan.price>0&&<div style={{fontSize:9,color:isActive?"rgba(255,255,255,.5)":T.muted,fontFamily:F,marginTop:2}}>/month</div>}
                        {/* Key extras */}
                        <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:3}}>
                          {plan.extras.map(e=>(
                            <div key={e} style={{fontSize:9,color:isActive?"rgba(255,255,255,.7)":T.muted,fontFamily:F,lineHeight:1.3}}>{e}</div>
                          ))}
                        </div>
                        {/* Loading indicator */}
                        {isLoading&&<div style={{marginTop:6,fontSize:10,color:T.muted,fontFamily:F}}>Opening…</div>}
                      </div>
                    );
                  })}
                </div>

                {/* Upgrade button — only show if not on highest plan */}
                {currentPlan!=="pro"&&(
                  <button
                    onClick={()=>handleUpgrade(PLANS.find(p=>p.id===(currentPlan==="free"?"basic":"pro")))}
                    disabled={!!billingLd}
                    style={{width:"100%",padding:"12px",background:currentPlan==="free"?T.primary:T.gold,border:"none",borderRadius:R.md,fontSize:13,fontWeight:600,color:currentPlan==="free"?"#fff":"#000",cursor:billingLd?"default":"pointer",fontFamily:F,marginBottom:8}}>
                    {billingLd?"Opening payment…":currentPlan==="free"?`Upgrade to Basic — ₦3,500/mo`:`Upgrade to Pro — ₦7,500/mo`}
                  </button>
                )}
                {currentPlan==="pro"&&(
                  <div style={{padding:"10px",background:`${T.success}10`,borderRadius:R.md,fontSize:12,fontWeight:600,color:T.success,textAlign:"center",fontFamily:F,marginBottom:8}}>
                    ✓ You're on the best plan
                  </div>
                )}

                {billingErr&&<div style={{background:`${T.danger}10`,borderRadius:R.md,padding:"9px 12px",fontSize:12,color:T.danger,fontFamily:F,marginBottom:6}}>{billingErr}</div>}
                {billingOk &&<div style={{background:`${T.success}10`,borderRadius:R.md,padding:"9px 12px",fontSize:12,color:T.success,fontFamily:F,marginBottom:6}}>{billingOk}</div>}

                <div style={{fontSize:10,color:T.muted,textAlign:"center",fontFamily:F}}>Secured by Paystack · Cancel anytime</div>
              </div>
            </div>
          </>);
        })()}

        {/* About section */}
        <div style={{padding:"20px 16px 6px"}}>
          <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.7,fontFamily:F}}>About</span>
        </div>
        <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
          <div style={{padding:"12px 16px",background:T.surface,borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:14,color:T.text,fontFamily:F}}>Version</span>
            <span style={{fontSize:14,color:T.muted,fontFamily:F}}>1.0.0</span>
          </div>
          <div style={{padding:"12px 16px",background:T.surface,display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:14,color:T.text,fontFamily:F}}>Plant ID</span>
            <span style={{fontSize:11,color:T.muted,fontFamily:F,fontFamily:"monospace",letterSpacing:.5}}>{plantId?.slice(0,16)}…</span>
          </div>
        </div>

        {/* Sign out */}
        <div style={{padding:"20px 16px 0"}}>
          <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
            <Row icon="logout" label="Sign out" danger onClick={onSignOut}/>
          </div>
        </div>

        <div style={{height:32}}/>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// REMITTANCE / CASH DRAWER RECONCILIATION
// ═══════════════════════════════════════════════════════════════
const RemittanceScreen = ({ entries, remittances, onSave, back, submittedBy }) => {
  const today     = new Date().toISOString().split("T")[0];
  const todayEntry= entries.find(e => e.date === today);

  const [date,        setDate]        = useState(today);
  const [cashInDrawer,setCashInDrawer]= useState("");
  const [posInDrawer, setPosInDrawer] = useState("");
  const [note,        setNote]        = useState("");
  const [ld,          setLd]          = useState(false);
  const [done,        setDone]        = useState(null);
  const [err,         setErr]         = useState("");

  // Entry for selected date
  const selectedEntry  = entries.find(e => e.date === date);
  const recordedCash   = selectedEntry ? selectedEntry.cashSales  : null;
  const recordedPOS    = selectedEntry ? selectedEntry.posSales   : null;
  const recordedTotal  = selectedEntry ? selectedEntry.cashSales + selectedEntry.posSales : null;

  const submittedCash  = cashInDrawer !== "" ? Number(cashInDrawer) : null;
  const submittedPOS   = posInDrawer  !== "" ? Number(posInDrawer)  : null;
  const submittedTotal = (submittedCash !== null || submittedPOS !== null)
    ? (submittedCash||0) + (submittedPOS||0) : null;

  const diff   = recordedTotal !== null && submittedTotal !== null
    ? submittedTotal - recordedTotal : null;
  const status = diff === null ? null : diff === 0 ? "match" : diff > 0 ? "surplus" : "shortfall";

  // Already submitted for this date?
  const existing = remittances.find(r => r.date === date);

  const save = async () => {
    if (!selectedEntry) { setErr("No daily entry found for this date. Log the entry first."); return; }
    if (cashInDrawer === "" && posInDrawer === "") { setErr("Enter at least cash or POS amount."); return; }
    setLd(true); setErr("");
    try {
      const rec = {
        date,
        entryId:      selectedEntry.id,
        cashInDrawer: submittedCash||0,
        posInDrawer:  submittedPOS||0,
        totalSubmitted: submittedTotal||0,
        recordedCash,
        recordedPOS,
        recordedTotal,
        difference:   diff,
        status,
        note,
        submittedBy,
      };
      await onSave(rec);
      setDone(rec);
    } catch(e) {
      setErr(e.message || "Save failed. Try again.");
    } finally { setLd(false); }
  };

  // ── Status colours ─────────────────────────────────────────
  const statusStyle = {
    match:     { bg:`${T.success}12`, border:T.success,  c:T.success,  label:"Exact match",            icon:"check"  },
    surplus:   { bg:`${T.warning}12`, border:T.warning,  c:T.warning,  label:"Surplus — over-collected",icon:"alert"  },
    shortfall: { bg:`${T.danger}12`,  border:T.danger,   c:T.danger,   label:"Shortfall — cash missing", icon:"alert"  },
  }[status] || null;

  // ── Done screen ────────────────────────────────────────────
  if (done) {
    const ss = statusStyle;
    return (
      <div style={{flex:1,display:"flex",flexDirection:"column",background:T.bg,fontFamily:F}}>
        <div style={{background:T.primary,padding:"32px 24px 28px",display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
          <div style={{width:56,height:56,borderRadius:"50%",background:"rgba(255,255,255,.12)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Icon n={status==="match"?"check":"alert"} s={28} c={status==="match"?T.gold:"#fca5a5"}/>
          </div>
          <div style={{fontSize:20,fontWeight:700,color:"#fff",textAlign:"center"}}>Remittance recorded</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,.55)",textAlign:"center"}}>{fmtD(done.date)}</div>
        </div>
        <div style={{padding:"16px 16px 0",display:"flex",flexDirection:"column",gap:8}}>
          <div style={{background:ss?.bg||T.bg,border:`1.5px solid ${ss?.border||T.border}`,borderRadius:R.lg,padding:"16px"}}>
            <div style={{fontSize:13,fontWeight:700,color:ss?.c||T.text,marginBottom:12}}>{ss?.label}</div>
            {[
              ["Cash submitted",   fmt(done.cashInDrawer||0)],
              ["POS submitted",    fmt(done.posInDrawer||0)],
              ["Total submitted",  fmt(done.totalSubmitted||done.cashInDrawer||0)],
              ["Recorded (entry)", fmt(done.recordedTotal||done.recordedCash||0)],
              ["Difference",       (done.difference>=0?"+":"")+fmt(done.difference)],
            ].map(([l,v])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${T.border}`}}>
                <span style={{fontSize:13,color:T.muted,fontFamily:F}}>{l}</span>
                <span style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>{v}</span>
              </div>
            ))}
            {done.note&&<div style={{marginTop:10,fontSize:12,color:T.muted,fontStyle:"italic"}}>{done.note}</div>}
          </div>
          {status==="shortfall"&&(
            <div style={{background:`${T.danger}10`,borderRadius:R.md,padding:"10px 14px",fontSize:12,color:T.danger,lineHeight:1.5}}>
              A shortfall of <strong>{fmt(Math.abs(done.difference))}</strong> has been recorded. The plant owner will be able to see this in the remittance history.
            </div>
          )}
          <Btn label="Back to home" onClick={back} size="lg"/>
        </div>
      </div>
    );
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title="Money remittance" dark={false} left={<BackBtn onClick={back} dark={false}/>}/>

      <div style={{flex:1,overflow:"auto",padding:"16px 16px 32px"}}>

        {/* What this screen does */}
        <div style={{background:`${T.primary}08`,borderRadius:R.lg,padding:"12px 14px",marginBottom:16,display:"flex",gap:10,alignItems:"flex-start"}}>
          <Icon n="cash" s={18} c={T.primary}/>
          <div style={{fontSize:12,color:T.text2,lineHeight:1.6}}>
            Enter the cash in your drawer and POS total below. The app compares your submission to what was recorded in today's entry and flags any difference.
          </div>
        </div>

        {/* Date selector */}
        <SLabel mt={0}>Select date</SLabel>
        <Input value={date} onChange={setDate} type="date"/>

        {/* Today's entry summary */}
        {selectedEntry ? (
          <Card pad="14px" style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.6,marginBottom:10}}>Entry for {fmtD(date)}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[
                ["Recorded cash sales", fmt(selectedEntry.cashSales),  false],
                ["POS / transfer",       fmt(selectedEntry.posSales),   false],
                ["Total sales",          fmt(selectedEntry.cashSales+selectedEntry.posSales), true],
                ["Gas dispensed",        fmtKg(selectedEntry.closeMeter-selectedEntry.openMeter), false],
              ].map(([l,v,bold])=>(
                <div key={l} style={{background:T.bg,borderRadius:R.sm,padding:"9px 10px"}}>
                  <div style={{fontSize:10,color:T.muted,fontFamily:F,textTransform:"uppercase",letterSpacing:.4,marginBottom:3}}>{l}</div>
                  <div style={{fontSize:bold?16:14,fontWeight:bold?700:600,color:T.text,fontFamily:F}}>{v}</div>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <div style={{background:`${T.warning}10`,borderRadius:R.md,padding:"12px 14px",marginBottom:16,display:"flex",gap:10,alignItems:"center"}}>
            <Icon n="alert" s={16} c={T.warning}/>
            <span style={{fontSize:12,color:T.warning,fontFamily:F}}>No entry found for {fmtD(date)}. Log the daily entry first.</span>
          </div>
        )}

        {/* Already submitted warning */}
        {existing&&(
          <div style={{background:`${T.warning}10`,border:`1px solid ${T.warning}`,borderRadius:R.md,padding:"10px 14px",marginBottom:16,display:"flex",gap:10,alignItems:"flex-start"}}>
            <Icon n="alert" s={16} c={T.warning}/>
            <div>
              <div style={{fontSize:12,fontWeight:600,color:T.warning,fontFamily:F}}>Already submitted for this date</div>
              <div style={{fontSize:11,color:T.muted,marginTop:2}}>
                Cash: {fmt(existing.cashInDrawer)} · POS: {fmt(existing.posInDrawer||0)} · Diff: {existing.difference>=0?"+":""}{fmt(existing.difference)}
              </div>
            </div>
          </div>
        )}

        {/* Money count — Cash + POS */}
        <SLabel>Money count</SLabel>
        <Card pad="14px" style={{marginBottom:12}}>
          <Input
            label="Cash in drawer (count physically)"
            value={cashInDrawer}
            onChange={v=>{setCashInDrawer(v);setErr("");}}
            type="number"
            prefix="₦"
            placeholder="0"
            hint="Count every note and coin in the drawer right now."
          />
          {/* Quick chips for cash */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:-6,marginBottom:14}}>
            {[5000,10000,20000,50000,100000].map(v=>(
              <button key={v} onClick={()=>setCashInDrawer(String((Number(cashInDrawer)||0)+v))}
                style={{padding:"4px 10px",background:T.bg2,border:`1px solid ${T.border}`,borderRadius:R.pill,fontSize:11,fontWeight:500,color:T.muted,cursor:"pointer",fontFamily:F}}>
                +{v>=1000?(v/1000)+"k":v}
              </button>
            ))}
          </div>
          <Input
            label="POS / transfer received"
            value={posInDrawer}
            onChange={v=>{setPosInDrawer(v);setErr("");}}
            type="number"
            prefix="₦"
            placeholder="0"
            hint="Enter the total POS and bank transfer amount."
          />
          {/* Quick chips for POS */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:-6,marginBottom:4}}>
            {[5000,10000,20000,50000,100000].map(v=>(
              <button key={v} onClick={()=>setPosInDrawer(String((Number(posInDrawer)||0)+v))}
                style={{padding:"4px 10px",background:T.bg2,border:`1px solid ${T.border}`,borderRadius:R.pill,fontSize:11,fontWeight:500,color:T.muted,cursor:"pointer",fontFamily:F}}>
                +{v>=1000?(v/1000)+"k":v}
              </button>
            ))}
          </div>
          {/* Combined total preview */}
          {submittedTotal!==null&&(
            <div style={{background:T.bg,borderRadius:R.sm,padding:"10px 12px",marginTop:4,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:13,color:T.muted,fontFamily:F}}>Total submitted</span>
              <span style={{fontSize:15,fontWeight:700,color:T.text,fontFamily:F}}>{fmt(submittedTotal)}</span>
            </div>
          )}
        </Card>

        {/* Live difference preview */}
        {diff !== null && statusStyle && (
          <div style={{background:statusStyle.bg,border:`1.5px solid ${statusStyle.border}`,borderRadius:R.lg,padding:"14px 16px",marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <Icon n={statusStyle.icon} s={18} c={statusStyle.c}/>
                <span style={{fontSize:14,fontWeight:700,color:statusStyle.c,fontFamily:F}}>{statusStyle.label}</span>
              </div>
              <span style={{fontSize:18,fontWeight:800,color:statusStyle.c,fontFamily:F}}>
                {diff>=0?"+":"-"}{fmt(Math.abs(diff))}
              </span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {[
                ["Cash submitted",    fmt(submittedCash||0)],
                ["POS submitted",     fmt(submittedPOS||0)],
                ["Total submitted",   fmt(submittedTotal||0)],
                ["Recorded (entry)",  fmt(recordedTotal||0)],
              ].map(([l,v])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:12,color:T.muted,fontFamily:F}}>{l}</span>
                  <span style={{fontSize:12,fontWeight:600,color:T.text,fontFamily:F}}>{v}</span>
                </div>
              ))}
            </div>
            {status==="shortfall"&&(
              <div style={{marginTop:10,fontSize:12,color:T.danger,lineHeight:1.5,fontFamily:F}}>
                {fmt(Math.abs(diff))} is unaccounted for. Check your POS receipts or ask about any refunds before submitting.
              </div>
            )}
            {status==="surplus"&&(
              <div style={{marginTop:10,fontSize:12,color:T.warning,lineHeight:1.5,fontFamily:F}}>
                You have {fmt(diff)} more than recorded. Double-check your count before submitting.
              </div>
            )}
          </div>
        )}

        {/* Note */}
        <SLabel>Note (optional)</SLabel>
        <Card pad="12px 14px" style={{marginBottom:20}}>
          <textarea
            value={note}
            onChange={e=>setNote(e.target.value)}
            placeholder="e.g. Short by ₦2,000 — customer owes from morning…"
            rows={3}
            style={{width:"100%",border:"none",outline:"none",fontSize:13,fontFamily:F,color:T.text,resize:"none",background:"transparent",boxSizing:"border-box"}}
          />
        </Card>

        {err&&<ErrBanner msg={err}/>}

        <Btn
          label="Submit remittance"
          onClick={save}
          disabled={!selectedEntry||(cashInDrawer===""&&posInDrawer==="")}
          loading={ld}
          size="lg"
          icon="check"
        />
        <div style={{marginTop:8}}>
          <Btn label="Cancel" onClick={back} variant="outline" size="lg"/>
        </div>

        {/* History — last 7 submissions */}
        {remittances.length > 0 && (<>
          <SLabel>Recent submissions</SLabel>
          <Card>
            {remittances.slice(0,7).map((r,i)=>{
              const ss = {
                match:     {c:T.success, label:"Match"},
                surplus:   {c:T.warning, label:"Surplus"},
                shortfall: {c:T.danger,  label:"Shortfall"},
              }[r.status]||{c:T.muted,label:"—"};
              return (
                <div key={r.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",borderBottom:i<Math.min(6,remittances.length-1)?`1px solid ${T.border}`:"none"}}>
                  <div style={{width:40,height:40,borderRadius:R.md,background:`${ss.c}12`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <span style={{fontSize:14,fontWeight:700,color:ss.c,lineHeight:1}}>{new Date(r.date).getDate()}</span>
                    <span style={{fontSize:9,color:T.muted}}>{new Date(r.date).toLocaleDateString("en-NG",{month:"short"})}</span>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>{fmtD(r.date)}</div>
                    <div style={{fontSize:11,color:T.muted,marginTop:1}}>
                      Drawer: {fmt(r.cashInDrawer)} · Recorded: {fmt(r.recordedCash)}
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:12,fontWeight:700,color:ss.c}}>{r.difference>=0?"+":""}{fmt(r.difference)}</div>
                    <div style={{fontSize:10,color:ss.c,marginTop:1}}>{ss.label}</div>
                  </div>
                </div>
              );
            })}
          </Card>
        </>)}
        <div style={{height:16}}/>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// MONTHLY SUMMARY SCREEN
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// EXPENSES SCREEN — standalone expense tracker with date
// ═══════════════════════════════════════════════════════════════
const ExpensesScreen = ({ expenses, entries=[], onAdd, onUpdate, onDelete, back }) => {
  const CATS = ["Salary","Utility","Maintenance","Repairs","Transport","Miscellaneous","Security","Generator","Office","Rent","Other"];

  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState(null); // null=new, else expense object
  const [cat,       setCat]       = useState("");
  const [amt,       setAmt]       = useState("");
  const [date,      setDate]      = useState(new Date().toISOString().split("T")[0]);
  const [note,      setNote]      = useState("");
  const [err,       setErr]       = useState("");
  const [ld,        setLd]        = useState(false);
  const [filterCat,    setFilterCat]    = useState("All");
  const [sourceFilter, setSourceFilter] = useState("all"); // all | owner | staff | entry

  const openNew  = () => { setEditing(null); setCat(""); setAmt(""); setDate(new Date().toISOString().split("T")[0]); setNote(""); setErr(""); setShowModal(true); };
  const openEdit = (e) => { setEditing(e); setCat(e.category); setAmt(String(e.amount)); setDate(e.date); setNote(e.note||""); setErr(""); setShowModal(true); };

  const save = async () => {
    if (!cat.trim()) { setErr("Select or enter a category."); return; }
    if (!amt || Number(amt)<=0) { setErr("Enter a valid amount."); return; }
    setLd(true); setErr("");
    try {
      const data = { date, category:cat.trim(), amount:Number(amt), note:note.trim() };
      if (editing) { await onUpdate(editing.id, data); }
      else         { await onAdd(data); }
      setShowModal(false);
    } catch(e) { setErr(e.message||"Failed. Try again."); }
    finally { setLd(false); }
  };

  const del = async () => {
    if (!editing) return;
    if (!window.confirm(`Delete "${editing.category}" expense?`)) return;
    setLd(true);
    try { await onDelete(editing.id); setShowModal(false); }
    finally { setLd(false); }
  };

  // Filter + group by month
  // ── Merge all expense sources ─────────────────────────────
  // 1. Standalone (owner + staff shift)
  const standaloneList = expenses.map(e => ({
    ...e,
    _source: e.source === "staff" ? "staff" : "standalone",
    _label:  e.source === "staff" ? "Staff expense" : null,
  }));
  // 2. Inline expenses from daily entries
  const entryExpenseList = entries.flatMap(entry =>
    (entry.expenses||[]).map((exp,i) => ({
      id:       `${entry.id}_exp_${i}`,
      date:      entry.date,
      category:  exp.cat,
      amount:    exp.amt,
      note:      "",
      _source:   "entry",
      _label:    "Daily entry",
    }))
  );
  // Merge + sort by date descending
  const allExpenses = [...standaloneList, ...entryExpenseList]
    .sort((a,b) => b.date.localeCompare(a.date));

  // Source breakdown totals
  const ownerTotal = allExpenses.filter(e=>!e._source||e._source==="standalone").reduce((s,e)=>s+e.amount,0);
  const staffTotal = allExpenses.filter(e=>e._source==="staff").reduce((s,e)=>s+e.amount,0);
  const entryTotal = allExpenses.filter(e=>e._source==="entry").reduce((s,e)=>s+e.amount,0);

  // Apply source filter first, then category filter
  const sourceFiltered = sourceFilter==="all" ? allExpenses
    : sourceFilter==="owner" ? allExpenses.filter(e=>!e._source||e._source==="standalone")
    : sourceFilter==="staff" ? allExpenses.filter(e=>e._source==="staff")
    : allExpenses.filter(e=>e._source==="entry");

  const allCats = ["All", ...Array.from(new Set(sourceFiltered.map(e=>e.category))).sort()];
  const filtered = filterCat==="All" ? sourceFiltered : sourceFiltered.filter(e=>e.category===filterCat);
  const total    = filtered.reduce((s,e)=>s+e.amount, 0);

  // Group by month
  const byMonth = {};
  filtered.forEach(e => {
    const key = e.date?.slice(0,7) || "Unknown";
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(e);
  });
  const months = Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));

  const monthLabel = (key) => {
    if (key==="Unknown") return "Unknown";
    const d = new Date(key+"-01");
    return d.toLocaleDateString("en-NG",{month:"long",year:"numeric"});
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title="Expenses" dark={false}
        left={<BackBtn onClick={back} dark={false}/>}
        right={
          <button onClick={openNew} style={{background:T.primary,border:"none",borderRadius:R.md,padding:"6px 11px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,color:"#fff"}}>
            <Icon n="plus" s={14} c="#fff"/>
            <span style={{fontSize:12,fontWeight:600,fontFamily:F}}>Add</span>
          </button>
        }
      />

      {/* Summary bar */}
      <div style={{background:T.primary,padding:"12px 16px",flexShrink:0}}>
        <div style={{fontSize:11,color:"rgba(255,255,255,.5)",fontFamily:F,marginBottom:2}}>
          {sourceFilter==="all"?"All sources":sourceFilter==="owner"?"Owner expenses":sourceFilter==="staff"?"Staff expenses":"Entry expenses"} · {filtered.length} item{filtered.length!==1?"s":""}
        </div>
        <div style={{fontSize:22,fontWeight:700,color:T.gold,fontFamily:F,marginBottom:10}}>−{fmt(total)}</div>
        {/* Source breakdown strip */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
          {[
            {key:"owner", label:"Owner",   val:ownerTotal, color:"rgba(255,255,255,.9)"},
            {key:"staff", label:"Staff",   val:staffTotal, color:T.gold},
            {key:"entry", label:"Entries", val:entryTotal, color:"rgba(255,255,255,.7)"},
          ].map(s=>(
            <div key={s.key} onClick={()=>{setSourceFilter(sourceFilter===s.key?"all":s.key);setFilterCat("All");}}
              style={{background:sourceFilter===s.key?"rgba(255,255,255,.15)":"rgba(255,255,255,.06)",borderRadius:R.md,padding:"7px 8px",cursor:"pointer",border:`1px solid ${sourceFilter===s.key?"rgba(255,255,255,.3)":"transparent"}`,transition:"all .15s"}}>
              <div style={{fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:F,marginBottom:2,textTransform:"uppercase",letterSpacing:.4}}>{s.label}</div>
              <div style={{fontSize:13,fontWeight:600,color:s.color,fontFamily:F}}>−{fmt(s.val)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Category filter chips — scrollable */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"8px 12px",overflowX:"auto",display:"flex",gap:6,flexShrink:0,WebkitOverflowScrolling:"touch"}}>
        {allCats.map(c=>(
          <button key={c} onClick={()=>setFilterCat(c)}
            style={{flexShrink:0,padding:"5px 12px",background:filterCat===c?T.primary:T.bg2,color:filterCat===c?"#fff":T.muted,border:"none",borderRadius:R.pill,fontSize:11,fontWeight:filterCat===c?600:400,cursor:"pointer",fontFamily:F,whiteSpace:"nowrap",transition:"all .15s"}}>
            {c}
          </button>
        ))}
      </div>

      <div style={{flex:1,overflow:"auto",padding:"12px 16px 24px"}}>
        {filtered.length===0 ? (
          <div style={{textAlign:"center",padding:"48px 0",color:T.muted,fontSize:13}}>
            {expenses.length===0 ? "No expenses yet. Tap Add to record one." : "No expenses in this category."}
          </div>
        ) : (
          months.map(mKey=>(
            <div key={mKey}>
              {/* Month header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"12px 0 8px"}}>
                <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.7}}>{monthLabel(mKey)}</span>
                <span style={{fontSize:12,fontWeight:700,color:T.danger}}>−{fmt(byMonth[mKey].reduce((s,e)=>s+e.amount,0))}</span>
              </div>
              <Card>
                {byMonth[mKey].map((e,i,arr)=>{
                  // Owner can edit standalone + staff expenses. Entry expenses are read-only (edit from the entry itself)
                  const canEdit = e._source !== "entry";
                  return (
                  <div key={e.id} onClick={()=>canEdit&&openEdit(e)}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none",cursor:canEdit?"pointer":"default",transition:"background .12s"}}
                    onMouseEnter={ev=>{if(canEdit)ev.currentTarget.style.background=T.bg;}}
                    onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                    {/* Category badge */}
                    <div style={{width:40,height:40,borderRadius:R.md,
                      background: e._source==="entry"?`${T.primary}10`:e._source==="staff"?`${T.warning}10`:`${T.danger}10`,
                      display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <span style={{fontSize:11,fontWeight:700,
                        color: e._source==="entry"?T.primary:e._source==="staff"?T.warning:T.danger,
                        fontFamily:F}}>{e.category.slice(0,2).toUpperCase()}</span>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.text}}>{e.category}</div>
                      <div style={{fontSize:11,color:T.muted,marginTop:2,display:"flex",gap:8,flexWrap:"wrap"}}>
                        <span>{fmtD(e.date)}</span>
                        {e.note&&<span style={{fontStyle:"italic"}}>· {e.note}</span>}
                        {e._label&&<span style={{background:e._source==="entry"?`${T.primary}12`:e._source==="staff"?`${T.warning}15`:T.bg2,color:e._source==="entry"?T.primary:e._source==="staff"?T.warning:T.muted,padding:"1px 6px",borderRadius:R.pill,fontSize:10,fontWeight:500}}>{e._label}</span>}
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:14,fontWeight:700,color:T.danger}}>−{fmt(e.amount)}</div>
                      <div style={{fontSize:10,color:T.muted,marginTop:1}}>{canEdit?"tap to edit":"from daily entry"}</div>
                    </div>
                  </div>
                  );
                })}
              </Card>
            </div>
          ))
        )}
        <div style={{height:16}}/>
      </div>

      {/* Add / Edit modal */}
      {showModal&&(
        <div style={{position:"absolute",inset:0,background:T.overlay,display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{background:T.surface,borderRadius:"16px 16px 0 0",padding:"20px 16px 32px",width:"100%",maxHeight:"88%",overflowY:"auto",fontFamily:F}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <span style={{fontSize:16,fontWeight:600,color:T.text}}>{editing?"Edit expense":"New expense"}</span>
              <button onClick={()=>setShowModal(false)} style={{background:T.bg2,border:"none",borderRadius:"50%",width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon n="close" s={14} c={T.muted}/>
              </button>
            </div>

            {/* Date */}
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:5}}>Date</div>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}
              style={{width:"100%",padding:"11px 12px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box",marginBottom:14}}
              onFocus={e=>e.target.style.borderColor=T.primary}
              onBlur={e=>e.target.style.borderColor=T.borderMid}
            />

            {/* Category */}
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:5}}>Category</div>
            <input value={cat} onChange={e=>{setCat(e.target.value);setErr("");}} placeholder="e.g. Salary"
              style={{width:"100%",padding:"11px 12px",border:`1.5px solid ${err&&!cat?T.danger:T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box",marginBottom:8}}
              onFocus={e=>e.target.style.borderColor=T.primary}
              onBlur={e=>e.target.style.borderColor=err&&!cat?T.danger:T.borderMid}
            />
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
              {CATS.map(c=>(
                <button key={c} onClick={()=>{setCat(c);setErr("");}}
                  style={{padding:"4px 10px",background:cat===c?T.primary:T.bg2,color:cat===c?"#fff":T.muted,border:"none",borderRadius:R.pill,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:F,transition:"all .12s"}}>
                  {c}
                </button>
              ))}
            </div>

            {/* Amount */}
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:5}}>Amount</div>
            <div style={{position:"relative",marginBottom:8}}>
              <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",fontSize:14,color:T.muted,pointerEvents:"none"}}>₦</span>
              <input value={amt} onChange={e=>{setAmt(e.target.value);setErr("");}} type="number" placeholder="0"
                style={{width:"100%",padding:"11px 12px 11px 28px",border:`1.5px solid ${err&&!amt?T.danger:T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box"}}
                onFocus={e=>e.target.style.borderColor=T.primary}
                onBlur={e=>e.target.style.borderColor=err&&!amt?T.danger:T.borderMid}
              />
            </div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
              {[5000,10000,15000,20000,50000,100000].map(v=>(
                <button key={v} onClick={()=>{setAmt(String(v));setErr("");}}
                  style={{padding:"4px 10px",background:Number(amt)===v?T.primary:T.bg2,color:Number(amt)===v?"#fff":T.muted,border:"none",borderRadius:R.pill,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:F}}>
                  {v>=1000?(v/1000)+"k":v}
                </button>
              ))}
            </div>

            {/* Note */}
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:5}}>Note (optional)</div>
            <input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Monthly salary for Musa"
              style={{width:"100%",padding:"11px 12px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box",marginBottom:14}}
              onFocus={e=>e.target.style.borderColor=T.primary}
              onBlur={e=>e.target.style.borderColor=T.borderMid}
            />

            {err&&<div style={{background:`${T.danger}10`,borderRadius:R.sm,padding:"8px 12px",marginBottom:12,fontSize:12,color:T.danger}}>{err}</div>}

            <div style={{display:"flex",gap:8}}>
              {editing&&(
                <button onClick={del} disabled={ld} style={{padding:"13px 16px",background:"#fee2e2",border:"none",borderRadius:R.md,fontSize:13,fontWeight:600,color:T.danger,cursor:"pointer",fontFamily:F,flexShrink:0}}>
                  Delete
                </button>
              )}
              <button onClick={save} disabled={ld} style={{flex:1,padding:"13px",background:ld?T.bg2:T.primary,border:"none",borderRadius:R.md,fontSize:14,fontWeight:600,color:ld?T.muted:"#fff",cursor:ld?"default":"pointer",fontFamily:F}}>
                {ld?"Saving…":editing?"Save changes":"Add expense"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
const MonthlySummaryScreen = ({ entries, prices=[], deliveries=[], back, goMonthPnL, sellPrice, costPrice, standaloneExpenses=[] }) => {
  const SP = sellPrice || DEFAULT_SELL_PRICE;
  const CP = costPrice || DEFAULT_COST_PRICE;
  const calcE = (e) => prices.length && deliveries.length
    ? calcEntryOnDate(e, prices, deliveries)
    : calcE(e);

  // Group entries by YYYY-MM
  const monthMap = {};
  entries.forEach(e => {
    const key = e.date.slice(0,7);
    if (!monthMap[key]) monthMap[key] = [];
    monthMap[key].push(e);
  });

  // Group standalone expenses by YYYY-MM
  const standaloneByMonth = {};
  standaloneExpenses.forEach(e => {
    const key = (e.date||"").slice(0,7);
    if (!standaloneByMonth[key]) standaloneByMonth[key] = 0;
    standaloneByMonth[key] += (e.amount||0);
  });

  const months = Object.keys(monthMap).sort((a,b)=>b.localeCompare(a)).map(key => {
    const mes = monthMap[key];
    const entryTotals = mes.reduce((a,e)=>{
      const c=calcE(e);
      return {rev:a.rev+c.sales, grossP:a.grossP+c.grossProfit, gas:a.gas+c.gas, profit:a.profit+c.profit};
    },{rev:0,grossP:0,gas:0,profit:0});

    // Add standalone expenses for this month
    const standaloneExp = standaloneByMonth[key] || 0;
    const totals = {
      ...entryTotals,
      profit: entryTotals.profit - standaloneExp,
    };

    const best   = mes.reduce((a,e)=>calcE(e).grossProfit>calcE(a).grossProfit?e:a);
    const sorted = [...mes].sort((a,b)=>a.date.localeCompare(b.date));
    const spark  = sorted.map(e=>calcE(e).grossProfit);
    const d      = new Date(key+"-01");
    const label  = d.toLocaleDateString("en-NG",{month:"long",year:"numeric"});
    const margin = totals.rev>0?Math.round((totals.grossP/totals.rev)*100):0;
    return {key,label,days:mes.length,totals,best,spark,margin};
  });

  // SVG sparkline
  const Sparkline = ({data,color=T.primary,h=40,w=72}) => {
    if (data.length < 2) return <div style={{width:w,height:h}}/>;
    const max=Math.max(...data,1), min=Math.min(...data,0), range=max-min||1;
    const pts=data.map((v,i)=>{
      const x=(i/Math.max(data.length-1,1))*w;
      const y=h-((v-min)/range)*(h-4)-2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const last=pts.split(" ").pop().split(",");
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",flexShrink:0}}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx={last[0]} cy={last[1]} r="2.5" fill={color}/>
      </svg>
    );
  };

  const yearTotals=months.slice(0,12).reduce((a,m)=>({rev:a.rev+m.totals.rev,grossP:a.grossP+m.totals.grossP,gas:a.gas+m.totals.gas}),{rev:0,grossP:0,gas:0});
  const yearMargin=yearTotals.rev>0?Math.round((yearTotals.grossP/yearTotals.rev)*100):0;

  if (!months.length) return (
    <div style={{flex:1,display:"flex",flexDirection:"column",background:T.bg,fontFamily:F}}>
      <TopBar title="Monthly summary" dark={false} left={<BackBtn onClick={back} dark={false}/>}/>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center",color:T.muted,fontSize:13}}>No entries yet.</div>
    </div>
  );

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title="Monthly summary" dark={false}
        left={<BackBtn onClick={back} dark={false}/>}
        right={<Badge label={`${months.length} month${months.length!==1?"s":""}`}/>}
      />
      <div style={{flex:1,overflow:"auto",padding:"16px 16px 24px"}}>

        {/* Year strip */}
        {months.length>1&&(
          <Card pad="0" style={{marginBottom:16,background:T.primary,border:"none"}}>
            <div style={{padding:"12px 16px 14px"}}>
              <div style={{fontSize:11,fontWeight:600,color:"rgba(255,255,255,.5)",textTransform:"uppercase",letterSpacing:.7,marginBottom:10}}>Last {Math.min(months.length,12)} months</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[["Revenue",fmt(yearTotals.rev),T.gold],["Gross profit",fmt(yearTotals.grossP),yearMargin>=15?"#6ee7b7":"#fca5a5"],["Gas sold",fmtKg(yearTotals.gas),"rgba(255,255,255,.8)"]].map(([l,v,c])=>(
                  <div key={l}>
                    <div style={{fontSize:10,color:"rgba(255,255,255,.45)",marginBottom:2}}>{l}</div>
                    <div style={{fontSize:15,fontWeight:700,color:c}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:10,fontSize:11,color:"rgba(255,255,255,.4)"}}>Avg gross margin: {yearMargin}%</div>
            </div>
          </Card>
        )}

        {/* Month cards */}
        {months.map((m,idx)=>(
          <div key={m.key} onClick={()=>goMonthPnL(m.key)}
            style={{background:T.surface,borderRadius:R.lg,border:`1px solid ${T.border}`,marginBottom:10,overflow:"hidden",cursor:"pointer",transition:"transform .12s"}}
            onMouseEnter={e=>e.currentTarget.style.transform="translateY(-1px)"}
            onMouseLeave={e=>e.currentTarget.style.transform="none"}
          >
            {/* Header */}
            <div style={{padding:"12px 14px 10px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:15,fontWeight:700,color:T.text}}>{m.label}</div>
                <div style={{fontSize:11,color:T.muted,marginTop:2}}>{m.days} day{m.days!==1?"s":""} recorded{idx===0?" · current":""}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <Badge label={`${m.margin}%`} variant={m.margin>=18?"success":m.margin>=8?"warning":"danger"}/>
                <Icon n="chevron" s={16} c={T.muted}/>
              </div>
            </div>

            {/* Body */}
            <div style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  {l:"Revenue",     v:fmt(m.totals.rev),    bold:true},
                  {l:"Gross profit",v:fmt(m.totals.grossP), bold:false},
                  {l:"Gas sold",    v:fmtKg(m.totals.gas),  bold:false},
                  {l:"Best day",    v:fmtShort(m.best.date),bold:false},
                ].map(({l,v,bold})=>(
                  <div key={l}>
                    <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:.4,marginBottom:2}}>{l}</div>
                    <div style={{fontSize:bold?15:12,fontWeight:bold?700:500,color:T.text}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
                <Sparkline data={m.spark} color={m.margin>=15?T.success:m.margin>=8?T.warning:T.danger} h={44} w={72}/>
                <div style={{fontSize:9,color:T.muted}}>daily gross profit</div>
              </div>
            </div>

            {/* Footer */}
            <div style={{padding:"0 14px 10px",borderTop:`1px solid ${T.border}`,paddingTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:11,color:T.muted}}>Best: {fmtD(m.best.date)} · {fmt(calcEntry(m.best,SP,CP).grossProfit)}</div>
              <div style={{fontSize:11,fontWeight:600,color:T.primary}}>Open P&L →</div>
            </div>
          </div>
        ))}
        <div style={{height:16}}/>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// STAFF EXPENSE SCREEN
// Staff records shift expenses: generator fuel, gas gifts, petty cash
// Stored in the same standaloneExpenses collection — visible to owner
// ═══════════════════════════════════════════════════════════════
// ── Staff Expenses List — shows all staff's own expenses + Add button ──
const StaffExpensesListScreen = ({ onAdd, onUpdate, onDelete, submittedBy, back, allExpenses=[] }) => {
  const [showAdd, setShowAdd] = useState(false);

  // All expenses by this staff member
  const myExpenses = allExpenses
    .filter(e => e.source === "staff" && (e.submittedBy === submittedBy || !e.submittedBy))
    .sort((a,b) => b.date.localeCompare(a.date));
  const myTotal = myExpenses.reduce((s,e)=>s+(e.amount||0), 0);

  // Edit modal state
  const [editItem,  setEditItem]  = useState(null);
  const [editCat,   setEditCat]   = useState("");
  const [editAmt,   setEditAmt]   = useState("");
  const [editNote,  setEditNote]  = useState("");
  const [editDate,  setEditDate]  = useState("");
  const [editLd,    setEditLd]    = useState(false);
  const [editErr,   setEditErr]   = useState("");
  const CATS = ["Generator Fuel","Gas Gift","Petty Cash","Transport","Maintenance","Repairs","Other"];

  const openEdit = (e) => { setEditItem(e); setEditCat(e.category); setEditAmt(String(e.amount)); setEditNote(e.note||""); setEditDate(e.date); setEditErr(""); };
  const saveEdit = async () => {
    if (!editAmt||Number(editAmt)<=0){setEditErr("Enter a valid amount.");return;}
    setEditLd(true); setEditErr("");
    try { await onUpdate(editItem.id,{category:editCat,amount:Number(editAmt),note:editNote.trim(),date:editDate}); setEditItem(null); }
    catch(e){setEditErr(e.message||"Failed.");}
    finally{setEditLd(false);}
  };
  const deleteEdit = async () => {
    if (!window.confirm(`Delete "${editCat}"?`)) return;
    setEditLd(true);
    try { await onDelete(editItem.id); setEditItem(null); }
    catch(e){setEditErr(e.message||"Failed.");}
    finally{setEditLd(false);}
  };

  // Show the add form as a sub-screen
  if (showAdd) return (
    <StaffExpenseScreen
      onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete}
      submittedBy={submittedBy} back={()=>setShowAdd(false)}
      allExpenses={allExpenses}
    />
  );

  // Group by month
  const byMonth = {};
  myExpenses.forEach(e => {
    const k = e.date?.slice(0,7)||"Unknown";
    if (!byMonth[k]) byMonth[k] = [];
    byMonth[k].push(e);
  });
  const months = Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title="My expenses" dark={false}
        left={<BackBtn onClick={back} dark={false}/>}
        right={
          <button onClick={()=>setShowAdd(true)} style={{background:T.primary,border:"none",borderRadius:R.md,padding:"6px 11px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,color:"#fff"}}>
            <Icon n="plus" s={14} c="#fff"/>
            <span style={{fontSize:12,fontWeight:600,fontFamily:F}}>Add</span>
          </button>
        }
      />

      {/* Summary bar */}
      <div style={{background:T.primary,padding:"12px 16px",flexShrink:0}}>
        <div style={{fontSize:11,color:"rgba(255,255,255,.5)",fontFamily:F,marginBottom:2}}>
          {myExpenses.length} expense{myExpenses.length!==1?"s":""}
        </div>
        <div style={{fontSize:22,fontWeight:700,color:T.gold,fontFamily:F}}>−{fmt(myTotal)}</div>
      </div>

      <div style={{flex:1,overflow:"auto",padding:"16px 16px 32px"}}>
        {myExpenses.length===0?(
          <div style={{textAlign:"center",padding:"48px 20px",color:T.muted,fontFamily:F}}>
            <div style={{fontSize:32,marginBottom:12}}>📋</div>
            <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:6}}>No expenses yet</div>
            <div style={{fontSize:13,marginBottom:20}}>Tap "+ Add" to record your first expense</div>
            <Btn label="Record an expense" onClick={()=>setShowAdd(true)} size="lg" icon="plus"/>
          </div>
        ):(
          months.map(mKey=>{
            const mTotal = byMonth[mKey].reduce((s,e)=>s+e.amount,0);
            const [y,m] = mKey.split("-");
            const mLabel = new Date(Number(y),Number(m)-1,1).toLocaleDateString("en-NG",{month:"long",year:"numeric"});
            return (
              <div key={mKey} style={{marginBottom:20}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.6,fontFamily:F}}>{mLabel}</span>
                  <span style={{fontSize:12,fontWeight:600,color:T.danger,fontFamily:F}}>−{fmt(mTotal)}</span>
                </div>
                <Card>
                  {byMonth[mKey].map((e,i,arr)=>(
                    <div key={e.id||i} onClick={()=>e.id&&openEdit(e)}
                      style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none",cursor:e.id?"pointer":"default",transition:"background .12s"}}
                      onMouseEnter={ev=>{if(e.id)ev.currentTarget.style.background=T.bg;}}
                      onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                      <div style={{width:40,height:40,borderRadius:R.md,background:`${T.warning}12`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span style={{fontSize:11,fontWeight:700,color:T.warning,fontFamily:F}}>{(e.category||"?").slice(0,2).toUpperCase()}</span>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>{e.category}</div>
                        <div style={{fontSize:11,color:T.muted,marginTop:2,fontFamily:F}}>{fmtD(e.date)}{e.note?` · ${e.note}`:""}</div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontSize:14,fontWeight:700,color:T.danger,fontFamily:F}}>−{fmt(e.amount)}</div>
                        {e.id&&<div style={{fontSize:10,color:T.muted,fontFamily:F}}>tap to edit</div>}
                      </div>
                    </div>
                  ))}
                </Card>
              </div>
            );
          })
        )}
      </div>

      {/* Edit modal */}
      {editItem&&(
        <div style={{position:"absolute",inset:0,background:T.overlay,display:"flex",alignItems:"flex-end",zIndex:100}}>
          <div style={{background:T.surface,borderRadius:"16px 16px 0 0",padding:"20px 16px 32px",width:"100%",maxHeight:"85%",overflowY:"auto",fontFamily:F}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <span style={{fontSize:16,fontWeight:600,color:T.text}}>Edit expense</span>
              <button onClick={()=>setEditItem(null)} style={{background:T.bg2,border:"none",borderRadius:"50%",width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon n="close" s={14} c={T.muted}/>
              </button>
            </div>
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:6}}>Category</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
              {CATS.map(c=>(
                <button key={c} onClick={()=>setEditCat(c)}
                  style={{padding:"6px 12px",background:editCat===c?T.primary:T.bg2,color:editCat===c?"#fff":T.text,border:`1.5px solid ${editCat===c?T.primary:T.border}`,borderRadius:R.pill,fontSize:12,fontWeight:editCat===c?600:400,cursor:"pointer",fontFamily:F}}>
                  {c}
                </button>
              ))}
            </div>
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:6}}>Amount</div>
            <div style={{position:"relative",marginBottom:14}}>
              <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",fontSize:14,color:T.muted,pointerEvents:"none"}}>₦</span>
              <input value={editAmt} onChange={e=>setEditAmt(e.target.value)} type="number"
                style={{width:"100%",padding:"11px 12px 11px 28px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:15,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box"}}
                onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor=T.borderMid}
              />
            </div>
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:6}}>Date</div>
            <input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)}
              style={{width:"100%",padding:"10px 12px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box",marginBottom:14}}
            />
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:6}}>Note (optional)</div>
            <input value={editNote} onChange={e=>setEditNote(e.target.value)} placeholder="e.g. 5kg for Mama…"
              style={{width:"100%",padding:"10px 12px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:13,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box",marginBottom:14}}
            />
            {editErr&&<div style={{background:`${T.danger}10`,borderRadius:R.md,padding:"9px 12px",fontSize:12,color:T.danger,marginBottom:12}}>{editErr}</div>}
            <Btn label="Save changes" onClick={saveEdit} loading={editLd} size="lg" icon="check"/>
            <div style={{marginTop:8}}><Btn label="Delete expense" onClick={deleteEdit} variant="danger" size="lg" loading={editLd}/></div>
          </div>
        </div>
      )}
    </div>
  );
};

const StaffExpenseScreen = ({ onAdd, onUpdate, onDelete, submittedBy, back, allExpenses=[] }) => {
  const today = new Date().toISOString().split("T")[0];
  const CATS  = ["Generator Fuel","Gas Gift","Petty Cash","Transport","Maintenance","Repairs","Other"];

  const [cat,  setCat]  = useState("");
  const [amt,  setAmt]  = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today);
  const [ld,   setLd]   = useState(false);
  const [err,  setErr]  = useState("");
  const [ok,   setOk]   = useState("");

  // Edit modal state
  const [editItem,  setEditItem]  = useState(null);
  const [editCat,   setEditCat]   = useState("");
  const [editAmt,   setEditAmt]   = useState("");
  const [editNote,  setEditNote]  = useState("");
  const [editDate,  setEditDate]  = useState("");
  const [editLd,    setEditLd]    = useState(false);
  const [editErr,   setEditErr]   = useState("");

  const openEdit = (e) => {
    setEditItem(e);
    setEditCat(e.category);
    setEditAmt(String(e.amount));
    setEditNote(e.note||"");
    setEditDate(e.date);
    setEditErr("");
  };

  const saveEdit = async () => {
    if (!editAmt || Number(editAmt)<=0) { setEditErr("Enter a valid amount."); return; }
    setEditLd(true); setEditErr("");
    try {
      await onUpdate(editItem.id, { category:editCat, amount:Number(editAmt), note:editNote.trim(), date:editDate });
      setEditItem(null);
    } catch(e) { setEditErr(e.message||"Failed. Try again."); }
    finally { setEditLd(false); }
  };

  const deleteEdit = async () => {
    if (!window.confirm(`Delete "${editCat}" expense of ₦${Number(editAmt).toLocaleString("en-NG")}?`)) return;
    setEditLd(true);
    try { await onDelete(editItem.id); setEditItem(null); }
    catch(e) { setEditErr(e.message||"Failed."); }
    finally { setEditLd(false); }
  };

  const save = async () => {
    if (!cat) { setErr("Please select a category."); return; }
    if (!amt || Number(amt) <= 0) { setErr("Enter a valid amount."); return; }
    setLd(true); setErr(""); setOk("");
    try {
      await onAdd({ date, category:cat, amount:Number(amt), note:note.trim(), submittedBy:submittedBy||"", source:"staff" });
      setOk(`✓ ${cat} — ₦${Number(amt).toLocaleString("en-NG")} recorded`);
      setCat(""); setAmt(""); setNote(""); setDate(today);
    } catch(e) { setErr(e.message || "Failed. Try again."); }
    finally { setLd(false); }
  };

  // All expenses submitted by this staff member
  // Also shows older expenses with empty submittedBy (recorded before UID tracking)
  const myExpenses = allExpenses
    .filter(e => e.source === "staff" && (e.submittedBy === submittedBy || !e.submittedBy))
    .sort((a,b) => b.date.localeCompare(a.date));
  const myTotal = myExpenses.reduce((s,e)=>s+(e.amount||0), 0);

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title="Shift expenses" dark={false} left={<BackBtn onClick={back} dark={false}/>}/>
      <div style={{flex:1,overflow:"auto",padding:"16px 16px 32px"}}>

        {/* Info */}
        <div style={{background:`${T.primary}08`,borderRadius:R.lg,padding:"12px 14px",marginBottom:14,display:"flex",gap:10,alignItems:"flex-start"}}>
          <Icon n="cash" s={16} c={T.primary}/>
          <div style={{fontSize:12,color:T.text2,lineHeight:1.6}}>
            Record cash spent during your shift. Select <strong>Gas Gift</strong> and use Note to say who received it (e.g. "5kg for Mama"). The owner sees all entries.
          </div>
        </div>

        {/* Success toast */}
        {ok&&(
          <div style={{background:T.primary,borderRadius:R.lg,padding:"11px 14px",marginBottom:14,display:"flex",gap:10,alignItems:"center"}}>
            <Icon n="check" s={15} c={T.gold}/>
            <span style={{fontSize:13,fontWeight:600,color:"#fff"}}>{ok}</span>
          </div>
        )}

        {/* Category — fixed chips ONLY, no free text to keep categories clean */}
        <SLabel mt={0}>Category</SLabel>
        <Card pad="14px" style={{marginBottom:12}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {CATS.map(c=>(
              <button key={c} onClick={()=>{setCat(c);setErr("");setOk("");}}
                style={{padding:"8px 14px",background:cat===c?T.primary:T.bg2,color:cat===c?"#fff":T.text,border:`1.5px solid ${cat===c?T.primary:T.border}`,borderRadius:R.pill,fontSize:12,fontWeight:cat===c?600:400,cursor:"pointer",fontFamily:F,transition:"all .12s"}}>
                {c}
              </button>
            ))}
          </div>
          {cat==="Gas Gift"&&(
            <div style={{marginTop:10,fontSize:11,color:T.muted,background:T.bg,borderRadius:R.md,padding:"7px 10px"}}>
              💡 Use Note below to say who received the gas (e.g. "5kg for Mama")
            </div>
          )}
        </Card>

        {/* Amount */}
        <SLabel>Amount</SLabel>
        <Card pad="14px" style={{marginBottom:12}}>
          <div style={{position:"relative",marginBottom:8}}>
            <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",fontSize:14,color:T.muted,pointerEvents:"none"}}>₦</span>
            <input value={amt} onChange={e=>{setAmt(e.target.value);setErr("");setOk("");}} type="number" placeholder="Enter amount"
              style={{width:"100%",padding:"11px 12px 11px 28px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:15,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box"}}
              onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor=T.borderMid}
            />
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[500,1000,2000,5000,10000,20000].map(v=>(
              <button key={v} onClick={()=>{setAmt(String(v));setErr("");setOk("");}}
                style={{padding:"5px 10px",background:Number(amt)===v?T.primary:T.bg2,color:Number(amt)===v?"#fff":T.muted,border:"none",borderRadius:R.pill,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:F}}>
                {v>=1000?(v/1000)+"k":v}
              </button>
            ))}
          </div>
        </Card>

        {/* Date */}
        <SLabel>Date</SLabel>
        <Card pad="12px 14px" style={{marginBottom:12}}>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)}
            style={{width:"100%",padding:"8px 0",border:"none",fontSize:14,fontFamily:F,color:T.text,outline:"none",background:"transparent",boxSizing:"border-box"}}
          />
        </Card>

        {/* Note — required for Gas Gift, optional for others */}
        <SLabel>Note {cat==="Gas Gift"?"— who received it?":"(optional)"}</SLabel>
        <Card pad="12px 14px" style={{marginBottom:16,border:cat==="Gas Gift"?`1.5px solid ${T.primary}`:undefined}}>
          <input value={note} onChange={e=>setNote(e.target.value)}
            placeholder={cat==="Gas Gift"?"e.g. 5kg for Mama, 3kg for customer":"e.g. Generator ran 4hrs, morning delivery tip…"}
            style={{width:"100%",padding:"8px 0",border:"none",fontSize:13,fontFamily:F,color:T.text,outline:"none",background:"transparent",boxSizing:"border-box"}}
          />
        </Card>

        {err&&<ErrBanner msg={err}/>}

        <Btn label="Record expense" onClick={save} loading={ld}
          disabled={!cat||!amt||Number(amt)<=0} size="lg" icon="check"/>

        {/* My expense history */}
        {myExpenses.length>0&&(<>
          <div style={{marginTop:24,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.5,fontFamily:F}}>My expenses</span>
            <span style={{fontSize:13,fontWeight:700,color:T.danger,fontFamily:F}}>−{fmt(myTotal)}</span>
          </div>
          <Card>
            {myExpenses.slice(0,20).map((e,i,arr)=>(
              <div key={e.id||i} onClick={()=>e.id&&openEdit(e)}
                style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none",cursor:e.id?"pointer":"default",transition:"background .12s"}}
                onMouseEnter={ev=>{if(e.id)ev.currentTarget.style.background=T.bg;}}
                onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                <div style={{width:36,height:36,borderRadius:R.md,background:`${T.warning}12`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontSize:10,fontWeight:700,color:T.warning,fontFamily:F}}>{(e.category||"?").slice(0,2).toUpperCase()}</span>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:500,color:T.text,fontFamily:F}}>{e.category}</div>
                  <div style={{fontSize:11,color:T.muted,marginTop:1,fontFamily:F}}>{fmtD(e.date)}{e.note?` · ${e.note}`:""}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.danger,fontFamily:F}}>−{fmt(e.amount)}</div>
                  {e.id&&<div style={{fontSize:10,color:T.muted,fontFamily:F}}>tap to edit</div>}
                </div>
              </div>
            ))}
          </Card>
        </>)}

      </div>

      {/* Edit expense modal */}
      {editItem&&(
        <div style={{position:"absolute",inset:0,background:T.overlay,display:"flex",alignItems:"flex-end",zIndex:100}}>
          <div style={{background:T.surface,borderRadius:"16px 16px 0 0",padding:"20px 16px 32px",width:"100%",maxHeight:"85%",overflowY:"auto",fontFamily:F}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <span style={{fontSize:16,fontWeight:600,color:T.text}}>Edit expense</span>
              <button onClick={()=>setEditItem(null)} style={{background:T.bg2,border:"none",borderRadius:"50%",width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon n="close" s={14} c={T.muted}/>
              </button>
            </div>

            {/* Category chips */}
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:6}}>Category</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
              {CATS.map(c=>(
                <button key={c} onClick={()=>setEditCat(c)}
                  style={{padding:"6px 12px",background:editCat===c?T.primary:T.bg2,color:editCat===c?"#fff":T.text,border:`1.5px solid ${editCat===c?T.primary:T.border}`,borderRadius:R.pill,fontSize:12,fontWeight:editCat===c?600:400,cursor:"pointer",fontFamily:F}}>
                  {c}
                </button>
              ))}
            </div>

            {/* Amount */}
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:6}}>Amount</div>
            <div style={{position:"relative",marginBottom:14}}>
              <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",fontSize:14,color:T.muted,pointerEvents:"none"}}>₦</span>
              <input value={editAmt} onChange={e=>setEditAmt(e.target.value)} type="number"
                style={{width:"100%",padding:"11px 12px 11px 28px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:15,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box"}}
                onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor=T.borderMid}
              />
            </div>

            {/* Date */}
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:6}}>Date</div>
            <input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)}
              style={{width:"100%",padding:"10px 12px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:14,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box",marginBottom:14}}
            />

            {/* Note */}
            <div style={{fontSize:12,fontWeight:600,color:T.text2,marginBottom:6}}>Note (optional)</div>
            <input value={editNote} onChange={e=>setEditNote(e.target.value)}
              placeholder="e.g. 5kg for Mama, generator ran 4hrs…"
              style={{width:"100%",padding:"10px 12px",border:`1.5px solid ${T.borderMid}`,borderRadius:R.md,fontSize:13,fontFamily:F,color:T.text,outline:"none",background:T.surface,boxSizing:"border-box",marginBottom:14}}
            />

            {editErr&&<div style={{background:`${T.danger}10`,borderRadius:R.md,padding:"9px 12px",fontSize:12,color:T.danger,marginBottom:12}}>{editErr}</div>}

            <Btn label="Save changes" onClick={saveEdit} loading={editLd} size="lg" icon="check"/>
            <div style={{marginTop:8}}>
              <Btn label="Delete this expense" onClick={deleteEdit} variant="danger" size="lg" loading={editLd}/>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Simple staff account screen — sign out + info
const StaffAccountScreen = ({ user, profile, onSignOut, back }) => (
  <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
    <TopBar title="Account" dark={false} left={<BackBtn onClick={back} dark={false}/>}/>
    <div style={{flex:1,overflow:"auto",padding:"0 0 32px"}}>
      {/* Profile card */}
      <div style={{background:T.primary,padding:"24px 20px 28px",display:"flex",alignItems:"center",gap:14}}>
        <div style={{width:52,height:52,borderRadius:"50%",background:T.gold,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <span style={{fontSize:20,fontWeight:700,color:"#000"}}>{(user?.email||"?")[0].toUpperCase()}</span>
        </div>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:"#fff"}}>{profile?.displayName||"Staff"}</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.6)",marginTop:2}}>{user?.email}</div>
          <div style={{marginTop:6,display:"inline-block",background:"rgba(255,255,255,.12)",borderRadius:R.pill,padding:"2px 10px",fontSize:11,color:"rgba(255,255,255,.7)"}}>Staff account</div>
        </div>
      </div>

      {/* Info rows */}
      <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,marginTop:20}}>
        <div style={{padding:"12px 20px",background:T.surface,borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between"}}>
          <span style={{fontSize:14,color:T.muted}}>Plant</span>
          <span style={{fontSize:14,fontWeight:500,color:T.text}}>{profile?.displayName||"—"}</span>
        </div>
        <div style={{padding:"12px 20px",background:T.surface,borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between"}}>
          <span style={{fontSize:14,color:T.muted}}>Role</span>
          <span style={{fontSize:14,fontWeight:500,color:T.text}}>Staff</span>
        </div>
        <div style={{padding:"12px 20px",background:T.surface,display:"flex",justifyContent:"space-between"}}>
          <span style={{fontSize:14,color:T.muted}}>Email</span>
          <span style={{fontSize:13,color:T.muted}}>{user?.email}</span>
        </div>
      </div>

      {/* What staff can do */}
      <div style={{padding:"20px 20px 0"}}>
        <div style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.6,marginBottom:10}}>Your access</div>
        <Card>
          {[
            ["Log daily meter entries",     true],
            ["Record shift expenses",        true],
            ["View all entries & history",   true],
            ["View P&L reports",            false],
            ["Manage stock & deliveries",    false],
            ["Access settings",              false],
          ].map(([label,allowed],i,arr)=>(
            <div key={label} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none"}}>
              <div style={{width:20,height:20,borderRadius:"50%",background:allowed?`${T.success}15`:`${T.danger}10`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <Icon n={allowed?"check":"close"} s={10} c={allowed?T.success:T.danger}/>
              </div>
              <span style={{fontSize:13,color:allowed?T.text:T.muted}}>{label}</span>
            </div>
          ))}
        </Card>
      </div>

      <div style={{padding:"20px"}}>
        <Btn label="Sign out" onClick={onSignOut} variant="danger" size="lg" icon="logout"/>
      </div>
    </div>
  </div>
);

// Entry hub — choice between New entry and All entries
const EntryHubScreen = ({ onNewEntry, onAllEntries, back }) => (
  <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
    <TopBar title="Entry" dark={false} left={<BackBtn onClick={back} dark={false}/>}/>
    <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",padding:"32px 20px",gap:14}}>
      <div style={{textAlign:"center",marginBottom:8}}>
        <div style={{fontSize:15,fontWeight:600,color:T.text,marginBottom:4}}>What would you like to do?</div>
        <div style={{fontSize:13,color:T.muted}}>Log today's readings or review past entries</div>
      </div>

      {/* New entry */}
      <div onClick={onNewEntry} style={{background:T.primary,borderRadius:R.xl,padding:"20px 20px",cursor:"pointer",display:"flex",alignItems:"center",gap:16,transition:"opacity .12s"}}
        onMouseEnter={e=>e.currentTarget.style.opacity=".9"}
        onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
        <div style={{width:48,height:48,borderRadius:R.lg,background:"rgba(255,255,255,.12)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <Icon n="plus" s={24} c={T.gold}/>
        </div>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:"#fff"}}>New entry</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.55)",marginTop:2}}>Log today's meter readings, cash and POS sales</div>
        </div>
        <Icon n="chevron" s={18} c="rgba(255,255,255,.4)" style={{marginLeft:"auto"}}/>
      </div>

      {/* All entries */}
      <div onClick={onAllEntries} style={{background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:R.xl,padding:"20px 20px",cursor:"pointer",display:"flex",alignItems:"center",gap:16,transition:"background .12s"}}
        onMouseEnter={e=>e.currentTarget.style.background=T.bg}
        onMouseLeave={e=>e.currentTarget.style.background=T.surface}>
        <div style={{width:48,height:48,borderRadius:R.lg,background:`${T.primary}10`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <Icon n="history" s={24} c={T.primary}/>
        </div>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:T.text}}>All entries</div>
          <div style={{fontSize:12,color:T.muted,marginTop:2}}>View and edit all past daily entries</div>
        </div>
        <Icon n="chevron" s={18} c={T.muted} style={{marginLeft:"auto"}}/>
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
export default function GasLedgerApp() {
  const {user, loading:authLd}    = useAuth();
  const {profile, loading:profLd} = useUserProfile(user?.uid);

  const [screen,        setScreen]        = useState("dashboard");
  const [prevScreen,    setPrevScreen]     = useState("dashboard");
  const [detail,        setDetail]        = useState(null);
  const [justSaved,     setJustSaved]     = useState(false);

  // Navigate with back-tracking — clear justSaved when going to dashboard
  const goScreen = (s) => {
    setPrevScreen(screen);
    setScreen(s);
  };

  // Mark a recent save — stays true until entries/deliveries/prices reload
  const onSaveComplete = () => {
    setJustSaved(true);
  };
  const [pendingInvite, setPendingInvite] = useState(null);
  const [inviteChecked, setInviteChecked] = useState(false);
  const [monthlyKey,    setMonthlyKey]    = useState(null); // "2025-06" → opens P&L for that month

  const role    = profile?.role || "owner";
  const plantId = profile?.plantId;
  const isStaff = role === "staff";
  const plan    = getPlan(profile);
  const planLimits = getPlanLimits(plan);

  const {data:entries,         loading:eLd} = useEntries(plantId);
  const {data:deliveries,      loading:dLd} = useDeliveries(plantId);
  const {data:prices,          loading:pLd} = usePrices(plantId);
  const {data:remittances              }    = useRemittances(plantId);
  const {data:ownerExpenses        }    = useStandaloneExpenses(isStaff ? null : plantId);
  const {data:staffOwnExpenses     }    = useStaffExpenses(isStaff ? plantId : null, user?.uid);
  const standaloneExpenses               = isStaff ? staffOwnExpenses : ownerExpenses;
  const {invites                       }    = useInvites(plantId, user?.uid);
  const {staff: staffMembers           }    = useStaffMembers(plantId);
  const plantDoc                            = usePlant(plantId); // for WhatsApp creds

  const stock     = buildStockPeriods(entries, deliveries);
  const livePrice = latestPrice(prices);
  const liveCost  = latestCostPrice(deliveries) || profile?.defaultCostPrice || DEFAULT_COST_PRICE;

  // Clear justSaved when data actually updates OR after 2s max
  const entriesLen    = entries?.length    || 0;
  const deliveriesLen = deliveries?.length || 0;
  const pricesLen     = prices?.length     || 0;
  useEffect(() => {
    if (!justSaved) return;
    // Clear immediately if data already loaded (entriesLen already reflects new entry)
    const t = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(t);
  }, [justSaved, entriesLen, deliveriesLen, pricesLen]);

  // ── Notifications ──────────────────────────────────────────
  const { unread, notifs, markAllRead } = useNotifications(plantId, user?.uid, entries||[], standaloneExpenses||[], role);

  // WhatsApp credentials — read from Firestore plant doc (set by owner, readable by all plant members)
  // This ensures staff devices can send notifications to the owner
  const waPhone      = plantDoc?.waPhone      || (()=>{ try{ return localStorage.getItem("gasledger_wa_phone")||"";      }catch{ return ""; } })();
  const waToken      = plantDoc?.waToken      || (()=>{ try{ return localStorage.getItem("gasledger_wa_token")||"";      }catch{ return ""; } })();
  const waInstanceId = plantDoc?.waInstanceId || (()=>{ try{ return localStorage.getItem("gasledger_wa_instanceid")||"";}catch{ return ""; } })();

  // Helper: send WhatsApp alert to owner when staff does something
  const notifyOwner = (msg) => { if (!isStaff) return; sendWhatsAppNotif(waPhone, waToken, waInstanceId, msg); };

  const addEntry      = useCallback(async (e) => {
    await fbAddEntry(plantId, { ...e, staffUid: user?.uid||"" });
    if (isStaff) {
      const phone  = plantDoc?.waPhone      || "";
      const tok    = plantDoc?.waToken      || "";
      const instId = plantDoc?.waInstanceId || "";
      const sales  = (e.cashSales||0) + (e.posSales||0);
      const gas    = (e.closeMeter||0) - (e.openMeter||0);
      const msg    = `📊 New entry from ${profile?.displayName||"Staff"}\n${e.date}\nSales: ₦${sales.toLocaleString("en-NG")} · Gas: ${gas} kg\nView: gasledger.hggas.com.ng`;
      sendWhatsAppNotif(phone, tok, instId, msg);
    }
  }, [plantId, user?.uid, isStaff, profile?.displayName, plantDoc]);
  const addDelivery   = useCallback(async d => { await fbAddDelivery(plantId,d); onSaveComplete(); }, [plantId]);
  const addPrice      = useCallback(async p => { await fbAddPrice(plantId,p);    onSaveComplete(); }, [plantId]);
  const deletePrice   = useCallback(id  => fbDeletePrice(plantId,id),      [plantId]);
  const updatePriceItem = useCallback((id,d) => fbUpdatePrice(plantId,id,d),[plantId]);
  const addRemittance      = useCallback(r   => fbAddRemittance(plantId,r),             [plantId]);
  const addExpense         = useCallback(e   => fbAddStandaloneExpense(plantId,e,user?.uid),  [plantId,user?.uid]);
  const addShiftExpense    = useCallback(async (e) => {
    await fbAddShiftExpense(plantId, e);
    // Notify owner when staff records an expense
    if (isStaff) {
      // Read credentials fresh from plantDoc to avoid stale closure
      const phone  = plantDoc?.waPhone      || "";
      const tok    = plantDoc?.waToken      || "";
      const instId = plantDoc?.waInstanceId || "";
      const msg = `💸 Staff expense recorded\n${profile?.displayName||"Staff"} · ${e.date}\n${e.category} — ₦${(e.amount||0).toLocaleString("en-NG")}${e.note?`\nNote: ${e.note}`:""}\nView: gasledger.hggas.com.ng`;
      sendWhatsAppNotif(phone, tok, instId, msg);
    }
  }, [plantId, isStaff, profile?.displayName, plantDoc]);
  const updateExpenseItem  = useCallback((id,d) => fbUpdateStandaloneExpense(plantId,id,d),[plantId]);
  const deleteExpenseItem  = useCallback(id  => fbDeleteStandaloneExpense(plantId,id),  [plantId]);
  const updateEntry   = useCallback((id,d) => fbUpdateEntry(plantId,id,d),[plantId]);
  const updateDelivery= useCallback((id,d) => fbUpdateDelivery(plantId,id,d),[plantId]);
  const deleteEntry   = useCallback(id  => fbDeleteEntry(plantId,id),     [plantId]);
  const deleteDelivery= useCallback(id  => fbDeleteDelivery(plantId,id),  [plantId]);
  const openDetail    = useCallback(e   => {setDetail(e);setScreen("detail");}, []);

  // After login, check for a pending invite (staff flow)
  useEffect(() => {
    if (!user || inviteChecked) return;
    // Already has a profile — no need to check
    if (profile && profile.plantId) { setInviteChecked(true); return; }
    // Profile loaded but no plantId — might be a new staff user
    if (!profLd) {
      getPendingInvite(user.email).then(inv => {
        setPendingInvite(inv);
        setInviteChecked(true);
      }).catch(() => setInviteChecked(true));
    }
  }, [user, profile, profLd, inviteChecked]);

  // Expose setScreen and plant name globally for Dashboard quick-actions and PDF
  useEffect(() => {
    window.__setScreen  = (s) => goScreen(s);
    window.__plantName  = profile?.displayName || "";
    return () => { delete window.__setScreen; delete window.__plantName; };
  }, [profile?.displayName, screen]);

  const globalCSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { height: 100%; height: -webkit-fill-available; }
    body {
      font-family: ${F};
      background: ${T.bg};
      -webkit-font-smoothing: antialiased;
      -webkit-text-size-adjust: 100%;
      height: 100%;
      height: -webkit-fill-available;
      overflow: hidden;
    }
    #root {
      height: 100%;
      height: 100dvh;
      display: flex;
      flex-direction: column;
    }
    /* Ensure content never hides behind notch or Dynamic Island */
    .safe-top { padding-top: env(safe-area-inset-top, 0px); }
    input, textarea, button, select { font-family: inherit; }
    input, select { font-size: 16px; }
    textarea { resize: none; font-size: 16px; }
    ::-webkit-scrollbar { display: none; }
    * { -webkit-tap-highlight-color: transparent; }
  `;

  const Shell = ({children}) => (
    <div style={{
      height:"100%",
      display:"flex",
      flexDirection:"column",
      background:T.bg,
      width:"100%",
      maxWidth:480,
      margin:"0 auto",
      position:"relative",
      overflow:"hidden",
    }}>
      <style>{globalCSS}</style>
      {children}
    </div>
  );

  // ── Auth loading ──────────────────────────────────────────
  if (authLd || (user && (profLd || !inviteChecked))) return <Shell><Spinner/></Shell>;

  // ── Not logged in ─────────────────────────────────────────
  if (!user) return <Shell><AuthScreen onAuthed={()=>{ setInviteChecked(false); }}/></Shell>;

  // ── Logged in, pending invite, no profile yet ─────────────
  if (pendingInvite && !profile?.plantId) return (
    <Shell>
      <InviteAcceptScreen
        user={user}
        invite={pendingInvite}
        onAccepted={()=>{ setPendingInvite(null); setInviteChecked(false); }}
      />
    </Shell>
  );

  // ── Logged in, no plant, no invite ────────────────────────
  if (!profile?.plantId) return <Shell><SetupScreen user={user}/></Shell>;

  // ── Access revoked — staff removed by owner ────────────────
  if (profile?.role === "revoked") return (
    <Shell>
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:T.bg,padding:32,gap:16,fontFamily:F,textAlign:"center"}}>
        <div style={{width:64,height:64,borderRadius:"50%",background:`${T.danger}12`,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <Icon n="lock" s={30} c={T.danger}/>
        </div>
        <div style={{fontSize:20,fontWeight:700,color:T.text}}>Access removed</div>
        <div style={{fontSize:14,color:T.muted,lineHeight:1.7,maxWidth:280}}>
          Your access to this plant has been removed by the owner. Contact the plant owner if you think this is a mistake.
        </div>
        <div style={{marginTop:8,width:"100%"}}>
          <Btn label="Sign out" onClick={signOutUser} size="lg" variant="outline"/>
        </div>
      </div>
    </Shell>
  );

  // ── Data loading ──────────────────────────────────────────
  if ((eLd||dLd||pLd) && screen==="dashboard") return <Shell><Spinner/></Shell>;
  if (justSaved && screen==="dashboard") return <Shell><Spinner/></Shell>;

  // ── Gate function — blocks staff from owner-only screens ──
  const Gate = ({children, allowed=true}) => allowed ? children : (
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:T.bg,padding:32,gap:16,fontFamily:F}}>
      <div style={{width:52,height:52,borderRadius:"50%",background:`${T.danger}12`,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <Icon n="lock" s={26} c={T.danger}/>
      </div>
      <div style={{fontSize:17,fontWeight:700,color:T.text,textAlign:"center"}}>Access restricted</div>
      <div style={{fontSize:13,color:T.muted,textAlign:"center",lineHeight:1.6}}>
        This section is only available to the plant owner.
      </div>
      <Btn label="Back to home" onClick={()=>setScreen("dashboard")} variant="outline" size="lg"/>
    </div>
  );

  const mainScreens = ["dashboard","entry","entryhub","pnl","pnl-monthly","history","stock","settings","detail","remittance","staffexpense","staffaccount","monthly","expenses"];

  return (
    <Shell>
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",position:"relative"}}>
        {screen==="dashboard"   && <Dashboard entries={entries} stock={stock} plantName={profile.displayName} goEntry={()=>setScreen("entry")} goDayDetail={openDetail} goStock={()=>setScreen("stock")} goSetPrice={()=>{ setScreen("stock"); window.__stockTab="prices"; }} sellPrice={livePrice} costPrice={liveCost} standaloneExpenses={standaloneExpenses} role={role} onSignOut={signOutUser} notifs={notifs} unread={unread} onMarkRead={markAllRead}/>}
        {screen==="entryhub"    && <EntryHubScreen onNewEntry={()=>setScreen("entry")} onAllEntries={()=>setScreen("history")} back={()=>setScreen("dashboard")}/> }
        {screen==="entry"       && <DailyEntry back={()=>{ onSaveComplete(); setScreen("dashboard"); }} onSave={addEntry} lastEntry={entries[0]} allEntries={entries} allPrices={prices} allDeliveries={deliveries} pricePerKg={livePrice} costPerKg={liveCost} existingDates={entries.map(e=>e.date)} role={role}/>}
        {screen==="stock"       && <Gate allowed={!isStaff}><StockScreen stock={stock} prices={prices} onAddDelivery={addDelivery} onAddPrice={addPrice} onUpdateDelivery={updateDelivery} onDeleteDelivery={deleteDelivery} onDeletePrice={deletePrice} onUpdatePrice={updatePriceItem} loading={dLd||pLd} back={()=>setScreen("dashboard")}/></Gate>}
        {screen==="pnl"         && <Gate allowed={!isStaff}><PnLScreen entries={entries} prices={prices} deliveries={deliveries} back={()=>setScreen("dashboard")} sellPrice={livePrice} costPrice={liveCost} standaloneExpenses={standaloneExpenses} canExportPdf={planLimits.pdf} onUpgrade={()=>setScreen("settings")}/></Gate>}
        {screen==="pnl-monthly" && <Gate allowed={!isStaff}><PnLScreen entries={entries} prices={prices} deliveries={deliveries} back={()=>setScreen("monthly")} sellPrice={livePrice} costPrice={liveCost} initialMonth={monthlyKey} standaloneExpenses={standaloneExpenses} canExportPdf={planLimits.pdf} onUpgrade={()=>setScreen("settings")}/></Gate>}
        {screen==="expenses"    && <Gate allowed={!isStaff}><ExpensesScreen expenses={standaloneExpenses} entries={entries} onAdd={addExpense} onUpdate={updateExpenseItem} onDelete={deleteExpenseItem} back={()=>setScreen("dashboard")}/></Gate>}
        {screen==="monthly"     && <Gate allowed={!isStaff}><MonthlySummaryScreen entries={entries} prices={prices} deliveries={deliveries} back={()=>setScreen("dashboard")} sellPrice={livePrice} costPrice={liveCost} standaloneExpenses={standaloneExpenses} goMonthPnL={(key)=>{ setMonthlyKey(key); setScreen("pnl-monthly"); }}/></Gate>}
        {screen==="history"     && <HistoryScreen entries={entries} prices={prices} deliveries={deliveries} back={()=>setScreen(prevScreen||"dashboard")} goDayDetail={openDetail} sellPrice={livePrice} costPrice={liveCost}/>}
        {screen==="remittance"  && <RemittanceScreen entries={entries} remittances={remittances} onSave={addRemittance} back={()=>setScreen("dashboard")} submittedBy={user?.uid}/>}
        {screen==="staffaccount"&& <StaffAccountScreen user={user} profile={profile} onSignOut={signOutUser} back={()=>setScreen("dashboard")}/> }
        {screen==="staffexpense"&& <StaffExpensesListScreen onAdd={addShiftExpense} onUpdate={updateExpenseItem} onDelete={deleteExpenseItem} submittedBy={user?.uid} back={()=>setScreen("dashboard")} allExpenses={standaloneExpenses}/>}
        {screen==="detail"      && detail && <DayDetail entry={detail} back={()=>setScreen("history")} sellPrice={livePrice} costPrice={liveCost} onUpdate={updateEntry} onDelete={deleteEntry} isOwner={!isStaff}/>}
        {screen==="settings"    && <Gate allowed={!isStaff}><SettingsScreen user={user} profile={profile} plantId={plantId} onSignOut={signOutUser} invites={invites||[]} staffMembers={staffMembers||[]} liveCost={liveCost} planLimits={planLimits}/></Gate>}
      </div>
      {mainScreens.includes(screen) && <BottomNav active={screen==="pnl-monthly"?"monthly":screen==="staffexpense"?"staffexpense":screen==="staffaccount"?"staffaccount":screen==="entry"||screen==="history"||(screen==="detail"&&role==="owner")?"entryhub":screen} onChange={setScreen} role={role}/>}
    </Shell>
  );
}
