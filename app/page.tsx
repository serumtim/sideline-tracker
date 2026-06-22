"use client";
// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, rectSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const HASHES = ["L", "M", "R"];
const DEF_POS = ["DL", "LB", "CB", "S", "DB", "EDGE"];

const DEFAULT_PLAYBOOK = {
  personnel: ["Tiger", "Grizzly", "Cheetah"],
  formations: ["Red", "Blue", "Green", "Yellow", "Brown", "Black"],
  formTags: ["Over", "Flop", "Strong", "Trips", "Loose", "Empty"],
  positions: ["X", "Y", "A", "B", "F"],
  rpoTags: ["Pop", "Peak"],
  motions: ["Jet", "Orbit", "Z-Motion", "Shift", "Across", "Return"],
  runPlays: ["Buck", "Power", "Trojan", "Counter", "Jet", "Belly", "Trap", "ISO"],
  passPlays: ["Snag", "Stick", "Vert", "Flood", "Waggle", "Pig", "Smash", "Hitches"],
  sections: {
    personnel: true, formTags: true, motion: true, rpo: true, carrier: true, tackler: true,
  },
  // Defensive — opponent's offense
  oppPersonnel: ["11", "12", "21", "22", "Jumbo"],
  oppFormations: ["Spread", "Pro", "Shotgun", "I-Form", "Pistol"],
  oppFormTags: ["Over", "Under", "Trips", "Empty", "Bunch"],
  oppMotions: ["Jet", "Orbit", "Shift"],
  oppRunPlays: ["Inside Zone", "Outside Zone", "Counter", "Power", "Toss"],
  oppPassPlays: ["RPO", "Screen", "Quick Game", "Dropback", "PA"],
  // Defensive — our calls
  defFronts: ["4-3", "3-4", "4-4", "Bear", "Nickel", "Dime"],
  defCoverages: ["Cover 0", "Cover 1", "Cover 2", "Cover 3", "Cover 4", "Man", "Zone"],
  defBlitz: ["None", "A-Gap", "B-Gap", "Edge", "Corner", "Safety"],
  fieldBdry: ["Field", "Boundary", "Middle"],
  penalties: ["Holding", "False Start", "Offside", "Encroachment", "Pass Interference", "Personal Foul", "Illegal Procedure", "Delay of Game"],
  driveOutcomes: ["Touchdown", "Field Goal", "Missed FG", "Punt", "Turnover on Downs", "Interception", "Fumble", "Blocked Punt", "Blocked FG", "Safety", "End of Half", "End of Game"],
  defSections: {
    oppPersonnel: true, oppFormTags: true, oppMotion: true,
    defFront: true, defCoverage: true, defBlitz: true,
    carrier: true, tackler: true, fieldBdry: true,
  },
};

const DEFAULT_SECTION_ORDER = ["hash", "downDistance", "personnel", "formation", "formTags", "motion", "runPlay", "rpoTags", "passPlay", "result", "carrier", "tackler"];
const DEFAULT_LAYOUT = { sectionOrder: [...DEFAULT_SECTION_ORDER], chipOrder: {} };

const SECTION_LABELS = {
  hash: "Hash", downDistance: "Down & Distance", personnel: "Personnel",
  formation: "Formation", formTags: "Formation Tags", motion: "Shift / Motion",
  runPlay: "Run Play", rpoTags: "RPO Tags", passPlay: "Pass Play",
  result: "Result", carrier: "Ball Carrier", tackler: "Tackled By",
};

const DEFAULT_DEF_SECTION_ORDER = ["hash", "fieldBdry", "downDistance", "oppPersonnel", "oppFormation", "oppFormTags", "oppMotion", "oppRunPlay", "oppPassPlay", "result", "defFront", "defCoverage", "defBlitz", "carrier", "tackler"];
const DEFAULT_DEF_LAYOUT = { sectionOrder: [...DEFAULT_DEF_SECTION_ORDER], chipOrder: {} };

const DEF_SECTION_LABELS = {
  hash: "Hash", fieldBdry: "Field / Boundary", downDistance: "Down & Distance",
  oppPersonnel: "Their Personnel", oppFormation: "Their Formation", oppFormTags: "Their Formation Tags",
  oppMotion: "Their Motion", oppRunPlay: "Their Run Play", oppPassPlay: "Their Pass Play",
  result: "Result", defFront: "Our Front", defCoverage: "Our Coverage",
  defBlitz: "Blitz Tag", carrier: "Their Ball Carrier #", tackler: "Our Tackler",
};

