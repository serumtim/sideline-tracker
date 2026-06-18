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
  if (saved && (saved.offense !== undefined || saved.defense !== undefined)) {
    return {
      offense: { ...DEFAULT_LAYOUT, ...saved.offense },
      defense: { ...DEFAULT_DEF_LAYOUT, ...saved.defense },
    };
  }
  return { offense: { ...DEFAULT_LAYOUT, ...(saved || {}) }, defense: DEFAULT_DEF_LAYOUT };
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
  let totalYards = 0;
  plays.forEach((p) => {
    totalYards += p.yards;
    const playLabel = (p.runCarrier && p.playType === "Run") ? `${p.runCarrier} ${p.play}` : p.play;
    for (const [obj, k] of [[byPersonnel, p.personnel], [byFormation, p.formation], [byPlay, playLabel], [byGain, p.gainType || "—"], [byDown, p.down], [byHash, p.hash]]) {
      (obj[k] ??= { count: 0, yards: 0 }); obj[k].count++; obj[k].yards += p.yards;
    }
    if (p.carrier) {
      const k = `#${p.carrier}`;
      (byCarrier[k] ??= { count: 0, yards: 0 }); byCarrier[k].count++; byCarrier[k].yards += p.yards;
    }
  });
  return { byPersonnel, byFormation, byPlay, byGain, byDown, byHash, byCarrier, totalYards, avg: plays.length ? (totalYards / plays.length).toFixed(1) : "0.0" };
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
    <Game id={activeId} label={active?.label || "Game"} playbook={playbook} layout={layout}
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
function GamesList({ index, loading, onRefresh, onOpen, onCreate, onDelete, onSignOut, onEditPlaybook, onViewStaff, onViewReports, isHeadCoach, canEditPlaybook, profile }) {
  const [showNew, setShowNew] = useState(false);
  const [label, setLabel] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);

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
          index.map((g) => (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#11161f", borderRadius: 12, padding: "14px 16px", marginBottom: 8, border: "1px solid #1d2530" }}>
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
  ];
  const defCategories = [
    { key: "oppPersonnel", label: "Their Personnel Groups" }, { key: "oppFormations", label: "Their Formations" },
    { key: "oppFormTags", label: "Their Formation Tags" }, { key: "oppRunPlays", label: "Their Run Plays" },
    { key: "oppPassPlays", label: "Their Pass Plays" }, { key: "oppMotions", label: "Their Motions" },
    { key: "defFronts", label: "Our Fronts" }, { key: "defCoverages", label: "Our Coverages" },
    { key: "defBlitz", label: "Blitz Tags" }, { key: "fieldBdry", label: "Field / Boundary" },
  ];
  const offChipSections = [
    { id: "personnel", label: "Personnel", chips: draft.personnel },
    { id: "formation", label: "Formations", chips: draft.formations },
    { id: "formTags", label: "Formation Tags", chips: draft.formTags },
    { id: "motion", label: "Motions", chips: draft.motions },
    { id: "runPlay", label: "Run Plays", chips: draft.runPlays },
    { id: "rpoTags", label: "RPO Tags", chips: draft.rpoTags },
    { id: "passPlay", label: "Pass Plays", chips: draft.passPlays },
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
function Game({ id, label, playbook, layout, isHeadCoach, onBack }) {
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
  const offReady = editing && formation && play && (yards !== "" || incomplete);
  const defReady = editing && defOppFormation && defPlay && (defYards !== "" || defIncomplete);
  const activePlays = side === "offense" ? offPlays : defPlays;

  const fetchGame = useCallback(async () => {
    try {
      setSyncing(true);
      const { data } = await supabase.from("games").select("offensive_plays, defensive_plays").eq("id", id).single();
      if (data) { setOffPlays(data.offensive_plays || []); setDefPlays(data.defensive_plays || []); }
    } catch (e) {}
    setSyncing(false); setLoaded(true);
  }, [id]);

  useEffect(() => { fetchGame(); }, [fetchGame]);

  useEffect(() => {
    const channel = supabase
      .channel(`game-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${id}` },
        (payload) => { setOffPlays(payload.new.offensive_plays || []); setDefPlays(payload.new.defensive_plays || []); })
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

  function toggle(list, setList, val) { setList(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]); }

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
    const y = incomplete ? 0 : (parseInt(yards, 10) || 0);
    const newPlay = {
      id: Date.now() + Math.random(), personnel: personnel || "—", formation, formTags: [...formTags],
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
    if (gainType === "TD" || gainType === "INT" || gainType === "Safety") { setDown(1); setDistance(10); }
    else { const g = y >= distance; if (g) { setDown(1); setDistance(10); } else if (down < 4) { setDown(down + 1); setDistance(Math.max(distance - y, 1)); } else { setDown(1); setDistance(10); } }
    setPlay(""); setPlayType(""); setRunCarrier(""); setYards(""); setGainType(""); setIncomplete(false);
    setCarrier(""); setTacklerPos(""); setTacklerNum(""); setMotion("None"); setMotionPlayer("");
    setFormTags([]); setRpoTags([]); setRpoPlayer("");
    setFumbleForcerPos(""); setFumbleForcerNum(""); setFumbleRecovery("");
    setIntByPos(""); setIntByNum(""); setIntReturn("0");
  }

  async function logDefPlay() {
    if (!defReady) return;
    const y = defIncomplete ? 0 : (parseInt(defYards, 10) || 0);
    const newPlay = {
      id: Date.now() + Math.random(),
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
    if (defGainType === "TD" || defGainType === "INT" || defGainType === "Safety") { setDown(1); setDistance(10); }
    else { const g = y >= distance; if (g) { setDown(1); setDistance(10); } else if (down < 4) { setDown(down + 1); setDistance(Math.max(distance - y, 1)); } else { setDown(1); setDistance(10); } }
    setDefPlay(""); setDefPlayType(""); setDefYards(""); setDefGainType(""); setDefIncomplete(false);
    setDefCarrier(""); setDefTacklerPos(""); setDefTacklerNum(""); setDefOppMotion("None"); setDefOppMotionPlayer("");
    setDefOppFormTags([]); setDefFieldBdry(""); setDefFront(""); setDefCoverage(""); setDefBlitz(""); setDefOppPersonnel("");
  }

  async function deletePlay(pid) {
    if (side === "offense") { const n = offPlays.filter((p) => p.id !== pid); setOffPlays(n); persist(n, "offense"); }
    else { const n = defPlays.filter((p) => p.id !== pid); setDefPlays(n); persist(n, "defense"); }
  }

  function exportCSV() {
    const headers = ["Side", "#", "Hash", "Field/Bdry", "Down", "Distance",
      "Personnel", "Formation", "Form Tags", "RPO", "RPO Player", "Motion", "Motion Player", "Play", "Gain Type", "Yards", "Incomplete", "Ball Carrier", "Tackled By",
      "Their Personnel", "Their Formation", "Their Form Tags", "Their Motion", "Their Motion Player", "Their Play",
      "Our Front", "Our Coverage", "Blitz", "Their Ball Carrier", "Our Tackler"];
    const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const offRows = [...offPlays].reverse().map((p, i) => [
      "Offense", i + 1, p.hash, "", ordinal(p.down), p.distance,
      p.personnel, p.formation, (p.formTags || []).join(" "), (p.rpoTags || []).join(" "),
      p.rpoTags?.length > 0 ? (p.rpoPlayer || "") : "", p.motion,
      p.motion !== "None" ? (p.motionPlayer || "") : "",
      (p.runCarrier && p.playType === "Run") ? `${p.runCarrier} ${p.play}` : p.play,
      p.gainType || "", p.incomplete ? 0 : p.yards, p.incomplete ? "INC" : "", p.carrier || "", p.tackler,
      "", "", "", "", "", "", "", "", "", "", "",
    ]);
    const defRows = [...defPlays].reverse().map((p, i) => [
      "Defense", i + 1, p.hash, p.fieldBdry || "", ordinal(p.down), p.distance,
      "", "", "", "", "", "", "", "",
      p.gainType || "", p.incomplete ? 0 : p.yards, p.incomplete ? "INC" : "", "", "",
      p.oppPersonnel, p.oppFormation, (p.oppFormTags || []).join(" "),
      p.oppMotion, p.oppMotion !== "None" ? (p.oppMotionPlayer || "") : "", p.play,
      p.front || "", p.coverage || "", p.blitz || "", p.carrier || "", p.tackler,
    ]);
    const csv = [headers, ...offRows, ...defRows].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `sideline-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const tendencies = useMemo(() => calcTendencies(offPlays), [offPlays]);
  const defTendencies = useMemo(() => calcDefTendencies(defPlays), [defPlays]);

  return (
    <Shell subtitle={label} onBack={onBack}
      right={<span style={{ fontSize: 11, color: syncing ? "#f5c518" : "#3ddc84" }}>{syncing ? "syncing…" : "● live"}</span>}>

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
                        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 50, textAlign: "center" }}>{distance}</span>
                        <button onClick={() => setDistance(distance + 1)} style={stepBtn}>+</button>
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
                          <Chip active={gainType === "Sack"} onClick={() => { setGainType("Sack"); setIncomplete(false); }} big>Sack</Chip>
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
                        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, minWidth: 50, textAlign: "center" }}>{distance}</span>
                        <button onClick={() => setDistance(distance + 1)} style={stepBtn}>+</button>
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
                        <Chip active={defGainType === "Sack"} onClick={() => { setDefGainType("Sack"); setDefIncomplete(false); }} big>Sack</Chip>
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
              {activePlays.map((p) => {
                if (side === "offense") {
                  const col = p.gainType === "TD" ? "#3ddc84" : (p.incomplete || p.gainType === "INT" || p.gainType === "Safety" || p.gainType === "Sack") ? "#ff5252" : p.yards >= p.distance ? "#3ddc84" : p.yards < 0 ? "#ff5252" : "#f5c518";
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${col}` }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15 }}>{ordinal(p.down)} &amp; {p.distance} · {p.hash} · {p.personnel} {p.formation}{p.formTags?.length ? ` ${p.formTags.join(" ")}` : ""}</div>
                        <div style={{ fontSize: 13, color: "#a8b3c4", marginTop: 2 }}>{(p.runCarrier && p.playType === "Run") ? `${p.runCarrier} ${p.play}` : p.play}{p.rpoTags?.length ? ` · ${p.rpoTags.join("/")}${p.rpoPlayer ? " (" + p.rpoPlayer + ")" : ""}` : ""}{p.motion !== "None" ? ` · ${p.motionPlayer ? p.motionPlayer + " " : ""}${p.motion}` : ""}{p.passer ? ` · QB #${p.passer}` : ""}{p.carrier ? ` · #${p.carrier}` : ""}{p.gainType === "Fumble" ? ` · frc ${p.fumbleForcer || "—"}${p.fumbleRecovery ? " · " + p.fumbleRecovery.toLowerCase() + " rec" : ""}` : ""}{p.gainType === "INT" ? ` · int ${p.intBy || "—"}${p.intReturn ? " · " + p.intReturn + " yd ret" : ""}` : ""}{p.gainType !== "INT" && p.gainType !== "Fumble" ? ` · tkl ${p.tackler}` : ""}</div>
                      </div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, minWidth: 44, textAlign: "right", color: col }}>
                        {p.gainType === "INT" ? "INT" : p.gainType === "Safety" ? "SAF" : p.gainType === "TD" ? "TD" : p.gainType === "Sack" ? "SCK" : p.incomplete ? "INC" : `${p.yards > 0 ? "+" : ""}${p.yards}`}
                      </div>
                      {editing && <button onClick={() => deletePlay(p.id)} style={{ background: "none", border: "none", color: "#4a5568", fontSize: 20, cursor: "pointer", padding: "0 4px" }}>×</button>}
                    </div>
                  );
                } else {
                  const col = p.gainType === "INT" || p.gainType === "Safety" || p.gainType === "Fumble" ? "#3ddc84"
                    : p.gainType === "TD" ? "#ff5252"
                    : p.incomplete ? "#3ddc84"
                    : p.yards >= p.distance ? "#ff5252" : p.yards < 0 ? "#3ddc84" : "#f5c518";
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#11161f", borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${col}` }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15 }}>
                          {ordinal(p.down)} &amp; {p.distance} · {p.hash}{p.fieldBdry ? ` · ${p.fieldBdry}` : ""} · {p.oppPersonnel} {p.oppFormation}{p.oppFormTags?.length ? ` ${p.oppFormTags.join(" ")}` : ""}
                        </div>
                        <div style={{ fontSize: 13, color: "#a8b3c4", marginTop: 2 }}>
                          {p.play}{p.oppMotion !== "None" ? ` · ${p.oppMotionPlayer ? p.oppMotionPlayer + " " : ""}${p.oppMotion}` : ""}{p.front ? ` · ${p.front}` : ""}{p.coverage ? `/${p.coverage}` : ""}{p.blitz && p.blitz !== "None" ? `/${p.blitz}` : ""}{p.carrier ? ` · #${p.carrier}` : ""}{` · tkl ${p.tackler}`}
                        </div>
                      </div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, minWidth: 44, textAlign: "right", color: col }}>
                        {p.gainType === "INT" ? "INT" : p.gainType === "Safety" ? "SAF" : p.gainType === "TD" ? "TD" : p.gainType === "Sack" ? "SCK" : p.gainType === "Fumble" ? "FUM" : p.incomplete ? "INC" : `${p.yards > 0 ? "+" : ""}${p.yards}`}
                      </div>
                      {editing && <button onClick={() => deletePlay(p.id)} style={{ background: "none", border: "none", color: "#4a5568", fontSize: 20, cursor: "pointer", padding: "0 4px" }}>×</button>}
                    </div>
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
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setTendSide("offense")} style={modeBtn(tendSide === "offense", true)}>Offense</button>
            <button onClick={() => setTendSide("defense")} style={modeBtn(tendSide === "defense")}>Defense</button>
          </div>
          {tendSide === "offense" ? (
            offPlays.length === 0 ? <div style={{ textAlign: "center", color: "#4a5568", padding: "60px 20px", fontSize: 15 }}>No offensive plays logged yet.</div> : (() => {
              const rushPlays = offPlays.filter(p => p.playType === "Run" || p.gainType === "Sack");
              const rushYards = rushPlays.reduce((s, p) => s + p.yards, 0);
              const rushTDs = offPlays.filter(p => p.gainType === "TD" && p.playType === "Run").length;
              const passPlays = offPlays.filter(p => p.playType === "Pass" && p.gainType !== "Sack");
              const passComp = passPlays.filter(p => !p.incomplete && p.gainType !== "INT").length;
              const passYards = passPlays.filter(p => !p.incomplete && p.gainType !== "INT").reduce((s, p) => s + p.yards, 0);
              const passTDs = offPlays.filter(p => p.gainType === "TD" && p.playType === "Pass").length;
              const ints = offPlays.filter(p => p.gainType === "INT").length;
              const fumbles = offPlays.filter(p => p.gainType === "Fumble").length;
              const sacks = offPlays.filter(p => p.gainType === "Sack").length;
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
                    {bsRow("Total", `${offPlays.length} plays · ${rushYards + passYards >= 0 ? "+" : ""}${rushYards + passYards} yds`)}
                    {bsRow("Rush", `${rushPlays.length} att · ${rushYards >= 0 ? "+" : ""}${rushYards} yds${rushTDs ? ` · ${rushTDs} TD` : ""}${sacks ? ` · ${sacks} sack${sacks > 1 ? "s" : ""}` : ""}`)}
                    {bsRow("Pass", `${passComp}/${passPlays.length} · ${passYards >= 0 ? "+" : ""}${passYards} yds${passTDs ? ` · ${passTDs} TD` : ""}${ints ? ` · ${ints} INT` : ""}`)}
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
                </>
              );
            })()
          ) : (
            defPlays.length === 0 ? <div style={{ textAlign: "center", color: "#4a5568", padding: "60px 20px", fontSize: 15 }}>No defensive plays logged yet.</div> : (() => {
              const dt = defTendencies;
              const runPlays = defPlays.filter(p => p.playType === "Run" || p.gainType === "Sack");
              const runYards = runPlays.reduce((s, p) => s + p.yards, 0);
              const runTDs = defPlays.filter(p => p.gainType === "TD" && p.playType === "Run").length;
              const passPl = defPlays.filter(p => p.playType === "Pass" && p.gainType !== "Sack");
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
                    {(turnovers > 0 || safeties > 0 || sacks > 0) && bsRow("Takeaways / Big Plays", [turnovers ? `${turnovers} TO` : "", safeties ? `${safeties} safety` : "", sacks ? `${sacks} sack${sacks > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · "))}
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
                </>
              );
            })()
          )}
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
