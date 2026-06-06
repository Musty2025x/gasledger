// ═══════════════════════════════════════════════════════════════
// GasLedgerFirebase.jsx  —  Clean native rebuild
// System font · SVG icons · Full-viewport layout · No emoji
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import {
  useAuth, useUserProfile,
  useEntries, useDeliveries, usePrices,
  useInvites, useStaffMembers,
  addEntry    as fbAddEntry,
  addDelivery as fbAddDelivery,
  addPrice    as fbAddPrice,
  createPlant, createInvite, acceptInvite,
  getPendingInvite, deleteInvite, revokeStaff,
  loginUser, registerUser, resetPassword, signOutUser,
} from "./firebase.js";

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
const GAS_PRICE = 320;

const calcEntry = (e) => {
  const gas  = (e.closeMeter||0) - (e.openMeter||0);
  const sales = (e.cashSales||0) + (e.posSales||0);
  const exp   = (e.expenses||[]).reduce((s,x)=>s+x.amt,0);
  const expRev = gas * GAS_PRICE;
  return { gas, sales, exp, expRev, variance: sales-expRev, profit: sales-exp };
};

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

const latestPrice = (prices) =>
  prices.length ? [...prices].sort((a,b)=>new Date(b.date)-new Date(a.date))[0].pricePerKg : GAS_PRICE;

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
    price:    "M12 2a10 10 0 100 20A10 10 0 0012 2z M12 6v6l4 2",
    settings: "M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
    people:  "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75",
    invite:  "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M19 8v6M22 11h-6",
    remove:  "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M22 11h-6",
    user:    "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 11a4 4 0 100-8 4 4 0 000 8z",
    shield:  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
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
  <div style={{background:dark?T.primary:T.surface,padding:"12px 16px",display:"flex",alignItems:"center",gap:12,flexShrink:0,borderBottom:dark?"none":`1px solid ${T.border}`}}>
    <div style={{width:36,flexShrink:0}}>{left||null}</div>
    <div style={{flex:1,textAlign:"center",fontSize:16,fontWeight:600,color:dark?"#fff":T.text,fontFamily:F}}>{title}</div>
    <div style={{width:36,flexShrink:0,display:"flex",justifyContent:"flex-end"}}>{right||null}</div>
  </div>
);