function mergeLayout(saved) {
  let result;
  if (saved && (saved.offense !== undefined || saved.defense !== undefined)) {
    result = {
      offense: { ...DEFAULT_LAYOUT, ...saved.offense },
      defense: { ...DEFAULT_DEF_LAYOUT, ...saved.defense },
    };
  } else {
    result = { offense: { ...DEFAULT_LAYOUT, ...(saved || {}) }, defense: DEFAULT_DEF_LAYOUT };
  }
  if (saved?.fpDisplayMode) result.fpDisplayMode = saved.fpDisplayMode;
  return result;
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

const FONT_DISPLAY = "'Oswald', 'Arial Narrow', sans-serif";
const FONT_BODY = "'Barlow', system-ui, sans-serif";

function calcTendencies(plays) {
  const byPersonnel = {}, byFormation = {}, byPlay = {}, byGain = {}, byDown = {}, byHash = {}, byCarrier = {};
  let totalYards = 0, playCount = 0;
  plays.forEach((p) => {
    if (p.type === "punt") return;
    playCount++;
    totalYards += p.yards;
    const playLabel = p.gainType === "Sack" ? (p.play || "Sack") : (p.runCarrier && p.playType === "Run") ? `${p.runCarrier} ${p.play}` : (p.play || "—");
    for (const [obj, k] of [[byPersonnel, p.personnel], [byFormation, p.formation], [byPlay, playLabel], [byGain, p.gainType || "—"], [byDown, p.down], [byHash, p.hash]]) {
      (obj[k] ??= { count: 0, yards: 0 }); obj[k].count++; obj[k].yards += p.yards;
    }
    if (p.carrier) {
      const k = `#${p.carrier}`;
      (byCarrier[k] ??= { count: 0, yards: 0 }); byCarrier[k].count++; byCarrier[k].yards += p.yards;
    }
  });
  return { byPersonnel, byFormation, byPlay, byGain, byDown, byHash, byCarrier, totalYards, avg: playCount ? (totalYards / playCount).toFixed(1) : "0.0" };
}

function calcDefTendencies(plays) {
  const byPersonnel = {}, byFormation = {}, byPlay = {}, byGain = {}, byDown = {}, byHash = {}, byCarrier = {}, byFront = {}, byCoverage = {}, byBlitz = {}, byFieldBdry = {};
  let totalYards = 0;
  plays.forEach((p) => {
    totalYards += p.yards;
    for (const [obj, k] of [
      [byPersonnel, p.oppPersonnel || "—"], [byFormation, p.oppFormation || "—"],
      [byPlay, p.play || "—"], [byGain, p.gainType || "—"],
      [byDown, p.down], [byHash, p.hash],
      [byFront, p.front || "—"], [byCoverage, p.coverage || "—"],
      [byBlitz, p.blitz || "None"], [byFieldBdry, p.fieldBdry || "—"],
    ]) {
      (obj[k] ??= { count: 0, yards: 0 }); obj[k].count++; obj[k].yards += p.yards;
    }
    if (p.carrier) {
      const k = `#${p.carrier}`;
      (byCarrier[k] ??= { count: 0, yards: 0 }); byCarrier[k].count++; byCarrier[k].yards += p.yards;
    }
  });
  return { byPersonnel, byFormation, byPlay, byGain, byDown, byHash, byCarrier, byFront, byCoverage, byBlitz, byFieldBdry, totalYards, avg: plays.length ? (totalYards / plays.length).toFixed(1) : "0.0" };
}

// =================== FIELD POSITION HELPERS ===================
// Internal storage: ytdg = abs = yards from OUR own end zone (1–99).
// Own X = abs X (X yards from our EZ, X < 50).
// Opp X = abs (100-X) (X yards from their EZ, abs > 50).
// Offense gains INCREASE abs. Defense (opponent) gains DECREASE abs.
// Own/Opp display: abs < 50 → "Own {abs}", abs > 50 → "Opp {100-abs}", abs == 50 → "50"
// ±50 display:     abs > 50 → "+{abs-50}", abs < 50 → "−{50-abs}", abs == 50 → "50"
function ytdgLabel(n, mode) {
  if (n === null || n === undefined) return null;
  if (n === 50) return "50";
  if (mode === "pm50") {
    if (n > 50) return `+${n - 50}`;
    return `−${50 - n}`;
  }
  if (n < 50) return `Own ${n}`;
  return `Opp ${100 - n}`;
}
// Max distance cap: on offense 1st & Goal when abs >= 90 (≤ Opp 10); on defense when abs ≤ 10 (≤ Own 10)
function ytdgMaxDist(n, side) {
  if (n == null) return 99;
  if (side === "offense") return n >= 90 ? 100 - n : 99;
  return n <= 10 ? n : 99;
}
function fpLabel(pos, mode) {
  // Handles both old {territory,yard} format (legacy plays) and new ytdg number format
  if (pos === null || pos === undefined) return null;
  if (typeof pos === "number") return ytdgLabel(pos, mode);
  if (pos.territory === "50") return "50";
  return `${pos.territory === "own" ? "Own" : "Opp"} ${pos.yard}`;
}
// Keep for migration of old game_state.ballPosition objects
function fpToAbs(pos) {
  if (!pos || typeof pos !== "object") return null;
  if (pos.territory === "50") return 50;
  if (pos.territory === "own") return pos.yard;
  return 100 - pos.yard;
}

// =================== ROOT ===================
export default function PlayTracker() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  // undefined = still loading profile, null = loaded but no profile, object = loaded profile
  const [profile, setProfile] = useState(undefined);
  const [screen, setScreen] = useState("games");
  const [gamesIndex, setGamesIndex] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [playbook, setPlaybook] = useState(DEFAULT_PLAYBOOK);
  const [layout, setLayout] = useState({ offense: DEFAULT_LAYOUT, defense: DEFAULT_DEF_LAYOUT });

  const isHeadCoach = profile?.role !== "assistant";
  const canEditPlaybook = isHeadCoach || profile?.can_edit_playbook === true;

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

  async function fetchPlaybook(prof, uid) {
    const targetId = prof?.role === "assistant" && prof?.team_id ? prof.team_id : uid;
    if (!targetId) return;
    const { data } = await supabase.from("playbooks").select("data").eq("user_id", targetId).maybeSingle();
    if (data?.data) setPlaybook({ ...DEFAULT_PLAYBOOK, ...data.data });
  }

  async function fetchLayout(prof, uid) {
    const targetId = prof?.role === "assistant" && prof?.team_id ? prof.team_id : uid;
    if (!targetId) return;
    try {
      const { data } = await supabase.from("team_layout").select("layout").eq("user_id", targetId).maybeSingle();
      if (data?.layout) setLayout(mergeLayout(data.layout));
    } catch { /* table may not exist yet */ }
  }

  async function saveLayout(data) {
    if (!canEditPlaybook) return;
    const targetId = profile.role === "assistant" ? profile.team_id : user.id;
    try {
      await supabase.from("team_layout").upsert({ user_id: targetId, layout: data, updated_at: new Date().toISOString() });
      setLayout(data);
    } catch (e) { console.error("saveLayout failed:", e?.message); }
  }

  async function initUser(u) {
    setUser(u);
    setProfile(undefined);
    const { data: prof } = await supabase.from("profiles").select("*").eq("user_id", u.id).maybeSingle();
    setProfile(prof);
    loadIndex();
    fetchPlaybook(prof, u.id);
    fetchLayout(prof, u.id);
  }

  // Called by AuthScreen after a successful sign-up (profile already created)
  function handleSignedUp(u, prof) {
    setUser(u);
    setProfile(prof);
    setAuthLoading(false);
    loadIndex();
    fetchPlaybook(prof, u.id);
    fetchLayout(prof, u.id);
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user: u } }) => {
      if (u) await initUser(u);
      else setProfile(null);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        await initUser(session.user);
      } else if (event === "SIGNED_OUT") {
        setUser(null); setProfile(null); setPlaybook(DEFAULT_PLAYBOOK); setLayout({ offense: DEFAULT_LAYOUT, defense: DEFAULT_DEF_LAYOUT });
        setGamesIndex([]); setScreen("games"); setActiveId(null); setLoadingIndex(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.id || !profile) return;
    const targetId = profile?.role === "assistant" && profile?.team_id ? profile.team_id : user.id;
    const channel = supabase
      .channel(`layout-${targetId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_layout", filter: `user_id=eq.${targetId}` },
        (payload) => { if (payload.new?.layout) setLayout(mergeLayout(payload.new.layout)); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, profile?.role, profile?.team_id]);

  async function createGame(label) {
    if (!isHeadCoach) return;
    const { data, error } = await supabase
      .from("games")
      .insert({ label: label.trim() || "Untitled Game", offensive_plays: [], defensive_plays: [], user_id: user.id })
      .select("id, label, created_at")
      .single();
    if (error || !data) { console.error("createGame failed:", error?.message); return; }
    setGamesIndex((prev) => [data, ...prev]);
    setActiveId(data.id); setScreen("game");
  }

  async function deleteGame(id) {
    if (!isHeadCoach) return;
    await supabase.from("games").delete().eq("id", id);
    setGamesIndex((prev) => prev.filter((g) => g.id !== id));
  }

  async function savePlaybook(data) {
    if (!canEditPlaybook) return;
    const targetId = profile.role === "assistant" ? profile.team_id : user.id;
    const { error } = await supabase.from("playbooks").upsert({
      user_id: targetId, data, updated_at: new Date().toISOString(),
    });
    if (!error) setPlaybook(data);
  }

  async function signOut() { await supabase.auth.signOut(); }

  if (authLoading || profile === undefined) return <LoadingScreen />;
  if (!user) return <AuthScreen onSignedUp={handleSignedUp} />;
  if (!profile) return (
    <SetupScreen userId={user.id} userEmail={user.email || ""} onDone={(prof) => {
      setProfile(prof); fetchPlaybook(prof, user.id); fetchLayout(prof, user.id);
    }} />
  );

  if (screen === "staff" && isHeadCoach) return (
    <StaffScreen profile={profile} onBack={() => setScreen("games")} />
  );
  if (screen === "reports") return (
    <ReportsScreen index={gamesIndex} onBack={() => setScreen("games")} />
  );
  if (screen === "playbook" && canEditPlaybook) return (
    <PlaybookEditor playbook={playbook} onSave={savePlaybook} layout={layout} onSaveLayout={saveLayout} onBack={() => setScreen("games")} />
  );
  if (screen === "games") return (
    <GamesList
      index={gamesIndex} loading={loadingIndex} onRefresh={loadIndex}
      onOpen={(id) => { setActiveId(id); setScreen("game"); }}
      onCreate={createGame} onDelete={deleteGame}
      onSignOut={signOut}
      isHeadCoach={isHeadCoach}
      canEditPlaybook={canEditPlaybook}
      profile={profile}
      onEditPlaybook={() => setScreen("playbook")}
      onViewStaff={() => setScreen("staff")}
      onViewReports={() => setScreen("reports")}
    />
  );

  const active = gamesIndex.find((g) => g.id === activeId);
  return (
    <Game id={activeId} label={active?.label || "Game"} gameDate={active?.created_at || null} playbook={playbook} layout={layout}
      isHeadCoach={isHeadCoach}
      onBack={() => { setScreen("games"); loadIndex(); }} />
  );
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
function AuthScreen({ onSignedUp }) {
  const [tab, setTab] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [school, setSchool] = useState("");
  const [state, setState] = useState("");
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email || !password) { setMessage({ text: "Email and password are required.", error: true }); return; }
    if (tab === "signup" && !school.trim()) { setMessage({ text: "School name is required.", error: true }); return; }
    setLoading(true); setMessage(null);

    if (tab === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setMessage({ text: error.message, error: true }); setLoading(false); }
      // success: onAuthStateChange in PlayTracker handles the rest
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) { setMessage({ text: error.message, error: true }); setLoading(false); return; }
      const uid = data.user?.id;
      if (!uid) { setMessage({ text: "Signup succeeded but no user ID — try signing in.", error: true }); setLoading(false); return; }
      const token = crypto.randomUUID();
      await supabase.from("profiles").upsert({
        user_id: uid, email: email.trim(), school: school.trim(), state, role: "head_coach", invite_token: token,
      });
      onSignedUp(data.user, { user_id: uid, email: email.trim(), school: school.trim(), state, role: "head_coach", invite_token: token });
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
        {tab === "signup" && (
          <>
            <Section label="School Name">
              <input value={school} onChange={(e) => setSchool(e.target.value)}
                placeholder="e.g. Central High School" style={inputStyle} />
            </Section>
            <Section label="State">
              <select value={state} onChange={(e) => setState(e.target.value)} style={{ ...inputStyle, appearance: "none" }}>
                <option value="">Select state…</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Section>
          </>
        )}
        {message && (
          <div style={{ borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13,
            background: message.error ? "#1d1015" : "#0d1a12",
            border: `1px solid ${message.error ? "#ff5252" : "#3ddc84"}`,
            color: message.error ? "#ff8a80" : "#3ddc84" }}>{message.text}</div>
        )}
        <button onClick={handleSubmit} disabled={loading} style={{
          width: "100%", padding: "18px", borderRadius: 12, border: "none",
          background: loading ? "#1d2530" : "#f5c518", color: loading ? "#4a5568" : "#0a0e14",
          fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, letterSpacing: 1.5,
          textTransform: "uppercase", cursor: loading ? "not-allowed" : "pointer",
        }}>{loading ? "Loading…" : tab === "signin" ? "Sign In" : "Create Account"}</button>
      </div>
    </Shell>
  );
}

// =================== SETUP (existing accounts without a profile) ===================
function SetupScreen({ userId, userEmail, onDone }) {
  const [school, setSchool] = useState("");
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!school.trim()) { setError("School name is required."); return; }
    setSaving(true);
    const token = crypto.randomUUID();
    const { data, error: upsertError } = await supabase.from("profiles").upsert({
      user_id: userId, email: userEmail, school: school.trim(), state, role: "head_coach", invite_token: token,
    }, { onConflict: "user_id" }).select().single();
    if (upsertError) {
      console.error("Profile save failed:", upsertError.message, upsertError.code, upsertError.details);
      setError(`Error: ${upsertError.message}`);
      setSaving(false);
      return;
    }
    if (data) onDone(data);
    else { setError("Something went wrong. Try again."); setSaving(false); }
  }

  return (
    <Shell subtitle="Set Up Your Profile">
      <div style={{ padding: 24, maxWidth: 420, margin: "0 auto" }}>
        <div style={{ background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 24, border: "1px solid #1d2530", fontSize: 13, color: "#a8b3c4" }}>
          One quick step — tell us about your program so your staff can find you.
        </div>
        <Section label="School Name">
          <input value={school} onChange={(e) => setSchool(e.target.value)}
            placeholder="e.g. Central High School" style={inputStyle} />
        </Section>
        <Section label="State">
          <select value={state} onChange={(e) => setState(e.target.value)} style={{ ...inputStyle, appearance: "none" }}>
            <option value="">Select state…</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Section>
        {error && <div style={{ color: "#ff8a80", fontSize: 13, marginBottom: 16 }}>{error}</div>}
        <button onClick={handleSave} disabled={saving} style={{
          width: "100%", padding: "18px", borderRadius: 12, border: "none",
          background: saving ? "#1d2530" : "#f5c518", color: saving ? "#4a5568" : "#0a0e14",
          fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, letterSpacing: 1.5,
          textTransform: "uppercase", cursor: saving ? "not-allowed" : "pointer",
        }}>{saving ? "Saving…" : "Save & Continue"}</button>
      </div>
    </Shell>
  );
}

// =================== STAFF SCREEN ===================
function StaffScreen({ profile, onBack }) {
  const [copied, setCopied] = useState(false);
  const [staff, setStaff] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [toggling, setToggling] = useState(null);

  const inviteUrl = typeof window !== "undefined"
    ? `${window.location.origin}/join?token=${profile.invite_token}`
    : "";

  useEffect(() => {
    supabase.from("profiles")
      .select("user_id, email, can_edit_playbook")
      .eq("team_id", profile.user_id)
      .then(({ data }) => { setStaff(data || []); setLoadingStaff(false); });
  }, [profile.user_id]);

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function togglePlaybook(assistantId, current) {
    setToggling(assistantId);
    const { error } = await supabase.from("profiles")
      .update({ can_edit_playbook: !current })
      .eq("user_id", assistantId);
    if (!error) {
      setStaff((prev) => prev.map((s) =>
        s.user_id === assistantId ? { ...s, can_edit_playbook: !current } : s
      ));
    }
    setToggling(null);
  }

  return (
    <Shell subtitle="Staff Access" onBack={onBack}>
      <div style={{ padding: 16 }}>
        <div style={{ background: "#11161f", borderRadius: 12, padding: 16, marginBottom: 20, border: "1px solid #1d2530" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 6 }}>Your Program</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700 }}>{profile.school || "—"}</div>
          {profile.state && <div style={{ fontSize: 13, color: "#7a8699", marginTop: 2 }}>{profile.state}</div>}
        </div>

        <Section label="Invite Link — text or email this to your staff">
          <div style={{ background: "#141a24", border: "1px solid #2a3543", borderRadius: 10, padding: "12px 14px", fontSize: 12, color: "#a8b3c4", wordBreak: "break-all", marginBottom: 10, fontFamily: FONT_BODY }}>
            {inviteUrl}
          </div>
          <button onClick={copyLink} style={{ ...solidBtn, width: "100%", padding: "16px" }}>
            {copied ? "✓ Copied to clipboard!" : "Copy Invite Link"}
          </button>
        </Section>

        <Section label={`Staff · ${loadingStaff ? "…" : staff.length} connected`}>
          {loadingStaff ? (
            <div style={{ color: "#4a5568", fontSize: 14 }}>Loading…</div>
          ) : staff.length === 0 ? (
            <div style={{ color: "#4a5568", fontSize: 14, padding: "8px 0" }}>No staff connected yet. Share the invite link above.</div>
          ) : staff.map((s) => (
            <div key={s.user_id} style={{ background: "#141a24", border: "1px solid #2a3543", borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16 }}>
                    {s.email || "Assistant Coach"}
                  </div>
                  <div style={{ fontSize: 12, color: "#7a8699", marginTop: 2 }}>Assistant · {profile.school}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#11161f", borderRadius: 10, padding: "12px 14px" }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, letterSpacing: 0.5 }}>Can Edit Playbook</div>
                  <div style={{ fontSize: 12, color: "#7a8699", marginTop: 2 }}>
                    {s.can_edit_playbook ? "Enabled — this coach can add and remove plays" : "Disabled — view only"}
                  </div>
                </div>
                <button
                  onClick={() => togglePlaybook(s.user_id, s.can_edit_playbook)}
                  disabled={toggling === s.user_id}
                  style={{
                    width: 52, height: 30, borderRadius: 15, border: "none", cursor: "pointer",
                    background: s.can_edit_playbook ? "#f5c518" : "#2a3543",
                    position: "relative", transition: "background 0.2s", flexShrink: 0, marginLeft: 16,
                    opacity: toggling === s.user_id ? 0.6 : 1,
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", background: "#fff",
                    position: "absolute", top: 4,
                    left: s.can_edit_playbook ? 26 : 4,
                    transition: "left 0.2s",
                  }} />
                </button>
              </div>
            </div>
          ))}
        </Section>
      </div>
    </Shell>
  );
}

// =================== REPORTS ===================
function ReportsScreen({ index, onBack }) {
  const [selected, setSelected] = useState(new Set());
  const [view, setView] = useState("select");
  const [reportGames, setReportGames] = useState([]);
  const [loading, setLoading] = useState(false);

  function toggleGame(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(index.map((g) => g.id))); }
  function clearAll() { setSelected(new Set()); }

  async function generate() {
    if (selected.size === 0) return;
    setLoading(true);
    const { data } = await supabase.from("games").select("id, label, created_at, offensive_plays, defensive_plays").in("id", [...selected]);
    setReportGames(data || []);
    setView("report");
    setLoading(false);
  }

  if (view === "report") {
    return <MultiGameReport games={reportGames} onBack={() => setView("select")} />;
  }

  return (
    <Shell subtitle="Reports" onBack={onBack}>
      <div style={{ padding: 16 }}>
        <div style={{ background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 16, border: "1px solid #1d2530", fontSize: 13, color: "#a8b3c4" }}>
          Select one or more games to build a combined tendencies report.
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699" }}>
            {selected.size} of {index.length} selected
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={selectAll} style={{ background: "none", border: "none", color: "#f5c518", fontSize: 13, cursor: "pointer", fontFamily: FONT_BODY }}>All</button>
            <button onClick={clearAll} style={{ background: "none", border: "none", color: "#7a8699", fontSize: 13, cursor: "pointer", fontFamily: FONT_BODY }}>Clear</button>
          </div>
        </div>

        {index.length === 0 ? (
          <div style={{ color: "#4a5568", textAlign: "center", padding: 40, fontSize: 15 }}>No games yet.</div>
        ) : index.map((g) => {
          const on = selected.has(g.id);
          return (
            <button key={g.id} onClick={() => toggleGame(g.id)} style={{
              display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left",
              background: on ? "#141a24" : "#11161f",
              border: `1px solid ${on ? "#f5c518" : "#1d2530"}`,
              borderRadius: 12, padding: "14px 16px", marginBottom: 8, cursor: "pointer",
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: 6, border: `2px solid ${on ? "#f5c518" : "#2a3543"}`,
                background: on ? "#f5c518" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {on && <span style={{ color: "#0a0e14", fontSize: 14, fontWeight: 700, lineHeight: 1 }}>✓</span>}
              </div>
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 17, color: "#f4f4f0" }}>{g.label}</div>
                <div style={{ fontSize: 12, color: "#7a8699", marginTop: 2 }}>{new Date(g.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
              </div>
            </button>
          );
        })}

        <button onClick={generate} disabled={selected.size === 0 || loading} style={{
          width: "100%", marginTop: 12, padding: "18px", borderRadius: 12, border: "none",
          background: selected.size > 0 ? "#f5c518" : "#1d2530",
          color: selected.size > 0 ? "#0a0e14" : "#4a5568",
          fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: 1.5,
          textTransform: "uppercase", cursor: selected.size > 0 ? "pointer" : "not-allowed",
        }}>{loading ? "Building…" : `Generate Report · ${selected.size} Game${selected.size === 1 ? "" : "s"}`}</button>
      </div>
    </Shell>
  );
}

function MultiGameReport({ games, onBack }) {
  const [reportSide, setReportSide] = useState("offense");
  const allOffPlays = games.flatMap((g) => g.offensive_plays || []);
  const allDefPlays = games.flatMap((g) => g.defensive_plays || []);
  const tendencies = calcTendencies(allOffPlays);
  const defTendencies = calcDefTendencies(allDefPlays);

  const gameRows = games
    .map((g) => {
      const plays = g.offensive_plays || [];
      const yards = plays.reduce((s, p) => s + (p.yards || 0), 0);
      return { label: g.label, date: g.created_at, count: plays.length, yards, avg: plays.length ? (yards / plays.length).toFixed(1) : "0.0" };
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  return (
    <Shell subtitle={`Report · ${games.length} Game${games.length === 1 ? "" : "s"}`} onBack={onBack}>
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={() => setReportSide("offense")} style={modeBtn(reportSide === "offense", true)}>Offense</button>
          <button onClick={() => setReportSide("defense")} style={modeBtn(reportSide === "defense")}>Defense</button>
        </div>

        <Section label="Games Included">
          {gameRows.map((g, i) => (
            <div key={i} style={{ background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 8, border: "1px solid #1d2530" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15 }}>{g.label}</div>
                  <div style={{ fontSize: 12, color: "#7a8699", marginTop: 2 }}>{new Date(g.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: "#f5c518" }}>{g.yards} yds</div>
                  <div style={{ fontSize: 12, color: "#7a8699" }}>{g.count} plays · {g.avg} avg</div>
                </div>
              </div>
            </div>
          ))}
        </Section>

        {reportSide === "offense" ? (
          allOffPlays.length === 0 ? (
            <div style={{ textAlign: "center", color: "#4a5568", padding: "40px 0", fontSize: 15 }}>No offensive plays in selected games.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                <Stat label="Total Plays" value={allOffPlays.length} /><Stat label="Total Yds" value={tendencies.totalYards} /><Stat label="Yds / Play" value={tendencies.avg} accent />
              </div>
              <Breakdown title="Run vs Pass" data={tendencies.byGain} total={allOffPlays.length} />
              <Breakdown title="By Personnel" data={tendencies.byPersonnel} total={allOffPlays.length} />
              <Breakdown title="By Formation" data={tendencies.byFormation} total={allOffPlays.length} />
              <Breakdown title="By Play Call" data={tendencies.byPlay} total={allOffPlays.length} />
              <Breakdown title="By Hash" data={tendencies.byHash} total={allOffPlays.length} />
              <Breakdown title="By Down" data={tendencies.byDown} total={allOffPlays.length} keyFmt={ordinal} />
              <CarrierBreakdown data={tendencies.byCarrier} />
            </>
          )
        ) : (
          allDefPlays.length === 0 ? (
            <div style={{ textAlign: "center", color: "#4a5568", padding: "40px 0", fontSize: 15 }}>No defensive plays in selected games.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                <Stat label="Total Plays" value={allDefPlays.length} /><Stat label="Yds Allowed" value={defTendencies.totalYards} /><Stat label="Yds / Play" value={defTendencies.avg} accent />
              </div>
              <Breakdown title="Run vs Pass" data={defTendencies.byGain} total={allDefPlays.length} />
              <Breakdown title="By Their Personnel" data={defTendencies.byPersonnel} total={allDefPlays.length} />
              <Breakdown title="By Their Formation" data={defTendencies.byFormation} total={allDefPlays.length} />
              <Breakdown title="By Their Play" data={defTendencies.byPlay} total={allDefPlays.length} />
              <Breakdown title="By Hash" data={defTendencies.byHash} total={allDefPlays.length} />
              <Breakdown title="By Down" data={defTendencies.byDown} total={allDefPlays.length} keyFmt={ordinal} />
              <Breakdown title="By Our Front" data={defTendencies.byFront} total={allDefPlays.length} />
              <Breakdown title="By Our Coverage" data={defTendencies.byCoverage} total={allDefPlays.length} />
              <CarrierBreakdown data={defTendencies.byCarrier} />
            </>
          )
        )}
      </div>
    </Shell>
  );
}

// =================== GAMES LIST ===================
function seasonYear(dateStr) {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1; // 1–12
  const year = d.getFullYear();
  return month >= 8 ? year : year - 1;
}
function currentSeasonYear() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return month >= 8 ? year : year - 1;
}

function GamesList({ index, loading, onRefresh, onOpen, onCreate, onDelete, onSignOut, onEditPlaybook, onViewStaff, onViewReports, isHeadCoach, canEditPlaybook, profile }) {
  const [showNew, setShowNew] = useState(false);
  const [label, setLabel] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);

  const curSy = currentSeasonYear();

  const [openSeasons, setOpenSeasons] = useState(() => {
    if (typeof window === "undefined") return new Set([curSy]);
    try {
      const saved = localStorage.getItem("sideline_open_seasons");
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set([curSy]);
  });

  function toggleSeason(sy) {
    setOpenSeasons(prev => {
      const next = new Set(prev);
      if (next.has(sy)) next.delete(sy); else next.add(sy);
      try { localStorage.setItem("sideline_open_seasons", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  const seasonGroups = useMemo(() => {
    const m = {};
    index.forEach(g => { const sy = seasonYear(g.created_at); (m[sy] ??= []).push(g); });
    return Object.entries(m).map(([sy, games]) => ({ sy: Number(sy), games })).sort((a, b) => b.sy - a.sy);
  }, [index]);

  return (
    <Shell
      subtitle={isHeadCoach ? (profile?.school || "Game Library") : `${profile?.school || "Team"} · Staff`}
      right={
        <div style={{ display: "flex", gap: 8 }}>
          {isHeadCoach && <button onClick={onViewStaff} style={headerBtn}>Staff</button>}
          {canEditPlaybook && <button onClick={onEditPlaybook} style={headerBtn}>Playbook</button>}
          <button onClick={onViewReports} style={headerBtn}>Reports</button>
          <button onClick={onSignOut} style={headerBtn}>Sign Out</button>
        </div>
      }
    >
      <div style={{ padding: 16 }}>
        {isHeadCoach ? (
          <button onClick={() => setShowNew(true)} style={{
            width: "100%", padding: "16px", borderRadius: 12, border: "none", background: "#f5c518", color: "#0a0e14",
            fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", marginBottom: 16,
          }}>+ New Game</button>
        ) : (
          <div style={{ background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 16, border: "1px solid #1d2530", fontSize: 13, color: "#a8b3c4" }}>
            Staff view — open a game to chart plays in real time.
          </div>
        )}

        {showNew && (
          <div style={{ background: "#11161f", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #2a3543" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 10 }}>Who are we playing?</div>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { onCreate(label); setLabel(""); setShowNew(false); } }}
              placeholder="e.g. vs Central — Week 4" style={inputStyle} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => { onCreate(label); setLabel(""); setShowNew(false); }} style={{ flex: 1, ...solidBtn }}>Start</button>
              <button onClick={() => { setShowNew(false); setLabel(""); }} style={{ flex: 1, ...ghostBtn }}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699" }}>Games · {index.length}</span>
          <button onClick={onRefresh} style={{ background: "none", border: "none", color: "#7a8699", fontSize: 13, cursor: "pointer", fontFamily: FONT_BODY }}>↻ Refresh</button>
        </div>

        {loading ? <div style={{ color: "#4a5568", textAlign: "center", padding: 40 }}>Loading…</div> :
          index.length === 0 ? <div style={{ color: "#4a5568", textAlign: "center", padding: 40, fontSize: 15 }}>No games yet.</div> :
          seasonGroups.map(({ sy, games }) => {
            const isOpen = openSeasons.has(sy);
            const isCurrent = sy === curSy;
            return (
              <div key={sy} style={{ marginBottom: 10 }}>
                {/* Season header */}
                <div
                  onClick={() => toggleSeason(sy)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: "#141a24", border: `1px solid ${isCurrent ? "#f5c518" : "#2a3543"}`,
                    borderRadius: isOpen ? "10px 10px 0 0" : 10,
                    padding: "11px 14px", cursor: "pointer", userSelect: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: isCurrent ? "#f5c518" : "#c4cdda" }}>
                      {sy} Season
                    </span>
                    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 12, color: "#4a5568", letterSpacing: 1 }}>
                      {games.length} game{games.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <span style={{ color: "#7a8699", fontSize: 13 }}>{isOpen ? "▲" : "▼"}</span>
                </div>

                {/* Game rows */}
                {isOpen && (
                  <div style={{ border: `1px solid ${isCurrent ? "#f5c518" : "#2a3543"}`, borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                    {games.map((g, gi) => (
                      <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#11161f", padding: "13px 14px", borderTop: gi > 0 ? "1px solid #1d2530" : "none" }}>
                        <button onClick={() => onOpen(g.id)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 17, color: "#f4f4f0" }}>{g.label}</div>
                          <div style={{ fontSize: 12, color: "#7a8699", marginTop: 2 }}>{new Date(g.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                        </button>
                        {isHeadCoach && (confirmDel === g.id ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => { onDelete(g.id); setConfirmDel(null); }} style={{ ...tinyBtn, background: "#ff5252", color: "#fff" }}>Delete</button>
                            <button onClick={() => setConfirmDel(null)} style={{ ...tinyBtn, background: "#2a3543", color: "#c4cdda" }}>No</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDel(g.id)} style={{ background: "none", border: "none", color: "#4a5568", fontSize: 20, cursor: "pointer" }}>×</button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        }
      </div>
    </Shell>
  );
}

// =================== DRAG HANDLE COMPONENTS ===================
function SortableRow({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", borderBottom: "1px solid #1d2530" }}>
      <span {...attributes} {...listeners} style={{ color: "#4a5568", fontSize: 20, cursor: "grab", padding: "2px 8px", touchAction: "none", userSelect: "none", flexShrink: 0 }}>≡</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
function SortableChipItem({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, display: "flex", alignItems: "center", background: "#141a24", border: "1px solid #2a3543", borderRadius: 10, padding: "9px 10px", gap: 6 }}>
      <span {...attributes} {...listeners} style={{ color: "#4a5568", fontSize: 16, cursor: "grab", touchAction: "none", userSelect: "none", flexShrink: 0 }}>≡</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, color: "#c4cdda" }}>{children}</span>
    </div>
  );
}

// =================== PLAYBOOK EDITOR ===================
function PlaybookEditor({ playbook, onSave, layout, onSaveLayout, onBack }) {
  const [draft, setDraft] = useState({ ...DEFAULT_PLAYBOOK, ...playbook });
  const [layoutDraft, setLayoutDraft] = useState({
    offense: { ...DEFAULT_LAYOUT, ...layout?.offense },
    defense: { ...DEFAULT_DEF_LAYOUT, ...layout?.defense },
    fpDisplayMode: layout?.fpDisplayMode ?? "ownOpp",
  });
  const [editorTab, setEditorTab] = useState("arrange");
  const [pbSide, setPbSide] = useState("offense");
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function removeItem(key, item) { setDraft((d) => ({ ...d, [key]: (d[key] || []).filter((x) => x !== item) })); }
  function addItem(key, value) { setDraft((d) => ({ ...d, [key]: [...(d[key] || []), value] })); }

  async function handleSave() { setSaving(true); await onSave(draft); setSaving(false); onBack(); }

  function toggleSection(key) {
    setDraft((d) => ({ ...d, sections: { ...(d.sections ?? DEFAULT_PLAYBOOK.sections), [key]: !(d.sections ?? DEFAULT_PLAYBOOK.sections)[key] } }));
  }
  function toggleDefSection(key) {
    setDraft((d) => ({ ...d, defSections: { ...(d.defSections ?? DEFAULT_PLAYBOOK.defSections), [key]: !(d.defSections ?? DEFAULT_PLAYBOOK.defSections)[key] } }));
  }

  function getLayoutChips(sectionId, baseChips) {
    const saved = layoutDraft[pbSide]?.chipOrder?.[sectionId];
    if (!saved?.length) return baseChips;
    return [...saved.filter(c => baseChips.includes(c)), ...baseChips.filter(c => !saved.includes(c))];
  }

  function handleSectionDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const cur = layoutDraft[pbSide].sectionOrder;
    const next = { ...layoutDraft, [pbSide]: { ...layoutDraft[pbSide], sectionOrder: arrayMove(cur, cur.indexOf(active.id), cur.indexOf(over.id)) } };
    setLayoutDraft(next); onSaveLayout(next);
  }

  function makeChipDragEnd(sectionId, baseChips) {
    return ({ active, over }) => {
      if (!over || active.id === over.id) return;
      const cur = getLayoutChips(sectionId, baseChips);
      const next = { ...layoutDraft, [pbSide]: { ...layoutDraft[pbSide], chipOrder: { ...layoutDraft[pbSide].chipOrder, [sectionId]: arrayMove(cur, cur.indexOf(active.id), cur.indexOf(over.id)) } } };
      setLayoutDraft(next); onSaveLayout(next);
    };
  }

  const sectionToggles = [
    { key: "personnel", label: "Personnel" }, { key: "formTags", label: "Formation Tags" },
    { key: "motion", label: "Shift / Motion" }, { key: "rpo", label: "RPO Tags" },
    { key: "carrier", label: "Ball Carrier" }, { key: "tackler", label: "Tackled By" },
  ];
  const defSectionToggles = [
    { key: "oppPersonnel", label: "Their Personnel" }, { key: "oppFormTags", label: "Their Formation Tags" },
    { key: "oppMotion", label: "Their Motion" }, { key: "defFront", label: "Our Front" },
    { key: "defCoverage", label: "Our Coverage" }, { key: "defBlitz", label: "Blitz Tag" },
    { key: "carrier", label: "Their Ball Carrier" }, { key: "tackler", label: "Our Tackler" },
    { key: "fieldBdry", label: "Field / Boundary" },
  ];
  const offCategories = [
    { key: "personnel", label: "Personnel Groups" }, { key: "formations", label: "Formations" },
    { key: "formTags", label: "Formation Tags" }, { key: "runPlays", label: "Run Plays" },
    { key: "passPlays", label: "Pass Plays" }, { key: "motions", label: "Motions (None is always available)" },
    { key: "positions", label: "Positions" }, { key: "rpoTags", label: "RPO Tags" },
    { key: "penalties", label: "Penalty Types" },
    { key: "driveOutcomes", label: "Drive Outcome Labels" },
  ];
  const defCategories = [
    { key: "oppPersonnel", label: "Their Personnel Groups" }, { key: "oppFormations", label: "Their Formations" },
    { key: "oppFormTags", label: "Their Formation Tags" }, { key: "oppRunPlays", label: "Their Run Plays" },
    { key: "oppPassPlays", label: "Their Pass Plays" }, { key: "oppMotions", label: "Their Motions" },
    { key: "defFronts", label: "Our Fronts" }, { key: "defCoverages", label: "Our Coverages" },
    { key: "defBlitz", label: "Blitz Tags" }, { key: "fieldBdry", label: "Field / Boundary" },
    { key: "penalties", label: "Penalty Types" },
    { key: "driveOutcomes", label: "Drive Outcome Labels" },
  ];
  const penaltyChipSection = { id: "penalties", label: "Penalty Types", chips: draft.penalties ?? DEFAULT_PLAYBOOK.penalties };
  const offChipSections = [
    { id: "personnel", label: "Personnel", chips: draft.personnel },
    { id: "formation", label: "Formations", chips: draft.formations },
    { id: "formTags", label: "Formation Tags", chips: draft.formTags },
    { id: "motion", label: "Motions", chips: draft.motions },
    { id: "runPlay", label: "Run Plays", chips: draft.runPlays },
    { id: "rpoTags", label: "RPO Tags", chips: draft.rpoTags },
    { id: "passPlay", label: "Pass Plays", chips: draft.passPlays },
    penaltyChipSection,
    { id: "driveOutcomes", label: "Drive Outcome Labels", chips: draft.driveOutcomes ?? DEFAULT_PLAYBOOK.driveOutcomes },
  ];
  const defChipSections = [
    { id: "oppPersonnel", label: "Their Personnel", chips: draft.oppPersonnel ?? DEFAULT_PLAYBOOK.oppPersonnel },
    { id: "oppFormation", label: "Their Formations", chips: draft.oppFormations ?? DEFAULT_PLAYBOOK.oppFormations },
    { id: "oppFormTags", label: "Their Formation Tags", chips: draft.oppFormTags ?? DEFAULT_PLAYBOOK.oppFormTags },
    { id: "oppMotion", label: "Their Motions", chips: draft.oppMotions ?? DEFAULT_PLAYBOOK.oppMotions },
    { id: "oppRunPlay", label: "Their Run Plays", chips: draft.oppRunPlays ?? DEFAULT_PLAYBOOK.oppRunPlays },
    { id: "oppPassPlay", label: "Their Pass Plays", chips: draft.oppPassPlays ?? DEFAULT_PLAYBOOK.oppPassPlays },
    { id: "defFront", label: "Our Fronts", chips: draft.defFronts ?? DEFAULT_PLAYBOOK.defFronts },
    { id: "defCoverage", label: "Our Coverages", chips: draft.defCoverages ?? DEFAULT_PLAYBOOK.defCoverages },
    { id: "defBlitz", label: "Blitz Tags", chips: draft.defBlitz ?? DEFAULT_PLAYBOOK.defBlitz },
    { id: "fieldBdry", label: "Field / Boundary", chips: draft.fieldBdry ?? DEFAULT_PLAYBOOK.fieldBdry },
    penaltyChipSection,
  ];
  const chipSections = pbSide === "offense" ? offChipSections : defChipSections;
  const curLabels = pbSide === "offense" ? SECTION_LABELS : DEF_SECTION_LABELS;
  const curSectionOrder = layoutDraft[pbSide]?.sectionOrder || (pbSide === "offense" ? DEFAULT_SECTION_ORDER : DEFAULT_DEF_SECTION_ORDER);
  const curSectionToggles = pbSide === "offense" ? sectionToggles : defSectionToggles;
  const curCategories = pbSide === "offense" ? offCategories : defCategories;

  return (
    <Shell subtitle="Edit Playbook" onBack={onBack}>
      <div style={{ display: "flex", borderBottom: "1px solid #1d2530" }}>
        {[["arrange", "Arrange"], ["edit", "Edit Lists"]].map(([k, l]) => (
          <button key={k} onClick={() => setEditorTab(k)} style={{
            flex: 1, padding: "14px", background: editorTab === k ? "#141a24" : "transparent",
            color: editorTab === k ? "#f5c518" : "#7a8699", border: "none",
            borderBottom: editorTab === k ? "2px solid #f5c518" : "2px solid transparent",
            fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, letterSpacing: 1,
            textTransform: "uppercase", cursor: "pointer",
          }}>{l}</button>
        ))}
      </div>

      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button onClick={() => setPbSide("offense")} style={modeBtn(pbSide === "offense", true)}>Offense</button>
          <button onClick={() => setPbSide("defense")} style={modeBtn(pbSide === "defense")}>Defense</button>
        </div>

        {editorTab === "arrange" && (
          <>
            <div style={{ background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 20, border: "1px solid #1d2530", fontSize: 13, color: "#a8b3c4" }}>
              Drag ≡ to reorder. Changes save immediately for the whole staff.
            </div>

            <Section label="Field Position Display">
              <div style={{ fontSize: 13, color: "#a8b3c4", marginBottom: 12 }}>How field position labels appear on this device for both sides.</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["ownOpp", "Own / Opp", "Own 25, Opp 10 — standard football notation"], ["pm50", "±50", "+25, −10 — yards from midfield"]].map(([val, label, desc]) => (
                  <button key={val} onClick={() => {
                    const next = { ...layoutDraft, fpDisplayMode: val };
                    setLayoutDraft(next); onSaveLayout(next);
                  }} style={{
                    flex: 1, padding: "14px 8px", borderRadius: 10, border: `2px solid ${layoutDraft.fpDisplayMode === val ? "#f5c518" : "#1d2530"}`,
                    background: layoutDraft.fpDisplayMode === val ? "#1a1a0e" : "#141a24",
                    color: layoutDraft.fpDisplayMode === val ? "#f5c518" : "#a8b3c4",
                    fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, letterSpacing: 1, cursor: "pointer", textAlign: "center",
                  }}>
                    <div>{label}</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, marginTop: 4, color: layoutDraft.fpDisplayMode === val ? "#c8b84a" : "#4a5568", letterSpacing: 0, fontWeight: 400 }}>{desc}</div>
                  </button>
                ))}
              </div>
            </Section>

            <Section label="Form Section Order">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
                <SortableContext items={curSectionOrder} strategy={verticalListSortingStrategy}>
                  <div style={{ background: "#141a24", border: "1px solid #2a3543", borderRadius: 12, padding: "0 12px" }}>
                    {curSectionOrder.map((key) => (
                      <SortableRow key={key} id={key}>
                        <span style={{ fontFamily: FONT_BODY, fontSize: 15, color: "#c4cdda" }}>{curLabels[key] || key}</span>
                      </SortableRow>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </Section>

            {chipSections.map(({ id, label, chips }) => {
              const ordered = getLayoutChips(id, chips);
              return (
                <Section key={id} label={`${label} · drag ≡ to reorder`}>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={makeChipDragEnd(id, chips)}>
                    <SortableContext items={ordered} strategy={rectSortingStrategy}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {ordered.map((chip) => (
                          <SortableChipItem key={chip} id={chip}>{chip}</SortableChipItem>
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </Section>
              );
            })}
          </>
        )}

        {editorTab === "edit" && (
          <>
            <div style={{ background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 20, border: "1px solid #1d2530", fontSize: 13, color: "#a8b3c4" }}>
              Tap × to remove an item. Type a name and press + or Enter to add one.
            </div>
            <Section label="Visible Sections · toggle off sections your team doesn't use">
              {curSectionToggles.map(({ key, label }) => {
                const bank = pbSide === "offense" ? (draft.sections ?? DEFAULT_PLAYBOOK.sections) : (draft.defSections ?? DEFAULT_PLAYBOOK.defSections);
                const on = bank[key];
                const doToggle = pbSide === "offense" ? toggleSection : toggleDefSection;
                return (
                  <div key={key} onClick={() => doToggle(key)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 4px", borderBottom: "1px solid #1d2530", cursor: "pointer" }}>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 15, color: on ? "#f4f4f0" : "#4a5568" }}>{label}</span>
                    <div style={{ width: 44, height: 24, borderRadius: 12, background: on ? "#f5c518" : "#1d2530", position: "relative", transition: "background 0.2s", border: "1px solid " + (on ? "#f5c518" : "#2a3543") }}>
                      <div style={{ position: "absolute", top: 2, left: on ? 22 : 2, width: 18, height: 18, borderRadius: 9, background: on ? "#0a0e14" : "#4a5568", transition: "left 0.2s" }} />
                    </div>
                  </div>
                );
              })}
            </Section>
            {curCategories.map(({ key, label }) => (
              <PlaybookCategory key={key} label={label} items={draft[key] ?? DEFAULT_PLAYBOOK[key] ?? []}
                onRemove={(item) => removeItem(key, item)}
                onAdd={(val) => addItem(key, val)} />
            ))}
            <button onClick={handleSave} disabled={saving} style={{
              width: "100%", marginTop: 8, padding: "18px", borderRadius: 12, border: "none",
              background: saving ? "#1d2530" : "#f5c518", color: saving ? "#4a5568" : "#0a0e14",
              fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: 1.5,
              textTransform: "uppercase", cursor: saving ? "not-allowed" : "pointer",
            }}>{saving ? "Saving…" : "Save Playbook"}</button>
          </>
        )}
      </div>
    </Shell>
  );
}

function PlaybookCategory({ label, items, onRemove, onAdd }) {
  const [input, setInput] = useState("");
  function submit() {
    const t = input.trim();
    if (t && !items.includes(t)) onAdd(t);
    setInput("");
  }
  return (
    <Section label={label}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {items.length === 0 && <div style={{ color: "#4a5568", fontSize: 13, padding: "6px 0" }}>None added yet</div>}
        {items.map((item) => (
          <div key={item} style={{ display: "flex", alignItems: "center", gap: 4, background: "#141a24", border: "1px solid #2a3543", borderRadius: 10, padding: "9px 12px", fontFamily: FONT_DISPLAY, fontSize: 14, color: "#c4cdda" }}>
            {item}
            <button onClick={() => onRemove(item)} style={{ background: "none", border: "none", color: "#4a5568", fontSize: 18, cursor: "pointer", padding: "0 0 0 6px", lineHeight: 1 }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Type and press +" style={{ ...inputStyle, flex: 1 }} />
        <button onClick={submit} style={{ ...solidBtn, padding: "14px 20px", fontSize: 20, lineHeight: 1 }}>+</button>
      </div>
    </Section>
  );
}

// =================== SINGLE GAME ===================
function Game({ id, label, gameDate, playbook, layout, isHeadCoach, onBack }) {
  const { personnel: PERSONNEL, formations: FORMATIONS, formTags: FORM_TAGS,
    positions: POSITIONS, rpoTags: RPO_TAGS, runPlays: RUN_PLAYS, passPlays: PASS_PLAYS } = playbook;
  const sec = playbook.sections ?? DEFAULT_PLAYBOOK.sections;
  const defSec = playbook.defSections ?? DEFAULT_PLAYBOOK.defSections;

  const offLayout = layout?.offense || DEFAULT_LAYOUT;
  const defLayout = layout?.defense || DEFAULT_DEF_LAYOUT;

  const sectionOrder = [
    ...(offLayout.sectionOrder || DEFAULT_SECTION_ORDER),
    ...DEFAULT_SECTION_ORDER.filter(s => !(offLayout.sectionOrder || DEFAULT_SECTION_ORDER).includes(s)),
  ];
  const defSectionOrder = [
    ...(defLayout.sectionOrder || DEFAULT_DEF_SECTION_ORDER),
    ...DEFAULT_DEF_SECTION_ORDER.filter(s => !(defLayout.sectionOrder || DEFAULT_DEF_SECTION_ORDER).includes(s)),
  ];

  function orderedChips(sectionId, baseChips) {
    const saved = offLayout.chipOrder?.[sectionId];
    if (!saved?.length) return baseChips;
    return [...saved.filter(c => baseChips.includes(c)), ...baseChips.filter(c => !saved.includes(c))];
  }
  function defOrderedChips(sectionId, baseChips) {
    const saved = defLayout.chipOrder?.[sectionId];
    if (!saved?.length) return baseChips;
    return [...saved.filter(c => baseChips.includes(c)), ...baseChips.filter(c => !saved.includes(c))];
  }

  const ORD_PERSONNEL = orderedChips("personnel", PERSONNEL);
  const ORD_FORMATIONS = orderedChips("formation", FORMATIONS);
  const ORD_FORM_TAGS = orderedChips("formTags", FORM_TAGS);
  const ORD_MOTIONS = ["None", ...orderedChips("motion", playbook.motions)];
  const ORD_RUN_PLAYS = orderedChips("runPlay", RUN_PLAYS);
  const ORD_RPO_TAGS = orderedChips("rpoTags", RPO_TAGS);
  const ORD_PASS_PLAYS = orderedChips("passPlay", PASS_PLAYS);

  const ORD_OPP_PERSONNEL = defOrderedChips("oppPersonnel", playbook.oppPersonnel ?? DEFAULT_PLAYBOOK.oppPersonnel);
  const ORD_OPP_FORMATIONS = defOrderedChips("oppFormation", playbook.oppFormations ?? DEFAULT_PLAYBOOK.oppFormations);
  const ORD_OPP_FORM_TAGS = defOrderedChips("oppFormTags", playbook.oppFormTags ?? DEFAULT_PLAYBOOK.oppFormTags);
  const ORD_OPP_MOTIONS = ["None", ...defOrderedChips("oppMotion", playbook.oppMotions ?? DEFAULT_PLAYBOOK.oppMotions)];
  const ORD_OPP_RUN_PLAYS = defOrderedChips("oppRunPlay", playbook.oppRunPlays ?? DEFAULT_PLAYBOOK.oppRunPlays);
  const ORD_OPP_PASS_PLAYS = defOrderedChips("oppPassPlay", playbook.oppPassPlays ?? DEFAULT_PLAYBOOK.oppPassPlays);
  const ORD_DEF_FRONTS = defOrderedChips("defFront", playbook.defFronts ?? DEFAULT_PLAYBOOK.defFronts);
  const ORD_DEF_COVERAGES = defOrderedChips("defCoverage", playbook.defCoverages ?? DEFAULT_PLAYBOOK.defCoverages);
  const ORD_DEF_BLITZ = defOrderedChips("defBlitz", playbook.defBlitz ?? DEFAULT_PLAYBOOK.defBlitz);
  const ORD_FIELD_BDRY = defOrderedChips("fieldBdry", playbook.fieldBdry ?? DEFAULT_PLAYBOOK.fieldBdry);

  const [tab, setTab] = useState("log");
  const [mode, setMode] = useState("view");
  const [side, setSide] = useState("offense");
  const [offPlays, setOffPlays] = useState([]);
  const [defPlays, setDefPlays] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tendSide, setTendSide] = useState("offense");

  // Ball tracking
  const [ytdg, setYtdg] = useState(null); // yardsToDefendingGoal: 1-99, or null
  const [driveNumber, setDriveNumber] = useState(1);
  const [showNewDrive, setShowNewDrive] = useState(false);
  const [ndTerritory, setNdTerritory] = useState("own"); // "own" | "50" | "opp"
  const [ndYard, setNdYard] = useState(25);
  const [ndPmValue, setNdPmValue] = useState(-25); // for ±50 mode: -49 to 49 (0 = midfield); -25 = Own 25
  const [needNewDrive, setNeedNewDrive] = useState(false);
  const fpDisplayMode = layout?.fpDisplayMode ?? "ownOpp";

  // Penalty form state
  const [showPenalty, setShowPenalty] = useState(false);
  const [penaltyType, setPenaltyType] = useState("");
  const [penaltyOnUs, setPenaltyOnUs] = useState(true);
  const [penaltyYards, setPenaltyYards] = useState(5);
  const [penaltyAutoFirst, setPenaltyAutoFirst] = useState(false);
  const [penaltyReplay, setPenaltyReplay] = useState(false);

  // Punt form state
  const [showPunt, setShowPunt] = useState(false);
  const [puntDist, setPuntDist] = useState(35);
  const [puntReturn, setPuntReturn] = useState(0);
  const [puntResult, setPuntResult] = useState("Returned");

  // End Drive form state
  const [showEndDrive, setShowEndDrive] = useState(false);
  const [endDriveOutcome, setEndDriveOutcome] = useState("");

  // Scoreboard
  const [usScore, setUsScore] = useState(0);
  const [themScore, setThemScore] = useState(0);
  const [drives, setDrives] = useState([]); // [{driveNumber,quarter,clock,usScore,themScore}]
  // New Drive — scoreboard fields
  const [ndQuarter, setNdQuarter] = useState(1);
  const [ndClockMin, setNdClockMin] = useState(12);
  const [ndClockSec, setNdClockSec] = useState(0);
  const [ndUsScore, setNdUsScore] = useState(0);
  const [ndThemScore, setNdThemScore] = useState(0);
  // Scoring prompt (appears after TD/FG/Safety)
  const [showScorePrompt, setShowScorePrompt] = useState(false);
  const [scoringTeam, setScoringTeam] = useState("us"); // "us"|"them"
  const [scorePromptType, setScorePromptType] = useState("td"); // "td"|"safety"|"fg"
  // Manual score edit overlay
  const [showScoreEdit, setShowScoreEdit] = useState(false);
  // Tendencies sub-tab
  const [tendSubTab, setTendSubTab] = useState("stats");

  // Reports
  const [reportView, setReportView] = useState(null); // null | "onepager" | "selfscout"
  const [pdfExporting, setPdfExporting] = useState(false);

  // Keep scores+drives in a ref so persistGameState (a stable callback) can read current values
  const scoreRef = React.useRef({ drives: [], usScore: 0, themScore: 0 });
  React.useEffect(() => { scoreRef.current = { drives, usScore, themScore }; }, [drives, usScore, themScore]);

  // Offensive form state
  const [personnel, setPersonnel] = useState("");
  const [formation, setFormation] = useState("");
  const [formTags, setFormTags] = useState([]);
  const [rpoTags, setRpoTags] = useState([]);
  const [rpoPlayer, setRpoPlayer] = useState("");
  const [motion, setMotion] = useState("None");
  const [motionPlayer, setMotionPlayer] = useState("");
  const [hash, setHash] = useState("M");
  const [down, setDown] = useState(1);
  const [distance, setDistance] = useState(10);
  const [play, setPlay] = useState("");
  const [playType, setPlayType] = useState("");
  const [runCarrier, setRunCarrier] = useState("");
  const [yards, setYards] = useState("");
  const [gainType, setGainType] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [tacklerPos, setTacklerPos] = useState("");
  const [tacklerNum, setTacklerNum] = useState("");
  const [passer, setPasser] = useState("");
  const [fumbleForcerPos, setFumbleForcerPos] = useState("");
  const [fumbleForcerNum, setFumbleForcerNum] = useState("");
  const [fumbleRecovery, setFumbleRecovery] = useState("");
  const [intByPos, setIntByPos] = useState("");
  const [intByNum, setIntByNum] = useState("");
  const [intReturn, setIntReturn] = useState("0");

  // Defensive form state
  const [defOppPersonnel, setDefOppPersonnel] = useState("");
  const [defOppFormation, setDefOppFormation] = useState("");
  const [defOppFormTags, setDefOppFormTags] = useState([]);
  const [defOppMotion, setDefOppMotion] = useState("None");
  const [defOppMotionPlayer, setDefOppMotionPlayer] = useState("");
  const [defPlay, setDefPlay] = useState("");
  const [defPlayType, setDefPlayType] = useState("");
  const [defYards, setDefYards] = useState("");
  const [defGainType, setDefGainType] = useState("");
  const [defIncomplete, setDefIncomplete] = useState(false);
  const [defCarrier, setDefCarrier] = useState("");
  const [defFront, setDefFront] = useState("");
  const [defCoverage, setDefCoverage] = useState("");
  const [defBlitz, setDefBlitz] = useState("");
  const [defTacklerPos, setDefTacklerPos] = useState("");
  const [defTacklerNum, setDefTacklerNum] = useState("");
  const [defFieldBdry, setDefFieldBdry] = useState("");

  const editing = mode === "edit";
  const offReady = editing && formation && (play || gainType === "Sack") && (yards !== "" || incomplete || gainType === "FG" || gainType === "Sack");
  const defReady = editing && defOppFormation && (defPlay || defGainType === "Sack") && (defYards !== "" || defIncomplete || defGainType === "Sack");
  const activePlays = side === "offense" ? offPlays : defPlays;

  const fetchGame = useCallback(async () => {
    try {
      setSyncing(true);
      const { data } = await supabase.from("games").select("offensive_plays, defensive_plays, game_state").eq("id", id).single();
      if (data) {
        setOffPlays(data.offensive_plays || []);
        setDefPlays(data.defensive_plays || []);
        if (data.game_state?.ytdg != null) {
          setYtdg(data.game_state.ytdg);
        } else if (data.game_state?.ballPosition) {
          // Migrate old {territory,yard} format — assume offense perspective
          const oldAbs = fpToAbs(data.game_state.ballPosition);
          if (oldAbs !== null) setYtdg(oldAbs);
        }
        if (data.game_state?.driveNumber) setDriveNumber(data.game_state.driveNumber);
        if (data.game_state?.drives) setDrives(data.game_state.drives);
        if (data.game_state?.usScore != null) setUsScore(data.game_state.usScore);
        if (data.game_state?.themScore != null) setThemScore(data.game_state.themScore);
      }
    } catch (e) {}
    setSyncing(false); setLoaded(true);
  }, [id]);

  useEffect(() => { fetchGame(); }, [fetchGame]);

  useEffect(() => {
    const channel = supabase
      .channel(`game-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${id}` },
        (payload) => {
          setOffPlays(payload.new.offensive_plays || []);
          setDefPlays(payload.new.defensive_plays || []);
          if (payload.new.game_state?.ytdg != null) {
            setYtdg(payload.new.game_state.ytdg);
          } else if (payload.new.game_state?.ballPosition) {
            const oldAbs = fpToAbs(payload.new.game_state.ballPosition);
            if (oldAbs !== null) setYtdg(oldAbs);
          }
          if (payload.new.game_state?.driveNumber) setDriveNumber(payload.new.game_state.driveNumber);
          if (payload.new.game_state?.drives) setDrives(payload.new.game_state.drives);
          if (payload.new.game_state?.usScore != null) setUsScore(payload.new.game_state.usScore);
          if (payload.new.game_state?.themScore != null) setThemScore(payload.new.game_state.themScore);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  useEffect(() => {
    if (playType === "Pass" && !passer) {
      const last = offPlays.find(p => p.passer);
      if (last?.passer) setPasser(last.passer);
    }
  }, [playType]);

  const persist = useCallback(async (nextPlays, pSide) => {
    const col = pSide === "offense" ? "offensive_plays" : "defensive_plays";
    try { await supabase.from("games").update({ [col]: nextPlays }).eq("id", id); }
    catch (e) { console.error(e); }
  }, [id]);

  const persistGameState = useCallback(async (newYtdg, newDriveNum, overrides = {}) => {
    const { drives: d, usScore: us, themScore: them } = scoreRef.current;
    try {
      await supabase.from("games").update({
        game_state: { ytdg: newYtdg, driveNumber: newDriveNum, drives: d, usScore: us, themScore: them, ...overrides }
      }).eq("id", id);
    }
    catch (e) { console.error(e); }
  }, [id]);

  function startNewDrive() {
    let newYtdg;
    if (fpDisplayMode === "pm50") {
      const clamped = Math.max(-49, Math.min(49, ndPmValue || 0));
      newYtdg = Math.max(1, Math.min(99, 50 + clamped));
    } else {
      if (ndTerritory === "50") newYtdg = 50;
      else if (ndTerritory === "own") newYtdg = Math.min(49, Math.max(1, ndYard));
      else newYtdg = Math.min(99, Math.max(51, 100 - ndYard));
    }
    const newDrive = driveNumber + (ytdg !== null ? 1 : 0);
    const cappedDist = Math.min(10, ytdgMaxDist(newYtdg, side));

    // Build clock string from minutes/seconds fields
    const clockStr = `${ndClockMin}:${String(ndClockSec).padStart(2, "0")}`;
    // Append this drive's context to the drives array
    const driveEntry = { driveNumber: newDrive, quarter: ndQuarter, clock: clockStr, usScore: ndUsScore, themScore: ndThemScore };
    const newDrives = [...scoreRef.current.drives.filter(d => d.driveNumber !== newDrive), driveEntry];
    setDrives(newDrives);
    scoreRef.current = { ...scoreRef.current, drives: newDrives };

    setYtdg(newYtdg);
    setDriveNumber(newDrive);
    setDown(1);
    setDistance(cappedDist);
    setNeedNewDrive(false);
    setShowNewDrive(false);
    persistGameState(newYtdg, newDrive, { drives: newDrives, usScore: scoreRef.current.usScore, themScore: scoreRef.current.themScore });
  }

  function openNewDrivePanel() {
    setNdUsScore(usScore); setNdThemScore(themScore);
    setNdQuarter(1); setNdClockMin(12); setNdClockSec(0);
  }

  function triggerScorePrompt(team, type) {
    setScoringTeam(team); setScorePromptType(type); setShowScorePrompt(true);
  }

  function applyScore(pts) {
    setShowScorePrompt(false);
    // Tag drive outcome before updating score so drives array is current
    let outcomeLabel = null;
    if (scorePromptType === "td") outcomeLabel = "Touchdown";
    else if (scorePromptType === "fg") outcomeLabel = pts === 3 ? "Field Goal" : "Missed FG";
    else if (scorePromptType === "safety") outcomeLabel = "Safety";
    if (outcomeLabel) {
      const newDrives = scoreRef.current.drives.map(d => d.driveNumber === driveNumber ? { ...d, outcome: outcomeLabel } : d);
      setDrives(newDrives);
      scoreRef.current = { ...scoreRef.current, drives: newDrives };
    }
    if (pts === 0) {
      persistGameState(ytdg, driveNumber, { drives: scoreRef.current.drives, usScore: scoreRef.current.usScore, themScore: scoreRef.current.themScore });
      return;
    }
    const newUs = scoringTeam === "us" ? usScore + pts : usScore;
    const newThem = scoringTeam === "them" ? themScore + pts : themScore;
    setUsScore(newUs); setThemScore(newThem);
    scoreRef.current = { ...scoreRef.current, usScore: newUs, themScore: newThem };
    // pre-fill next drive score so the panel is ready
    setNdUsScore(newUs); setNdThemScore(newThem);
    persistGameState(ytdg, driveNumber, { drives: scoreRef.current.drives, usScore: newUs, themScore: newThem });
  }

  function toggle(list, setList, val) { setList(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]); }

  function tagDriveOutcome(driveNum, outcome) {
    const newDrives = scoreRef.current.drives.map(d => d.driveNumber === driveNum ? { ...d, outcome } : d);
    setDrives(newDrives);
    scoreRef.current = { ...scoreRef.current, drives: newDrives };
    persistGameState(ytdg, driveNumber, { drives: newDrives, usScore: scoreRef.current.usScore, themScore: scoreRef.current.themScore });
  }

  const usedCarriers = useMemo(() => { const s = new Set(); offPlays.forEach((p) => p.carrier && s.add(p.carrier)); return [...s].sort((a, b) => a - b); }, [offPlays]);
  const usedPassers = useMemo(() => { const s = new Set(); offPlays.forEach((p) => p.passer && s.add(p.passer)); return [...s].sort((a, b) => a - b); }, [offPlays]);
  const usedTacklers = useMemo(() => { const s = new Set(); offPlays.forEach((p) => p.tacklerNum && s.add(p.tacklerNum)); return [...s].sort((a, b) => a - b); }, [offPlays]);
  const topTacklers = useMemo(() => { const c = {}; offPlays.forEach((p) => { if (p.tacklerNum) c[p.tacklerNum] = (c[p.tacklerNum] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3); }, [offPlays]);
  const defPosMap = useMemo(() => { const m = {}; [...offPlays].reverse().forEach((p) => { if (p.tacklerNum && p.tacklerPos) m[p.tacklerNum] = p.tacklerPos; }); return m; }, [offPlays]);
  const defLabel = (num) => (defPosMap[num] ? `${defPosMap[num]} #${num}` : `#${num}`);

  const defUsedCarriers = useMemo(() => { const s = new Set(); defPlays.forEach((p) => p.carrier && s.add(p.carrier)); return [...s].sort((a, b) => a - b); }, [defPlays]);
  const defUsedTacklers = useMemo(() => { const s = new Set(); defPlays.forEach((p) => p.tacklerNum && s.add(p.tacklerNum)); return [...s].sort((a, b) => a - b); }, [defPlays]);
  const defTopTacklers = useMemo(() => { const c = {}; defPlays.forEach((p) => { if (p.tacklerNum) c[p.tacklerNum] = (c[p.tacklerNum] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3); }, [defPlays]);
  const ourDefPosMap = useMemo(() => { const m = {}; [...defPlays].reverse().forEach((p) => { if (p.tacklerNum && p.tacklerPos) m[p.tacklerNum] = p.tacklerPos; }); return m; }, [defPlays]);
  const ourDefLabel = (num) => (ourDefPosMap[num] ? `${ourDefPosMap[num]} #${num}` : `#${num}`);

  async function logPlay() {
    if (!offReady) return;
    const y = gainType === "Sack" ? -(Math.abs(parseInt(yards, 10) || 0)) : incomplete ? 0 : (parseInt(yards, 10) || 0);
    const newPlay = {
      id: Date.now() + Math.random(), driveNumber, fieldPos: ytdg ?? null,
      personnel: personnel || "—", formation, formTags: [...formTags],
      rpoTags: [...rpoTags], rpoPlayer: rpoTags.length > 0 ? rpoPlayer : "",
      motion, motionPlayer: motion !== "None" ? motionPlayer : "",
      hash, down, distance, play, playType, yards: y,
      runCarrier: playType === "Run" ? runCarrier : "",
      passer: playType === "Pass" && gainType !== "Sack" ? passer.trim() : "",
      gainType, incomplete, carrier: incomplete ? "" : carrier.trim(),
      tacklerPos, tacklerNum: tacklerNum.trim(),
      tackler: tacklerPos || tacklerNum ? `${tacklerPos}${tacklerNum ? " #" + tacklerNum : ""}` : "—",
      fumbleForcer: gainType === "Fumble" ? (`${fumbleForcerPos}${fumbleForcerNum ? " #" + fumbleForcerNum : ""}`).trim() || "—" : "",
      fumbleRecovery: gainType === "Fumble" ? fumbleRecovery : "",
      intBy: gainType === "INT" ? (`${intByPos}${intByNum ? " #" + intByNum : ""}`).trim() || "—" : "",
      intReturn: gainType === "INT" ? (parseInt(intReturn, 10) || 0) : 0,
    };
    const next = [newPlay, ...offPlays];
    setOffPlays(next); persist(next, "offense");
    const turnover = gainType === "TD" || gainType === "FG" || gainType === "INT" || gainType === "Safety" || (gainType === "Fumble" && fumbleRecovery === "Defense");
    if (turnover) {
      setDown(1); setDistance(10); setNeedNewDrive(true);
      if (gainType === "INT") tagDriveOutcome(driveNumber, "Interception");
      else if (gainType === "Fumble" && fumbleRecovery === "Defense") tagDriveOutcome(driveNumber, "Fumble");
      if (gainType === "TD") triggerScorePrompt("us", "td");
      else if (gainType === "FG") triggerScorePrompt("us", "fg");
      else if (gainType === "Safety") triggerScorePrompt("them", "safety"); // we gave up a safety
    } else {
      const g = y >= distance;
      const newDown = g ? 1 : (down < 4 ? down + 1 : 1);
      const rawDist = g ? 10 : (down < 4 ? Math.max(distance - y, 1) : 10);
      if (ytdg !== null) {
        // Offense: gains increase abs (toward their EZ); sack decreases abs
        const newYtdg = gainType === "Sack" ? ytdg - Math.abs(y) : ytdg + y;
        if (newYtdg >= 100) { setDown(1); setDistance(10); setNeedNewDrive(true); triggerScorePrompt("us", "td"); } // TD by position
        else if (newYtdg <= 0) { setDown(1); setDistance(10); setNeedNewDrive(true); triggerScorePrompt("them", "safety"); } // safety
        else {
          const cappedDist = Math.min(rawDist, ytdgMaxDist(newYtdg, "offense"));
          setYtdg(newYtdg); setDown(newDown); setDistance(cappedDist);
          persistGameState(newYtdg, driveNumber);
        }
      } else { setDown(newDown); setDistance(rawDist); }
    }
    setPlay(""); setPlayType(""); setRunCarrier(""); setYards(""); setGainType(""); setIncomplete(false);
    setCarrier(""); setTacklerPos(""); setTacklerNum(""); setMotion("None"); setMotionPlayer("");
    setFormTags([]); setRpoTags([]); setRpoPlayer("");
    setFumbleForcerPos(""); setFumbleForcerNum(""); setFumbleRecovery("");
    setIntByPos(""); setIntByNum(""); setIntReturn("0");
  }

  async function logDefPlay() {
    if (!defReady) return;
    const y = defGainType === "Sack" ? -(Math.abs(parseInt(defYards, 10) || 0)) : defIncomplete ? 0 : (parseInt(defYards, 10) || 0);
    const newPlay = {
      id: Date.now() + Math.random(), driveNumber, fieldPos: ytdg ?? null,
      hash, fieldBdry: defFieldBdry, down, distance,
      oppPersonnel: defOppPersonnel || "—", oppFormation: defOppFormation,
      oppFormTags: [...defOppFormTags], oppMotion: defOppMotion,
      oppMotionPlayer: defOppMotion !== "None" ? defOppMotionPlayer : "",
      play: defPlay, playType: defPlayType,
      yards: y, gainType: defGainType, incomplete: defIncomplete,
      carrier: defIncomplete ? "" : defCarrier.trim(),
      front: defFront, coverage: defCoverage, blitz: defBlitz,
      tacklerPos: defTacklerPos, tacklerNum: defTacklerNum.trim(),
      tackler: defTacklerPos || defTacklerNum ? `${defTacklerPos}${defTacklerNum ? " #" + defTacklerNum : ""}` : "—",
    };
    const next = [newPlay, ...defPlays];
    setDefPlays(next); persist(next, "defense");
    const turnover = defGainType === "TD" || defGainType === "INT" || defGainType === "Safety" || defGainType === "Fumble";
    if (turnover) {
      setDown(1); setDistance(10); setNeedNewDrive(true);
      if (defGainType === "INT") tagDriveOutcome(driveNumber, "Interception");
      else if (defGainType === "Fumble") tagDriveOutcome(driveNumber, "Fumble");
      if (defGainType === "TD") triggerScorePrompt("them", "td"); // opponent scored
      else if (defGainType === "Safety") triggerScorePrompt("us", "safety"); // we got a safety
    } else {
      const g = y >= distance;
      const newDown = g ? 1 : (down < 4 ? down + 1 : 1);
      const rawDist = g ? 10 : (down < 4 ? Math.max(distance - y, 1) : 10);
      if (ytdg !== null) {
        // Defense: opponent gains decrease abs (ball toward our EZ); sack increases abs
        const newYtdg = defGainType === "Sack" ? ytdg + Math.abs(y) : ytdg - y;
        if (newYtdg <= 0) { setDown(1); setDistance(10); setNeedNewDrive(true); triggerScorePrompt("them", "td"); } // opponent TD by position
        else if (newYtdg >= 100) { setDown(1); setDistance(10); setNeedNewDrive(true); triggerScorePrompt("us", "safety"); } // safety by position
        else {
          const cappedDist = Math.min(rawDist, ytdgMaxDist(newYtdg, "defense"));
          setYtdg(newYtdg); setDown(newDown); setDistance(cappedDist);
          persistGameState(newYtdg, driveNumber);
        }
      } else { setDown(newDown); setDistance(rawDist); }
    }
    setDefPlay(""); setDefPlayType(""); setDefYards(""); setDefGainType(""); setDefIncomplete(false);
    setDefCarrier(""); setDefTacklerPos(""); setDefTacklerNum(""); setDefOppMotion("None"); setDefOppMotionPlayer("");
    setDefOppFormTags([]); setDefFieldBdry(""); setDefFront(""); setDefCoverage(""); setDefBlitz(""); setDefOppPersonnel("");
  }

  async function logPenalty() {
    if (!penaltyType) return;

    // Against offense = ball goes backward = abs decreases (toward our EZ); favors offense = abs increases
    const againstOffense = (penaltyOnUs && side === "offense") || (!penaltyOnUs && side === "defense");

    let newYtdg = ytdg;
    if (ytdg !== null) {
      newYtdg = Math.max(1, Math.min(99, againstOffense ? ytdg - penaltyYards : ytdg + penaltyYards));
    }

    let newDown = down;
    let newDist = distance;

    if (penaltyAutoFirst) {
      newDown = 1;
      newDist = newYtdg != null ? Math.min(10, ytdgMaxDist(newYtdg, side)) : 10;
    } else if (penaltyReplay) {
      newDist = againstOffense
        ? Math.max(1, distance + penaltyYards)
        : Math.max(1, distance - penaltyYards);
      if (newYtdg != null) newDist = Math.min(newDist, ytdgMaxDist(newYtdg, side));
    } else {
      if (againstOffense) {
        newDist = Math.max(1, distance + penaltyYards);
        if (newYtdg != null) newDist = Math.min(newDist, ytdgMaxDist(newYtdg, side));
      } else {
        const calc = distance - penaltyYards;
        if (calc <= 0) {
          newDown = 1;
          newDist = newYtdg != null ? Math.min(10, ytdgMaxDist(newYtdg, side)) : 10;
        } else {
          newDist = calc;
          if (newYtdg != null) newDist = Math.min(newDist, ytdgMaxDist(newYtdg, side));
        }
      }
    }

    const yds = penaltyOnUs ? -Math.abs(penaltyYards) : Math.abs(penaltyYards);
    const newPlay = {
      id: Date.now() + Math.random(), type: "penalty",
      driveNumber, fieldPos: ytdg ?? null,
      down, distance, hash,
      penaltyType, penaltyOnUs, yards: yds, side,
      penaltyAutoFirst, penaltyReplay,
      newDown, newDistance: newDist,
    };
    if (side === "offense") { const n = [newPlay, ...offPlays]; setOffPlays(n); persist(n, "offense"); }
    else { const n = [newPlay, ...defPlays]; setDefPlays(n); persist(n, "defense"); }

    if (newYtdg !== ytdg) { setYtdg(newYtdg); persistGameState(newYtdg, driveNumber); }
    setDown(newDown); setDistance(newDist);

    setShowPenalty(false); setPenaltyType(""); setPenaltyYards(5); setPenaltyOnUs(true);
    setPenaltyAutoFirst(false); setPenaltyReplay(false);
  }

  async function deletePlay(pid) {
    if (side === "offense") { const n = offPlays.filter((p) => p.id !== pid); setOffPlays(n); persist(n, "offense"); }
    else { const n = defPlays.filter((p) => p.id !== pid); setDefPlays(n); persist(n, "defense"); }
  }

  function exportCSV() {
    const headers = ["Side", "Drive", "Field Pos", "Play #", "Hash", "Field/Bdry", "Down", "Distance",
      "Personnel", "Formation", "Form Tags", "RPO", "RPO Player", "Motion", "Motion Player", "Play", "Play Type", "Gain Type", "Yards", "Incomplete", "Ball Carrier", "Tackled By",
      "Their Personnel", "Their Formation", "Their Form Tags", "Their Motion", "Their Motion Player", "Their Play",
      "Our Front", "Our Coverage", "Blitz", "Their Ball Carrier", "Our Tackler", "Punt Return", "Punt Net"];
    const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const allOff = [...offPlays].reverse();
    const allDef = [...defPlays].reverse();
    const offRows = allOff.map((p, i) => {
      if (p.type === "penalty") return [
        "Offense", p.driveNumber || "", fpLabel(p.fieldPos) || "", i + 1,
        p.hash || "", "", ordinal(p.down), p.distance,
        "", "", "", "", "", "", "", "PENALTY", "Penalty",
        `${p.penaltyOnUs ? "On Us" : "On Them"} — ${p.penaltyType}`, p.yards, "", "", "",
        "", "", "", "", "", "", "", "", "", "", "", "", "",
      ];
      if (p.type === "punt") return [
        "Offense", p.driveNumber || "", fpLabel(p.fieldPos) || "", i + 1,
        p.hash || "", "", ordinal(p.down), p.distance,
        "", "", "", "", "", "", "", "PUNT", "Punt",
        p.puntResult || "", p.puntDist || 0, "", "", "",
        "", "", "", "", "", "", "", "", "", "", "", p.puntReturn || 0, p.puntNet || 0,
      ];
      return [
        "Offense", p.driveNumber || "", fpLabel(p.fieldPos) || "", i + 1,
        p.hash, "", ordinal(p.down), p.distance,
        p.personnel, p.formation, (p.formTags || []).join(" "), (p.rpoTags || []).join(" "),
        p.rpoTags?.length > 0 ? (p.rpoPlayer || "") : "", p.motion,
        p.motion !== "None" ? (p.motionPlayer || "") : "",
        (p.runCarrier && p.playType === "Run") ? `${p.runCarrier} ${p.play}` : p.play,
        p.playType || "", p.gainType || "", p.incomplete ? 0 : p.yards, p.incomplete ? "INC" : "", p.carrier || "", p.tackler,
        "", "", "", "", "", "", "", "", "", "", "", "", "",
      ];
    });
    const defRows = allDef.map((p, i) => {
      if (p.type === "penalty") return [
        "Defense", p.driveNumber || "", fpLabel(p.fieldPos) || "", i + 1,
        p.hash || "", "", ordinal(p.down), p.distance,
        "", "", "", "", "", "", "", "PENALTY", "Penalty",
        `${p.penaltyOnUs ? "On Us" : "On Them"} — ${p.penaltyType}`, p.yards, "", "", "",
        "", "", "", "", "", "", "", "", "", "", "", "", "",
      ];
      return [
        "Defense", p.driveNumber || "", fpLabel(p.fieldPos) || "", i + 1,
        p.hash, p.fieldBdry || "", ordinal(p.down), p.distance,
        "", "", "", "", "", "", "", "", p.playType || "", p.gainType || "", p.incomplete ? 0 : p.yards, p.incomplete ? "INC" : "", "", "",
        p.oppPersonnel, p.oppFormation, (p.oppFormTags || []).join(" "),
        p.oppMotion, p.oppMotion !== "None" ? (p.oppMotionPlayer || "") : "", p.play,
        p.front || "", p.coverage || "", p.blitz || "", p.carrier || "", p.tackler, "", "",
      ];
    });
    const csv = [headers, ...offRows, ...defRows].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `sideline-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function logPunt() {
    const noReturnResults = ["Fair Catch", "Downed", "Out of Bounds", "Touchback", "Blocked"];
    const actualReturn = noReturnResults.includes(puntResult) ? 0 : puntReturn;
    let newAbs = ytdg;
    let keepPossession = false;
    if (ytdg != null) {
      const landing = Math.min(99, ytdg + puntDist);
      if (puntResult === "Touchback") { newAbs = 80; }
      else if (puntResult === "Blocked") { newAbs = ytdg; }
      else if (noReturnResults.includes(puntResult)) { newAbs = Math.max(1, Math.min(98, landing)); }
      else if (puntResult === "Fumble-Us") { newAbs = Math.max(1, Math.min(99, landing - actualReturn)); keepPossession = true; }
      else { newAbs = Math.max(1, Math.min(99, landing - actualReturn)); }
    }
    const net = ytdg != null ? newAbs - ytdg : puntDist - actualReturn;
    const newPlay = {
      id: Date.now() + Math.random(), driveNumber, fieldPos: ytdg ?? null,
      type: "punt", down, distance, hash,
      puntDist, puntReturn: actualReturn, puntResult, puntNet: net,
    };
    const next = [newPlay, ...offPlays];
    setOffPlays(next); persist(next, "offense");
    if (keepPossession) {
      if (newAbs != null) { setYtdg(newAbs); persistGameState(newAbs, driveNumber); }
      setDown(1); setDistance(Math.min(10, ytdgMaxDist(newAbs ?? 1, "offense")));
    } else {
      tagDriveOutcome(driveNumber, puntResult === "Blocked" ? "Blocked Punt" : "Punt");
      if (newAbs != null) { setYtdg(newAbs); persistGameState(newAbs, driveNumber); }
      setDown(1); setDistance(10); setNeedNewDrive(true);
    }
    setShowPunt(false); setPuntDist(35); setPuntReturn(0); setPuntResult("Returned");
  }

  function endDrive() {
    if (endDriveOutcome) tagDriveOutcome(driveNumber, endDriveOutcome);
    setNeedNewDrive(true);
    setShowEndDrive(false);
    setEndDriveOutcome("");
  }

  const tendencies = useMemo(() => calcTendencies(offPlays), [offPlays]);
  const defTendencies = useMemo(() => calcDefTendencies(defPlays), [defPlays]);

  return (
    <Shell subtitle={label} onBack={onBack}
      right={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setShowScoreEdit(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: "#1d2530", border: "1px solid #2a3543", borderRadius: 10, padding: "6px 12px", cursor: "pointer" }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: "#f5c518", minWidth: 22, textAlign: "right" }}>{usScore}</span>
            <span style={{ color: "#4a5568", fontSize: 14 }}>–</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: "#c4cdda", minWidth: 22 }}>{themScore}</span>
          </button>
          <span style={{ fontSize: 11, color: syncing ? "#f5c518" : "#3ddc84" }}>{syncing ? "sync…" : "●"}</span>
        </div>
      }>

      {/* Side toggle */}
      <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid #1d2530" }}>
        <button onClick={() => setSide("offense")} style={modeBtn(side === "offense", true)}>Offense</button>
        <button onClick={() => setSide("defense")} style={modeBtn(side === "defense")}>Defense</button>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid #1d2530" }}>
        <button onClick={() => setMode("view")} style={modeBtn(mode === "view")}>View</button>
        <button onClick={() => setMode("edit")} style={modeBtn(mode === "edit", true)}>Edit</button>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #1d2530" }}>
        {[["log", editing ? "Log Play" : "Plays"], ["tendencies", "Trends"], ["reports", "Reports"], ["export", "Export"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "12px 4px", background: tab === k ? "#141a24" : "transparent", color: tab === k ? "#f5c518" : "#7a8699",
            border: "none", borderBottom: tab === k ? "2px solid #f5c518" : "2px solid transparent",
            fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", cursor: "pointer",
          }}>{l}</button>
        ))}
      </div>

      {/* Score edit overlay */}
      {showScoreEdit && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#141a24", border: "1px solid #2a3543", borderRadius: 16, padding: 24, width: "100%", maxWidth: 360 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#f5c518", marginBottom: 20 }}>Edit Score</div>
            <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
              {[["Us", usScore, setUsScore], ["Them", themScore, setThemScore]].map(([lbl, val, setter]) => (
                <div key={lbl} style={{ flex: 1, background: "#1d2530", borderRadius: 12, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: "#7a8699", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>{lbl}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    <button onClick={() => { const n = Math.max(0, val - 1); setter(n); scoreRef.current = { ...scoreRef.current, usScore: lbl === "Us" ? n : scoreRef.current.usScore, themScore: lbl === "Them" ? n : scoreRef.current.themScore }; }} style={stepBtn}>–</button>
                    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 700, minWidth: 46, textAlign: "center" }}>{val}</span>
                    <button onClick={() => { const n = val + 1; setter(n); scoreRef.current = { ...scoreRef.current, usScore: lbl === "Us" ? n : scoreRef.current.usScore, themScore: lbl === "Them" ? n : scoreRef.current.themScore }; }} style={stepBtn}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => {
              setShowScoreEdit(false);
              persistGameState(ytdg, driveNumber);
            }} style={{ width: "100%", padding: "16px", borderRadius: 12, border: "none", background: "#f5c518", color: "#0a0e14", fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>Done</button>
          </div>
        </div>
      )}

      {/* Scoring prompt overlay */}
      {showScorePrompt && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#141a24", border: `2px solid ${scoringTeam === "us" ? "#3ddc84" : "#ff5252"}`, borderRadius: 16, padding: 24, width: "100%", maxWidth: 360 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: scoringTeam === "us" ? "#3ddc84" : "#ff5252", marginBottom: 6 }}>
              {scoringTeam === "us" ? "We Scored!" : "They Scored"}
            </div>
            <div style={{ fontSize: 13, color: "#a8b3c4", marginBottom: 20 }}>
              {scorePromptType === "td" ? "Select the result:" : scorePromptType === "fg" ? "Field goal result:" : "Safety — select:"}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {scorePromptType === "td" && <>
                <button onClick={() => applyScore(6)} style={{ flex: 1, minWidth: "40%", padding: "16px 8px", borderRadius: 10, border: "none", background: "#3ddc84", color: "#0a0e14", fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, cursor: "pointer" }}>+6 TD</button>
                <button onClick={() => applyScore(7)} style={{ flex: 1, minWidth: "40%", padding: "16px 8px", borderRadius: 10, border: "none", background: "#2db870", color: "#0a0e14", fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, cursor: "pointer" }}>+7 (PAT)</button>
                <button onClick={() => applyScore(8)} style={{ flex: 1, minWidth: "40%", padding: "16px 8px", borderRadius: 10, border: "none", background: "#259e60", color: "#0a0e14", fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, cursor: "pointer" }}>+8 (2-pt)</button>
              </>}
              {scorePromptType === "fg" && <>
                <button onClick={() => applyScore(3)} style={{ flex: 1, padding: "16px 8px", borderRadius: 10, border: "none", background: "#3ddc84", color: "#0a0e14", fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, cursor: "pointer" }}>+3 Good</button>
              </>}
              {scorePromptType === "safety" && <>
                <button onClick={() => applyScore(2)} style={{ flex: 1, padding: "16px 8px", borderRadius: 10, border: "none", background: "#3ddc84", color: "#0a0e14", fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, cursor: "pointer" }}>+2 Safety</button>
              </>}
              <button onClick={() => applyScore(0)} style={{ flex: 1, minWidth: "40%", padding: "16px 8px", borderRadius: 10, border: "1px solid #4a5568", background: "none", color: "#7a8699", fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>No Score</button>
            </div>
          </div>
        </div>
      )}

      {tab === "log" && (
        <div style={{ padding: 16 }}>

          {/* Ball position banner */}
          <div style={{ background: "#11161f", border: "1px solid #1d2530", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
            {ytdg !== null ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 2 }}>Ball · Drive {driveNumber}</div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: 1, color: "#f4f4f0" }}>
                    {ytdgLabel(ytdg, fpDisplayMode)}
                    {((side === "offense" && ytdg >= 90) || (side === "defense" && ytdg <= 10)) && <span style={{ fontFamily: FONT_DISPLAY, fontSize: 13, color: "#f5c518", marginLeft: 10, letterSpacing: 1 }}>GOAL LINE</span>}
                  </div>
                </div>
                {editing && !needNewDrive && !showEndDrive && <button onClick={() => { setEndDriveOutcome(""); setShowEndDrive(true); }} style={{ background: "none", border: "1px solid #ff5252", borderRadius: 8, color: "#ff5252", fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", padding: "8px 12px", cursor: "pointer" }}>End Drive</button>}
                {editing && <button onClick={() => {
                  if (fpDisplayMode === "pm50") { setNdPmValue(ytdg - 50); }
                  else if (ytdg === 50) { setNdTerritory("50"); setNdYard(25); }
                  else if (ytdg > 50) { setNdTerritory("opp"); setNdYard(100 - ytdg); }
                  else { setNdTerritory("own"); setNdYard(ytdg); }
                  openNewDrivePanel();
                  setShowNewDrive(true); setNeedNewDrive(false);
                }} style={{ background: "#1d2530", border: "1px solid #2a3543", borderRadius: 8, color: "#f5c518", fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", padding: "8px 12px", cursor: "pointer" }}>New Drive</button>}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, color: "#4a5568", fontSize: 13 }}>No field position set. Tap <b style={{ color: "#7a8699" }}>New Drive</b> to start tracking.</div>
                {editing && <button onClick={() => {
                  if (fpDisplayMode === "pm50") setNdPmValue(-25); else { setNdTerritory("own"); setNdYard(25); }
                  openNewDrivePanel();
                  setShowNewDrive(true);
                }} style={{ background: "#f5c518", border: "none", borderRadius: 8, color: "#0a0e14", fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", padding: "8px 12px", cursor: "pointer" }}>New Drive</button>}
              </div>
            )}
          </div>

          {/* Need New Drive banner */}
          {needNewDrive && (
            <div style={{ background: "#1a1208", border: "1px solid #f5c518", borderRadius: 12, padding: "12px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, fontFamily: FONT_DISPLAY, fontSize: 14, color: "#f5c518", letterSpacing: 1 }}>Drive ended — start the next drive.</div>
              <button onClick={() => {
                if (fpDisplayMode === "pm50") setNdPmValue(-25); else { setNdTerritory("own"); setNdYard(25); }
                openNewDrivePanel();
                setShowNewDrive(true);
              }} style={{ background: "#f5c518", border: "none", borderRadius: 8, color: "#0a0e14", fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", padding: "8px 12px", cursor: "pointer" }}>New Drive</button>
            </div>
          )}

          {/* New Drive panel */}
          {showNewDrive && (
            <div style={{ background: "#141a24", border: "1px solid #f5c518", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#f5c518", marginBottom: 14 }}>
                {ytdg !== null ? `Starting Drive ${driveNumber + 1}` : "Set Starting Field Position"}
              </div>

              {/* Quarter */}
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Quarter</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {[1, 2, 3, 4, "OT"].map((q) => (
                  <button key={q} onClick={() => setNdQuarter(q)} style={{ flex: 1, padding: "12px 0", borderRadius: 8, border: "none", background: ndQuarter === q ? "#f5c518" : "#1d2530", color: ndQuarter === q ? "#0a0e14" : "#a8b3c4", fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 700, letterSpacing: 1, cursor: "pointer" }}>{q}</button>
                ))}
              </div>

              {/* Clock */}
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Clock</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => setNdClockMin(Math.max(0, ndClockMin - 1))} style={{ ...stepBtn, width: 38, height: 38, fontSize: 20 }}>–</button>
                    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 46, textAlign: "center" }}>{ndClockMin}</span>
                    <button onClick={() => setNdClockMin(Math.min(12, ndClockMin + 1))} style={{ ...stepBtn, width: 38, height: 38, fontSize: 20 }}>+</button>
                  </div>
                  <span style={{ fontSize: 11, color: "#4a5568", letterSpacing: 1 }}>MIN</span>
                </div>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, color: "#7a8699", marginBottom: 14 }}>:</span>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => setNdClockSec(ndClockSec === 0 ? 55 : ndClockSec - 5)} style={{ ...stepBtn, width: 38, height: 38, fontSize: 20 }}>–</button>
                    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 46, textAlign: "center" }}>{String(ndClockSec).padStart(2, "0")}</span>
                    <button onClick={() => setNdClockSec(ndClockSec === 55 ? 0 : ndClockSec + 5)} style={{ ...stepBtn, width: 38, height: 38, fontSize: 20 }}>+</button>
                  </div>
                  <span style={{ fontSize: 11, color: "#4a5568", letterSpacing: 1 }}>SEC</span>
                </div>
              </div>

              {/* Score */}
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Score at Drive Start</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
                {[["Us", ndUsScore, setNdUsScore], ["Them", ndThemScore, setNdThemScore]].map(([lbl, val, setter]) => (
                  <div key={lbl} style={{ flex: 1, background: "#1d2530", borderRadius: 10, padding: "10px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#7a8699", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>{lbl}</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <button onClick={() => setter(Math.max(0, val - 1))} style={{ ...stepBtn, width: 34, height: 34, fontSize: 18 }}>–</button>
                      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, minWidth: 36, textAlign: "center" }}>{val}</span>
                      <button onClick={() => setter(val + 1)} style={{ ...stepBtn, width: 34, height: 34, fontSize: 18 }}>+</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Field position */}
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Ball Spot</div>
              {fpDisplayMode === "pm50" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <button onClick={() => setNdPmValue(Math.max(-49, ndPmValue - 1))} style={stepBtn}>–</button>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 60, textAlign: "center" }}>
                    {ndPmValue === 0 ? "50" : ndPmValue > 0 ? `+${ndPmValue}` : `${ndPmValue}`}
                  </span>
                  <button onClick={() => setNdPmValue(Math.min(49, ndPmValue + 1))} style={stepBtn}>+</button>
                  <span style={{ color: "#7a8699", fontSize: 13 }}>{ndPmValue > 0 ? "opp territory" : ndPmValue < 0 ? "own territory" : "midfield"}</span>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    {["own", "50", "opp"].map((t) => (
                      <button key={t} onClick={() => setNdTerritory(t)} style={{ flex: 1, padding: "12px 0", borderRadius: 8, border: "none", background: ndTerritory === t ? "#f5c518" : "#1d2530", color: ndTerritory === t ? "#0a0e14" : "#a8b3c4", fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>
                        {t === "own" ? "Own" : t === "50" ? "50" : "Opp"}
                      </button>
                    ))}
                  </div>
                  {ndTerritory !== "50" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                      <button onClick={() => setNdYard(Math.max(1, ndYard - 1))} style={stepBtn}>–</button>
                      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 50, textAlign: "center" }}>{ndYard}</span>
                      <button onClick={() => setNdYard(Math.min(49, ndYard + 1))} style={stepBtn}>+</button>
                      <span style={{ color: "#7a8699", fontSize: 13 }}>{ndTerritory === "own" ? "own yard line" : "opp yard line"}</span>
                    </div>
                  )}
                </>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={startNewDrive} style={{ flex: 1, padding: "14px", borderRadius: 10, border: "none", background: "#f5c518", color: "#0a0e14", fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>
                  {ytdg !== null ? `Start Drive ${driveNumber + 1}` : "Set Position"}
                </button>
                <button onClick={() => { setShowNewDrive(false); setNeedNewDrive(false); }} style={{ padding: "14px 18px", borderRadius: 10, border: "1px solid #2a3543", background: "none", color: "#7a8699", fontFamily: FONT_DISPLAY, fontSize: 14, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Penalty panel */}
          {showPenalty && (
            <div style={{ background: "#141a24", border: "1px solid #f59e0b", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#f59e0b", marginBottom: 12 }}>Flag on the Play</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Penalty Type</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {(playbook.penalties ?? DEFAULT_PLAYBOOK.penalties).map((pt) => (
                  <Chip key={pt} active={penaltyType === pt} onClick={() => setPenaltyType(penaltyType === pt ? "" : pt)}>{pt}</Chip>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <button onClick={() => setPenaltyOnUs(true)} style={{ flex: 1, padding: "12px 0", borderRadius: 8, border: "none", background: penaltyOnUs ? "#ff5252" : "#1d2530", color: penaltyOnUs ? "#fff" : "#a8b3c4", fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 700, letterSpacing: 1, cursor: "pointer" }}>On Us</button>
                <button onClick={() => setPenaltyOnUs(false)} style={{ flex: 1, padding: "12px 0", borderRadius: 8, border: "none", background: !penaltyOnUs ? "#3ddc84" : "#1d2530", color: !penaltyOnUs ? "#0a0e14" : "#a8b3c4", fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 700, letterSpacing: 1, cursor: "pointer" }}>On Them</button>
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Yards</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <button onClick={() => setPenaltyYards(Math.max(1, penaltyYards - 1))} style={stepBtn}>–</button>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 50, textAlign: "center" }}>{penaltyYards}</span>
                <button onClick={() => setPenaltyYards(penaltyYards + 1)} style={stepBtn}>+</button>
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Override</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <button onClick={() => { setPenaltyAutoFirst(!penaltyAutoFirst); if (!penaltyAutoFirst) setPenaltyReplay(false); }} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${penaltyAutoFirst ? "#f5c518" : "#2a3543"}`, background: penaltyAutoFirst ? "#1a1810" : "none", color: penaltyAutoFirst ? "#f5c518" : "#7a8699", fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>Auto 1st Down</button>
                <button onClick={() => { setPenaltyReplay(!penaltyReplay); if (!penaltyReplay) setPenaltyAutoFirst(false); }} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${penaltyReplay ? "#f5c518" : "#2a3543"}`, background: penaltyReplay ? "#1a1810" : "none", color: penaltyReplay ? "#f5c518" : "#7a8699", fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>Replay Down</button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={logPenalty} disabled={!penaltyType} style={{ flex: 1, padding: "14px", borderRadius: 10, border: "none", background: penaltyType ? "#f59e0b" : "#1d2530", color: penaltyType ? "#0a0e14" : "#4a5568", fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: penaltyType ? "pointer" : "not-allowed" }}>Log Flag</button>
                <button onClick={() => { setShowPenalty(false); setPenaltyType(""); setPenaltyYards(5); setPenaltyOnUs(true); setPenaltyAutoFirst(false); setPenaltyReplay(false); }} style={{ padding: "14px 18px", borderRadius: 10, border: "1px solid #2a3543", background: "none", color: "#7a8699", fontFamily: FONT_DISPLAY, fontSize: 14, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Punt panel */}
          {showPunt && side === "offense" && (
            <div style={{ background: "#141a24", border: "1px solid #5b8af5", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#5b8af5", marginBottom: 12 }}>Punt</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Punt Distance (yds)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <button onClick={() => setPuntDist(Math.max(0, puntDist - 1))} style={stepBtn}>–</button>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 50, textAlign: "center" }}>{puntDist}</span>
                <button onClick={() => setPuntDist(Math.min(80, puntDist + 1))} style={stepBtn}>+</button>
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Result</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {["Returned", "Fair Catch", "Touchback", "Downed", "Out of Bounds", "Blocked", "Fumble-Us", "Fumble-Them"].map(r => (
                  <Chip key={r} active={puntResult === r} onClick={() => setPuntResult(r)}>{r}</Chip>
                ))}
              </div>
              {["Returned", "Fumble-Us", "Fumble-Them"].includes(puntResult) && (<>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Return Yards</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <button onClick={() => setPuntReturn(Math.max(-10, puntReturn - 1))} style={stepBtn}>–</button>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 50, textAlign: "center" }}>{puntReturn}</span>
                  <button onClick={() => setPuntReturn(Math.min(50, puntReturn + 1))} style={stepBtn}>+</button>
                </div>
              </>)}
              {ytdg != null && (() => {
                const noRet = ["Fair Catch", "Downed", "Out of Bounds"].includes(puntResult);
                const landing = Math.min(99, ytdg + puntDist);
                const endAbs = puntResult === "Touchback" ? 80 : puntResult === "Blocked" ? ytdg : noRet ? Math.max(1, Math.min(98, landing)) : Math.max(1, Math.min(99, landing - puntReturn));
                const net = endAbs - ytdg;
                return (
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, color: "#a8b3c4", marginBottom: 14 }}>
                    Net {net >= 0 ? "+" : ""}{net} yds → {ytdgLabel(endAbs, fpDisplayMode)}
                    {puntResult === "Fumble-Us" && <span style={{ color: "#3ddc84", marginLeft: 8 }}>We recover — keep possession</span>}
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={logPunt} style={{ flex: 1, padding: "14px", borderRadius: 10, border: "none", background: "#5b8af5", color: "#fff", fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>Log Punt</button>
                <button onClick={() => { setShowPunt(false); setPuntDist(35); setPuntReturn(0); setPuntResult("Returned"); }} style={{ padding: "14px 18px", borderRadius: 10, border: "1px solid #2a3543", background: "none", color: "#7a8699", fontFamily: FONT_DISPLAY, fontSize: 14, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {/* End Drive panel */}
          {showEndDrive && editing && (
            <div style={{ background: "#141a24", border: "1px solid #ff5252", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#ff5252", marginBottom: 12 }}>End Drive {driveNumber}</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Outcome</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {(playbook.driveOutcomes ?? DEFAULT_PLAYBOOK.driveOutcomes).map(o => (
                  <Chip key={o} active={endDriveOutcome === o} onClick={() => setEndDriveOutcome(endDriveOutcome === o ? "" : o)}>{o}</Chip>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={endDrive} style={{ flex: 1, padding: "14px", borderRadius: 10, border: "none", background: "#ff5252", color: "#fff", fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>End Drive</button>
                <button onClick={() => { setShowEndDrive(false); setEndDriveOutcome(""); }} style={{ padding: "14px 18px", borderRadius: 10, border: "1px solid #2a3543", background: "none", color: "#7a8699", fontFamily: FONT_DISPLAY, fontSize: 14, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {editing && !showNewDrive && !showPenalty && !showPunt && !showEndDrive && (
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button onClick={() => setShowPenalty(true)} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #f59e0b", background: "none", color: "#f59e0b", fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>🚩 Flag</button>
              {side === "offense" && <button onClick={() => { setShowPunt(true); setPuntDist(35); setPuntReturn(0); setPuntResult("Returned"); }} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #5b8af5", background: "none", color: "#5b8af5", fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>Punt</button>}
            </div>
          )}

          {editing && side === "offense" && (
            <>
              {sectionOrder.map((key) => {
                const sectionMap = {
                  hash: (<Section label="Hash"><div style={{ display: "flex", gap: 8 }}>{HASHES.map((h) => <Chip key={h} active={hash === h} onClick={() => setHash(h)} big>{h}</Chip>)}</div></Section>),
                  downDistance: (
                    <Section label="Down & Distance">
                      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>{[1, 2, 3, 4].map((d) => <Chip key={d} active={down === d} onClick={() => setDown(d)} big>{ordinal(d)}</Chip>)}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ color: "#7a8699", fontSize: 14, textTransform: "uppercase", letterSpacing: 1 }}>&amp;</span>
                        <button onClick={() => setDistance(Math.max(distance - 1, 1))} style={stepBtn}>–</button>
                        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 50, textAlign: "center" }}>{distance}{ytdg !== null && ((side === "offense" && ytdg >= 90 && distance >= 100 - ytdg) || (side === "defense" && ytdg <= 10 && distance >= ytdg)) ? <span style={{ fontSize: 13, color: "#f5c518", display: "block", letterSpacing: 1 }}>GOAL</span> : null}</span>
                        <button onClick={() => setDistance(Math.min(distance + 1, ytdgMaxDist(ytdg, side)))} style={stepBtn}>+</button>
                        <span style={{ color: "#7a8699", fontSize: 13 }}>yds to go</span>
                      </div>
                    </Section>
                  ),
                  personnel: sec.personnel ? (<Section label="Personnel"><Grid>{ORD_PERSONNEL.map((p) => <Chip key={p} active={personnel === p} onClick={() => setPersonnel(personnel === p ? "" : p)}>{p}</Chip>)}</Grid></Section>) : null,
                  formation: (<Section label="Formation"><Grid>{ORD_FORMATIONS.map((f) => <Chip key={f} active={formation === f} onClick={() => setFormation(f)}>{f}</Chip>)}</Grid></Section>),
                  formTags: sec.formTags ? (<Section label="Formation Tags · tap multiple"><Grid>{ORD_FORM_TAGS.map((t) => <Chip key={t} active={formTags.includes(t)} onClick={() => toggle(formTags, setFormTags, t)}>{t}</Chip>)}</Grid></Section>) : null,
                  motion: sec.motion ? (
                    <Section label="Shift / Motion">
                      <Grid>{ORD_MOTIONS.map((m) => <Chip key={m} active={motion === m} onClick={() => { setMotion(m); if (m === "None") setMotionPlayer(""); }}>{m}</Chip>)}</Grid>
                      {motion !== "None" && (<div style={{ marginTop: 10 }}><div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Who's in motion?</div><Grid>{POSITIONS.map((p) => <Chip key={p} active={motionPlayer === p} onClick={() => setMotionPlayer(motionPlayer === p ? "" : p)}>{p}</Chip>)}</Grid></div>)}
                    </Section>
                  ) : null,
                  runPlay: (
                    <Section label="Run Play">
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Carrier</div>
                      <Grid>{["Q", "F", "A", "B", "Y", "X"].map((pos) => <Chip key={pos} active={runCarrier === pos} onClick={() => setRunCarrier(runCarrier === pos ? "" : pos)}>{pos}</Chip>)}</Grid>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", margin: "12px 0 8px" }}>Play</div>
                      <Grid>{ORD_RUN_PLAYS.map((p) => <Chip key={p} active={play === p && playType === "Run"} onClick={() => { setPlay(p); setPlayType("Run"); }}>{p}</Chip>)}</Grid>
                    </Section>
                  ),
                  rpoTags: sec.rpo ? (
                    <Section label="RPO Tags · tap multiple">
                      <Grid>{ORD_RPO_TAGS.map((t) => <Chip key={t} active={rpoTags.includes(t)} onClick={() => toggle(rpoTags, setRpoTags, t)}>{t}</Chip>)}</Grid>
                      {rpoTags.length > 0 && (<div style={{ marginTop: 10 }}><div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Who's running the RPO?</div><Grid>{POSITIONS.map((p) => <Chip key={p} active={rpoPlayer === p} onClick={() => setRpoPlayer(rpoPlayer === p ? "" : p)}>{p}</Chip>)}</Grid></div>)}
                    </Section>
                  ) : null,
                  passPlay: (<Section label="Pass Play"><Grid>{ORD_PASS_PLAYS.map((p) => <Chip key={p} active={play === p && playType === "Pass"} onClick={() => { setPlay(p); setPlayType("Pass"); }}>{p}</Chip>)}</Grid></Section>),
                  result: (
                    <>
                      <Section label="Result">
                        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                          <Chip active={gainType === "Run"} onClick={() => { setGainType("Run"); setIncomplete(false); }} big>Run</Chip>
                          <Chip active={gainType === "Pass" && !incomplete} onClick={() => { setGainType("Pass"); setIncomplete(false); }} big>Pass</Chip>
                          <Chip active={incomplete && gainType === "Pass"} onClick={() => { setGainType("Pass"); setIncomplete(true); setYards(""); setCarrier(""); }} big>Inc</Chip>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                          <Chip active={gainType === "TD"} onClick={() => { setGainType("TD"); setIncomplete(false); }} big>TD</Chip>
                          <Chip active={gainType === "INT"} onClick={() => { setGainType("INT"); setIncomplete(true); setYards(""); setCarrier(""); }} big>INT</Chip>
                          <Chip active={gainType === "Fumble"} onClick={() => { setGainType("Fumble"); setIncomplete(false); }} big>Fumble</Chip>
                          <Chip active={gainType === "Safety"} onClick={() => { setGainType("Safety"); setIncomplete(true); setYards(""); setCarrier(""); }} big>Safety</Chip>
                          <Chip active={gainType === "Sack"} onClick={() => { setGainType("Sack"); setIncomplete(false); setPlayType("Pass"); setYards("0"); }} big>Sack</Chip>
                          <Chip active={gainType === "FG"} onClick={() => { setGainType("FG"); setIncomplete(true); setYards(""); setCarrier(""); }} big>FG</Chip>
                        </div>
                        {gainType === "INT" ? <div style={{ color: "#ff5252", fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>INTERCEPTION — 0 yards</div>
                          : gainType === "Safety" ? <div style={{ color: "#ff5252", fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>SAFETY — 0 yards</div>
                          : incomplete ? <div style={{ color: "#ff5252", fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>INCOMPLETE — 0 yards</div>
                          : (<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <button onClick={() => setYards(String((parseInt(yards, 10) || 0) - 1))} style={stepBtn}>–</button>
                            <input value={yards} onChange={(e) => setYards(e.target.value.replace(/[^-0-9]/g, ""))} placeholder="0" inputMode="numeric" style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, width: 90, textAlign: "center", background: "#141a24", border: "1px solid #2a3543", borderRadius: 10, color: "#f5c518", padding: "6px 0" }} />
                            <button onClick={() => setYards(String((parseInt(yards, 10) || 0) + 1))} style={stepBtn}>+</button>
                            <span style={{ color: "#7a8699", fontSize: 13 }}>{gainType === "Sack" ? "yards lost" : "yards gained"}</span>
                          </div>)}
                      </Section>
                      {playType === "Pass" && gainType !== "Sack" && (
                        <Section label="Passer #">
                          {usedPassers.length > 0 && <Grid>{usedPassers.map((n) => <Chip key={n} active={passer === n} onClick={() => setPasser(passer === n ? "" : n)}>#{n}</Chip>)}</Grid>}
                          <input value={passer} onChange={(e) => setPasser(e.target.value.replace(/[^0-9]/g, ""))} placeholder="QB jersey # (type new)" inputMode="numeric" style={{ ...inputStyle, marginTop: usedPassers.length ? 10 : 0 }} />
                        </Section>
                      )}
                      {gainType === "Fumble" && (
                        <Section label="Fumble Details">
                          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Who forced the fumble?</div>
                          <Grid>{DEF_POS.map((pos) => <Chip key={pos} active={fumbleForcerPos === pos} onClick={() => setFumbleForcerPos(fumbleForcerPos === pos ? "" : pos)}>{pos}</Chip>)}</Grid>
                          <input value={fumbleForcerNum} onChange={(e) => setFumbleForcerNum(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Defender jersey #" inputMode="numeric" style={{ ...inputStyle, marginTop: 10 }} />
                          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginTop: 14, marginBottom: 8 }}>Recovered by</div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <Chip active={fumbleRecovery === "Offense"} onClick={() => setFumbleRecovery(fumbleRecovery === "Offense" ? "" : "Offense")} big>Offense</Chip>
                            <Chip active={fumbleRecovery === "Defense"} onClick={() => setFumbleRecovery(fumbleRecovery === "Defense" ? "" : "Defense")} big>Defense</Chip>
                          </div>
                        </Section>
                      )}
                      {gainType === "INT" && (
                        <Section label="Interception Details">
                          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Who made the INT?</div>
                          <Grid>{DEF_POS.map((pos) => <Chip key={pos} active={intByPos === pos} onClick={() => setIntByPos(intByPos === pos ? "" : pos)}>{pos}</Chip>)}</Grid>
                          <input value={intByNum} onChange={(e) => setIntByNum(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Defender jersey #" inputMode="numeric" style={{ ...inputStyle, marginTop: 10 }} />
                          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginTop: 14, marginBottom: 8 }}>Return yards</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <button onClick={() => setIntReturn(String(Math.max(0, (parseInt(intReturn, 10) || 0) - 1)))} style={stepBtn}>–</button>
                            <input value={intReturn} onChange={(e) => setIntReturn(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" inputMode="numeric" style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, width: 90, textAlign: "center", background: "#141a24", border: "1px solid #2a3543", borderRadius: 10, color: "#f5c518", padding: "6px 0" }} />
                            <button onClick={() => setIntReturn(String((parseInt(intReturn, 10) || 0) + 1))} style={stepBtn}>+</button>
                            <span style={{ color: "#7a8699", fontSize: 13 }}>return yards</span>
                          </div>
                        </Section>
                      )}
                    </>
                  ),
                  carrier: sec.carrier && !incomplete ? (
                    <Section label="Ball Carrier / Receiver #">
                      {usedCarriers.length > 0 && <Grid>{usedCarriers.map((n) => <Chip key={n} active={carrier === n} onClick={() => setCarrier(carrier === n ? "" : n)}>#{n}</Chip>)}</Grid>}
                      <input value={carrier} onChange={(e) => setCarrier(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Jersey # (type new)" inputMode="numeric" style={{ ...inputStyle, marginTop: usedCarriers.length ? 10 : 0 }} />
                    </Section>
                  ) : null,
                  tackler: sec.tackler ? (
                    <Section label={gainType === "Sack" ? "Sack / TFL — Defender" : "Tackled By (Defender)"}>
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
                  ) : null,
                };
                const content = sectionMap[key];
                if (!content) return null;
                return <React.Fragment key={key}>{content}</React.Fragment>;
              })}
              <button onClick={logPlay} disabled={!offReady} style={{
                width: "100%", marginTop: 8, padding: "18px", borderRadius: 12, border: "none",
                background: offReady ? "#f5c518" : "#1d2530", color: offReady ? "#0a0e14" : "#4a5568",
                fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", cursor: offReady ? "pointer" : "not-allowed",
              }}>Log Play ↵</button>
            </>
          )}

          {editing && side === "defense" && (
            <>
              {defSectionOrder.map((key) => {
                const defSectionMap = {
                  hash: (<Section label="Hash"><div style={{ display: "flex", gap: 8 }}>{HASHES.map((h) => <Chip key={h} active={hash === h} onClick={() => setHash(h)} big>{h}</Chip>)}</div></Section>),
                  fieldBdry: defSec.fieldBdry ? (
                    <Section label="Field / Boundary">
                      <div style={{ display: "flex", gap: 8 }}>{ORD_FIELD_BDRY.map((fb) => <Chip key={fb} active={defFieldBdry === fb} onClick={() => setDefFieldBdry(defFieldBdry === fb ? "" : fb)} big>{fb}</Chip>)}</div>
                    </Section>
                  ) : null,
                  downDistance: (
                    <Section label="Down & Distance">
                      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>{[1, 2, 3, 4].map((d) => <Chip key={d} active={down === d} onClick={() => setDown(d)} big>{ordinal(d)}</Chip>)}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ color: "#7a8699", fontSize: 14, textTransform: "uppercase", letterSpacing: 1 }}>&amp;</span>
                        <button onClick={() => setDistance(Math.max(distance - 1, 1))} style={stepBtn}>–</button>
                        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 50, textAlign: "center" }}>{distance}{ytdg !== null && ((side === "offense" && ytdg >= 90 && distance >= 100 - ytdg) || (side === "defense" && ytdg <= 10 && distance >= ytdg)) ? <span style={{ fontSize: 13, color: "#f5c518", display: "block", letterSpacing: 1 }}>GOAL</span> : null}</span>
                        <button onClick={() => setDistance(Math.min(distance + 1, ytdgMaxDist(ytdg, side)))} style={stepBtn}>+</button>
                        <span style={{ color: "#7a8699", fontSize: 13 }}>yds to go</span>
                      </div>
                    </Section>
                  ),
                  oppPersonnel: defSec.oppPersonnel ? (<Section label="Their Personnel"><Grid>{ORD_OPP_PERSONNEL.map((p) => <Chip key={p} active={defOppPersonnel === p} onClick={() => setDefOppPersonnel(defOppPersonnel === p ? "" : p)}>{p}</Chip>)}</Grid></Section>) : null,
                  oppFormation: (<Section label="Their Formation"><Grid>{ORD_OPP_FORMATIONS.map((f) => <Chip key={f} active={defOppFormation === f} onClick={() => setDefOppFormation(f)}>{f}</Chip>)}</Grid></Section>),
                  oppFormTags: defSec.oppFormTags ? (<Section label="Their Formation Tags · tap multiple"><Grid>{ORD_OPP_FORM_TAGS.map((t) => <Chip key={t} active={defOppFormTags.includes(t)} onClick={() => toggle(defOppFormTags, setDefOppFormTags, t)}>{t}</Chip>)}</Grid></Section>) : null,
                  oppMotion: defSec.oppMotion ? (
                    <Section label="Their Motion / Shift">
                      <Grid>{ORD_OPP_MOTIONS.map((m) => <Chip key={m} active={defOppMotion === m} onClick={() => { setDefOppMotion(m); if (m === "None") setDefOppMotionPlayer(""); }}>{m}</Chip>)}</Grid>
                      {defOppMotion !== "None" && (<div style={{ marginTop: 10 }}><div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Who's in motion?</div><Grid>{POSITIONS.map((p) => <Chip key={p} active={defOppMotionPlayer === p} onClick={() => setDefOppMotionPlayer(defOppMotionPlayer === p ? "" : p)}>{p}</Chip>)}</Grid></div>)}
                    </Section>
                  ) : null,
                  oppRunPlay: (<Section label="Their Run Play"><Grid>{ORD_OPP_RUN_PLAYS.map((p) => <Chip key={p} active={defPlay === p && defPlayType === "Run"} onClick={() => { setDefPlay(p); setDefPlayType("Run"); }}>{p}</Chip>)}</Grid></Section>),
                  oppPassPlay: (<Section label="Their Pass Play"><Grid>{ORD_OPP_PASS_PLAYS.map((p) => <Chip key={p} active={defPlay === p && defPlayType === "Pass"} onClick={() => { setDefPlay(p); setDefPlayType("Pass"); }}>{p}</Chip>)}</Grid></Section>),
                  result: (
                    <Section label="Result">
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <Chip active={defGainType === "Run"} onClick={() => { setDefGainType("Run"); setDefIncomplete(false); }} big>Run</Chip>
                        <Chip active={defGainType === "Pass" && !defIncomplete} onClick={() => { setDefGainType("Pass"); setDefIncomplete(false); }} big>Pass</Chip>
                        <Chip active={defIncomplete && defGainType === "Pass"} onClick={() => { setDefGainType("Pass"); setDefIncomplete(true); setDefYards(""); setDefCarrier(""); }} big>Inc</Chip>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                        <Chip active={defGainType === "TD"} onClick={() => { setDefGainType("TD"); setDefIncomplete(false); }} big>TD</Chip>
                        <Chip active={defGainType === "INT"} onClick={() => { setDefGainType("INT"); setDefIncomplete(true); setDefYards(""); setDefCarrier(""); }} big>INT</Chip>
                        <Chip active={defGainType === "Fumble"} onClick={() => { setDefGainType("Fumble"); setDefIncomplete(false); }} big>Fumble</Chip>
                        <Chip active={defGainType === "Safety"} onClick={() => { setDefGainType("Safety"); setDefIncomplete(true); setDefYards(""); setDefCarrier(""); }} big>Safety</Chip>
                        <Chip active={defGainType === "Sack"} onClick={() => { setDefGainType("Sack"); setDefIncomplete(false); setDefPlayType("Pass"); setDefYards("0"); }} big>Sack</Chip>
                      </div>
                      {defGainType === "INT" ? <div style={{ color: "#3ddc84", fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>INTERCEPTION — turnover!</div>
                        : defGainType === "Safety" ? <div style={{ color: "#3ddc84", fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>SAFETY — 2 points!</div>
                        : defIncomplete ? <div style={{ color: "#3ddc84", fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>INCOMPLETE — no gain</div>
                        : (<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <button onClick={() => setDefYards(String((parseInt(defYards, 10) || 0) - 1))} style={stepBtn}>–</button>
                          <input value={defYards} onChange={(e) => setDefYards(e.target.value.replace(/[^-0-9]/g, ""))} placeholder="0" inputMode="numeric" style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, width: 90, textAlign: "center", background: "#141a24", border: "1px solid #2a3543", borderRadius: 10, color: "#f5c518", padding: "6px 0" }} />
                          <button onClick={() => setDefYards(String((parseInt(defYards, 10) || 0) + 1))} style={stepBtn}>+</button>
                          <span style={{ color: "#7a8699", fontSize: 13 }}>{defGainType === "Sack" ? "yards lost" : "yards allowed"}</span>
                        </div>)}
                    </Section>
                  ),
                  defFront: defSec.defFront ? (<Section label="Our Front"><Grid>{ORD_DEF_FRONTS.map((f) => <Chip key={f} active={defFront === f} onClick={() => setDefFront(defFront === f ? "" : f)}>{f}</Chip>)}</Grid></Section>) : null,
                  defCoverage: defSec.defCoverage ? (<Section label="Our Coverage"><Grid>{ORD_DEF_COVERAGES.map((c) => <Chip key={c} active={defCoverage === c} onClick={() => setDefCoverage(defCoverage === c ? "" : c)}>{c}</Chip>)}</Grid></Section>) : null,
                  defBlitz: defSec.defBlitz ? (<Section label="Blitz Tag"><Grid>{ORD_DEF_BLITZ.map((b) => <Chip key={b} active={defBlitz === b} onClick={() => setDefBlitz(defBlitz === b ? "" : b)}>{b}</Chip>)}</Grid></Section>) : null,
                  carrier: defSec.carrier && !defIncomplete ? (
                    <Section label="Their Ball Carrier #">
                      {defUsedCarriers.length > 0 && <Grid>{defUsedCarriers.map((n) => <Chip key={n} active={defCarrier === n} onClick={() => setDefCarrier(defCarrier === n ? "" : n)}>#{n}</Chip>)}</Grid>}
                      <input value={defCarrier} onChange={(e) => setDefCarrier(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Jersey # (type new)" inputMode="numeric" style={{ ...inputStyle, marginTop: defUsedCarriers.length ? 10 : 0 }} />
                    </Section>
                  ) : null,
                  tackler: defSec.tackler ? (
                    <Section label="Our Tackler">
                      <Grid>{DEF_POS.map((pos) => <Chip key={pos} active={defTacklerPos === pos} onClick={() => setDefTacklerPos(defTacklerPos === pos ? "" : pos)}>{pos}</Chip>)}</Grid>
                      {defUsedTacklers.length > 0 && <div style={{ marginTop: 10 }}><Grid>{defUsedTacklers.map((n) => <Chip key={n} active={defTacklerNum === n} onClick={() => { const sel = defTacklerNum === n; setDefTacklerNum(sel ? "" : n); if (!sel && ourDefPosMap[n]) setDefTacklerPos(ourDefPosMap[n]); }}>{ourDefLabel(n)}</Chip>)}</Grid></div>}
                      <input value={defTacklerNum} onChange={(e) => setDefTacklerNum(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Jersey # (type new)" inputMode="numeric" style={{ ...inputStyle, marginTop: 10 }} />
                      {defTopTacklers.length > 0 && (
                        <div style={{ marginTop: 14, background: "#11161f", borderRadius: 10, padding: "12px 14px", border: "1px solid #1d2530" }}>
                          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>Top Tacklers · Our Defense</div>
                          {defTopTacklers.map(([num, ct], i) => (
                            <div key={num} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: ["#f5c518", "#c4cdda", "#cd7f32"][i], fontSize: 16, minWidth: 18 }}>{i + 1}</span>
                              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16 }}>{ourDefLabel(num)}</span>
                              <span style={{ marginLeft: "auto", color: "#a8b3c4", fontSize: 14 }}>{ct} {ct === 1 ? "tackle" : "tackles"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </Section>
                  ) : null,
                };
                const content = defSectionMap[key];
                if (!content) return null;
                return <React.Fragment key={key}>{content}</React.Fragment>;
              })}
              <button onClick={logDefPlay} disabled={!defReady} style={{
                width: "100%", marginTop: 8, padding: "18px", borderRadius: 12, border: "none",
                background: defReady ? "#3ddc84" : "#1d2530", color: defReady ? "#0a0e14" : "#4a5568",
                fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", cursor: defReady ? "pointer" : "not-allowed",
              }}>Log Play ↵</button>
            </>
          )}

          {!editing && (
            <div style={{ background: "#141a24", borderRadius: 10, padding: "12px 14px", marginBottom: 16, border: "1px solid #1d2530", fontSize: 13, color: "#a8b3c4" }}>
              View mode — watching the live game. Switch to Edit to chart plays.
            </div>
          )}
          {activePlays.length > 0 && (
            <div style={{ marginTop: editing ? 24 : 0 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 10 }}>
                {side === "offense" ? "Offense" : "Defense"} · {activePlays.length} {activePlays.length === 1 ? "play" : "plays"}
              </div>
              {activePlays.map((p, i) => {
                const showBanner = i > 0 && p.driveNumber && activePlays[i - 1].driveNumber && p.driveNumber !== activePlays[i - 1].driveNumber;
                const banner = showBanner ? (() => {
                  const pd = activePlays[i - 1].driveNumber;
                  const di = drives.find(d => d.driveNumber === pd);
                  const oc = di?.outcome ? (["Touchdown", "Field Goal"].includes(di.outcome) ? "#3ddc84" : ["Interception", "Fumble", "Blocked Punt", "Blocked FG", "Safety"].includes(di.outcome) ? "#ff5252" : "#a8b3c4") : null;
                  return (
                    <div style={{ borderTop: "1px solid #1d2530", margin: "4px 0 10px", padding: "6px 4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#4a5568" }}>Drive {pd}</span>
                      {di?.outcome && <span style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: oc }}>{di.outcome}</span>}
                    </div>
                  );
                })() : null;
                // Penalty play row
                if (p.type === "penalty") {
                  const hasResult = p.newDown != null && p.newDistance != null;
                  const tag = p.penaltyAutoFirst ? " · Auto 1st" : p.penaltyReplay ? " · Replay" : "";
                  return (
                    <React.Fragment key={p.id}>{banner}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: "3px solid #f59e0b" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: "#f59e0b" }}>🚩 FLAG · {p.penaltyType} · {p.penaltyOnUs ? "on us" : "on them"}{tag}</div>
                          <div style={{ fontSize: 13, color: "#a8b3c4", marginTop: 2 }}>
                            {ordinal(p.down)} &amp; {p.distance}{p.fieldPos != null ? ` · ${fpLabel(p.fieldPos, fpDisplayMode)}` : ""} · {Math.abs(p.yards)} yds
                            {hasResult && <span style={{ color: "#f5c518", marginLeft: 6 }}>→ {ordinal(p.newDown)} &amp; {p.newDistance}</span>}
                          </div>
                        </div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, color: "#f59e0b", minWidth: 44, textAlign: "right" }}>
                          {p.penaltyOnUs ? `−${Math.abs(p.yards)}` : `+${Math.abs(p.yards)}`}
                        </div>
                        {editing && <button onClick={() => deletePlay(p.id)} style={{ background: "none", border: "none", color: "#4a5568", fontSize: 20, cursor: "pointer", padding: "0 4px" }}>×</button>}
                      </div>
                    </React.Fragment>
                  );
                }
                if (p.type === "punt") {
                  const detail = p.puntResult === "Touchback" ? "Touchback" : p.puntResult === "Blocked" ? "Blocked" : `${p.puntDist} yd${p.puntReturn > 0 ? `, ${p.puntReturn} return` : ""} → net ${p.puntNet >= 0 ? "+" : ""}${p.puntNet}`;
                  return (
                    <React.Fragment key={p.id}>{banner}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: "3px solid #5b8af5" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15 }}>{ordinal(p.down)} &amp; {p.distance}{p.hash ? ` · ${p.hash}` : ""}{p.fieldPos != null ? ` · ${fpLabel(p.fieldPos, fpDisplayMode)}` : ""}{p.driveNumber ? ` · Drive ${p.driveNumber}` : ""}</div>
                          <div style={{ fontSize: 13, color: "#a8b3c4", marginTop: 2 }}>PUNT · {detail}</div>
                        </div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, minWidth: 44, textAlign: "right", color: "#5b8af5" }}>PUNT</div>
                        {editing && <button onClick={() => deletePlay(p.id)} style={{ background: "none", border: "none", color: "#4a5568", fontSize: 20, cursor: "pointer", padding: "0 4px" }}>×</button>}
                      </div>
                    </React.Fragment>
                  );
                }
                if (side === "offense") {
                  const col = p.gainType === "TD" ? "#3ddc84" : (p.incomplete || p.gainType === "INT" || p.gainType === "Safety" || p.gainType === "Sack") ? "#ff5252" : p.yards >= p.distance ? "#3ddc84" : p.yards < 0 ? "#ff5252" : "#f5c518";
                  return (
                    <React.Fragment key={p.id}>{banner}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${col}` }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15 }}>{ordinal(p.down)} &amp; {p.distance} · {p.hash}{p.fieldPos != null ? ` · ${fpLabel(p.fieldPos, fpDisplayMode)}` : ""}{p.driveNumber ? ` · Drive ${p.driveNumber}` : ""}</div>
                          <div style={{ fontSize: 13, color: "#a8b3c4", marginTop: 2 }}>{p.personnel} {p.formation}{p.formTags?.length ? ` ${p.formTags.join(" ")}` : ""} · {(p.runCarrier && p.playType === "Run") ? `${p.runCarrier} ${p.play}` : p.play}{p.rpoTags?.length ? ` · ${p.rpoTags.join("/")}${p.rpoPlayer ? " (" + p.rpoPlayer + ")" : ""}` : ""}{p.motion !== "None" ? ` · ${p.motionPlayer ? p.motionPlayer + " " : ""}${p.motion}` : ""}{p.passer ? ` · QB #${p.passer}` : ""}{p.carrier ? ` · #${p.carrier}` : ""}{p.gainType === "Fumble" ? ` · frc ${p.fumbleForcer || "—"}${p.fumbleRecovery ? " · " + p.fumbleRecovery.toLowerCase() + " rec" : ""}` : ""}{p.gainType === "INT" ? ` · int ${p.intBy || "—"}${p.intReturn ? " · " + p.intReturn + " yd ret" : ""}` : ""}{p.gainType !== "INT" && p.gainType !== "Fumble" ? ` · tkl ${p.tackler}` : ""}</div>
                        </div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, minWidth: 44, textAlign: "right", color: col }}>
                          {p.gainType === "INT" ? "INT" : p.gainType === "Safety" ? "SAF" : p.gainType === "TD" ? "TD" : p.gainType === "FG" ? "FG" : p.gainType === "Sack" ? "SCK" : p.incomplete ? "INC" : `${p.yards > 0 ? "+" : ""}${p.yards}`}
                        </div>
                        {editing && <button onClick={() => deletePlay(p.id)} style={{ background: "none", border: "none", color: "#4a5568", fontSize: 20, cursor: "pointer", padding: "0 4px" }}>×</button>}
                      </div>
                    </React.Fragment>
                  );
                } else {
                  const col = p.gainType === "INT" || p.gainType === "Safety" || p.gainType === "Fumble" ? "#3ddc84"
                    : p.gainType === "TD" ? "#ff5252"
                    : p.incomplete ? "#3ddc84"
                    : p.yards >= p.distance ? "#ff5252" : p.yards < 0 ? "#3ddc84" : "#f5c518";
                  return (
                    <React.Fragment key={p.id}>{banner}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${col}` }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15 }}>
                            {ordinal(p.down)} &amp; {p.distance} · {p.hash}{p.fieldBdry ? ` · ${p.fieldBdry}` : ""}{p.fieldPos != null ? ` · ${fpLabel(p.fieldPos, fpDisplayMode)}` : ""}{p.driveNumber ? ` · Drive ${p.driveNumber}` : ""}
                          </div>
                          <div style={{ fontSize: 13, color: "#a8b3c4", marginTop: 2 }}>
                            {p.oppPersonnel} {p.oppFormation} · {p.play}{p.oppMotion !== "None" ? ` · ${p.oppMotionPlayer ? p.oppMotionPlayer + " " : ""}${p.oppMotion}` : ""}{p.front ? ` · ${p.front}` : ""}{p.coverage ? `/${p.coverage}` : ""}{p.blitz && p.blitz !== "None" ? `/${p.blitz}` : ""}{p.carrier ? ` · #${p.carrier}` : ""}{` · tkl ${p.tackler}`}
                          </div>
                        </div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, minWidth: 44, textAlign: "right", color: col }}>
                          {p.gainType === "INT" ? "INT" : p.gainType === "Safety" ? "SAF" : p.gainType === "TD" ? "TD" : p.gainType === "Sack" ? "SCK" : p.gainType === "Fumble" ? "FUM" : p.incomplete ? "INC" : `${p.yards > 0 ? "+" : ""}${p.yards}`}
                        </div>
                        {editing && <button onClick={() => deletePlay(p.id)} style={{ background: "none", border: "none", color: "#4a5568", fontSize: 20, cursor: "pointer", padding: "0 4px" }}>×</button>}
                      </div>
                    </React.Fragment>
                  );
                }
              })}
            </div>
          )}
          {loaded && activePlays.length === 0 && !editing && <div style={{ color: "#4a5568", textAlign: "center", padding: 30, fontSize: 15 }}>No plays logged yet.</div>}
        </div>
      )}

      {tab === "tendencies" && (
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setTendSide("offense")} style={modeBtn(tendSide === "offense", true)}>Offense</button>
            <button onClick={() => setTendSide("defense")} style={modeBtn(tendSide === "defense")}>Defense</button>
          </div>
          <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid #1d2530" }}>
            {[["stats", "Stats"], ["situations", "Situations"]].map(([k, l]) => (
              <button key={k} onClick={() => setTendSubTab(k)} style={{ flex: 1, padding: "10px", background: "transparent", color: tendSubTab === k ? "#f5c518" : "#7a8699", border: "none", borderBottom: tendSubTab === k ? "2px solid #f5c518" : "2px solid transparent", fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>{l}</button>
            ))}
          </div>
          {tendSubTab === "situations" ? (
            <SituationsTab plays={tendSide === "offense" ? offPlays : defPlays} drives={drives} side={tendSide} fpDisplayMode={fpDisplayMode} driveOutcomes={playbook.driveOutcomes ?? DEFAULT_PLAYBOOK.driveOutcomes} />
          ) : tendSide === "offense" ? (
            offPlays.length === 0 ? <div style={{ textAlign: "center", color: "#4a5568", padding: "60px 20px", fontSize: 15 }}>No offensive plays logged yet.</div> : (() => {
              const rushPlays = offPlays.filter(p => p.gainType !== "Sack" && p.playType === "Run");
              const rushYards = rushPlays.reduce((s, p) => s + p.yards, 0);
              const rushTDs = offPlays.filter(p => p.gainType === "TD" && p.playType === "Run").length;
              const passPlays = offPlays.filter(p => p.gainType !== "Sack" && p.playType === "Pass");
              const passComp = passPlays.filter(p => !p.incomplete && p.gainType !== "INT").length;
              const passYards = passPlays.filter(p => !p.incomplete && p.gainType !== "INT").reduce((s, p) => s + p.yards, 0);
              const passTDs = offPlays.filter(p => p.gainType === "TD" && p.playType === "Pass").length;
              const ints = offPlays.filter(p => p.gainType === "INT").length;
              const fumbles = offPlays.filter(p => p.gainType === "Fumble").length;
              const sacks = offPlays.filter(p => p.gainType === "Sack").length;
              const sackYards = offPlays.filter(p => p.gainType === "Sack").reduce((s, p) => s + p.yards, 0);
              const safeties = offPlays.filter(p => p.gainType === "Safety").length;
              const qbStats = {};
              offPlays.filter(p => p.playType === "Pass" && p.passer && p.gainType !== "Sack").forEach(p => {
                const q = qbStats[p.passer] ??= { att: 0, comp: 0, yards: 0, tds: 0, ints: 0 };
                q.att++; if (!p.incomplete && p.gainType !== "INT") { q.comp++; q.yards += p.yards; }
                if (p.gainType === "TD") q.tds++; if (p.gainType === "INT") q.ints++;
              });
              const bsRow = (lbl, value) => (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #1d2530" }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "#7a8699" }}>{lbl}</span>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, color: "#f4f4f0" }}>{value}</span>
                </div>
              );
              return (
                <>
                  <div style={{ background: "#11161f", border: "1px solid #1d2530", borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#f5c518", marginBottom: 10 }}>Offense · Box Score</div>
                    {bsRow("Total", `${offPlays.length} plays · ${rushYards + passYards + sackYards >= 0 ? "+" : ""}${rushYards + passYards + sackYards} yds`)}
                    {bsRow("Rush", `${rushPlays.length} att · ${rushYards >= 0 ? "+" : ""}${rushYards} yds${rushTDs ? ` · ${rushTDs} TD` : ""}`)}
                    {bsRow("Pass", `${passComp}/${passPlays.length} · ${passYards >= 0 ? "+" : ""}${passYards} yds${passTDs ? ` · ${passTDs} TD` : ""}${ints ? ` · ${ints} INT` : ""}`)}
                    {sacks > 0 && bsRow("Sacks", `${sacks} for ${sackYards} yds`)}
                    {Object.entries(qbStats).map(([num, s]) => bsRow(`QB #${num}`, `${s.comp}/${s.att} · ${s.yards >= 0 ? "+" : ""}${s.yards} yds${s.tds ? " · " + s.tds + " TD" : ""}${s.ints ? " · " + s.ints + " INT" : ""}`))}
                    {(fumbles > 0 || safeties > 0) && bsRow("Turnovers", `${fumbles ? fumbles + " fumble" + (fumbles > 1 ? "s" : "") : ""}${fumbles && safeties ? " · " : ""}${safeties ? safeties + " safety" : ""}`)}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                    <Stat label="Plays" value={offPlays.length} /><Stat label="Total Yds" value={tendencies.totalYards} /><Stat label="Yds / Play" value={tendencies.avg} accent />
                  </div>
                  <Breakdown title="Run vs Pass" data={tendencies.byGain} total={offPlays.length} />
                  <Breakdown title="By Personnel" data={tendencies.byPersonnel} total={offPlays.length} />
                  <Breakdown title="By Formation" data={tendencies.byFormation} total={offPlays.length} />
                  <Breakdown title="By Play Call" data={tendencies.byPlay} total={offPlays.length} />
                  <Breakdown title="By Hash" data={tendencies.byHash} total={offPlays.length} />
                  <Breakdown title="By Down" data={tendencies.byDown} total={offPlays.length} keyFmt={ordinal} />
                  <CarrierBreakdown data={tendencies.byCarrier} />
                  <DriveBreakdown plays={offPlays} drives={drives} />
                  <PuntBreakdown plays={offPlays} />
                  <DriveOutcomeBreakdown drives={drives} plays={offPlays} />
                </>
              );
            })()
          ) : (
            defPlays.length === 0 ? <div style={{ textAlign: "center", color: "#4a5568", padding: "60px 20px", fontSize: 15 }}>No defensive plays logged yet.</div> : (() => {
              const dt = defTendencies;
              const runPlays = defPlays.filter(p => p.gainType !== "Sack" && p.playType === "Run");
              const runYards = runPlays.reduce((s, p) => s + p.yards, 0);
              const runTDs = defPlays.filter(p => p.gainType === "TD" && p.playType === "Run").length;
              const passPl = defPlays.filter(p => p.gainType !== "Sack" && p.playType === "Pass");
              const sackYards = defPlays.filter(p => p.gainType === "Sack").reduce((s, p) => s + p.yards, 0);
              const passComp = passPl.filter(p => !p.incomplete && p.gainType !== "INT").length;
              const passYards = passPl.filter(p => !p.incomplete && p.gainType !== "INT").reduce((s, p) => s + p.yards, 0);
              const passTDs = defPlays.filter(p => p.gainType === "TD" && p.playType === "Pass").length;
              const turnovers = defPlays.filter(p => p.gainType === "INT" || p.gainType === "Fumble").length;
              const safeties = defPlays.filter(p => p.gainType === "Safety").length;
              const sacks = defPlays.filter(p => p.gainType === "Sack").length;
              const bsRow = (lbl, value) => (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #1d2530" }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "#7a8699" }}>{lbl}</span>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, color: "#f4f4f0" }}>{value}</span>
                </div>
              );
              return (
                <>
                  <div style={{ background: "#11161f", border: "1px solid #1d2530", borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#3ddc84", marginBottom: 10 }}>Defense · Box Score</div>
                    {bsRow("Total Plays", `${defPlays.length} · ${dt.totalYards} yds allowed · ${dt.avg} avg`)}
                    {bsRow("Rush Def", `${runPlays.length} att · ${runYards} yds${runTDs ? ` · ${runTDs} TD allowed` : ""}`)}
                    {bsRow("Pass Def", `${passComp}/${passPl.length} · ${passYards} yds${passTDs ? ` · ${passTDs} TD allowed` : ""}`)}
                    {(turnovers > 0 || safeties > 0 || sacks > 0) && bsRow("Takeaways / Big Plays", [turnovers ? `${turnovers} TO` : "", safeties ? `${safeties} safety` : "", sacks > 0 ? `${sacks} sack${sacks > 1 ? "s" : ""}${sackYards < 0 ? " (" + sackYards + " yds)" : ""}` : ""].filter(Boolean).join(" · "))}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                    <Stat label="Plays" value={defPlays.length} /><Stat label="Yds Allowed" value={dt.totalYards} /><Stat label="Yds / Play" value={dt.avg} accent />
                  </div>
                  <Breakdown title="Run vs Pass" data={dt.byGain} total={defPlays.length} />
                  <Breakdown title="By Their Personnel" data={dt.byPersonnel} total={defPlays.length} />
                  <Breakdown title="By Their Formation" data={dt.byFormation} total={defPlays.length} />
                  <Breakdown title="By Their Play" data={dt.byPlay} total={defPlays.length} />
                  <Breakdown title="By Hash" data={dt.byHash} total={defPlays.length} />
                  <Breakdown title="By Down" data={dt.byDown} total={defPlays.length} keyFmt={ordinal} />
                  <Breakdown title="By Our Front" data={dt.byFront} total={defPlays.length} />
                  <Breakdown title="By Our Coverage" data={dt.byCoverage} total={defPlays.length} />
                  {Object.keys(dt.byBlitz).some(k => k !== "None" && k !== "—") && <Breakdown title="By Blitz Tag" data={Object.fromEntries(Object.entries(dt.byBlitz).filter(([k]) => k !== "None" && k !== "—"))} total={defPlays.length} />}
                  <CarrierBreakdown data={dt.byCarrier} />
                  <DriveBreakdown plays={defPlays} drives={drives} />
                  <DriveOutcomeBreakdown drives={drives} plays={defPlays} />
                </>
              );
            })()
          )}
        </div>
      )}

      {tab === "reports" && (
        <div style={{ padding: 16 }}>
          {[
            { key: "onepager", title: "Postgame One-Pager", desc: "Header, score by quarter, game stats, drive summary, top performers, what worked." },
            { key: "selfscout", title: "Self-Scout Tendency Report", desc: "Down & distance, field zone, formation, personnel, hash tendencies. Multi-game aggregation." },
          ].map(({ key, title, desc }) => (
            <div key={key} style={{ background: "#11161f", borderRadius: 12, padding: 16, marginBottom: 12, border: "1px solid #1d2530" }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{title}</div>
              <div style={{ fontSize: 13, color: "#a8b3c4", marginBottom: 14, lineHeight: 1.5 }}>{desc}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setReportView(key)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "#f5c518", color: "#0a0e14", fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>View</button>
                <button onClick={async () => {
                  setPdfExporting(true);
                  if (key === "onepager") {
                    await exportOnePagerPDF(computeOnePager(offPlays, defPlays, drives, usScore, themScore), label, gameDate, usScore, themScore);
                  } else {
                    await exportSelfScoutPDF(computeSelfScout(offPlays), label, playbook.teamName || "Our Offense", gameDate);
                  }
                  setPdfExporting(false);
                }} disabled={pdfExporting} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid #2a3543", background: "transparent", color: pdfExporting ? "#4a5568" : "#c4cdda", fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", cursor: pdfExporting ? "not-allowed" : "pointer" }}>{pdfExporting ? "Exporting…" : "↓ PDF"}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "export" && (
        <div style={{ padding: 16 }}>
          <div style={{ background: "#11161f", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #1d2530" }}>
            <div style={{ fontSize: 14, color: "#a8b3c4", lineHeight: 1.5 }}>{offPlays.length} offensive + {defPlays.length} defensive plays in <b style={{ color: "#f4f4f0" }}>{label}</b>. Downloads as a CSV you can open in Excel or Sheets.</div>
          </div>
          <button onClick={exportCSV} disabled={offPlays.length === 0 && defPlays.length === 0} style={{
            width: "100%", padding: "18px", borderRadius: 12, border: "none",
            background: (offPlays.length || defPlays.length) ? "#3ddc84" : "#1d2530",
            color: (offPlays.length || defPlays.length) ? "#0a0e14" : "#4a5568",
            fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
            cursor: (offPlays.length || defPlays.length) ? "pointer" : "not-allowed",
          }}>↓ Download Spreadsheet (CSV)</button>
        </div>
      )}
      {reportView === "onepager" && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 300, background: "#fff", overflowY: "auto" }}>
          <OnePagerView
            data={computeOnePager(offPlays, defPlays, drives, usScore, themScore)}
            label={label} gameDate={gameDate} usScore={usScore} themScore={themScore}
            onClose={() => setReportView(null)}
            onExportPDF={async () => { setPdfExporting(true); await exportOnePagerPDF(computeOnePager(offPlays, defPlays, drives, usScore, themScore), label, gameDate, usScore, themScore); setPdfExporting(false); }}
            pdfExporting={pdfExporting}
          />
        </div>
      )}
      {reportView === "selfscout" && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 300, background: "#fff", overflowY: "auto" }}>
          <SelfScoutView
            currentGameId={id} currentOffPlays={offPlays}
            label={label} gameDate={gameDate}
            onClose={() => setReportView(null)}
            onExportPDF={async () => { setPdfExporting(true); await exportSelfScoutPDF(computeSelfScout(offPlays), label, playbook.teamName || "Our Offense", gameDate); setPdfExporting(false); }}
            pdfExporting={pdfExporting}
            teamName={playbook.teamName || "Our Offense"}
          />
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
const headerBtn = { background: "none", border: "1px solid #2a3543", borderRadius: 8, color: "#7a8699", fontSize: 12, cursor: "pointer", fontFamily: FONT_BODY, padding: "6px 10px" };
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
function DriveBreakdown({ plays, drives }) {
  const driveMap = {};
  (drives || []).forEach(d => { driveMap[d.driveNumber] = d; });
  const byDrive = {};
  plays.forEach((p) => {
    if (!p.driveNumber || p.type === "penalty" || p.type === "punt") return;
    const d = p.driveNumber;
    byDrive[d] ??= { count: 0, yards: 0, result: null };
    byDrive[d].count++;
    byDrive[d].yards += p.yards || 0;
    if (!byDrive[d].result) {
      if (p.gainType === "TD") byDrive[d].result = "TD";
      else if (p.gainType === "Safety") byDrive[d].result = "Safety";
      else if (p.gainType === "INT") byDrive[d].result = "INT";
      else if (p.gainType === "Fumble") byDrive[d].result = "Fumble";
    }
  });
  // Prefer the tagged outcome over the play-derived fallback
  Object.keys(byDrive).forEach(dNum => {
    if (driveMap[dNum]?.outcome) byDrive[dNum].result = driveMap[dNum].outcome;
  });
  const rows = Object.entries(byDrive).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (rows.length === 0) return null;
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 12 }}>By Drive</div>
      <div style={{ display: "flex", padding: "0 4px 8px", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#4a5568", borderBottom: "1px solid #1d2530", marginBottom: 10 }}>
        <span style={{ width: 60 }}>Drive</span>
        <span style={{ width: 50, textAlign: "right" }}>Plays</span>
        <span style={{ flex: 1, textAlign: "right" }}>Yards</span>
        <span style={{ width: 50, textAlign: "right" }}>Avg</span>
        <span style={{ width: 70, textAlign: "right" }}>Result</span>
      </div>
      {rows.map(([d, v]) => {
        const avg = v.count ? (v.yards / v.count).toFixed(1) : "0.0";
        const resultColor = ["TD", "Touchdown", "Field Goal"].includes(v.result) ? "#3ddc84"
          : ["INT", "Interception", "Fumble", "Blocked Punt", "Blocked FG"].includes(v.result) ? "#ff5252"
          : v.result === "Safety" ? "#f5c518"
          : "#a8b3c4";
        return (
          <div key={d} style={{ display: "flex", alignItems: "center", padding: "8px 4px", borderBottom: "1px solid #1d2530" }}>
            <span style={{ width: 60, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>#{d}</span>
            <span style={{ width: 50, textAlign: "right", color: "#a8b3c4", fontSize: 14 }}>{v.count}</span>
            <span style={{ flex: 1, textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 700, color: "#f5c518" }}>{v.yards >= 0 ? "+" : ""}{v.yards}</span>
            <span style={{ width: 50, textAlign: "right", color: "#a8b3c4", fontSize: 13 }}>{avg}</span>
            <span style={{ width: 70, textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 12, color: resultColor }}>{v.result || "—"}</span>
          </div>
        );
      })}
    </div>
  );
}

function DriveOutcomeBreakdown({ drives, plays }) {
  const relevantNums = new Set((plays || []).filter(p => p.driveNumber).map(p => p.driveNumber));
  const relevant = (drives || []).filter(d => relevantNums.has(d.driveNumber));
  const withOutcome = relevant.filter(d => d.outcome);
  if (withOutcome.length === 0) return null;
  const total = relevant.length;
  const counts = {};
  withOutcome.forEach(d => { counts[d.outcome] = (counts[d.outcome] || 0) + 1; });
  const scoringCount = (counts["Touchdown"] || 0) + (counts["Field Goal"] || 0);
  const scoringRate = total > 0 ? Math.round(scoringCount / total * 100) : 0;
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const bsRow = (lbl, val, col) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #1d2530" }}>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "#7a8699" }}>{lbl}</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, color: col || "#f4f4f0" }}>{val}</span>
    </div>
  );
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 12 }}>Drive Outcomes</div>
      <div style={{ background: "#11161f", border: "1px solid #1d2530", borderRadius: 12, padding: "14px 16px" }}>
        {bsRow("Scoring Rate", `${scoringCount} / ${total} drives (${scoringRate}%)`, scoringRate >= 50 ? "#3ddc84" : scoringRate >= 30 ? "#f5c518" : "#f4f4f0")}
        {rows.map(([outcome, count]) => {
          const col = ["Touchdown", "Field Goal"].includes(outcome) ? "#3ddc84"
            : ["Interception", "Fumble", "Blocked Punt", "Blocked FG", "Safety"].includes(outcome) ? "#ff5252"
            : "#f4f4f0";
          return bsRow(outcome, count, col);
        })}
      </div>
    </div>
  );
}

// =================== REPORTS ===================

function computeOnePager(offPlays, defPlays, drives, usScore, themScore) {
  const sorted = [...drives].sort((a, b) => a.driveNumber - b.driveNumber);
  const off = offPlays.filter(p => p.type !== "penalty" && p.type !== "punt");
  const def = defPlays.filter(p => p.type !== "penalty" && p.type !== "punt");

  function scoreAfterQ(q) {
    const nxt = sorted.find(d => d.quarter > q);
    return nxt ? { us: nxt.usScore, them: nxt.themScore } : { us: usScore, them: themScore };
  }
  const qScores = [1, 2, 3, 4].map(q => {
    const end = scoreAfterQ(q);
    const prev = q === 1 ? { us: 0, them: 0 } : scoreAfterQ(q - 1);
    return { us: end.us - prev.us, them: end.them - prev.them };
  });

  const offYards = off.reduce((s, p) => s + (p.yards || 0), 0);
  const defYards = def.reduce((s, p) => s + (p.yards || 0), 0);
  const offYPP = off.length ? (offYards / off.length).toFixed(1) : "—";
  const defYPP = def.length ? (defYards / def.length).toFixed(1) : "—";

  const off3A = off.filter(p => p.down === 3);
  const off3C = off3A.filter(p => ["INT", "Fumble", "Sack"].indexOf(p.gainType) === -1 && (p.yards || 0) >= (p.distance || 1));
  const def3A = def.filter(p => p.down === 3);
  const def3C = def3A.filter(p => ["INT", "Fumble", "Sack"].indexOf(p.gainType) === -1 && (p.yards || 0) >= (p.distance || 1));

  const offRZNums = new Set(off.filter(p => (p.fieldPos || 0) >= 80 && p.driveNumber).map(p => p.driveNumber));
  const offRZTDs = sorted.filter(d => offRZNums.has(d.driveNumber) && d.outcome === "Touchdown").length;
  const defRZNums = new Set(def.filter(p => (p.fieldPos || 0) >= 80 && p.driveNumber).map(p => p.driveNumber));
  const defRZTDs = def.filter(p => (p.fieldPos || 0) >= 80 && p.gainType === "TD").length;

  const offINTs = off.filter(p => p.gainType === "INT").length;
  const offFumbles = off.filter(p => p.gainType === "Fumble").length;
  const defINTs = def.filter(p => p.gainType === "INT").length;
  const defFumbles = def.filter(p => p.gainType === "Fumble").length;

  const offPens = offPlays.filter(p => p.type === "penalty");
  const defPens = defPlays.filter(p => p.type === "penalty");
  const offPenYards = Math.abs(offPens.reduce((s, p) => s + (p.yards || 0), 0));
  const defPenYards = Math.abs(defPens.reduce((s, p) => s + (p.yards || 0), 0));

  const offSacks = off.filter(p => p.gainType === "Sack").length;
  const defSacks = def.filter(p => p.gainType === "Sack").length;

  const driveSummary = sorted.map(d => {
    const dPlays = off.filter(p => p.driveNumber === d.driveNumber);
    const allDP = offPlays.filter(p => p.driveNumber === d.driveNumber && p.type !== "penalty");
    const yards = dPlays.reduce((s, p) => s + (p.yards || 0), 0);
    const startPos = allDP.length > 0 ? allDP[allDP.length - 1].fieldPos : null;
    return { num: d.driveNumber, startPos, plays: allDP.length, yards, outcome: d.outcome || null };
  }).filter(d => d.plays > 0);

  const cMap = {};
  off.filter(p => p.carrier && !p.incomplete && p.gainType !== "INT").forEach(p => {
    (cMap[p.carrier] ??= { yards: 0, count: 0 }); cMap[p.carrier].yards += p.yards || 0; cMap[p.carrier].count++;
  });
  const topCarriers = Object.entries(cMap).sort((a, b) => b[1].yards - a[1].yards).slice(0, 3)
    .map(([k, v]) => ({ num: k, yards: v.yards, count: v.count, avg: (v.yards / v.count).toFixed(1) }));

  const tMap = {};
  def.filter(p => p.tacklerNum).forEach(p => {
    (tMap[p.tacklerNum] ??= { count: 0, pos: "" }); tMap[p.tacklerNum].count++;
    if (p.tacklerPos && !tMap[p.tacklerNum].pos) tMap[p.tacklerNum].pos = p.tacklerPos;
  });
  const topTacklers = Object.entries(tMap).sort((a, b) => b[1].count - a[1].count).slice(0, 3)
    .map(([k, v]) => ({ num: k, count: v.count, pos: v.pos }));

  const pMap = {};
  off.filter(p => p.play && !p.incomplete && p.gainType !== "INT" && p.gainType !== "Fumble").forEach(p => {
    (pMap[p.play] ??= { yards: 0, count: 0 }); pMap[p.play].yards += p.yards || 0; pMap[p.play].count++;
  });
  const qual = Object.entries(pMap).filter(([, v]) => v.count >= 3).map(([k, v]) => ({ play: k, avg: v.yards / v.count, count: v.count }));
  const whatWorked = [...qual].sort((a, b) => b.avg - a.avg).slice(0, 3);
  const whatDidnt = [...qual].sort((a, b) => a.avg - b.avg).slice(0, 3);

  const result = usScore > themScore ? "W" : usScore < themScore ? "L" : "T";
  return {
    qScores, result, offTotal: off.length, defTotal: def.length,
    offYards, defYards, offYPP, defYPP,
    off3A: off3A.length, off3C: off3C.length, def3A: def3A.length, def3C: def3C.length,
    offRZTrips: offRZNums.size, offRZTDs, defRZTrips: defRZNums.size, defRZTDs,
    offINTs, offFumbles, defINTs, defFumbles,
    offPens: offPens.length, offPenYards, defPens: defPens.length, defPenYards,
    offSacks, defSacks, driveSummary, topCarriers, topTacklers, whatWorked, whatDidnt,
  };
}

function computeSelfScout(offPlays) {
  const plays = offPlays.filter(p => p.type !== "penalty" && p.type !== "punt");
  const total = plays.length;
  const runs = plays.filter(p => p.playType === "Run");
  const passes = plays.filter(p => p.playType === "Pass");
  const totalYards = plays.reduce((s, p) => s + (p.yards || 0), 0);
  const ypp = total ? (totalYards / total).toFixed(1) : "—";
  const runPct = total ? Math.round(runs.length / total * 100) : 0;

  function bStats(bp) {
    const r = bp.filter(p => p.playType === "Run"), pa = bp.filter(p => p.playType === "Pass");
    const y = bp.reduce((s, p) => s + (p.yards || 0), 0);
    const pf = {};
    bp.forEach(p => { if (p.play) pf[p.play] = (pf[p.play] || 0) + 1; });
    const topPlay = Object.entries(pf).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    return { count: bp.length, runPct: Math.round(r.length / bp.length * 100), passPct: Math.round(pa.length / bp.length * 100), avg: (y / bp.length).toFixed(1), topPlay };
  }

  function ddBucket(p) {
    const d = p.down, dist = p.distance;
    if (d === 1) return "1st & 10";
    if (d === 2 && dist <= 3) return "2nd & Short (1-3)";
    if (d === 2 && dist <= 6) return "2nd & Med (4-6)";
    if (d === 2) return "2nd & Long (7+)";
    if (d === 3 && dist <= 3) return "3rd & Short (1-3)";
    if (d === 3 && dist <= 6) return "3rd & Med (4-6)";
    if (d === 3) return "3rd & Long (7+)";
    if (d === 4) return "4th Down";
    return null;
  }
  const ddOrder = ["1st & 10", "2nd & Short (1-3)", "2nd & Med (4-6)", "2nd & Long (7+)", "3rd & Short (1-3)", "3rd & Med (4-6)", "3rd & Long (7+)", "4th Down"];
  const ddB = {};
  plays.forEach(p => { const b = ddBucket(p); if (b) (ddB[b] ??= []).push(p); });
  const ddRows = ddOrder.map(b => ddB[b]?.length ? { label: b, ...bStats(ddB[b]) } : null).filter(Boolean);

  function fzBucket(fp) {
    if (fp == null) return null;
    if (fp <= 20) return "Backed Up (Own 1-20)";
    if (fp <= 79) return "Normal (Own 21–Opp 21)";
    if (fp <= 96) return "Red Zone (Opp 20-4)";
    return "Goal Line (Opp 3-1)";
  }
  const fzOrder = ["Backed Up (Own 1-20)", "Normal (Own 21–Opp 21)", "Red Zone (Opp 20-4)", "Goal Line (Opp 3-1)"];
  const fzB = {};
  plays.forEach(p => { const b = fzBucket(p.fieldPos); if (b) (fzB[b] ??= []).push(p); });
  const fzRows = fzOrder.map(b => fzB[b]?.length ? { label: b, ...bStats(fzB[b]) } : null).filter(Boolean);

  const hashB = {};
  plays.forEach(p => { (hashB[p.hash || "—"] ??= []).push(p); });
  const hashRows = Object.entries(hashB).sort((a, b) => b[1].length - a[1].length).map(([h, bp]) => ({ hash: h, ...bStats(bp) }));

  function groupTend(keyFn) {
    const m = {};
    plays.forEach(p => { const k = keyFn(p) || "—"; (m[k] ??= []).push(p); });
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length).map(([k, bp]) => {
      const pf = {};
      bp.forEach(p => { if (p.play) pf[p.play] = (pf[p.play] || 0) + 1; });
      const top3 = Object.entries(pf).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([pl, c]) => `${pl} (${c})`).join(", ");
      return { label: k, pct: Math.round(bp.length / total * 100), top3, ...bStats(bp) };
    });
  }

  const personnelRows = groupTend(p => p.personnel);
  const formationRows = groupTend(p => p.formation);

  const pf = {};
  plays.forEach(p => {
    if (!p.play) return;
    (pf[p.play] ??= { count: 0, yards: 0, type: p.playType });
    pf[p.play].count++; pf[p.play].yards += p.yards || 0;
    if (!pf[p.play].type && p.playType) pf[p.play].type = p.playType;
  });
  const topPlays = Object.entries(pf).sort((a, b) => b[1].count - a[1].count).slice(0, 10)
    .map(([k, v]) => ({ play: k, count: v.count, avg: (v.yards / v.count).toFixed(1), type: v.type || "—", pct: Math.round(v.count / total * 100) }));

  const cMap = {};
  plays.filter(p => p.carrier && !p.incomplete && p.gainType !== "INT").forEach(p => {
    (cMap[p.carrier] ??= { count: 0, yards: 0, longest: 0 });
    cMap[p.carrier].count++; cMap[p.carrier].yards += p.yards || 0;
    if ((p.yards || 0) > cMap[p.carrier].longest) cMap[p.carrier].longest = p.yards;
  });
  const topCarriers = Object.entries(cMap).sort((a, b) => b[1].yards - a[1].yards).slice(0, 8)
    .map(([k, v]) => ({ num: k, count: v.count, yards: v.yards, avg: (v.yards / v.count).toFixed(1), longest: v.longest }));

  return { total, runCount: runs.length, passCount: passes.length, runPct, passPct: 100 - runPct, ypp, totalYards, ddRows, fzRows, hashRows, personnelRows, formationRows, topPlays, topCarriers };
}

async function exportOnePagerPDF(data, label, gameDate, usScore, themScore) {
  try {
    const { Document, Page, View, Text, StyleSheet, pdf } = await import("@react-pdf/renderer");
    const e = React.createElement;
    const S = StyleSheet.create({
      page: { padding: 36, fontFamily: "Helvetica", fontSize: 10, color: "#111" },
      secHdr: { fontSize: 8, fontFamily: "Helvetica-Bold", textTransform: "uppercase", color: "#1a3a5c", borderBottomWidth: 1.5, borderBottomColor: "#1a3a5c", paddingBottom: 2, marginTop: 14, marginBottom: 6 },
      row: { flexDirection: "row" },
      thCell: { padding: "3 5", fontSize: 7, fontFamily: "Helvetica-Bold", color: "#fff", backgroundColor: "#1a3a5c", flex: 1 },
      tdCell: { padding: "3 5", fontSize: 8, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", flex: 1 },
      label: { flex: 2 },
    });

    function t(style, text) { return e(Text, { style }, String(text ?? "")); }
    function v(style, ...children) { return e(View, { style }, ...children); }
    function secH(text) { return t(S.secHdr, text); }
    function tRow(cells, isHeader) {
      return v(S.row, ...cells.map((cell, i) =>
        e(Text, { style: isHeader ? S.thCell : S.tdCell, key: i }, String(cell ?? ""))
      ));
    }

    const { qScores, result, offTotal, defTotal, offYards, defYards, offYPP, defYPP, off3A, off3C, def3A, def3C, offRZTrips, offRZTDs, defRZTrips, defRZTDs, offINTs, offFumbles, defINTs, defFumbles, offPens, offPenYards, defPens, defPenYards, offSacks, defSacks, driveSummary, topCarriers, topTacklers, whatWorked, whatDidnt } = data;
    const fpL = (pos) => { if (pos == null) return "—"; if (pos === 50) return "50"; if (pos < 50) return `Own ${pos}`; return `Opp ${100 - pos}`; };
    const fmtDate = gameDate ? new Date(gameDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

    const doc = e(Document, null,
      e(Page, { size: "LETTER", style: S.page },
        // Header
        v({ flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: "#1a3a5c", paddingBottom: 10, marginBottom: 12 },
          v({},
            t({ fontSize: 16, fontFamily: "Helvetica-Bold", textTransform: "uppercase" }, label),
            t({ fontSize: 8, color: "#6b7280", marginTop: 2 }, fmtDate)
          ),
          v({ alignItems: "flex-end" },
            t({ fontSize: 22, fontFamily: "Helvetica-Bold" }, `${usScore} – ${themScore}`),
            t({ fontSize: 9, fontFamily: "Helvetica-Bold", color: result === "W" ? "#155724" : result === "L" ? "#7f1d1d" : "#374151" },
              result === "W" ? "WIN" : result === "L" ? "LOSS" : "TIE")
          )
        ),
        // Score by Quarter
        secH("Score by Quarter"),
        tRow(["", "Q1", "Q2", "Q3", "Q4", "Final"], true),
        tRow(["Us", ...qScores.map(q => q.us), usScore]),
        tRow(["Them", ...qScores.map(q => q.them), themScore]),
        // Stats
        secH("Game Stats"),
        tRow(["Stat", "Us", "Them"], true),
        tRow(["Total Plays", offTotal, defTotal]),
        tRow(["Total Yards", offYards, defYards]),
        tRow(["Yards / Play", offYPP, defYPP]),
        tRow(["3rd Down", `${off3C}/${off3A} (${off3A ? Math.round(off3C / off3A * 100) : 0}%)`, `${def3C}/${def3A} (${def3A ? Math.round(def3C / def3A * 100) : 0}%)`]),
        tRow(["Red Zone (TD/Trips)", `${offRZTDs}/${offRZTrips}`, `${defRZTDs}/${defRZTrips}`]),
        tRow(["Turnovers", `${offINTs + offFumbles} (${offINTs} INT, ${offFumbles} Fum)`, `${defINTs + defFumbles} (${defINTs} INT, ${defFumbles} Fum)`]),
        tRow(["Sacks", offSacks, defSacks]),
        tRow(["Penalties (Yds)", `${offPens} (${offPenYards} yds)`, `${defPens} (${defPenYards} yds)`]),
        // Drive Summary
        driveSummary.length > 0 ? v({},
          secH("Drive Summary"),
          tRow(["#", "Start", "Plays", "Yards", "Outcome"], true),
          ...driveSummary.map(d => tRow([d.num, fpL(d.startPos), d.plays, `${d.yards >= 0 ? "+" : ""}${d.yards}`, d.outcome || "—"]))
        ) : null,
        // Top Performers
        (topCarriers.length > 0 || topTacklers.length > 0) ? v({},
          secH("Top Performers"),
          topCarriers.length > 0 ? v({},
            t({ fontSize: 8, fontFamily: "Helvetica-Bold", marginBottom: 3, color: "#1a3a5c" }, "Ball Carriers"),
            tRow(["#", "Carries", "Yards", "Avg"], true),
            ...topCarriers.map(c => tRow([`#${c.num}`, c.count, c.yards, c.avg]))
          ) : null,
          topTacklers.length > 0 ? v({ marginTop: 6 },
            t({ fontSize: 8, fontFamily: "Helvetica-Bold", marginBottom: 3, color: "#1a3a5c" }, "Tacklers"),
            tRow(["Player", "Tackles"], true),
            ...topTacklers.map(tk => tRow([tk.pos ? `${tk.pos} #${tk.num}` : `#${tk.num}`, tk.count]))
          ) : null
        ) : null,
        // What Worked / What Didn't
        (whatWorked.length > 0 || whatDidnt.length > 0) ? v({},
          secH("What Worked / What Didn't (min 3 att)"),
          v({ flexDirection: "row", gap: 10 },
            whatWorked.length > 0 ? v({ flex: 1 },
              t({ fontSize: 8, fontFamily: "Helvetica-Bold", color: "#155724", marginBottom: 3 }, "What Worked"),
              tRow(["Play", "Att", "Avg"], true),
              ...whatWorked.map(w => tRow([w.play, w.count, w.avg.toFixed(1)]))
            ) : null,
            whatDidnt.length > 0 ? v({ flex: 1 },
              t({ fontSize: 8, fontFamily: "Helvetica-Bold", color: "#7f1d1d", marginBottom: 3 }, "What Didn't"),
              tRow(["Play", "Att", "Avg"], true),
              ...whatDidnt.map(w => tRow([w.play, w.count, w.avg.toFixed(1)]))
            ) : null
          )
        ) : null
      )
    );

    const blob = await pdf(doc).toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `OnePager_${label.replace(/[/\\:*?"<>|]/g, "_")}.pdf`; a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("PDF export failed:", err);
    alert("PDF export failed — check browser console.");
  }
}

async function exportSelfScoutPDF(data, label, teamName, gameDate) {
  try {
    const { Document, Page, View, Text, StyleSheet, pdf } = await import("@react-pdf/renderer");
    const e = React.createElement;
    const S = StyleSheet.create({
      page: { padding: 36, fontFamily: "Helvetica", fontSize: 10, color: "#111" },
      secHdr: { fontSize: 8, fontFamily: "Helvetica-Bold", textTransform: "uppercase", color: "#1a3a5c", borderBottomWidth: 1.5, borderBottomColor: "#1a3a5c", paddingBottom: 2, marginTop: 14, marginBottom: 6 },
      row: { flexDirection: "row" },
      thCell: { padding: "3 4", fontSize: 7, fontFamily: "Helvetica-Bold", color: "#fff", backgroundColor: "#1a3a5c", flex: 1 },
      thCellW: { padding: "3 4", fontSize: 7, fontFamily: "Helvetica-Bold", color: "#fff", backgroundColor: "#1a3a5c", flex: 2 },
      tdCell: { padding: "3 4", fontSize: 8, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", flex: 1 },
      tdCellW: { padding: "3 4", fontSize: 8, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", flex: 2 },
      tdCellL: { padding: "3 4", fontSize: 8, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", flex: 3 },
    });

    function t(style, text) { return e(Text, { style }, String(text ?? "")); }
    function v(style, ...children) { return e(View, { style }, ...children); }
    function secH(text) { return t(S.secHdr, text); }

    function tendTable(rows, wideFirst) {
      return v({},
        v(S.row,
          e(Text, { style: wideFirst ? S.thCellW : S.thCell }, "Group"),
          e(Text, { style: S.thCell }, "Plays %"),
          e(Text, { style: S.thCell }, "Run%"),
          e(Text, { style: S.thCell }, "Pass%"),
          e(Text, { style: S.thCell }, "Avg"),
          e(Text, { style: S.tdCellL, key: "tp" }, "Top Plays")
        ),
        ...rows.map(r => v({ ...S.row, key: r.label },
          e(Text, { style: wideFirst ? S.tdCellW : S.tdCell }, r.label),
          e(Text, { style: S.tdCell }, `${r.count} (${r.pct}%)`),
          e(Text, { style: S.tdCell }, `${r.runPct}%`),
          e(Text, { style: S.tdCell }, `${r.passPct}%`),
          e(Text, { style: S.tdCell }, r.avg),
          e(Text, { style: S.tdCellL }, r.top3 || "—")
        ))
      );
    }

    const fmtDate = gameDate ? new Date(gameDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    const { total, runCount, passCount, runPct, passPct, ypp, ddRows, fzRows, hashRows, personnelRows, formationRows, topPlays, topCarriers } = data;

    const doc = e(Document, null,
      e(Page, { size: "LETTER", style: S.page },
        v({ flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: "#1a3a5c", paddingBottom: 10, marginBottom: 12 },
          v({},
            t({ fontSize: 14, fontFamily: "Helvetica-Bold", textTransform: "uppercase" }, `Self-Scout: ${teamName}`),
            t({ fontSize: 8, color: "#6b7280", marginTop: 2 }, `${label} · ${fmtDate}`)
          ),
          v({ alignItems: "flex-end" },
            t({ fontSize: 11, fontFamily: "Helvetica-Bold" }, `${total} plays`),
            t({ fontSize: 9, color: "#374151" }, `${runCount} run (${runPct}%) / ${passCount} pass (${passPct}%)`),
            t({ fontSize: 9, color: "#374151" }, `${ypp} yds/play`)
          )
        ),
        ddRows.length > 0 ? v({},
          secH("Down & Distance Tendencies"),
          v(S.row,
            e(Text, { style: S.thCellW }, "Situation"),
            e(Text, { style: S.thCell }, "Plays"),
            e(Text, { style: S.thCell }, "Run%"),
            e(Text, { style: S.thCell }, "Pass%"),
            e(Text, { style: S.thCell }, "Avg"),
            e(Text, { style: S.thCellW }, "Top Play")
          ),
          ...ddRows.map(r => v({ ...S.row, key: r.label },
            e(Text, { style: S.tdCellW }, r.label),
            e(Text, { style: S.tdCell }, r.count),
            e(Text, { style: S.tdCell }, `${r.runPct}%`),
            e(Text, { style: S.tdCell }, `${r.passPct}%`),
            e(Text, { style: S.tdCell }, r.avg),
            e(Text, { style: S.tdCellW }, r.topPlay)
          ))
        ) : null,
        fzRows.length > 0 ? v({},
          secH("Field Zone Tendencies"),
          v(S.row,
            e(Text, { style: S.thCellW }, "Zone"),
            e(Text, { style: S.thCell }, "Plays"),
            e(Text, { style: S.thCell }, "Run%"),
            e(Text, { style: S.thCell }, "Pass%"),
            e(Text, { style: S.thCell }, "Avg"),
            e(Text, { style: S.thCellW }, "Top Play")
          ),
          ...fzRows.map(r => v({ ...S.row, key: r.label },
            e(Text, { style: S.tdCellW }, r.label),
            e(Text, { style: S.tdCell }, r.count),
            e(Text, { style: S.tdCell }, `${r.runPct}%`),
            e(Text, { style: S.tdCell }, `${r.passPct}%`),
            e(Text, { style: S.tdCell }, r.avg),
            e(Text, { style: S.tdCellW }, r.topPlay)
          ))
        ) : null
      ),
      e(Page, { size: "LETTER", style: S.page },
        personnelRows.length > 0 ? v({}, secH("Personnel Tendencies"), tendTable(personnelRows, true)) : null,
        formationRows.length > 0 ? v({}, secH("Formation Tendencies"), tendTable(formationRows, false)) : null,
        topPlays.length > 0 ? v({},
          secH("Top Plays by Frequency"),
          v(S.row,
            e(Text, { style: S.thCellW }, "Play"),
            e(Text, { style: S.thCell }, "Type"),
            e(Text, { style: S.thCell }, "Count %"),
            e(Text, { style: S.thCell }, "Avg")
          ),
          ...topPlays.map(r => v({ ...S.row, key: r.play },
            e(Text, { style: S.tdCellW }, r.play),
            e(Text, { style: S.tdCell }, r.type),
            e(Text, { style: S.tdCell }, `${r.count} (${r.pct}%)`),
            e(Text, { style: S.tdCell }, r.avg)
          ))
        ) : null,
        topCarriers.length > 0 ? v({},
          secH("Ball Carriers"),
          v(S.row,
            e(Text, { style: S.thCell }, "#"),
            e(Text, { style: S.thCell }, "Touches"),
            e(Text, { style: S.thCell }, "Yards"),
            e(Text, { style: S.thCell }, "Avg"),
            e(Text, { style: S.thCell }, "Long")
          ),
          ...topCarriers.map(c => v({ ...S.row, key: c.num },
            e(Text, { style: S.tdCell }, `#${c.num}`),
            e(Text, { style: S.tdCell }, c.count),
            e(Text, { style: S.tdCell }, c.yards),
            e(Text, { style: S.tdCell }, c.avg),
            e(Text, { style: S.tdCell }, c.longest)
          ))
        ) : null,
        hashRows.length > 0 ? v({},
          secH("Hash Tendencies"),
          v(S.row,
            e(Text, { style: S.thCell }, "Hash"),
            e(Text, { style: S.thCell }, "Plays"),
            e(Text, { style: S.thCell }, "Run%"),
            e(Text, { style: S.thCell }, "Pass%"),
            e(Text, { style: S.thCell }, "Avg")
          ),
          ...hashRows.map(r => v({ ...S.row, key: r.hash },
            e(Text, { style: S.tdCell }, r.hash),
            e(Text, { style: S.tdCell }, r.count),
            e(Text, { style: S.tdCell }, `${r.runPct}%`),
            e(Text, { style: S.tdCell }, `${r.passPct}%`),
            e(Text, { style: S.tdCell }, r.avg)
          ))
        ) : null
      )
    );

    const blob = await pdf(doc).toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `SelfScout_${label.replace(/[/\\:*?"<>|]/g, "_")}.pdf`; a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Self-Scout PDF export failed:", err);
    alert("PDF export failed — check browser console.");
  }
}

function OnePagerView({ data, label, gameDate, usScore, themScore, onClose, onExportPDF, pdfExporting }) {
  const { qScores, result, offTotal, defTotal, offYards, defYards, offYPP, defYPP, off3A, off3C, def3A, def3C, offRZTrips, offRZTDs, defRZTrips, defRZTDs, offINTs, offFumbles, defINTs, defFumbles, offPens, offPenYards, defPens, defPenYards, offSacks, defSacks, driveSummary, topCarriers, topTacklers, whatWorked, whatDidnt } = data;
  const fmtDate = gameDate ? new Date(gameDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
  const D = { background: "#fff", color: "#111", fontFamily: "'Georgia', serif" };
  const SH = { fontFamily: "'Arial Narrow', sans-serif", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#1a3a5c", borderBottom: "2px solid #1a3a5c", paddingBottom: 4, marginBottom: 10, marginTop: 20 };
  const TBL = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
  const TH = { padding: "6px 8px", textAlign: "left", background: "#1a3a5c", color: "#fff", fontFamily: "'Arial Narrow', sans-serif", fontWeight: 700, fontSize: 11, textTransform: "uppercase" };
  const THC = { ...TH, textAlign: "center" };
  const TD = { padding: "5px 8px", borderBottom: "1px solid #e5e7eb", fontSize: 13 };
  const TDC = { ...TD, textAlign: "center" };
  const TDLBL = { ...TD, fontFamily: "'Arial Narrow', sans-serif", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, color: "#374151" };

  function outcomeStyle(oc) {
    if (!oc) return {};
    if (oc === "Touchdown") return { background: "#d4edda", color: "#155724", borderRadius: 3, padding: "1px 6px", fontSize: 11, fontFamily: "'Arial Narrow', sans-serif", fontWeight: 700 };
    if (oc === "Field Goal") return { background: "#fff3cd", color: "#856404", borderRadius: 3, padding: "1px 6px", fontSize: 11, fontFamily: "'Arial Narrow', sans-serif", fontWeight: 700 };
    if (["Interception", "Fumble", "Blocked Punt", "Blocked FG", "Safety"].includes(oc)) return { background: "#f8d7da", color: "#7f1d1d", borderRadius: 3, padding: "1px 6px", fontSize: 11, fontFamily: "'Arial Narrow', sans-serif", fontWeight: 700 };
    return { background: "#f3f4f6", color: "#374151", borderRadius: 3, padding: "1px 6px", fontSize: 11, fontFamily: "'Arial Narrow', sans-serif" };
  }
  function fpL(pos) { if (pos == null) return "—"; if (pos === 50) return "50"; if (pos < 50) return `Own ${pos}`; return `Opp ${100 - pos}`; }

  return (
    <div style={D}>
      <div style={{ background: "#1a3a5c", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 10 }}>
        <button onClick={onClose} style={{ background: "none", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 6, color: "#fff", padding: "6px 12px", cursor: "pointer", fontSize: 13, fontFamily: FONT_BODY }}>‹ Back</button>
        <span style={{ flex: 1, color: "#fff", fontFamily: FONT_DISPLAY, fontSize: 16, letterSpacing: 1 }}>Postgame One-Pager</span>
        <button onClick={onExportPDF} disabled={pdfExporting} style={{ background: pdfExporting ? "#4a6585" : "#fff", border: "none", borderRadius: 6, color: pdfExporting ? "#ccc" : "#1a3a5c", padding: "7px 14px", cursor: pdfExporting ? "not-allowed" : "pointer", fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 700, letterSpacing: 0.5 }}>{pdfExporting ? "Exporting…" : "↓ Export PDF"}</button>
      </div>
      <div style={{ padding: "20px 16px", maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, paddingBottom: 14, borderBottom: "2px solid #1a3a5c" }}>
          <div>
            <div style={{ fontFamily: "'Arial Narrow', sans-serif", fontSize: 22, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
            {fmtDate && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{fmtDate}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Arial Narrow', sans-serif", fontSize: 28, fontWeight: 700 }}>{usScore} – {themScore}</div>
            <span style={{ display: "inline-block", background: result === "W" ? "#d4edda" : result === "L" ? "#f8d7da" : "#e9ecef", color: result === "W" ? "#155724" : result === "L" ? "#7f1d1d" : "#374151", borderRadius: 4, padding: "2px 10px", fontSize: 13, fontWeight: 700, fontFamily: "'Arial Narrow', sans-serif", letterSpacing: 1 }}>{result === "W" ? "WIN" : result === "L" ? "LOSS" : "TIE"}</span>
          </div>
        </div>

        <div style={SH}>Score by Quarter</div>
        <table style={TBL}><thead><tr>
          <th style={TH}></th>
          {[1,2,3,4].map(q => <th key={q} style={THC}>Q{q}</th>)}
          <th style={{ ...THC, background: "#0f2540" }}>Final</th>
        </tr></thead><tbody>
          {[["Us", usScore], ["Them", themScore]].map(([lbl, final]) => (
            <tr key={lbl}>
              <td style={{ ...TD, fontWeight: 700, fontFamily: "'Arial Narrow', sans-serif", textTransform: "uppercase", fontSize: 11 }}>{lbl}</td>
              {qScores.map((q, i) => <td key={i} style={TDC}>{lbl === "Us" ? q.us : q.them}</td>)}
              <td style={{ ...TDC, fontWeight: 700, background: "#f3f4f6" }}>{final}</td>
            </tr>
          ))}
        </tbody></table>

        <div style={SH}>Game Stats</div>
        <table style={TBL}><thead><tr><th style={TH}>Stat</th><th style={THC}>Us</th><th style={THC}>Them</th></tr></thead><tbody>
          {[
            ["Total Plays", offTotal, defTotal],
            ["Total Yards", offYards, defYards],
            ["Yards / Play", offYPP, defYPP],
            ["3rd Down", `${off3C}/${off3A} (${off3A ? Math.round(off3C/off3A*100) : 0}%)`, `${def3C}/${def3A} (${def3A ? Math.round(def3C/def3A*100) : 0}%)`],
            ["Red Zone (TD/Trips)", `${offRZTDs}/${offRZTrips}`, `${defRZTDs}/${defRZTrips}`],
            ["Turnovers", `${offINTs + offFumbles} (${offINTs} INT, ${offFumbles} Fum)`, `${defINTs + defFumbles} (${defINTs} INT, ${defFumbles} Fum)`],
            ["Sacks", offSacks, defSacks],
            ["Penalties (Yds)", `${offPens} (${offPenYards} yds)`, `${defPens} (${defPenYards} yds)`],
          ].map(([stat, us, them]) => (
            <tr key={stat}><td style={TDLBL}>{stat}</td><td style={TDC}>{us}</td><td style={TDC}>{them}</td></tr>
          ))}
        </tbody></table>

        {driveSummary.length > 0 && (<>
          <div style={SH}>Drive Summary</div>
          <table style={TBL}><thead><tr>
            <th style={THC}>#</th><th style={TH}>Start</th><th style={THC}>Plays</th><th style={THC}>Yards</th><th style={TH}>Outcome</th>
          </tr></thead><tbody>
            {driveSummary.map(d => (
              <tr key={d.num}>
                <td style={{ ...TDC, fontWeight: 700 }}>{d.num}</td>
                <td style={TD}>{fpL(d.startPos)}</td>
                <td style={TDC}>{d.plays}</td>
                <td style={TDC}>{d.yards >= 0 ? "+" : ""}{d.yards}</td>
                <td style={TD}>{d.outcome ? <span style={outcomeStyle(d.outcome)}>{d.outcome}</span> : "—"}</td>
              </tr>
            ))}
          </tbody></table>
        </>)}

        {(topCarriers.length > 0 || topTacklers.length > 0) && (<>
          <div style={SH}>Top Performers</div>
          <div style={{ display: "grid", gridTemplateColumns: topCarriers.length > 0 && topTacklers.length > 0 ? "1fr 1fr" : "1fr", gap: 16 }}>
            {topCarriers.length > 0 && (
              <div>
                <div style={{ fontFamily: "'Arial Narrow', sans-serif", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#1a3a5c", marginBottom: 6 }}>Offense — Ball Carriers</div>
                <table style={TBL}><thead><tr><th style={TH}>#</th><th style={THC}>Car</th><th style={THC}>Yds</th><th style={THC}>Avg</th></tr></thead>
                  <tbody>{topCarriers.map(c => (<tr key={c.num}><td style={TD}>#{c.num}</td><td style={TDC}>{c.count}</td><td style={TDC}>{c.yards}</td><td style={TDC}>{c.avg}</td></tr>))}</tbody>
                </table>
              </div>
            )}
            {topTacklers.length > 0 && (
              <div>
                <div style={{ fontFamily: "'Arial Narrow', sans-serif", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#1a3a5c", marginBottom: 6 }}>Defense — Tackles</div>
                <table style={TBL}><thead><tr><th style={TH}>Player</th><th style={THC}>Tkl</th></tr></thead>
                  <tbody>{topTacklers.map(t => (<tr key={t.num}><td style={TD}>{t.pos ? `${t.pos} #${t.num}` : `#${t.num}`}</td><td style={TDC}>{t.count}</td></tr>))}</tbody>
                </table>
              </div>
            )}
          </div>
        </>)}

        {(whatWorked.length > 0 || whatDidnt.length > 0) && (<>
          <div style={SH}>What Worked / What Didn't (min 3 att)</div>
          <div style={{ display: "grid", gridTemplateColumns: whatWorked.length > 0 && whatDidnt.length > 0 ? "1fr 1fr" : "1fr", gap: 16 }}>
            {whatWorked.length > 0 && (
              <div>
                <div style={{ fontFamily: "'Arial Narrow', sans-serif", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#155724", marginBottom: 6 }}>What Worked</div>
                <table style={TBL}><thead><tr><th style={TH}>Play</th><th style={THC}>Att</th><th style={THC}>Avg</th></tr></thead>
                  <tbody>{whatWorked.map(w => (<tr key={w.play}><td style={TD}>{w.play}</td><td style={TDC}>{w.count}</td><td style={{ ...TDC, color: "#155724", fontWeight: 700 }}>{w.avg.toFixed(1)}</td></tr>))}</tbody>
                </table>
              </div>
            )}
            {whatDidnt.length > 0 && (
              <div>
                <div style={{ fontFamily: "'Arial Narrow', sans-serif", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#7f1d1d", marginBottom: 6 }}>What Didn't</div>
                <table style={TBL}><thead><tr><th style={TH}>Play</th><th style={THC}>Att</th><th style={THC}>Avg</th></tr></thead>
                  <tbody>{whatDidnt.map(w => (<tr key={w.play}><td style={TD}>{w.play}</td><td style={TDC}>{w.count}</td><td style={{ ...TDC, color: "#7f1d1d", fontWeight: 700 }}>{w.avg.toFixed(1)}</td></tr>))}</tbody>
                </table>
              </div>
            )}
          </div>
        </>)}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}

function SelfScoutView({ currentGameId, currentOffPlays, label, gameDate, onClose, onExportPDF, pdfExporting, teamName }) {
  const [allGames, setAllGames] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set([currentGameId]));
  const [extraPlays, setExtraPlays] = useState({});
  const [loadingGames, setLoadingGames] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    supabase.from("games").select("id, label, created_at").order("created_at", { ascending: false })
      .then(({ data }) => setAllGames(data || []));
  }, []);

  useEffect(() => {
    const toFetch = [...selectedIds].filter(gid => gid !== currentGameId && !extraPlays[gid]);
    if (!toFetch.length) return;
    setLoadingGames(true);
    supabase.from("games").select("id, offensive_plays").in("id", toFetch)
      .then(({ data }) => {
        if (data) setExtraPlays(prev => { const n = { ...prev }; data.forEach(g => { n[g.id] = g.offensive_plays || []; }); return n; });
        setLoadingGames(false);
      });
  }, [selectedIds]);

  const allOffPlays = useMemo(() => {
    let plays = selectedIds.has(currentGameId) ? [...currentOffPlays] : [];
    selectedIds.forEach(gid => { if (gid !== currentGameId && extraPlays[gid]) plays = [...plays, ...extraPlays[gid]]; });
    return plays;
  }, [selectedIds, currentOffPlays, extraPlays, currentGameId]);

  const scout = useMemo(() => computeSelfScout(allOffPlays), [allOffPlays]);
  const fmtDate = gameDate ? new Date(gameDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
  const selCount = selectedIds.size;
  const pickerLabel = selCount === 1 && selectedIds.has(currentGameId) ? `${label} only` : `${selCount} game${selCount === 1 ? "" : "s"} selected`;

  const D = { background: "#fff", color: "#111", fontFamily: "'Georgia', serif" };
  const SH = { fontFamily: "'Arial Narrow', sans-serif", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#1a3a5c", borderBottom: "2px solid #1a3a5c", paddingBottom: 4, marginBottom: 10, marginTop: 20 };
  const TBL = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
  const TH = { padding: "5px 6px", textAlign: "left", background: "#1a3a5c", color: "#fff", fontFamily: "'Arial Narrow', sans-serif", fontWeight: 700, fontSize: 10, textTransform: "uppercase" };
  const THC = { ...TH, textAlign: "center" };
  const TD = { padding: "4px 6px", borderBottom: "1px solid #e5e7eb", fontSize: 12 };
  const TDC = { ...TD, textAlign: "center" };

  function TendTable({ title, rows }) {
    if (!rows.length) return null;
    return (<>
      <div style={SH}>{title}</div>
      <table style={TBL}><thead><tr>
        <th style={TH}>Group</th><th style={THC}>Plays (%)</th><th style={THC}>Run%</th><th style={THC}>Pass%</th><th style={THC}>Avg</th><th style={TH}>Top Plays</th>
      </tr></thead><tbody>
        {rows.map(r => (<tr key={r.label}>
          <td style={{ ...TD, fontWeight: 600 }}>{r.label}</td>
          <td style={TDC}>{r.count} ({r.pct}%)</td>
          <td style={TDC}>{r.runPct}%</td><td style={TDC}>{r.passPct}%</td><td style={TDC}>{r.avg}</td>
          <td style={{ ...TD, fontSize: 11, color: "#374151" }}>{r.top3 || "—"}</td>
        </tr>))}
      </tbody></table>
    </>);
  }

  return (
    <div style={D}>
      <div style={{ background: "#1a3a5c", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 10 }}>
        <button onClick={onClose} style={{ background: "none", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 6, color: "#fff", padding: "6px 12px", cursor: "pointer", fontSize: 13, fontFamily: FONT_BODY }}>‹ Back</button>
        <span style={{ flex: 1, color: "#fff", fontFamily: FONT_DISPLAY, fontSize: 16, letterSpacing: 1 }}>Self-Scout Tendency Report</span>
        <button onClick={onExportPDF} disabled={pdfExporting} style={{ background: pdfExporting ? "#4a6585" : "#fff", border: "none", borderRadius: 6, color: pdfExporting ? "#ccc" : "#1a3a5c", padding: "7px 14px", cursor: pdfExporting ? "not-allowed" : "pointer", fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 700 }}>{pdfExporting ? "Exporting…" : "↓ Export PDF"}</button>
      </div>
      <div style={{ padding: "20px 16px", maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, paddingBottom: 12, borderBottom: "2px solid #1a3a5c" }}>
          <div>
            <div style={{ fontFamily: "'Arial Narrow', sans-serif", fontSize: 22, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Self-Scout: {teamName}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{selCount === 1 && selectedIds.has(currentGameId) ? `${label} · ${fmtDate}` : `${selCount} games selected`}</div>
          </div>
          <button onClick={() => setShowPicker(!showPicker)} style={{ border: "1px solid #d1d5db", borderRadius: 6, background: "#f9fafb", color: "#374151", padding: "6px 12px", cursor: "pointer", fontSize: 12, fontFamily: FONT_BODY }}>
            {showPicker ? "▲" : "▼"} {pickerLabel}
          </button>
        </div>

        {showPicker && allGames && (
          <div style={{ background: "#f9fafb", border: "1px solid #d1d5db", borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <div style={{ fontFamily: "'Arial Narrow', sans-serif", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#6b7280", marginBottom: 8 }}>Select Games to Include</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
              {allGames.map(g => {
                const checked = selectedIds.has(g.id);
                return (
                  <label key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 0" }}>
                    <input type="checkbox" checked={checked} onChange={() => {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (checked && next.size > 1) next.delete(g.id); else if (!checked) next.add(g.id);
                        return next.size === 0 ? new Set([currentGameId]) : next;
                      });
                    }} />
                    <span style={{ fontSize: 13, fontFamily: FONT_BODY }}>{g.label}</span>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>{new Date(g.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                  </label>
                );
              })}
            </div>
            {loadingGames && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>Loading plays…</div>}
          </div>
        )}

        {scout.total === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontSize: 14 }}>No offensive plays in selected games.</div>
        ) : (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
            {[["Total Plays", scout.total], ["Run / Pass", `${scout.runCount} / ${scout.passCount}`], ["Run%", `${scout.runPct}%`], ["Yds / Play", scout.ypp]].map(([l, v]) => (
              <div key={l} style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 6, padding: "10px", textAlign: "center" }}>
                <div style={{ fontFamily: "'Arial Narrow', sans-serif", fontSize: 18, fontWeight: 700 }}>{v}</div>
                <div style={{ fontSize: 10, fontFamily: "'Arial Narrow', sans-serif", textTransform: "uppercase", color: "#6b7280", marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>

          {scout.ddRows.length > 0 && (<>
            <div style={SH}>Down & Distance Tendencies</div>
            <table style={TBL}><thead><tr>
              <th style={TH}>Situation</th><th style={THC}>Plays</th><th style={THC}>Run%</th><th style={THC}>Pass%</th><th style={THC}>Avg</th><th style={TH}>Top Play</th>
            </tr></thead><tbody>
              {scout.ddRows.map(r => (<tr key={r.label}>
                <td style={{ ...TD, fontWeight: 600 }}>{r.label}</td><td style={TDC}>{r.count}</td>
                <td style={TDC}>{r.runPct}%</td><td style={TDC}>{r.passPct}%</td><td style={TDC}>{r.avg}</td>
                <td style={{ ...TD, fontSize: 11 }}>{r.topPlay}</td>
              </tr>))}
            </tbody></table>
          </>)}

          {scout.fzRows.length > 0 && (<>
            <div style={SH}>Field Zone Tendencies</div>
            <table style={TBL}><thead><tr>
              <th style={TH}>Zone</th><th style={THC}>Plays</th><th style={THC}>Run%</th><th style={THC}>Pass%</th><th style={THC}>Avg</th><th style={TH}>Top Play</th>
            </tr></thead><tbody>
              {scout.fzRows.map(r => (<tr key={r.label}>
                <td style={{ ...TD, fontWeight: 600 }}>{r.label}</td><td style={TDC}>{r.count}</td>
                <td style={TDC}>{r.runPct}%</td><td style={TDC}>{r.passPct}%</td><td style={TDC}>{r.avg}</td>
                <td style={{ ...TD, fontSize: 11 }}>{r.topPlay}</td>
              </tr>))}
            </tbody></table>
          </>)}

          {scout.hashRows.length > 0 && (<>
            <div style={SH}>Hash Tendencies</div>
            <table style={TBL}><thead><tr>
              <th style={TH}>Hash</th><th style={THC}>Plays</th><th style={THC}>Run%</th><th style={THC}>Pass%</th><th style={THC}>Avg</th>
            </tr></thead><tbody>
              {scout.hashRows.map(r => (<tr key={r.hash}>
                <td style={{ ...TD, fontWeight: 600 }}>{r.hash}</td><td style={TDC}>{r.count}</td>
                <td style={TDC}>{r.runPct}%</td><td style={TDC}>{r.passPct}%</td><td style={TDC}>{r.avg}</td>
              </tr>))}
            </tbody></table>
          </>)}

          <TendTable title="Personnel Tendencies" rows={scout.personnelRows} />
          <TendTable title="Formation Tendencies" rows={scout.formationRows} />

          {scout.topPlays.length > 0 && (<>
            <div style={SH}>Top Plays by Frequency</div>
            <table style={TBL}><thead><tr>
              <th style={TH}>Play</th><th style={THC}>Type</th><th style={THC}>Count (%)</th><th style={THC}>Avg</th>
            </tr></thead><tbody>
              {scout.topPlays.map(r => (<tr key={r.play}>
                <td style={{ ...TD, fontWeight: 600 }}>{r.play}</td><td style={TDC}>{r.type}</td>
                <td style={TDC}>{r.count} ({r.pct}%)</td><td style={TDC}>{r.avg}</td>
              </tr>))}
            </tbody></table>
          </>)}

          {scout.topCarriers.length > 0 && (<>
            <div style={SH}>Ball Carriers</div>
            <table style={TBL}><thead><tr>
              <th style={TH}>#</th><th style={THC}>Touches</th><th style={THC}>Total Yds</th><th style={THC}>Avg</th><th style={THC}>Long</th>
            </tr></thead><tbody>
              {scout.topCarriers.map(c => (<tr key={c.num}>
                <td style={{ ...TD, fontWeight: 600 }}>#{c.num}</td><td style={TDC}>{c.count}</td>
                <td style={TDC}>{c.yards}</td><td style={TDC}>{c.avg}</td><td style={TDC}>{c.longest}</td>
              </tr>))}
            </tbody></table>
          </>)}
        </>)}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}

// =================== SITUATIONS ===================
function fieldZone(abs, side) {
  if (abs == null) return null;
  if (side === "offense") {
    if (abs <= 20) return "Backed Up";
    if (abs <= 79) return "Normal";
    if (abs <= 96) return "Red Zone";
    return "Goal Line";
  }
  // Defense — opponent running toward our EZ
  if (abs >= 80) return "Backed Up"; // they're in their own territory
  if (abs >= 21) return "Normal";
  if (abs >= 4) return "Red Zone"; // they're near our EZ
  return "Goal Line";
}

function downDistBucket(down, dist) {
  if (down === 4) return "4th Down";
  if (down === 3) {
    if (dist <= 3) return "3rd & Short (1-3)";
    if (dist <= 6) return "3rd & Medium (4-6)";
    return "3rd & Long (7+)";
  }
  return null;
}

function scoreStateBucket(usScore, themScore) {
  if (usScore == null || themScore == null) return null;
  const diff = usScore - themScore;
  if (diff >= 8) return "Leading 8+";
  if (diff >= 1) return "Leading 1-7";
  if (diff === 0) return "Tied";
  if (diff >= -7) return "Trailing 1-7";
  return "Trailing 8+";
}

function timeBucket(quarter, clockStr) {
  if (!clockStr) return null;
  const parts = clockStr.split(":");
  const min = parseInt(parts[0], 10) || 0;
  const sec = parseInt(parts[1], 10) || 0;
  const totalSec = min * 60 + sec;
  if ((quarter === 2 || quarter === 4) && totalSec <= 120) return "Two-Minute";
  if (totalSec < 180) return "Late (< 3:00)";
  if (totalSec <= 360) return "Mid (3:00–6:00)";
  return "Early (> 6:00)";
}

function sitSummary(plays) {
  if (!plays.length) return null;
  const total = plays.length;
  const runs = plays.filter(p => p.playType === "Run").length;
  const passes = plays.filter(p => p.playType === "Pass").length;
  const yards = plays.reduce((s, p) => s + (p.yards || 0), 0);
  const avg = (yards / total).toFixed(1);
  const playCounts = {};
  plays.forEach(p => { if (p.play) playCounts[p.play] = (playCounts[p.play] || 0) + 1; });
  const topPlay = Object.entries(playCounts).sort((a, b) => b[1] - a[1])[0];
  return { total, runs, passes, yards, avg, topPlay: topPlay ? topPlay[0] : "—" };
}

function SitRow({ label, plays }) {
  const s = sitSummary(plays);
  if (!s) return null;
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid #1d2530" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14 }}>{label}</span>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, color: "#f5c518", fontWeight: 700 }}>{s.avg} yds</span>
      </div>
      <div style={{ fontSize: 12, color: "#7a8699" }}>
        {s.total} plays · {s.runs}R/{s.passes}P · top: {s.topPlay}
      </div>
    </div>
  );
}

function SitSection({ title, buckets, plays, bucketFn }) {
  const groups = {};
  plays.forEach(p => {
    const b = bucketFn(p);
    if (b) (groups[b] ??= []).push(p);
  });
  const ordered = buckets.filter(b => groups[b]);
  if (ordered.length === 0) return null;
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 8 }}>{title}</div>
      <div style={{ background: "#11161f", borderRadius: 12, padding: "4px 14px", border: "1px solid #1d2530" }}>
        {ordered.map(b => <SitRow key={b} label={b} plays={groups[b]} />)}
      </div>
    </div>
  );
}

function SituationsTab({ plays, drives, side, fpDisplayMode, driveOutcomes }) {
  // Only non-penalty, non-punt plays
  const filtered = plays.filter(p => p.type !== "penalty" && p.type !== "punt");

  // Build driveNumber → drive context map
  const driveMap = {};
  drives.forEach(d => { driveMap[d.driveNumber] = d; });

  // Attach drive context to each play
  const withCtx = filtered.map(p => {
    const d = driveMap[p.driveNumber];
    return { ...p, _quarter: d?.quarter, _clock: d?.clock, _usScore: d?.usScore, _themScore: d?.themScore, _driveOutcome: d?.outcome ?? null };
  });

  const hasAnyContext = withCtx.some(p => p._quarter != null);

  if (!hasAnyContext) {
    return (
      <div style={{ background: "#11161f", borderRadius: 12, padding: 20, border: "1px solid #1d2530", textAlign: "center", color: "#7a8699", fontSize: 14, lineHeight: 1.6 }}>
        Add quarter, score, and clock to your drives to see situational tendencies.
        <br /><span style={{ fontSize: 12, color: "#4a5568", marginTop: 6, display: "block" }}>Tap "New Drive" and fill in the fields at the top of the panel.</span>
      </div>
    );
  }

  const ctxPlays = withCtx.filter(p => p._quarter != null);
  const noCtxCount = filtered.length - ctxPlays.length;

  return (
    <>
      {noCtxCount > 0 && <div style={{ fontSize: 12, color: "#4a5568", marginBottom: 16 }}>{noCtxCount} play{noCtxCount > 1 ? "s" : ""} excluded (no drive context)</div>}

      <SitSection
        title="By Quarter"
        buckets={[1, 2, 3, 4, "OT"].map(String)}
        plays={ctxPlays}
        bucketFn={p => p._quarter != null ? String(p._quarter) : null}
      />

      <SitSection
        title="By Down & Distance"
        buckets={["3rd & Short (1-3)", "3rd & Medium (4-6)", "3rd & Long (7+)", "4th Down"]}
        plays={ctxPlays}
        bucketFn={p => downDistBucket(p.down, p.distance)}
      />

      <SitSection
        title="By Field Zone"
        buckets={["Goal Line", "Red Zone", "Normal", "Backed Up"]}
        plays={ctxPlays}
        bucketFn={p => fieldZone(p.fieldPos, side)}
      />

      <SitSection
        title="By Score State"
        buckets={["Leading 8+", "Leading 1-7", "Tied", "Trailing 1-7", "Trailing 8+"]}
        plays={ctxPlays}
        bucketFn={p => scoreStateBucket(p._usScore, p._themScore)}
      />

      <SitSection
        title="By Time"
        buckets={["Early (> 6:00)", "Mid (3:00–6:00)", "Late (< 3:00)", "Two-Minute"]}
        plays={ctxPlays}
        bucketFn={p => timeBucket(p._quarter, p._clock)}
      />

      {(driveOutcomes || []).length > 0 && (
        <SitSection
          title="By Drive Outcome"
          buckets={driveOutcomes}
          plays={ctxPlays}
          bucketFn={p => p._driveOutcome || null}
        />
      )}
    </>
  );
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

function PuntBreakdown({ plays }) {
  const punts = plays.filter(p => p.type === "punt");
  if (punts.length === 0) return null;
  const total = punts.length;
  const avgDist = (punts.reduce((s, p) => s + (p.puntDist || 0), 0) / total).toFixed(1);
  const avgReturn = (punts.reduce((s, p) => s + (p.puntReturn || 0), 0) / total).toFixed(1);
  const avgNet = (punts.reduce((s, p) => s + (p.puntNet || 0), 0) / total).toFixed(1);
  const touchbacks = punts.filter(p => p.puntResult === "Touchback").length;
  const fairCatches = punts.filter(p => p.puntResult === "Fair Catch").length;
  const blocked = punts.filter(p => p.puntResult === "Blocked").length;
  const bsRow = (lbl, val) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #1d2530" }}>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "#7a8699" }}>{lbl}</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, color: "#f4f4f0" }}>{val}</span>
    </div>
  );
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 12 }}>Punting</div>
      <div style={{ background: "#11161f", border: "1px solid #1d2530", borderRadius: 12, padding: "14px 16px" }}>
        {bsRow("Punts", total)}
        {bsRow("Avg Distance", `${avgDist} yds`)}
        {bsRow("Avg Return Allowed", `${avgReturn} yds`)}
        {bsRow("Avg Net", `${avgNet} yds`)}
        {touchbacks > 0 && bsRow("Touchbacks", touchbacks)}
        {fairCatches > 0 && bsRow("Fair Catches", fairCatches)}
        {blocked > 0 && bsRow("Blocked", blocked)}
      </div>
    </div>
  );
}
