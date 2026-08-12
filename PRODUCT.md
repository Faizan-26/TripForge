# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js with TypeScript and Tailwind CSS. The current implementation is a frontend scaffold, with a FastAPI backend planned for the vertical slice.

## Users

The primary user is a traveler who wants to plan a trip by asking questions in natural language. They may provide destinations, dates, traveler count, budget, interests, and preferences conversationally.

## Product Purpose

TripForge is an AI-assisted travel planning product that understands a traveler's natural-language request, researches relevant options, and produces detailed, realistic trip information and an itinerary. A chat-like AI interface is the primary interaction model. The product uses multiple specialized agents coordinated through an observable harness so the user can benefit from structured research, planning, validation, and recovery rather than a single unconstrained chatbot response.

Success means a normal traveler can describe a trip naturally, receive structured requirements, and get a grounded plan with useful explanations, realistic pacing, budget awareness, and visible progress.

## Positioning

TripForge coordinates specialized travel-planning agents over shared constraints and real tools, then uses deterministic compatibility, budget, and validation logic to produce a coherent trip. Its meaningful distinction is treating the itinerary as an inspectable planning workflow rather than an ungrounded chat answer or a traditional booking portal.

## Operating Context

The main workflow begins in a conversational trip prompt. The system interprets the request, establishes geographic scope, researches stays and activities, checks compatibility, ranks options, assembles an itinerary, evaluates budget and constraints, validates the result, and explains the outcome. The frontend should expose enough execution state to make the multi-agent process understandable without overwhelming a normal traveler. A later harness view may show agent inputs, tools, results, latency, tokens, errors, retries, and checkpoints.

## Capabilities and Constraints

- Natural-language trip requests and a chat-style AI interface.
- Structured trip requirements including destination, travelers, duration, dates, budget, and interests.
- Geographic scope established before independent stay and activity research.
- Specialized supervisor, scope, stay, activities, ranking, itinerary, and validator responsibilities.
- Parallel research only when branches are independently safe; shared state ownership must remain explicit.
- Real external travel data should remain grounded with provider IDs, coordinates, prices, and source metadata.
- Deterministic code handles distances, travel time, dates, currency, budget arithmetic, availability checks, and schema validation.
- Invalid plans should trigger targeted retries rather than restarting the entire workflow.
- The initial milestone is Next.js UI to FastAPI to one LLM call to a structured TripRequest displayed in the UI.
- V1 does not require payments, full booking, flights, RAG, MCP, long-term memory, complex authentication, or autonomous browser control.

## Brand Commitments

The product name is TripForge. The experience should feel like a modern AI application combined with a premium travel experience, not a traditional booking portal. The intended interface direction is neutral application chrome, travel photography as the primary source of visual color, spacious layouts, rounded cards without excessive decoration, clear execution states, and minimal gradients/effects. Geist is the primary UI font and Geist Mono is reserved for technical harness information.

## Evidence on Hand

- [PROJECT_ALIGNMENT.md](PROJECT_ALIGNMENT.md) contains the project vision, architecture, agent responsibilities, frontend direction, implementation phases, V1 scope, and success definition.
- The repository contains a Next.js 16.3.0 TypeScript frontend scaffold under `frontend/`.
- No production travel data, testimonials, customer claims, booking integrations, or visual brand assets are currently available; future work must not fabricate them.

## Product Principles

- Ground recommendations in real tool results and preserve their source identity.
- Establish shared geographic and trip constraints before specialized research.
- Keep deterministic validation and arithmetic outside language-model reasoning.
- Make agent execution observable and understandable to the traveler.
- Prefer targeted recovery and realistic plans over impressive but unreliable answers.

