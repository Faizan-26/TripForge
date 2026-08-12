---
version: 1
slug: "frontend-app-chat-new-page-tsx"
primary_target: "frontend/app/chat/new/page.tsx"
related_targets: ["frontend/app/chat/new/TripDraft.tsx","frontend/app/chat/new/chat.module.css"]
---

# New trip conversation

- Scope: `/chat/new` and its authenticated conversation shell.
- Visitor mode: Operate.
- Audience: An authenticated traveler beginning or continuing a trip-planning conversation.
- Job: Turn a rough idea into a conversational planning thread without requiring a return to the marketing page.
- Primary action: Share or refine a trip idea in the persistent composer.
- Content states: Empty account, landing-carried draft, active conversation, future saved-trip history.
- Direction: Journey thread — a compact trip library beside a focused conversation, with the composer anchoring every state.
- Memorable moment: The route mark resolves into a direct “Where should we go?” invitation; a carried draft becomes the traveler’s first message.
- Constraints: Light Route Room identity, no technical authentication labels, no fabricated saved projects or travel results, responsive sidebar drawer, reduced-motion support.
- Unresolved: Saved projects and assistant responses need Supabase/FastAPI persistence and APIs before they can represent real history or agent output.
- Concept seed: `d0cd8fcd`, assigned grounded structure 4.
