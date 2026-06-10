"use client";
// @ts-nocheck
import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

const FONT_DISPLAY = "'Oswald', 'Arial Narrow', sans-serif";
const FONT_BODY = "'Barlow', system-ui, sans-serif";
const inputStyle = { width: "100%", boxSizing: "border-box", background: "#141a24", border: "1px solid #2a3543", borderRadius: 10, color: "#f4f4f0", padding: "14px", fontSize: 16, fontFamily: FONT_BODY };

function JoinForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");

  const [team, setTeam] = useState(null);       // the head coach's profile row
  const [status, setStatus] = useState("loading"); // loading | ready | invalid | done
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setStatus("invalid"); return; }
    supabase.from("profiles")
      .select("user_id, school, state")
      .eq("invite_token", token)
      .maybeSingle()
      .then(({ data }) => {
        if (data) { setTeam(data); setStatus("ready"); }
        else setStatus("invalid");
      });
  }, [token]);

  async function handleJoin() {
    if (!email || !password) { setMessage({ text: "Email and password are required.", error: true }); return; }
    setSubmitting(true); setMessage(null);

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { setMessage({ text: error.message, error: true }); setSubmitting(false); return; }

    const uid = data.user?.id;
    if (!uid) { setMessage({ text: "Signup succeeded but no user ID — try again.", error: true }); setSubmitting(false); return; }

    await supabase.from("profiles").upsert({
      user_id: uid,
      email: email.trim(),
      school: team.school,
      state: team.state,
      role: "assistant",
      team_id: team.user_id,
    });

    setStatus("done");
    setTimeout(() => router.push("/"), 1500);
  }

  if (status === "loading") {
    return (
      <div style={{ fontFamily: FONT_BODY, background: "#0a0e14", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#f4f4f0" }}>
          Side<span style={{ color: "#f5c518" }}>line</span>
        </div>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div style={{ fontFamily: FONT_BODY, background: "#0a0e14", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 360, textAlign: "center" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", marginBottom: 20 }}>
            Side<span style={{ color: "#f5c518" }}>line</span>
          </div>
          <div style={{ background: "#1d1015", border: "1px solid #ff5252", borderRadius: 12, padding: 20, color: "#ff8a80", fontSize: 14, lineHeight: 1.6 }}>
            This invite link is invalid or has expired. Ask your head coach to send a new one.
          </div>
          <button onClick={() => router.push("/")} style={{ marginTop: 16, background: "none", border: "1px solid #2a3543", borderRadius: 8, color: "#7a8699", fontSize: 13, cursor: "pointer", fontFamily: FONT_BODY, padding: "10px 20px" }}>
            Go to Sign In
          </button>
        </div>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div style={{ fontFamily: FONT_BODY, background: "#0a0e14", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 360, textAlign: "center" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", marginBottom: 20 }}>
            Side<span style={{ color: "#f5c518" }}>line</span>
          </div>
          <div style={{ background: "#0d1a12", border: "1px solid #3ddc84", borderRadius: 12, padding: 20, color: "#3ddc84", fontSize: 15, lineHeight: 1.6 }}>
            ✓ You're in! Taking you to {team?.school}…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT_BODY, background: "#0a0e14", minHeight: "100vh", color: "#f4f4f0", paddingBottom: 40 }}>
      <div style={{ background: "linear-gradient(180deg,#11161f,#0a0e14)", borderBottom: "3px solid #f5c518", padding: "16px 16px 12px" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
          Side<span style={{ color: "#f5c518" }}>line</span>
        </div>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginTop: 1 }}>Staff Sign Up</div>
      </div>

      <div style={{ padding: 24, maxWidth: 420, margin: "0 auto" }}>
        <div style={{ background: "#11161f", border: "1px solid #1d2530", borderRadius: 12, padding: 16, marginBottom: 28 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 6 }}>Joining</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700 }}>{team?.school}</div>
          {team?.state && <div style={{ fontSize: 13, color: "#7a8699", marginTop: 2 }}>{team.state}</div>}
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 10 }}>Email</div>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="your@email.com" style={inputStyle} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#7a8699", marginBottom: 10 }}>Password</div>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="Min. 6 characters" style={inputStyle} />
        </div>

        {message && (
          <div style={{ borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13,
            background: message.error ? "#1d1015" : "#0d1a12",
            border: `1px solid ${message.error ? "#ff5252" : "#3ddc84"}`,
            color: message.error ? "#ff8a80" : "#3ddc84" }}>{message.text}</div>
        )}

        <button onClick={handleJoin} disabled={submitting} style={{
          width: "100%", padding: "18px", borderRadius: 12, border: "none",
          background: submitting ? "#1d2530" : "#f5c518", color: submitting ? "#4a5568" : "#0a0e14",
          fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, letterSpacing: 1.5,
          textTransform: "uppercase", cursor: submitting ? "not-allowed" : "pointer",
        }}>{submitting ? "Creating account…" : "Join Team"}</button>

        <div style={{ marginTop: 16, fontSize: 12, color: "#4a5568", textAlign: "center", lineHeight: 1.6 }}>
          Already have an account? <button onClick={() => router.push("/")} style={{ background: "none", border: "none", color: "#7a8699", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, textDecoration: "underline" }}>Sign in here</button>
        </div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={
      <div style={{ fontFamily: "'Barlow', system-ui, sans-serif", background: "#0a0e14", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#f4f4f0" }}>
          Side<span style={{ color: "#f5c518" }}>line</span>
        </div>
      </div>
    }>
      <JoinForm />
    </Suspense>
  );
}
