import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = { title: "TripForge — A considered way to travel", description: "Multi-agent travel planning, grounded in the details." };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}><body>
    {/* THESIS: A traveler begins with one plain sentence while a Route Room makes the coordinated planning work tangible; it refuses the generic booking hero. OWN-WORLD: Warm map paper, ink-blue wayfinding panels, hairline routes, and citron departure signals; precise Geist type and diagrammatic motion. STORY: Visitors understand that TripForge turns their request into a checked route, then start the authenticated handoff. FIRST VIEWPORT: Navigation tops a spacious left-side statement and input; a living agent route board fills the right half. FORM: Route Room, composition A, seed a6c40489. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md */}
    {children}
  </body></html>;
}
