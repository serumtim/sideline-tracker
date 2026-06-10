"use client";
// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";

const HASHES = ["L", "M", "R"];
const PERSONNEL = ["Tiger", "Grizzly", "Cheetah"];
const FORMATIONS = ["Red", "Blue", "Green", "Yellow", "Brown", "Black"];
const FORM_TAGS = ["Over", "Flop", "Strong", "Trips", "Loose", "Empty"];
const POSITIONS = ["X", "Y", "A", "B", "F"];
const RPO_TAGS = ["Pop", "Peak"];
const MOTIONS = ["None", "Jet", "Orbit", "Z-Motion", "Shift", "Across", "Return"];
const RUN_PLAYS = ["Buck", "Power", "Trojan", "Counter", "Jet", "Belly", "Trap", "ISO"];
const PASS_PLAYS = ["Snag", "Stick", "Vert", "Flood", "Waggle", "Pig", "Smash", "Hitches"];
const DEF_POS = ["DL", "LB", "CB", "S", "DB", "EDGE"];

const FONT_DISPLAY = "'Oswald', 'Arial Narrow', sans-serif";
const FONT_BODY = "'Barlow', system-ui, sans-serif";

// =================== ROOT ===================
export default function PlayTracker() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [screen, setScreen] = useState("games");
  const [gamesIndex, setGamesIndex] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loadingIndex, setLoadingIndex] = useState(true);

  const loadIndex = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("games")
        .select("id, label, created_at")
        .order("created_at", { ascending: false });
      setGamesIndex(data || []);
    } catch { setGamesIndex([]); }
    setLoadingIndex(false);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) loadIndex();
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadIndex();
      } else {
        setGamesIndex([]);
        setScreen("games");
        setActiveId(null);
        setLoadingIndex(true);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadIndex]);

  async function createGame(label) {
    const { data, error } = await supabase
      .from("games")
      .insert({ label: label.trim() || "Untitled Game", plays: [], user_id: user.id })
      .select("id, label, created_at")
      .single();
    if (error || !data) { console.error("createGame failed:", error?.message); return; }
    setGamesIndex((prev) => [data, ...prev]);
    setActiveId(data.id);
    setScreen("game");
  }

  async function deleteGame(id) {
    await supabase.from("games").delete().eq("id", id);
    setGamesIndex((prev) => prev.filter((g) => g.id !== id));
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (authLoading) return <LoadingScreen />;
  if (!user) return <AuthScreen />;

  if (screen === "games") {
    return <GamesList index={gamesIndex} loading={loadingIndex} onRefresh={loadIndex}
      onOpen={(id) => { setActiveId(id); setScreen("game"); }}
      onCreate={createGame} onDelete={deleteGame} onSignOut={signOut} />;
  }

  const active = gamesIndex.find((g) => g.id === activeId);
  return <Game id={activeId} label={active?.label || "Game"} onBack={() => { setScreen("games"); loadIndex(); }} />;
}

