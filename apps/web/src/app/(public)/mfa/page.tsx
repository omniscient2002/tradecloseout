"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setCsrfToken } from "../../../lib/api-client";

type Phase = "loading" | "enroll" | "enroll-verify" | "verify" | "recovery" | "save-codes" | "complete";
type SessionResponse = { csrfToken: string; authGeneration: string; mfaVerified: boolean };
type EnrollResponse = SessionResponse & { recoveryCodes: string[] };

export default function MfaPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupKey, setSetupKey] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ enrolled: boolean; verified: boolean }>("/api/v1/auth/mfa/status")
      .then(status => {
        if (status.verified) {
          router.replace("/dashboard");
          return;
        }
        setPhase(status.enrolled ? "verify" : "enroll");
      })
      .catch(() => {
        setError("Your session could not be verified. Sign in again.");
        setPhase("verify");
      });
  }, [router]);

  const invoke = async (action: () => Promise<void>) => {
    setError(null); setBusy(true);
    try { await action(); }
    catch (e: any) { setError(e?.message || "Verification failed."); }
    finally { setBusy(false); }
  };

  const complete = (session: SessionResponse) => {
    if (!session.csrfToken || !session.authGeneration) throw new Error("Invalid MFA session response");
    setCsrfToken(session.csrfToken, session.authGeneration);
    router.replace("/dashboard");
    router.refresh();
  };

  const startEnrollment = () => invoke(async () => {
    const state = await apiFetch<{ manualSetupKey: string; periodSeconds: number }>(
      "/api/v1/auth/mfa/enroll/start", { method: "POST" },
    );
    setSetupKey(state.manualSetupKey);
    setPhase("enroll-verify");
  });

  const submitCode = () => invoke(async () => {
    if (!/^\d{6}$/.test(code)) throw new Error("Enter a six-digit authenticator code.");
    if (phase === "enroll-verify") {
      const result = await apiFetch<EnrollResponse>("/api/v1/auth/mfa/enroll/confirm", {
        method: "POST", body: JSON.stringify({ code }),
      });
      setCsrfToken(result.csrfToken, result.authGeneration);
      setRecoveryCodes(result.recoveryCodes);
      setCode("");
      setPhase("save-codes");
    } else {
      const result = await apiFetch<SessionResponse>("/api/v1/auth/mfa/verify", {
        method: "POST", body: JSON.stringify({ code }),
      });
      complete(result);
    }
  });

  const submitRecovery = () => invoke(async () => {
    const result = await apiFetch<SessionResponse>("/api/v1/auth/mfa/recovery", {
      method: "POST", body: JSON.stringify({ recoveryCode: code.trim() }),
    });
    complete(result);
  });

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <section className="w-full max-w-lg rounded-xl bg-slate-900 border border-slate-700 p-8 space-y-5">
        <h1 className="text-xl font-semibold">Secure your TradeCloseout account</h1>
        <p className="text-sm text-slate-300">
          Organisation owners and administrators must verify a second factor before managing sensitive information.
        </p>
        {error && <div role="alert" className="text-sm text-red-300">{error}</div>}
        {phase === "loading" && <p>Checking your authenticated session…</p>}
        {phase === "enroll" && (
          <button disabled={busy} onClick={startEnrollment}
            className="bg-blue-600 rounded-md px-4 py-2 text-white disabled:opacity-50">
            Start authenticator enrollment
          </button>
        )}
        {phase === "enroll-verify" && (
          <div className="space-y-2">
            <p className="text-sm">Add this key manually to your authenticator app (TOTP, 30-second period, 6 digits). Do not share it.</p>
            <code className="block break-all bg-slate-800 rounded-md p-3 select-all">{setupKey}</code>
          </div>
        )}
        {["enroll-verify", "verify", "recovery"].includes(phase) && (
          <form onSubmit={e => {
            e.preventDefault();
            if (phase === "recovery") void submitRecovery();
            else void submitCode();
          }} className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="mfa-code">
              {phase === "recovery" ? "One-time recovery code" : "6-digit authenticator code"}
            </label>
            <input id="mfa-code" required autoComplete="one-time-code"
              value={code} onChange={e => setCode(e.target.value)}
              maxLength={phase === "recovery" ? 24 : 6}
              className="w-full rounded-md p-2 bg-slate-800 border border-slate-600" />
            <button type="submit" disabled={busy}
              className="bg-blue-600 rounded-md px-4 py-2 text-white disabled:opacity-50">
              {busy ? "Checking…" : "Verify"}
            </button>
            {phase !== "enroll-verify" && (
              <button type="button" className="ml-3 underline text-sm"
                onClick={() => { setCode(""); setPhase(phase === "recovery" ? "verify" : "recovery"); }}>
                {phase === "recovery" ? "Use authenticator code" : "Use a recovery code"}
              </button>
            )}
          </form>
        )}
        {phase === "save-codes" && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">Save these eight recovery codes offline. Each works once.</p>
            <div className="grid grid-cols-2 gap-2">
              {recoveryCodes.map(c => <code key={c} className="bg-slate-800 p-2 text-xs break-all">{c}</code>)}
            </div>
            <button className="bg-blue-600 rounded-md px-4 py-2"
              onClick={() => { setRecoveryCodes([]); setSetupKey(""); setPhase("complete"); router.replace("/dashboard"); }}>
              I have saved the codes securely
            </button>
          </div>
        )}
        <div className="pt-3 border-t border-slate-700">
          <a href="/login" className="text-sm underline">Return to sign-in</a>
        </div>
      </section>
    </main>
  );
}