// ── Bottom nav ───────────────────────────────────────────────
const BottomNav = ({active, onChange, role="owner"}) => {
  const ownerTabs = [
    {id:"dashboard", icon:"home",     label:"Home"},
    {id:"entry",     icon:"entry",    label:"Entry"},
    {id:"stock",     icon:"truck",    label:"Stock"},
    {id:"pnl",       icon:"pnl",      label:"P&L"},
    {id:"settings",  icon:"settings", label:"Settings"},
  ];
  const staffTabs = [
    {id:"dashboard", icon:"home",     label:"Home"},
    {id:"entry",     icon:"entry",    label:"Entry"},
    {id:"history",   icon:"history",  label:"History"},
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
      <div style={{background:T.primary,padding:"48px 24px 32px"}}>
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
      <div style={{background:T.primary,padding:"48px 24px 32px"}}>
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
      <div style={{background:T.primary,padding:"48px 24px 32px"}}>
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
const Dashboard = ({entries, stock, plantName, goEntry, goDayDetail}) => {
  const [hide, setHide] = useState(false);

  const totals = entries.slice(0,7).reduce((a,e)=>{
    const c=calcEntry(e);
    return {rev:a.rev+c.sales, gas:a.gas+c.gas, profit:a.profit+c.profit, exp:a.exp+c.exp};
  },{rev:0,gas:0,profit:0,exp:0});

  const today  = entries[0];
  const todayC = today ? calcEntry(today) : null;

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

  const chartData = [...entries].reverse().slice(-7).map(e=>({l:fmtShort(e.date).split(" ")[0], v:calcEntry(e).sales}));

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg}}>
      {/* Header */}
      <div style={{background:T.primary,padding:"16px 16px 20px",flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.5)",fontFamily:F,marginBottom:2}}>Good day</div>
            <div style={{fontSize:18,fontWeight:700,color:"#fff",fontFamily:F}}>{plantName||"Your Plant"}</div>
          </div>
          <button onClick={()=>setHide(h=>!h)} style={{background:"rgba(255,255,255,.1)",border:"none",borderRadius:R.md,padding:"7px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,color:"rgba(255,255,255,.7)"}}>
            <Icon n={hide?"eye":"eyeoff"} s={15} c="rgba(255,255,255,.7)"/>
            <span style={{fontSize:12,fontFamily:F,fontWeight:500}}>{hide?"Show":"Hide"}</span>
          </button>
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
        {/* Stock summary */}
        {stock.current&&(()=>{
          const {delivery,available,remaining,pct,carryForward,sold}=stock.current;
          const bc=pct>40?T.success:pct>15?T.warning:T.danger;
          return (
            <div style={{marginBottom:16}}>
              {carryForward>0&&(
                <div style={{background:"#fffbeb",border:`1px solid #f59e0b`,borderRadius:R.lg,padding:"10px 14px",marginBottom:8,display:"flex",gap:10,alignItems:"flex-start"}}>
                  <Icon n="alert" s={16} c="#b45309"/>
                  <div style={{fontSize:12,color:"#92400e",fontFamily:F,lineHeight:1.5}}><strong>{fmtKg(carryForward)}</strong> carry-forward from previous delivery included in current stock.</div>
                </div>
              )}
              <Card>
                <div style={{padding:"12px 14px 4px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <span style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>Stock — current period</span>
                    <Badge label={`${pct}% remaining`} variant={pct>40?"success":pct>15?"warning":"danger"}/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                    {[["Delivered",fmtKg(delivery.kg),false],["Sold",fmtKg(sold),false],["Remaining",fmtKg(remaining),true]].map(([l,v,hi])=>(
                      <div key={l} style={{background:hi?T.primary:T.bg,borderRadius:R.md,padding:"10px 8px",textAlign:"center"}}>
                        <div style={{fontSize:14,fontWeight:700,color:hi?T.gold:T.text,fontFamily:F}}>{v}</div>
                        <div style={{fontSize:10,color:hi?"rgba(255,255,255,.5)":T.muted,fontFamily:F,marginTop:2,textTransform:"uppercase",letterSpacing:.3}}>{l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{height:6,borderRadius:R.pill,background:T.bg2,overflow:"hidden",marginBottom:12}}>
                    <div style={{height:"100%",width:`${Math.max(2,pct)}%`,background:bc,borderRadius:R.pill,transition:"width .4s"}}/>
                  </div>
                </div>
              </Card>
            </div>
          );
        })()}

        {/* 7-day stats */}
        <SLabel>7-day summary</SLabel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          {[["Revenue",fmt(totals.rev),"#fff",T.primary],["Gas sold",fmtKg(totals.gas),T.text,T.surface],["Net profit",fmt(totals.profit),T.text,T.surface],["Expenses",fmt(totals.exp),T.text,T.surface]].map(([l,v,tc,bg],i)=>(
            <div key={l} style={{background:bg,borderRadius:R.lg,border:`1px solid ${i===0?"transparent":T.border}`,padding:"12px 14px"}}>
              <div style={{fontSize:11,color:i===0?"rgba(255,255,255,.5)":T.muted,fontFamily:F,fontWeight:500,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>{l}</div>
              <div style={{fontSize:18,fontWeight:700,color:i===0?T.gold:T.text,fontFamily:F}}>{v}</div>
            </div>
          ))}
        </div>

        {/* Chart */}
        <Card pad="14px" style={{marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:F}}>Sales trend</span>
            <span style={{fontSize:11,color:T.muted,fontFamily:F}}>Last 7 days</span>
          </div>
          <MiniBar data={chartData}/>
        </Card>

        {/* Quick actions */}
        <SLabel>Quick actions</SLabel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          {[
            {icon:"history", label:"All entries",   fn:()=>window.__setScreen&&window.__setScreen("history")},
            {icon:"pnl",     label:"P&L report",    fn:()=>window.__setScreen&&window.__setScreen("pnl")},
            {icon:"truck",   label:"Stock tracker",  fn:()=>window.__setScreen&&window.__setScreen("stock")},
            {icon:"entry",   label:"New entry",      fn:goEntry},
          ].map(a=>(
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

        {/* Recent */}
        <SLabel>Recent entries</SLabel>
        {entries.length===0?(
          <div style={{textAlign:"center",padding:"32px 0",color:T.muted,fontFamily:F,fontSize:13}}>No entries yet. Tap Entry below to start.</div>
        ):(
          <Card>
            {entries.slice(0,5).map((e,i)=>{
              const c=calcEntry(e);
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
                    <div style={{fontSize:11,color:T.muted,fontFamily:F,marginTop:1}}>{fmtKg(c.gas)} · {(e.expenses||[]).length} expense(s)</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:13,fontWeight:700,color:c.profit>=0?T.success:T.danger,fontFamily:F}}>{fmt(c.profit)}</div>
                    <div style={{fontSize:10,color:T.muted,fontFamily:F}}>profit</div>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
        <div style={{height:16}}/>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// DAILY ENTRY
// ═══════════════════════════════════════════════════════════════
const DailyEntry = ({back, onSave, lastEntry, pricePerKg}) => {
  const GP  = pricePerKg || GAS_PRICE;
  const now = new Date().toISOString().split("T")[0];
  const [date,  setDate]  = useState(now);
  const [open,  setOpen]  = useState(String(lastEntry?.closeMeter||""));
  const [close, setClose] = useState("");
  const [cash,  setCash]  = useState("");
  const [pos,   setPos]   = useState("");
  const [exps,  setExps]  = useState([{cat:"",amt:""}]);
  const [notes, setNotes] = useState("");
  const [ld,    setLd]    = useState(false);
  const [done,  setDone]  = useState(false);
  const [err,   setErr]   = useState("");

  const gas     = (Number(close)||0)-(Number(open)||0);
  const sales   = (Number(cash)||0)+(Number(pos)||0);
  const expRev  = gas*GP;
  const variance= sales-expRev;
  const profit  = sales - exps.reduce((s,x)=>s+(Number(x.amt)||0),0);
  const valid   = close&&open&&Number(close)>Number(open)&&(cash||pos);

  const setE = (i,k,v) => setExps(p=>p.map((x,j)=>j===i?{...x,[k]:v}:x));

  const save = async () => {
    setLd(true); setErr("");
    try {
      await onSave({date,openMeter:Number(open),closeMeter:Number(close),cashSales:Number(cash)||0,posSales:Number(pos)||0,expenses:exps.filter(x=>x.cat&&x.amt).map(x=>({cat:x.cat,amt:Number(x.amt)})),notes});
      setDone(true);
    } catch(e) { setErr(e.message||"Save failed. Try again."); }
    finally { setLd(false); }
  };

  if (done) return (
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:T.bg,gap:12,padding:32,fontFamily:F}}>
      <div style={{width:56,height:56,borderRadius:"50%",background:`${T.success}15`,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <Icon n="check" s={28} c={T.success}/>
      </div>
      <div style={{fontSize:18,fontWeight:700,color:T.text}}>Entry saved</div>
      <div style={{fontSize:13,color:T.muted,textAlign:"center",lineHeight:1.6}}>Synced to Firestore.</div>
      <div style={{marginTop:8,width:"100%"}}><Btn label="Back to dashboard" onClick={back} size="lg"/></div>
    </div>
  );

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title="Daily entry" left={<BackBtn onClick={back}/>}/>
      {/* Live preview bar */}
      {(gas>0||sales>0)&&(
        <div style={{background:T.primary,padding:"8px 16px",display:"flex",gap:8}}>
          {[[fmtKg(gas),"Gas"],[fmt(sales),"Sales"],[(variance>=0?"+":"")+fmt(variance),"Variance"]].map(([v,l])=>(
            <div key={l} style={{flex:1,background:"rgba(255,255,255,.08)",borderRadius:R.sm,padding:"7px 8px",textAlign:"center"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#fff",fontFamily:F}}>{v}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.45)",fontFamily:F,textTransform:"uppercase",letterSpacing:.4,marginTop:1}}>{l}</div>
            </div>
          ))}
        </div>
      )}
      {err&&<ErrBanner msg={err}/>}
      <div style={{flex:1,overflow:"auto",padding:"16px 16px 24px"}}>
        <SLabel mt={0}>Date</SLabel>
        <Input value={date} onChange={setDate} type="date"/>

        <SLabel>Meter readings</SLabel>
        <Card pad="14px" style={{marginBottom:12}}>
          <Input label="Opening meter (kg)" value={open} onChange={setOpen} type="number" placeholder="e.g. 14820" hint={lastEntry?`Last close: ${lastEntry.closeMeter} kg`:""}/>
          <Input label="Closing meter (kg)" value={close} onChange={setClose} type="number" placeholder="e.g. 15340" error={close&&Number(close)<=Number(open)?"Must be greater than opening":""}/>
          {gas>0&&<div style={{background:T.bg,borderRadius:R.sm,padding:"9px 12px",display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:13,color:T.muted}}>Gas dispensed</span><span style={{fontSize:13,fontWeight:700,color:T.text}}>{fmtKg(gas)}</span></div>}
        </Card>

        <SLabel>Sales</SLabel>
        <Card pad="14px" style={{marginBottom:12}}>
          <div style={{background:T.bg,borderRadius:R.sm,padding:"8px 12px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,color:T.muted}}>Current price (auto-filled)</span>
            <span style={{fontSize:13,fontWeight:600,color:T.text}}>₦{GP}/kg</span>
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
const StockScreen = ({stock, prices, onAddDelivery, onAddPrice, back}) => {
  const [tab,       setTab]       = useState("deliveries");
  const [showDel,   setShowDel]   = useState(false);
  const [showPx,    setShowPx]    = useState(false);
  const [ld,        setLd]        = useState(false);
  const [delKg,     setDelKg]     = useState("");
  const [delDate,   setDelDate]   = useState(new Date().toISOString().split("T")[0]);
  const [delSup,    setDelSup]    = useState("");
  const [delPx,     setDelPx]     = useState("");
  const [delNote,   setDelNote]   = useState("");
  const [pxDate,    setPxDate]    = useState(new Date().toISOString().split("T")[0]);
  const [pxPrice,   setPxPrice]   = useState("");
  const [pxNote,    setPxNote]    = useState("");

  const cur = stock.current;
  const lp  = prices.length ? [...prices].sort((a,b)=>new Date(b.date)-new Date(a.date))[0] : null;

  const saveDel = async () => {
    if(!delKg||!delSup) return; setLd(true);
    try { await onAddDelivery({date:delDate,kg:Number(delKg),supplier:delSup,pricePerKg:Number(delPx)||0,note:delNote}); setShowDel(false); setDelKg(""); setDelSup(""); setDelPx(""); setDelNote(""); }
    finally { setLd(false); }
  };
  const savePx = async () => {
    if(!pxPrice) return; setLd(true);
    try { await onAddPrice({date:pxDate,pricePerKg:Number(pxPrice),note:pxNote}); setShowPx(false); setPxPrice(""); setPxNote(""); }
    finally { setLd(false); }
  };

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

      <div style={{flex:1,overflow:"auto",padding:"16px 16px 24px"}}>
        {tab==="deliveries"&&(<>
          {cur&&(
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
                <Divider my={8}/>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:13,fontWeight:600,color:T.text}}>Remaining now</span>
                  <span style={{fontSize:16,fontWeight:700,color:cur.pct<15?T.danger:cur.pct<40?T.warning:T.success}}>{fmtKg(cur.remaining)}</span>
                </div>
                <div style={{marginTop:8,height:5,borderRadius:R.pill,background:T.bg2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.max(2,cur.pct)}%`,background:cur.pct>40?T.success:cur.pct>15?T.warning:T.danger,borderRadius:R.pill}}/>
                </div>
                <div style={{fontSize:11,color:T.muted,marginTop:4,textAlign:"right"}}>{cur.pct}% left</div>
              </div>
            </Card>
          )}
          <SLabel mt={8}>All delivery periods</SLabel>
          {stock.periods.map((p,i)=>{
            const pct=p.available>0?Math.round((p.remaining/p.available)*100):0;
            return (
              <Card key={i} style={{marginBottom:8}}>
                <div style={{padding:"11px 14px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
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
const PnLScreen = ({entries, back}) => {
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
    { id:"today",     label:"Today",       from:todayISO(),  to:todayISO()  },
    { id:"thisweek",  label:"This week",   from:daysAgo(6),  to:todayISO()  },
    { id:"thismonth", label:"This month",  from:monthStart(0),to:todayISO() },
    { id:"last7",     label:"Last 7 days", from:daysAgo(6),  to:todayISO()  },
    { id:"last30",    label:"Last 30 days",from:daysAgo(29), to:todayISO()  },
    { id:"lastmonth", label:"Last month",  from:monthStart(-1),to:monthEnd(-1) },
  ];

  const [preset,   setPreset]   = useState("thisweek");
  const [fromDate, setFromDate] = useState(PRESETS[1].from);
  const [toDate,   setToDate]   = useState(PRESETS[1].to);
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
    const c=calcEntry(e);
    return {rev:a.rev+c.sales,gas:a.gas+c.gas,exp:a.exp+c.exp,
            profit:a.profit+c.profit,cash:a.cash+e.cashSales,
            pos:a.pos+e.posSales,variance:a.variance+c.variance};
  },{rev:0,gas:0,exp:0,profit:0,cash:0,pos:0,variance:0});

  const margin = totals.rev>0 ? Math.round((totals.profit/totals.rev)*100) : 0;
  const avgDaily= days>0 ? totals.rev/days : 0;

  const expBd = {};
  filtered.forEach(e=>(e.expenses||[]).forEach(x=>{expBd[x.cat]=(expBd[x.cat]||0)+x.amt;}));
  const expList = Object.entries(expBd).sort((a,b)=>b[1]-a[1]);

  // ── range label for header ────────────────────────────────
  const rangeLabel = preset==="custom"
    ? `${fmtShort(fromDate)} – ${fmtShort(toDate)}`
    : PRESETS.find(p=>p.id===preset)?.label || "";

  const Row = ({label,value,bold,credit,indent,last}) => (
    <div style={{display:"flex",justifyContent:"space-between",padding:indent?"9px 14px 9px 24px":"9px 14px",borderBottom:last?"none":`1px solid ${T.border}`,background:bold?T.bg:"transparent"}}>
      <span style={{fontSize:bold?13:12,fontWeight:bold?600:400,color:T.text,fontFamily:F}}>{label}</span>
      <span style={{fontSize:bold?14:12,fontWeight:bold?700:500,fontFamily:F,color:credit===true?T.success:credit===false?T.danger:T.text}}>{value}</span>
    </div>
  );

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title="P&L report" left={<BackBtn onClick={back}/>}
        right={
          <button onClick={()=>{setDraftFrom(fromDate);setDraftTo(toDate);setShowPicker(true);}}
            style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:R.md,padding:"5px 10px",cursor:"pointer",fontSize:12,fontWeight:600,color:T.text,fontFamily:F}}>
            Custom
          </button>
        }
      />

      {/* Preset chips — scrollable single row */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"10px 16px",overflowX:"auto",display:"flex",gap:6,flexShrink:0,WebkitOverflowScrolling:"touch"}}>
        <style>{`.pchip::-webkit-scrollbar{display:none}`}</style>
        {PRESETS.map(p=>(
          <button key={p.id} onClick={()=>applyPreset(p)}
            style={{flexShrink:0,padding:"7px 14px",background:preset===p.id?T.primary:T.bg2,color:preset===p.id?"#fff":T.muted,border:"none",borderRadius:R.pill,fontSize:12,fontWeight:preset===p.id?600:400,cursor:"pointer",fontFamily:F,transition:"all .15s",whiteSpace:"nowrap"}}>
            {p.label}
          </button>
        ))}
        {preset==="custom"&&(
          <button style={{flexShrink:0,padding:"7px 14px",background:T.primary,color:"#fff",border:"none",borderRadius:R.pill,fontSize:12,fontWeight:600,fontFamily:F,whiteSpace:"nowrap"}}>
            {fmtShort(fromDate)} – {fmtShort(toDate)}
          </button>
        )}
      </div>

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
              {l:"Revenue",   v:fmt(totals.rev),    color:T.gold,    bg:T.primary},
              {l:"Net profit",v:fmt(totals.profit),  color:totals.profit>=0?T.success:T.danger, bg:T.surface},
              {l:"Expenses",  v:fmt(totals.exp),     color:T.text,    bg:T.surface},
              {l:"Gas sold",  v:fmtKg(totals.gas),  color:T.text,    bg:T.surface},
              {l:"Cash",      v:fmt(totals.cash),    color:T.text,    bg:T.surface},
              {l:"POS / transfer",v:fmt(totals.pos), color:T.text,    bg:T.surface},
            ].map(({l,v,color,bg})=>(
              <div key={l} style={{background:bg,borderRadius:R.lg,border:`1px solid ${bg===T.primary?"transparent":T.border}`,padding:"11px 13px"}}>
                <div style={{fontSize:11,color:bg===T.primary?"rgba(255,255,255,.5)":T.muted,fontFamily:F,fontWeight:500,textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>{l}</div>
                <div style={{fontSize:16,fontWeight:700,color,fontFamily:F}}>{v}</div>
                {l==="Net profit"&&<div style={{fontSize:11,color:T.muted,marginTop:2}}>{margin}% margin</div>}
              </div>
            ))}
          </div>

          {/* Income statement */}
          <SLabel>Income statement</SLabel>
          <Card style={{marginBottom:16}}>
            <Row label="Cash sales"      value={fmt(totals.cash)}   indent credit={true}/>
            <Row label="POS / transfer"  value={fmt(totals.pos)}    indent credit={true}/>
            <Row label="Gross revenue"   value={fmt(totals.rev)}    bold   credit={true}/>
            <div style={{padding:"8px 14px",background:T.bg,borderBottom:`1px solid ${T.border}`}}>
              <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.5,fontFamily:F}}>Expenses</span>
            </div>
            {expList.map(([cat,amt])=><Row key={cat} label={cat} value={fmt(amt)} indent credit={false}/>)}
            {expList.length===0&&<Row label="No expenses recorded" value="—" indent/>}
            <Row label="Total expenses"  value={fmt(totals.exp)}  bold credit={false}/>
            <div style={{padding:"12px 14px",background:totals.profit>=0?`${T.success}10`:`${T.danger}10`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:14,fontWeight:600,color:T.text,fontFamily:F}}>Net profit</span>
                <span style={{fontSize:18,fontWeight:700,color:totals.profit>=0?T.success:T.danger,fontFamily:F}}>{fmt(totals.profit)}</span>
              </div>
            </div>
          </Card>

          {/* Variance check */}
          <SLabel>Variance check</SLabel>
          <Card pad="14px" style={{marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:12,color:T.muted}}>Expected ({fmtKg(totals.gas)} × ₦{GAS_PRICE})</span>
              <span style={{fontSize:12,fontWeight:600,color:T.text}}>{fmt(totals.gas*GAS_PRICE)}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
              <span style={{fontSize:12,color:T.muted}}>Actual collected</span>
              <span style={{fontSize:12,fontWeight:600,color:T.text}}>{fmt(totals.rev)}</span>
            </div>
            <Divider/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
              <span style={{fontSize:13,fontWeight:600,color:T.text}}>Variance</span>
              <span style={{fontSize:15,fontWeight:700,color:totals.variance>=0?T.success:T.danger}}>
                {totals.variance>=0?"+":"-"}{fmt(Math.abs(totals.variance))}
              </span>
            </div>
            <div style={{marginTop:8,fontSize:11,color:T.muted,fontFamily:F}}>
              {Math.abs(totals.variance/(totals.gas*GAS_PRICE||1)*100).toFixed(1)}% {totals.variance>=0?"surplus":"shortfall"} vs expected.
            </div>
          </Card>

          {/* Day-by-day table */}
          <SLabel>Day-by-day breakdown</SLabel>
          <Card style={{marginBottom:16}}>
            {/* Table header */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 70px",gap:0,padding:"8px 14px",background:T.bg,borderBottom:`1px solid ${T.border}`}}>
              {["Date","Sales","Gas","Profit"].map(h=>(
                <span key={h} style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.4,fontFamily:F,textAlign:h!=="Date"?"right":"left"}}>{h}</span>
              ))}
            </div>
            {filtered.map((e,i)=>{
              const c=calcEntry(e);
              return (
                <div key={e.id} style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 70px",gap:0,padding:"10px 14px",borderBottom:i<filtered.length-1?`1px solid ${T.border}`:"none",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:500,color:T.text,fontFamily:F}}>{fmtShort(e.date)}</div>
                    <div style={{fontSize:10,color:T.muted,fontFamily:F,marginTop:1}}>{(e.expenses||[]).length} exp</div>
                  </div>
                  <div style={{textAlign:"right",fontSize:12,fontWeight:600,color:T.text,fontFamily:F}}>{fmt(c.sales)}</div>
                  <div style={{textAlign:"right",fontSize:12,color:T.muted,fontFamily:F}}>{fmtKg(c.gas)}</div>
                  <div style={{textAlign:"right",fontSize:12,fontWeight:700,color:c.profit>=0?T.success:T.danger,fontFamily:F}}>{fmt(c.profit)}</div>
                </div>
              );
            })}
            {/* Totals row */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 70px",gap:0,padding:"10px 14px",background:T.bg,borderTop:`1px solid ${T.border}`}}>
              <span style={{fontSize:12,fontWeight:600,color:T.text,fontFamily:F}}>Total ({days}d)</span>
              <span style={{textAlign:"right",fontSize:12,fontWeight:700,color:T.text,fontFamily:F}}>{fmt(totals.rev)}</span>
              <span style={{textAlign:"right",fontSize:12,fontWeight:600,color:T.muted,fontFamily:F}}>{fmtKg(totals.gas)}</span>
              <span style={{textAlign:"right",fontSize:13,fontWeight:700,color:totals.profit>=0?T.success:T.danger,fontFamily:F}}>{fmt(totals.profit)}</span>
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
const HistoryScreen = ({entries, back, goDayDetail}) => (
  <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
    <TopBar title="All entries" left={<BackBtn onClick={back}/>} right={<Badge label={`${entries.length} days`}/>}/>
    <div style={{flex:1,overflow:"auto",padding:"16px 16px 24px"}}>
      {entries.length===0?(
        <div style={{textAlign:"center",padding:"48px 0",color:T.muted,fontSize:13}}>No entries yet.</div>
      ):(
        <Card>
          {entries.map((e,i)=>{
            const c=calcEntry(e);
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
                  <div style={{fontSize:11,color:T.muted,fontFamily:F,marginTop:1}}>{fmtKg(c.gas)} · {(e.expenses||[]).length} expense(s)</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:13,fontWeight:700,color:c.profit>=0?T.success:T.danger,fontFamily:F}}>{fmt(c.profit)}</div>
                  <div style={{fontSize:10,color:T.muted,fontFamily:F}}>profit</div>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// DAY DETAIL
// ═══════════════════════════════════════════════════════════════
const DayDetail = ({entry, back}) => {
  const c = calcEntry(entry);
  const Row = ({l,v,accent}) => (
    <div style={{display:"flex",justifyContent:"space-between",padding:"11px 14px",borderBottom:`1px solid ${T.border}`}}>
      <span style={{fontSize:13,color:T.muted,fontFamily:F}}>{l}</span>
      <span style={{fontSize:13,fontWeight:600,color:accent||T.text,fontFamily:F}}>{v}</span>
    </div>
  );
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title={fmtD(entry.date)} left={<BackBtn onClick={back}/>}/>
      <div style={{flex:1,overflow:"auto",padding:"16px 16px 24px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          {[[fmt(c.sales),"Total sales",false],[fmt(c.profit),"Net profit",c.profit>=0]].map(([v,l,pos])=>(
            <div key={l} style={{background:T.surface,borderRadius:R.lg,border:`1px solid ${T.border}`,padding:"12px 14px"}}>
              <div style={{fontSize:11,color:T.muted,fontFamily:F,fontWeight:500,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>{l}</div>
              <div style={{fontSize:18,fontWeight:700,color:pos?T.success:l==="Net profit"?T.danger:T.text,fontFamily:F}}>{v}</div>
            </div>
          ))}
        </div>
        <SLabel mt={0}>Meter</SLabel>
        <Card style={{marginBottom:12}}>
          <Row l="Opening meter" v={`${entry.openMeter.toLocaleString()} kg`}/>
          <Row l="Closing meter" v={`${entry.closeMeter.toLocaleString()} kg`}/>
          <Row l="Gas dispensed" v={fmtKg(c.gas)} accent={T.primary}/>
        </Card>
        <SLabel>Sales</SLabel>
        <Card style={{marginBottom:12}}>
          <Row l="Cash"         v={fmt(entry.cashSales)}/>
          <Row l="POS/transfer" v={fmt(entry.posSales)}/>
          <Row l="Total"        v={fmt(c.sales)} accent={T.primary}/>
          <Row l="Expected"     v={fmt(c.expRev)}/>
          <Row l="Variance"     v={(c.variance>=0?"+":"")+fmt(c.variance)} accent={c.variance>=0?T.success:T.danger}/>
        </Card>
        {(entry.expenses||[]).length>0&&(<>
          <SLabel>Expenses</SLabel>
          <Card style={{marginBottom:12}}>
            {(entry.expenses||[]).map((x,i)=>(
              <Row key={i} l={x.cat} v={fmt(x.amt)} accent={T.danger}/>
            ))}
            <Row l="Total expenses" v={fmt(c.exp)} accent={T.danger}/>
          </Card>
        </>)}
        {entry.notes&&(<>
          <SLabel>Notes</SLabel>
          <Card pad="12px 14px" style={{marginBottom:12}}>
            <p style={{fontSize:13,color:T.text,fontFamily:F,lineHeight:1.6,margin:0}}>{entry.notes}</p>
          </Card>
        </>)}
        <div style={{marginTop:8}}><Btn label="Back to history" onClick={back} variant="outline" size="lg"/></div>
        <div style={{height:16}}/>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// SETTINGS SCREEN
// ═══════════════════════════════════════════════════════════════
const SettingsScreen = ({ user, profile, plantId, onSignOut }) => {
  const role = profile?.role || "owner";
  // sub-screens: null | "plant" | "email" | "password" | "staff"
  const [sub,        setSub]       = useState(null);

  // Plant name
  const [plantName,  setPlantName] = useState(profile?.displayName || "");
  const [savingName, setSavingName]= useState(false);
  const [nameMsg,    setNameMsg]   = useState("");

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

  // ── shared sub-screen shell ──────────────────────────────
  const SubScreen = ({ title, children }) => (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg,fontFamily:F}}>
      <TopBar title={title} dark={false} left={
        <BackBtn onClick={()=>{ setSub(null); setNameMsg(""); setEmailErr(""); setEmailOk(false); setPwErr(""); setPwOk(false); }} dark={false}/>
      }/>
      <div style={{flex:1,overflow:"auto",padding:"20px 16px 32px"}}>{children}</div>
    </div>
  );

  // ── Plant name sub-screen ────────────────────────────────
  if (sub === "plant") return (
    <SubScreen title="Plant name">
      <p style={{fontSize:13,color:T.muted,fontFamily:F,lineHeight:1.6,marginBottom:20}}>This name appears on your dashboard and all reports.</p>
      <Input label="Plant name" value={plantName} onChange={setPlantName} placeholder="e.g. Hageez Gas Plant" onEnter={savePlantName}/>
      {nameMsg && (
        <div style={{background: nameMsg.includes("updated") ? `${T.success}12` : `${T.danger}12`, borderRadius:R.md, padding:"10px 12px", marginBottom:14, fontSize:13, color: nameMsg.includes("updated") ? T.success : T.danger, fontFamily:F}}>
          {nameMsg}
        </div>
      )}
      <Btn label="Save plant name" onClick={savePlantName} loading={savingName} disabled={!plantName.trim()||plantName.trim()===profile?.displayName} size="lg" icon="check"/>
    </SubScreen>
  );

  // ── Change email sub-screen ──────────────────────────────
  if (sub === "email") return (
    <SubScreen title="Change email">
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
    </SubScreen>
  );

  // ── Change password sub-screen ───────────────────────────
  if (sub === "password") return (
    <SubScreen title="Change password">
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
    </SubScreen>
  );

  // ── Staff management state ───────────────────────────────
  const { invites }              = useInvites(plantId);
  const { staff: staffMembers }  = useStaffMembers(plantId);
  const [inviteEmail,  setInviteEmail]  = useState("");
  const [inviteLd,     setInviteLd]     = useState(false);
  const [inviteErr,    setInviteErr]    = useState("");
  const [inviteOk,     setInviteOk]     = useState("");

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteLd(true); setInviteErr(""); setInviteOk("");
    try {
      await createInvite(plantId, profile?.displayName||"", user.uid, inviteEmail.trim());
      setInviteOk(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
    } catch(e) {
      setInviteErr(e.message||"Failed to send invite.");
    } finally { setInviteLd(false); }
  };

  const handleRevoke = async (staffUid, staffEmail) => {
    if (!window.confirm(`Remove ${staffEmail} from this plant?`)) return;
    try { await revokeStaff(staffUid); }
    catch(e) { alert(e.message); }
  };

  const handleDeleteInvite = async (inviteId, email) => {
    if (!window.confirm(`Cancel invite for ${email}?`)) return;
    try { await deleteInvite(inviteId); }
    catch(e) { alert(e.message); }
  };

  // ── Staff sub-screen ─────────────────────────────────────
  if (sub === "staff") return (
    <SubScreen title="Staff access">
      {/* Invite form */}
      <div style={{marginBottom:20}}>
        <p style={{fontSize:13,color:T.muted,lineHeight:1.6,marginBottom:16}}>
          Invite staff by email. They'll register or log in with that email and be automatically linked to this plant.
        </p>
        <Input
          label="Staff email address"
          value={inviteEmail}
          onChange={v=>{setInviteEmail(v);setInviteErr("");setInviteOk("");}}
          type="email"
          placeholder="staff@example.com"
          onEnter={sendInvite}
        />
        {inviteErr&&<div style={{background:`${T.danger}10`,borderRadius:R.md,padding:"9px 12px",marginBottom:12,fontSize:13,color:T.danger}}>{inviteErr}</div>}
        {inviteOk &&<div style={{background:`${T.success}10`,borderRadius:R.md,padding:"9px 12px",marginBottom:12,fontSize:13,color:T.success}}>{inviteOk}</div>}
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
    </SubScreen>
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
              <div style={{marginTop:6,display:"inline-block",background:`${T.gold}25`,borderRadius:R.pill,padding:"2px 10px",fontSize:11,fontWeight:600,color:T.gold}}>Free plan</div>
            </div>
          </div>
        </div>

        {/* Plant section */}
        <div style={{padding:"8px 16px 6px"}}>
          <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.7,fontFamily:F}}>Plant</span>
        </div>
        <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
          <Row icon="plant"  label="Plant name" sub={profile?.displayName} onClick={()=>{ setPlantName(profile?.displayName||""); setNameMsg(""); setSub("plant"); }}/>
          {role==="owner"&&(
            <Row icon="people" label="Staff access"
              sub={staffMembers.length>0?`${staffMembers.length} active staff member${staffMembers.length!==1?"s":""}`:invites.filter(i=>i.status==="pending").length>0?"Pending invite":"No staff yet"}
              onClick={()=>{ setInviteEmail(""); setInviteErr(""); setInviteOk(""); setSub("staff"); }}/>
          )}
        </div>

        {/* Account section */}
        <div style={{padding:"20px 16px 6px"}}>
          <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.7,fontFamily:F}}>Account</span>
        </div>
        <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
          <Row icon="mail"   label="Email address"  sub={user?.email}         onClick={()=>{ setNewEmail(""); setEmailPw(""); setEmailErr(""); setEmailOk(false); setSub("email"); }}/>
          <Row icon="lock"   label="Password"       sub="Change your password" onClick={()=>{ setCurPw(""); setNewPw(""); setConfPw(""); setPwErr(""); setPwOk(false); setSub("password"); }}/>
        </div>

        {/* Plan section */}
        <div style={{padding:"20px 16px 6px"}}>
          <span style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:.7,fontFamily:F}}>Plan</span>
        </div>
        <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
          {/* Plan info tile */}
          <div style={{background:T.surface,padding:"14px 16px",borderBottom:`1px solid ${T.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:T.text,fontFamily:F}}>Free plan</div>
                <div style={{fontSize:12,color:T.muted,fontFamily:F,marginTop:2}}>All features included during beta</div>
              </div>
              <span style={{background:`${T.success}15`,color:T.success,fontSize:11,fontWeight:600,padding:"3px 9px",borderRadius:R.pill,fontFamily:F}}>Active</span>
            </div>
            {/* Feature list */}
            {["Dashboard & stock summary","Daily entry logging","P&L reports with date ranges","Stock & refill tracker"].map(f=>(
              <div key={f} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <div style={{width:16,height:16,borderRadius:"50%",background:`${T.success}15`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <Icon n="check" s={10} c={T.success}/>
                </div>
                <span style={{fontSize:12,color:T.text2,fontFamily:F}}>{f}</span>
              </div>
            ))}
            <div style={{marginTop:12,padding:"10px 12px",background:`${T.gold}12`,borderRadius:R.md,fontSize:12,color:"#7a5100",fontFamily:F,lineHeight:1.5}}>
              Paid plans with multi-staff access and PDF export coming soon.
            </div>
          </div>
        </div>

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
// ROOT
// ═══════════════════════════════════════════════════════════════
export default function GasLedgerApp() {
  const {user, loading:authLd}    = useAuth();
  const {profile, loading:profLd} = useUserProfile(user?.uid);

  const [screen,      setScreen]      = useState("dashboard");
  const [detail,      setDetail]      = useState(null);
  const [pendingInvite, setPendingInvite] = useState(null);
  const [inviteChecked, setInviteChecked] = useState(false);

  const role    = profile?.role || "owner";
  const plantId = profile?.plantId;
  const isStaff = role === "staff";

  const {data:entries,    loading:eLd} = useEntries(plantId);
  const {data:deliveries, loading:dLd} = useDeliveries(plantId);
  const {data:prices,     loading:pLd} = usePrices(plantId);

  const stock     = buildStockPeriods(entries, deliveries);
  const livePrice = latestPrice(prices);

  const addEntry    = useCallback(e => fbAddEntry(plantId,e),    [plantId]);
  const addDelivery = useCallback(d => fbAddDelivery(plantId,d), [plantId]);
  const addPrice    = useCallback(p => fbAddPrice(plantId,p),    [plantId]);
  const openDetail  = useCallback(e => {setDetail(e);setScreen("detail");}, []);

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

  // Expose setScreen globally for Dashboard quick-action buttons
  useEffect(() => { window.__setScreen = setScreen; return () => { delete window.__setScreen; }; }, []);

  const globalCSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { height: 100%; }
    body { font-family: ${F}; background: ${T.bg}; -webkit-font-smoothing: antialiased; }
    input, textarea, button, select { font-family: inherit; }
    textarea { resize: none; }
    ::-webkit-scrollbar { width: 0; }
  `;

  const Shell = ({children}) => (
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:T.bg,maxWidth:430,margin:"0 auto",position:"relative",overflow:"hidden"}}>
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

  // ── Data loading ──────────────────────────────────────────
  if ((eLd||dLd||pLd) && screen==="dashboard") return <Shell><Spinner/></Shell>;

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

  const mainScreens = ["dashboard","entry","pnl","history","stock","settings","detail"];

  return (
    <Shell>
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",position:"relative"}}>
        {screen==="dashboard" && <Dashboard entries={entries} stock={stock} plantName={profile.displayName} goEntry={()=>setScreen("entry")} goDayDetail={openDetail}/>}
        {screen==="entry"     && <DailyEntry back={()=>setScreen("dashboard")} onSave={addEntry} lastEntry={entries[0]} pricePerKg={livePrice}/>}
        {screen==="stock"     && <Gate allowed={!isStaff}><StockScreen stock={stock} prices={prices} onAddDelivery={addDelivery} onAddPrice={addPrice} back={()=>setScreen("dashboard")}/></Gate>}
        {screen==="pnl"       && <Gate allowed={!isStaff}><PnLScreen entries={entries} back={()=>setScreen("dashboard")}/></Gate>}
        {screen==="history"   && <HistoryScreen entries={entries} back={()=>setScreen("dashboard")} goDayDetail={openDetail}/>}
        {screen==="detail"    && detail && <DayDetail entry={detail} back={()=>setScreen("history")}/>}
        {screen==="settings"  && <Gate allowed={!isStaff}><SettingsScreen user={user} profile={profile} plantId={plantId} onSignOut={signOutUser}/></Gate>}
      </div>
      {mainScreens.includes(screen) && <BottomNav active={screen} onChange={setScreen} role={role}/>}
    </Shell>
  );
}
