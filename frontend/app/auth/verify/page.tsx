import { VerifyOtpForm } from "@/components/auth/VerifyOtpForm";
import { getSafeAuthDestination } from "@/lib/auth/redirects";
import styles from "./verify.module.css";

type Props = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function VerifyPage({ searchParams }: Props) {
  const params = await searchParams;
  const requestedNext = Array.isArray(params.next) ? params.next[0] : params.next;

  return <main className={styles.page}><div className={styles.route} aria-hidden="true"><span /><span /><span /></div><VerifyOtpForm next={getSafeAuthDestination(requestedNext)} /></main>;
}