// =================== LOADING ===================
function LoadingScreen() {
  return (
    <div style={{ fontFamily: FONT_BODY, background: "#0a0e14", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#f4f4f0" }}>
        Side<span style={{ color: "#f5c518" }}>line</span>
      </div>
    </div>
  );
}

// =================== AUTH ===================
function AuthScreen() {
  const [tab, setTab] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(null); // { text, error }
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email || !password) { setMessage({ text: "Email and password are required.", error: true }); return; }
    setLoading(true); setMessage(null);

    if (tab === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setMessage({ text: error.message, error: true }); setLoading(false); }
      // on success, onAuthStateChange in root fires and swaps the screen automatically
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setMessage({ text: error.message, error: true }); setLoading(false); return; }
      setMessage({ text: "Account created! You're being signed in…", error: false });
      setLoading(false);
    }
  }

  return (
    <Shell subtitle="Coach Login">
      <div style={{ padding: 24, maxWidth: 420, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
          <button onClick={() => { setTab("signin"); setMessage(null); }} style={modeBtn(tab === "signin")}>Sign In</button>
          <button onClick={() => { setTab("signup"); setMessage(null); }} style={modeBtn(tab === "signup", true)}>Sign Up</button>
        </div>

        <Section label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="coach@yourschool.com" style={inputStyle} />
        </Section>

        <Section label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={tab === "signup" ? "Min. 6 characters" : "Your password"} style={inputStyle} />
        </Section>

        {message && (
          <div style={{ borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13,
            background: message.error ? "#1d1015" : "#0d1a12",
            border: `1px solid ${message.error ? "#ff5252" : "#3ddc84"}`,
            color: message.error ? "#ff8a80" : "#3ddc84" }}>
            {message.text}
          </div>
        )}

        <button onClick={handleSubmit} disabled={loading} style={{
          width: "100%", padding: "18px", borderRadius: 12, border: "none",
          background: loading ? "#1d2530" : "#f5c518", color: loading ? "#4a5568" : "#0a0e14",
          fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, letterSpacing: 1.5,
          textTransform: "uppercase", cursor: loading ? "not-allowed" : "pointer",
        }}>
          {loading ? "Loading…" : tab === "signin" ? "Sign In" : "Create Account"}
        </button>
      </div>
    </Shell>
  );
}

// =================== GAMES LIST ===================
function GamesList({ index, loading, onRefresh, onOpen, onCreate, onDelete, onSignOut }) {
  const [showNew, setShowNew] = useState(false);
  const [label, setLabel] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);

  return (
    <Shell subtitle="Game Library" right={
      <button onClick={onSignOut} style={{ background: "none", border: "1px solid #2a3543", borderRadius: 8, color: "#7a8699", fontSize: 12, cursor: "pointer", fontFamily: FONT_BODY, padding: "6px 10px", letterSpacing: 0.5 }}>
        Sign Out
      </button>
    }>
      <div style={{ padding: 16 }}>
        <button onClick={() => setShowNew(true)} style={{
          width: "100%", padding: "16px", borderRadius: 12, border: "none", background: "#f5c518", color: "#0a0e14",
          fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", marginBottom: 16,
        }}>+ New Game</button>

        {showNew && (
          <div style={{ background: "#11161f", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #2a3543" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 10 }}>Who are we playing?</div>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onCreate(label); setLabel(""); setShowNew(false); } }}
              placeholder="e.g. vs Central — Week 4" style={inputStyle} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => { onCreate(label); setLabel(""); setShowNew(false); }} style={{ flex: 1, ...solidBtn }}>Start</button>
              <button onClick={() => { setShowNew(false); setLabel(""); }} style={{ flex: 1, ...ghostBtn }}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699" }}>Saved Games · {index.length}</span>
          <button onClick={onRefresh} style={{ background: "none", border: "none", color: "#7a8699", fontSize: 13, cursor: "pointer", fontFamily: FONT_BODY }}>↻ Refresh</button>
        </div>

        {loading ? <div style={{ color: "#4a5568", textAlign: "center", padding: 40 }}>Loading…</div> :
          index.length === 0 ? <div style={{ color: "#4a5568", textAlign: "center", padding: 40, fontSize: 15 }}>No games yet.<br />Tap New Game to start.</div> :
          index.map((g) => (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#11161f", borderRadius: 12, padding: "14px 16px", marginBottom: 8, border: "1px solid #1d2530" }}>
              <button onClick={() => onOpen(g.id)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 17, color: "#f4f4f0" }}>{g.label}</div>
                <div style={{ fontSize: 12, color: "#7a8699", marginTop: 2 }}>{new Date(g.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
              </button>
              {confirmDel === g.id ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { onDelete(g.id); setConfirmDel(null); }} style={{ ...tinyBtn, background: "#ff5252", color: "#fff" }}>Delete</button>
                  <button onClick={() => setConfirmDel(null)} style={{ ...tinyBtn, background: "#2a3543", color: "#c4cdda" }}>No</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDel(g.id)} style={{ background: "none", border: "none", color: "#4a5568", fontSize: 20, cursor: "pointer" }}>×</button>
              )}
            </div>
          ))}
        <div style={{ fontSize: 12, color: "#4a5568", textAlign: "center", marginTop: 20, lineHeight: 1.5 }}>
          Games sync across all devices in real time. Anyone in Edit mode can chart the live game together.
        </div>
      </div>
    </Shell>
  );
}

// =================== SINGLE GAME ===================
function Game({ id, label, onBack }) {
  const [tab, setTab] = useState("log");
  const [mode, setMode] = useState("view");
  const [plays, setPlays] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [personnel, setPersonnel] = useState("");
  const [formation, setFormation] = useState("");
  const [formTags, setFormTags] = useState([]);
  const [position, setPosition] = useState("");
  const [rpoTags, setRpoTags] = useState([]);
  const [motion, setMotion] = useState("None");
  const [hash, setHash] = useState("M");
  const [down, setDown] = useState(1);
  const [distance, setDistance] = useState(10);
  const [play, setPlay] = useState("");
  const [playType, setPlayType] = useState("");
  const [yards, setYards] = useState("");
  const [gainType, setGainType] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [tacklerPos, setTacklerPos] = useState("");
  const [tacklerNum, setTacklerNum] = useState("");

  const editing = mode === "edit";
  const ready = editing && formation && play && (yards !== "" || incomplete);

  const fetchGame = useCallback(async () => {
    try {
      setSyncing(true);
      const { data } = await supabase.from("games").select("plays").eq("id", id).single();
      if (data) setPlays(data.plays || []);
    } catch (e) {}
    setSyncing(false); setLoaded(true);
  }, [id]);

  useEffect(() => { fetchGame(); }, [fetchGame]);

  useEffect(() => {
    const channel = supabase
      .channel(`game-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${id}` },
        (payload) => { setPlays(payload.new.plays || []); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  const persist = useCallback(async (nextPlays) => {
    try { await supabase.from("games").update({ plays: nextPlays }).eq("id", id); }
    catch (e) { console.error(e); }
  }, [id]);

  function toggle(list, setList, val) { setList(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]); }

  const usedCarriers = useMemo(() => { const s = new Set(); plays.forEach((p) => p.carrier && s.add(p.carrier)); return [...s].sort((a, b) => a - b); }, [plays]);
  const usedTacklers = useMemo(() => { const s = new Set(); plays.forEach((p) => p.tacklerNum && s.add(p.tacklerNum)); return [...s].sort((a, b) => a - b); }, [plays]);
  const topTacklers = useMemo(() => { const c = {}; plays.forEach((p) => { if (p.tacklerNum) c[p.tacklerNum] = (c[p.tacklerNum] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3); }, [plays]);
  const defPosMap = useMemo(() => {
    const m = {};
    [...plays].reverse().forEach((p) => { if (p.tacklerNum && p.tacklerPos) m[p.tacklerNum] = p.tacklerPos; });
    return m;
  }, [plays]);
  const defLabel = (num) => (defPosMap[num] ? `${defPosMap[num]} #${num}` : `#${num}`);

  async function logPlay() {
    if (!ready) return;
    const y = incomplete ? 0 : (parseInt(yards, 10) || 0);
    const newPlay = {
      id: Date.now() + Math.random(), personnel: personnel || "—", formation, formTags: [...formTags], position,
      rpoTags: [...rpoTags], motion, hash, down, distance, play, playType, yards: y,
      gainType: incomplete ? "Pass" : gainType, incomplete, carrier: incomplete ? "" : carrier.trim(),
      tacklerPos, tacklerNum: tacklerNum.trim(),
      tackler: tacklerPos || tacklerNum ? `${tacklerPos}${tacklerNum ? " #" + tacklerNum : ""}` : "—",
    };
    const next = [newPlay, ...plays];
    setPlays(next); persist(next);
    const gotFirst = y >= distance;
    if (gotFirst) { setDown(1); setDistance(10); }
    else if (down < 4) { setDown(down + 1); setDistance(Math.max(distance - y, 1)); }
    else { setDown(1); setDistance(10); }
    setPlay(""); setPlayType(""); setYards(""); setGainType(""); setIncomplete(false);
    setCarrier(""); setTacklerPos(""); setTacklerNum(""); setMotion("None"); setFormTags([]); setPosition(""); setRpoTags([]);
  }

  async function deletePlay(pid) { const next = plays.filter((p) => p.id !== pid); setPlays(next); persist(next); }

  function exportCSV() {
    const headers = ["#", "Personnel", "Formation", "Form Tags", "Pos", "RPO", "Motion", "Hash", "Down", "Distance", "Play", "Gain Type", "Yards", "Incomplete", "Ball Carrier", "Tackled By"];
    const ordered = [...plays].reverse();
    const rows = ordered.map((p, i) => [i + 1, p.personnel, p.formation, p.formTags.join(" "), p.position, p.rpoTags.join(" "), p.motion, p.hash, ordinal(p.down), p.distance, p.play, p.gainType || "", p.incomplete ? 0 : p.yards, p.incomplete ? "INC" : "", p.carrier || "", p.tackler]);
    const esc = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `sideline-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const tendencies = useMemo(() => {
    const byPersonnel = {}, byFormation = {}, byPlay = {}, byGain = {}, byDown = {}, byHash = {}, byCarrier = {};
    let totalYards = 0;
    plays.forEach((p) => {
      totalYards += p.yards;
      for (const [obj, k] of [[byPersonnel, p.personnel], [byFormation, p.formation], [byPlay, p.play], [byGain, p.gainType || "—"], [byDown, p.down], [byHash, p.hash]]) {
        (obj[k] ??= { count: 0, yards: 0 }); obj[k].count++; obj[k].yards += p.yards;
      }
      if (p.carrier) {
        const k = `#${p.carrier}`;
        (byCarrier[k] ??= { count: 0, yards: 0 }); byCarrier[k].count++; byCarrier[k].yards += p.yards;
      }
    });
    return { byPersonnel, byFormation, byPlay, byGain, byDown, byHash, byCarrier, totalYards, avg: plays.length ? (totalYards / plays.length).toFixed(1) : "0.0" };
  }, [plays]);

  return (
    <Shell subtitle={label} onBack={onBack}
      right={<span style={{ fontSize: 11, color: syncing ? "#f5c518" : "#3ddc84" }}>{syncing ? "syncing…" : "● live"}</span>}>
      <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid #1d2530" }}>
        <button onClick={() => setMode("view")} style={modeBtn(mode === "view")}>👁 View</button>
        <button onClick={() => setMode("edit")} style={modeBtn(mode === "edit", true)}>✎ Edit</button>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #1d2530" }}>
        {[["log", editing ? "Log Play" : "Plays"], ["tendencies", "Tendencies"], ["export", "Export"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "14px", background: tab === k ? "#141a24" : "transparent", color: tab === k ? "#f5c518" : "#7a8699",
            border: "none", borderBottom: tab === k ? "2px solid #f5c518" : "2px solid transparent",
            fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer",
          }}>{l}</button>
        ))}
      </div>

      {tab === "log" && (
        <div style={{ padding: 16 }}>
          {editing && (
            <>
              <Section label="Hash"><div style={{ display: "flex", gap: 8 }}>{HASHES.map((h) => <Chip key={h} active={hash === h} onClick={() => setHash(h)} big>{h}</Chip>)}</div></Section>
              <Section label="Down & Distance">
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>{[1, 2, 3, 4].map((d) => <Chip key={d} active={down === d} onClick={() => setDown(d)} big>{ordinal(d)}</Chip>)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ color: "#7a8699", fontSize: 14, textTransform: "uppercase", letterSpacing: 1 }}>&amp;</span>
                  <button onClick={() => setDistance(Math.max(distance - 1, 1))} style={stepBtn}>–</button>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 50, textAlign: "center" }}>{distance}</span>
                  <button onClick={() => setDistance(distance + 1)} style={stepBtn}>+</button>
                  <span style={{ color: "#7a8699", fontSize: 13 }}>yds to go</span>
                </div>
              </Section>
              <Section label="Personnel"><Grid>{PERSONNEL.map((p) => <Chip key={p} active={personnel === p} onClick={() => setPersonnel(personnel === p ? "" : p)}>{p}</Chip>)}</Grid></Section>
              <Section label="Formation"><Grid>{FORMATIONS.map((f) => <Chip key={f} active={formation === f} onClick={() => setFormation(f)}>{f}</Chip>)}</Grid></Section>
              <Section label="Formation Tags · tap multiple"><Grid>{FORM_TAGS.map((t) => <Chip key={t} active={formTags.includes(t)} onClick={() => toggle(formTags, setFormTags, t)}>{t}</Chip>)}</Grid></Section>
              <Section label="Shift / Motion"><Grid>{MOTIONS.map((m) => <Chip key={m} active={motion === m} onClick={() => setMotion(m)}>{m}</Chip>)}</Grid></Section>
              <Section label="Run Play"><Grid>{RUN_PLAYS.map((p) => <Chip key={p} active={play === p && playType === "Run"} onClick={() => { setPlay(p); setPlayType("Run"); }}>{p}</Chip>)}</Grid></Section>
              <Section label="Position + RPO Tags · tap multiple">
                <Grid>{POSITIONS.map((p) => <Chip key={p} active={position === p} onClick={() => setPosition(position === p ? "" : p)}>{p}</Chip>)}</Grid>
                <div style={{ marginTop: 10 }}><Grid>{RPO_TAGS.map((t) => <Chip key={t} active={rpoTags.includes(t)} onClick={() => toggle(rpoTags, setRpoTags, t)}>{t}</Chip>)}</Grid></div>
              </Section>
              <Section label="Pass Play"><Grid>{PASS_PLAYS.map((p) => <Chip key={p} active={play === p && playType === "Pass"} onClick={() => { setPlay(p); setPlayType("Pass"); }}>{p}</Chip>)}</Grid></Section>
              <Section label="Result">
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <Chip active={gainType === "Run" && !incomplete} onClick={() => { setGainType("Run"); setIncomplete(false); }} big>Run</Chip>
                  <Chip active={gainType === "Pass" && !incomplete} onClick={() => { setGainType("Pass"); setIncomplete(false); }} big>Pass</Chip>
                  <Chip active={incomplete} onClick={() => { const ni = !incomplete; setIncomplete(ni); if (ni) { setYards(""); setCarrier(""); } }} big>Inc</Chip>
                </div>
                {!incomplete ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button onClick={() => setYards(String((parseInt(yards, 10) || 0) - 1))} style={stepBtn}>–</button>
                    <input value={yards} onChange={(e) => setYards(e.target.value.replace(/[^-0-9]/g, ""))} placeholder="0" inputMode="numeric"
                      style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, width: 90, textAlign: "center", background: "#141a24", border: "1px solid #2a3543", borderRadius: 10, color: "#f5c518", padding: "6px 0" }} />
                    <button onClick={() => setYards(String((parseInt(yards, 10) || 0) + 1))} style={stepBtn}>+</button>
                    <span style={{ color: "#7a8699", fontSize: 13 }}>yards gained</span>
                  </div>
                ) : <div style={{ color: "#ff5252", fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>INCOMPLETE — 0 yards</div>}
              </Section>
              {!incomplete && (
                <Section label="Ball Carrier / Receiver #">
                  {usedCarriers.length > 0 && <Grid>{usedCarriers.map((n) => <Chip key={n} active={carrier === n} onClick={() => setCarrier(carrier === n ? "" : n)}>#{n}</Chip>)}</Grid>}
                  <input value={carrier} onChange={(e) => setCarrier(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Jersey # (type new)" inputMode="numeric" style={{ ...inputStyle, marginTop: usedCarriers.length ? 10 : 0 }} />
                </Section>
              )}
              <Section label="Tackled By (Defender)">
                <Grid>{DEF_POS.map((pos) => <Chip key={pos} active={tacklerPos === pos} onClick={() => setTacklerPos(tacklerPos === pos ? "" : pos)}>{pos}</Chip>)}</Grid>
                {usedTacklers.length > 0 && <div style={{ marginTop: 10 }}><Grid>{usedTacklers.map((n) => <Chip key={n} active={tacklerNum === n} onClick={() => { const sel = tacklerNum === n; setTacklerNum(sel ? "" : n); if (!sel && defPosMap[n]) setTacklerPos(defPosMap[n]); }}>{defLabel(n)}</Chip>)}</Grid></div>}
                <input value={tacklerNum} onChange={(e) => setTacklerNum(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Defender jersey # (type new)" inputMode="numeric" style={{ ...inputStyle, marginTop: 10 }} />
                {topTacklers.length > 0 && (
                  <div style={{ marginTop: 14, background: "#11161f", borderRadius: 10, padding: "12px 14px", border: "1px solid #1d2530" }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Top Tacklers · Opponent</div>
                    {topTacklers.map(([num, ct], i) => (
                      <div key={num} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: ["#f5c518", "#c4cdda", "#cd7f32"][i], fontSize: 16, minWidth: 18 }}>{i + 1}</span>
                        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16 }}>{defLabel(num)}</span>
                        <span style={{ marginLeft: "auto", color: "#a8b3c4", fontSize: 14 }}>{ct} {ct === 1 ? "tackle" : "tackles"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
              <button onClick={logPlay} disabled={!ready} style={{
                width: "100%", marginTop: 8, padding: "18px", borderRadius: 12, border: "none",
                background: ready ? "#f5c518" : "#1d2530", color: ready ? "#0a0e14" : "#4a5568",
                fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", cursor: ready ? "pointer" : "not-allowed",
              }}>Log Play ↵</button>
            </>
          )}
          {!editing && (
            <div style={{ background: "#141a24", borderRadius: 10, padding: "12px 14px", marginBottom: 16, border: "1px solid #1d2530", fontSize: 13, color: "#a8b3c4" }}>
              View mode — watching the live game. Switch to Edit to chart plays.
            </div>
          )}
          {plays.length > 0 && (
            <div style={{ marginTop: editing ? 24 : 0 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 10 }}>Play Log · {plays.length}</div>
              {plays.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${p.incomplete ? "#ff5252" : p.yards >= p.distance ? "#3ddc84" : p.yards < 0 ? "#ff5252" : "#f5c518"}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15 }}>{ordinal(p.down)} &amp; {p.distance} · {p.hash} · {p.personnel} {p.formation}{p.formTags.length ? ` ${p.formTags.join(" ")}` : ""}</div>
                    <div style={{ fontSize: 13, color: "#a8b3c4", marginTop: 2 }}>{p.play}{p.position || p.rpoTags.length ? ` · ${p.position ? p.position + " " : ""}${p.rpoTags.join("/")}` : ""}{p.motion !== "None" ? ` · ${p.motion}` : ""}{p.carrier ? ` · #${p.carrier}` : ""} · tkl {p.tackler}</div>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: p.incomplete ? "#ff5252" : p.yards >= p.distance ? "#3ddc84" : p.yards < 0 ? "#ff5252" : "#f5c518", minWidth: 44, textAlign: "right" }}>{p.incomplete ? "INC" : `${p.yards > 0 ? "+" : ""}${p.yards}`}</div>
                  {editing && <button onClick={() => deletePlay(p.id)} style={{ background: "none", border: "none", color: "#4a5568", fontSize: 20, cursor: "pointer", padding: "0 4px" }}>×</button>}
                </div>
              ))}
            </div>
          )}
          {loaded && plays.length === 0 && !editing && <div style={{ color: "#4a5568", textAlign: "center", padding: 30, fontSize: 15 }}>No plays logged yet.</div>}
        </div>
      )}

      {tab === "tendencies" && (
        <div style={{ padding: 16 }}>
          {plays.length === 0 ? <div style={{ textAlign: "center", color: "#4a5568", padding: "60px 20px", fontSize: 15 }}>No plays logged yet.</div> : (
            <>
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                <Stat label="Plays" value={plays.length} /><Stat label="Total Yds" value={tendencies.totalYards} /><Stat label="Yds / Play" value={tendencies.avg} accent />
              </div>
              <Breakdown title="Run vs Pass" data={tendencies.byGain} total={plays.length} />
              <Breakdown title="By Personnel" data={tendencies.byPersonnel} total={plays.length} />
              <Breakdown title="By Formation" data={tendencies.byFormation} total={plays.length} />
              <Breakdown title="By Play Call" data={tendencies.byPlay} total={plays.length} />
              <Breakdown title="By Hash" data={tendencies.byHash} total={plays.length} />
              <Breakdown title="By Down" data={tendencies.byDown} total={plays.length} keyFmt={ordinal} />
              <CarrierBreakdown data={tendencies.byCarrier} />
            </>
          )}
        </div>
      )}

      {tab === "export" && (
        <div style={{ padding: 16 }}>
          <div style={{ background: "#11161f", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #1d2530" }}>
            <div style={{ fontSize: 14, color: "#a8b3c4", lineHeight: 1.5 }}>{plays.length} plays in <b style={{ color: "#f4f4f0" }}>{label}</b>. Downloads as a CSV you can open in Excel or Sheets and send to your staff.</div>
          </div>
          <button onClick={exportCSV} disabled={plays.length === 0} style={{
            width: "100%", padding: "18px", borderRadius: 12, border: "none", background: plays.length ? "#3ddc84" : "#1d2530", color: plays.length ? "#0a0e14" : "#4a5568",
            fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", cursor: plays.length ? "pointer" : "not-allowed",
          }}>↓ Download Spreadsheet (CSV)</button>
        </div>
      )}
    </Shell>
  );
}

// =================== SHARED UI ===================
function Shell({ children, subtitle, onBack, right }) {
  return (
    <div style={{ fontFamily: FONT_BODY, background: "#0a0e14", minHeight: "100vh", color: "#f4f4f0", paddingBottom: 40 }}>
      <div style={{ background: "linear-gradient(180deg,#11161f,#0a0e14)", borderBottom: "3px solid #f5c518", padding: "16px 16px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {onBack && <button onClick={onBack} style={{ background: "none", border: "none", color: "#f5c518", fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1 }}>‹</button>}
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>Side<span style={{ color: "#f5c518" }}>line</span></div>
            <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginTop: 1 }}>{subtitle}</div>
          </div>
          {right}
        </div>
      </div>
      {children}
    </div>
  );
}

function ordinal(n) { return ["", "1st", "2nd", "3rd", "4th"][n] || n + "th"; }
const stepBtn = { width: 46, height: 46, borderRadius: 10, border: "1px solid #2a3543", background: "#141a24", color: "#f4f4f0", fontSize: 24, fontWeight: 700, cursor: "pointer", lineHeight: 1 };
const inputStyle = { width: "100%", boxSizing: "border-box", background: "#141a24", border: "1px solid #2a3543", borderRadius: 10, color: "#f4f4f0", padding: "14px", fontSize: 16, fontFamily: FONT_BODY };
const solidBtn = { padding: "12px", borderRadius: 10, border: "none", background: "#f5c518", color: "#0a0e14", fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" };
const ghostBtn = { padding: "12px", borderRadius: 10, border: "1px solid #2a3543", background: "transparent", color: "#c4cdda", fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" };
const tinyBtn = { padding: "8px 12px", borderRadius: 8, border: "none", fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600, cursor: "pointer" };
function modeBtn(active, edit?) {
  return { flex: 1, padding: "12px", borderRadius: 10, border: active ? `1px solid ${edit ? "#f5c518" : "#3ddc84"}` : "1px solid #2a3543",
    background: active ? (edit ? "#f5c518" : "#3ddc84") : "#141a24", color: active ? "#0a0e14" : "#7a8699",
    fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" };
}
function Section({ label, children }) {
  return (<div style={{ marginBottom: 20 }}>
    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 10 }}>{label}</div>
    {children}
  </div>);
}
function Grid({ children }) { return <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{children}</div>; }
function Chip({ children, active, onClick, big }) {
  return (<button onClick={onClick} style={{
    padding: big ? "14px 0" : "11px 16px", flex: big ? 1 : "0 0 auto", borderRadius: 10,
    border: active ? "1px solid #f5c518" : "1px solid #2a3543", background: active ? "#f5c518" : "#141a24", color: active ? "#0a0e14" : "#c4cdda",
    fontFamily: FONT_DISPLAY, fontSize: big ? 18 : 14, fontWeight: 600, letterSpacing: 0.5, cursor: "pointer",
  }}>{children}</button>);
}
function Stat({ label, value, accent }) {
  return (<div style={{ flex: 1, background: "#11161f", borderRadius: 12, padding: "14px 10px", textAlign: "center", border: accent ? "1px solid #f5c518" : "1px solid #1d2530" }}>
    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, color: accent ? "#f5c518" : "#f4f4f0" }}>{value}</div>
    <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#7a8699", marginTop: 2 }}>{label}</div>
  </div>);
}
function Breakdown({ title, data, total, keyFmt = (x) => x }) {
  const rows = Object.entries(data).sort((a, b) => b[1].count - a[1].count);
  const max = Math.max(...rows.map(([, v]) => v.count), 1);
  return (<div style={{ marginBottom: 26 }}>
    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 12 }}>{title}</div>
    {rows.map(([k, v]) => {
      const pct = Math.round((v.count / total) * 100); const avg = (v.yards / v.count).toFixed(1);
      return (<div key={k} style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 5 }}>
          <span style={{ fontWeight: 600 }}>{keyFmt(k)}</span>
          <span style={{ color: "#a8b3c4" }}>{v.count} ({pct}%) · <span style={{ color: "#f5c518" }}>{avg} yds</span></span>
        </div>
        <div style={{ height: 8, background: "#11161f", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${(v.count / max) * 100}%`, height: "100%", background: "linear-gradient(90deg,#f5c518,#d4a800)", borderRadius: 4 }} />
        </div>
      </div>);
    })}
  </div>);
}
function CarrierBreakdown({ data }) {
  const rows = Object.entries(data).sort((a, b) => b[1].yards - a[1].yards);
  if (rows.length === 0) return null;
  const maxYds = Math.max(...rows.map(([, v]) => Math.abs(v.yards)), 1);
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 12 }}>By Ball Carrier</div>
      <div style={{ display: "flex", padding: "0 4px 8px", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#4a5568", borderBottom: "1px solid #1d2530", marginBottom: 10 }}>
        <span style={{ flex: 1 }}>Player</span><span style={{ width: 60, textAlign: "right" }}>Touches</span>
        <span style={{ width: 70, textAlign: "right" }}>Yards</span><span style={{ width: 50, textAlign: "right" }}>Avg</span>
      </div>
      {rows.map(([k, v]) => {
        const avg = (v.yards / v.count).toFixed(1);
        return (
          <div key={k} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", fontSize: 14, marginBottom: 5 }}>
              <span style={{ flex: 1, fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16 }}>{k}</span>
              <span style={{ width: 60, textAlign: "right", color: "#a8b3c4" }}>{v.count}</span>
              <span style={{ width: 70, textAlign: "right", color: "#f5c518", fontWeight: 700, fontFamily: FONT_DISPLAY }}>{v.yards}</span>
              <span style={{ width: 50, textAlign: "right", color: "#a8b3c4" }}>{avg}</span>
            </div>
            <div style={{ height: 6, background: "#11161f", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${(Math.max(v.yards, 0) / maxYds) * 100}%`, height: "100%", background: "linear-gradient(90deg,#f5c518,#d4a800)", borderRadius: 4 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
