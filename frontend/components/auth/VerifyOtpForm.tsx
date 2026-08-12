"use client";

import { ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearAuthEmail, EMAIL_KEY } from "@/lib/auth/pending-auth";
import { getSafeAuthDestination } from "@/lib/auth/redirects";
import { useSessionStorage } from "@/lib/browser/use-session-storage";
import { createClient } from "@/lib/supabase/client";
import styles from "./auth.module.css";

type Props = { next: string };

const OTP_LENGTH = 6;

export function VerifyOtpForm({ next }: Props) {
  const router = useRouter();
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const email = useSessionStorage(EMAIL_KEY);
  const [digits, setDigits] = useState(() => Array<string>(OTP_LENGTH).fill(""));
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(60);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  function setDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    setDigits((current) => current.map((item, itemIndex) => itemIndex === index ? digit : item));
    if (digit && index < OTP_LENGTH - 1) inputs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const value = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!value) return;
    event.preventDefault();
    setDigits(Array.from({ length: OTP_LENGTH }, (_, index) => value[index] ?? ""));
    inputs.current[Math.min(value.length, OTP_LENGTH) - 1]?.focus();
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = digits.join("");
    if (token.length !== OTP_LENGTH) { setError("Enter all six digits from the email."); return; }

    setError("");
    setIsVerifying(true);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.verifyOtp({ email, token, type: "email" });

    if (authError) {
      setError("That code is invalid or expired. Check the email or request a new one.");
      setIsVerifying(false);
      return;
    }

    clearAuthEmail();
    router.replace(getSafeAuthDestination(next));
    router.refresh();
  }

  async function resend() {
    if (!email || resendIn > 0) return;
    setError("");
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (authError) { setError("We couldn’t resend the code yet. Please try again shortly."); return; }
    setDigits(Array<string>(OTP_LENGTH).fill(""));
    setResendIn(60);
    inputs.current[0]?.focus();
  }

  if (!email) return <div className={styles.missingState}><h1>Start sign-in again</h1><p>Your email wasn’t available in this tab.</p><Link href="/?auth=required">Return to TripForge</Link></div>;

  return <form className={styles.verifyForm} onSubmit={verify}>
    <p className={styles.brandLine}><span>Trip</span>Forge</p>
    <h1>Check your inbox.</h1>
    <p>Enter the code sent to <strong>{email}</strong></p>
    <div className={styles.otpFields} onPaste={handlePaste}>
      {digits.map((digit, index) => <input key={index} ref={(element) => { inputs.current[index] = element; }} value={digit} onChange={(event) => setDigit(index, event.target.value)} onKeyDown={(event) => handleKeyDown(index, event)} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} aria-label={`Digit ${index + 1}`} maxLength={1} autoFocus={index === 0} />)}
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button className={styles.verifyButton} type="submit" disabled={isVerifying}>{isVerifying ? "Verifying…" : "Continue to your trip"}</button>
    <button className={styles.resendButton} type="button" onClick={resend} disabled={resendIn > 0}>Resend code{resendIn > 0 ? ` in ${resendIn}s` : ""}</button>
  </form>;
}
