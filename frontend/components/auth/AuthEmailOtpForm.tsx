"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowIcon } from "@/components/landing/icons";
import { saveAuthEmail } from "@/lib/auth/pending-auth";
import { getSafeAuthDestination } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/client";
import styles from "./auth.module.css";

type Props = {
  onClose: () => void;
  next?: string;
};

export function AuthEmailOtpForm({ onClose, next }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    setError("");
    setIsSending(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: true },
    });

    if (authError) {
      setError(
        authError.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : "We couldn’t send your code. Check the email and try again.",
      );
      setIsSending(false);
      return;
    }

    saveAuthEmail(normalizedEmail);
    const destination = getSafeAuthDestination(next);
    router.push(`/auth/verify?next=${encodeURIComponent(destination)}`);
  }

  return <section className={styles.authDock} aria-labelledby="auth-title">
    <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Close sign in">×</button>
    <h2 id="auth-title">Continue with email</h2>
    <p>We’ll send a six-digit code. No password needed.</p>
    <form onSubmit={requestOtp}>
      <label htmlFor="auth-email">Email address</label>
      <input id="auth-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required autoFocus />
      <button type="submit" disabled={isSending}>{isSending ? "Sending code…" : "Send one-time code"}<ArrowIcon /></button>
    </form>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <small>By continuing, you agree to receive a sign-in email from TripForge.</small>
  </section>;
}
