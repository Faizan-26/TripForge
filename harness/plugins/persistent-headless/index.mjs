import z from "@deepseek-ai/schemastery";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";

import { consumeTerminalResponse } from "../trip-result/index.mjs";
import { formatResultLine } from "../progress/index.mjs";

const TERMINAL_RECOVERY_PROMPT = [
  "Your previous turn ended before a valid TripForge terminal response was submitted.",
  "A deterministic workflow rule may have rejected the previous submit call.",
  "Follow that tool error and the workflow next_action. Do not repeat answered questions.",
  "Use the already available request and context, keep the user's language, and call",
  "submit_trip_response exactly once now. If details are missing, submit 1 to 4 concise",
  "clarification questions and preserve all facts already known in draft.",
].join(" ");

export const name = "tripforge-persistent-headless";
export const inject = [
  "agentDefaultModel",
  "agents",
  "sessions",
  "sessionPersistence",
  "headlessStartup",
];
export const Config = z.object({});

export function apply(ctx) {
  const exit = ctx.get("appExit");
  if (!exit) throw new Error("tripforge-persistent-headless requires appExit");
  run(ctx, {
    stdout: process.stdout,
    stderr: process.stderr,
    exit,
  }).catch((error) => {
    process.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
  });
}

async function run(ctx, io) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  const persistence = ctx.get("sessionPersistence");
  const startup = ctx.get("headlessStartup");
  if (!agents || !defaultModel || !sessions || !persistence || !startup) return;

  const rawSessionId = process.env.TRIPFORGE_DSH_SESSION_ID;
  if (!rawSessionId) throw new Error("TRIPFORGE_DSH_SESSION_ID is required");
  const sessionId = SessionId(rawSessionId);
  const selection = defaultModel.currentSelection();
  const setup = (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: undefined });
  };
  const exists = (await persistence.listSnapshots())
    .some((snapshot) => snapshot.header.id === sessionId);
  const { agent } = exists
    ? await agents.resume({
        resumeSessionId: sessionId,
        agentOptions: { provider: selection.provider, model: selection.model },
        setup,
      })
    : await agents.create({
        sessionId,
        meta: { cwd: process.cwd() },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup,
      });

  await agent.whenIdle();
  const firstSeq = agent.session.seq;
  agent.followup(createUserMessage({
    content: [{ type: "text", text: startup.task }],
    source: { kind: "user" },
  }));
  await agent.whenIdle();
  await sessions.flush(agent.session);

  let outcome = summarize(agent.session.events, firstSeq);
  let submittedResponse = consumeTerminalResponse(sessionId);
  if (shouldRetryTerminalResponse(submittedResponse, outcome)) {
    io.stderr.write(
      `dsh: TERMINAL_RECOVERY: ${outcome.reason?.kind ?? "missing-turn-end"}; retrying once\n`,
    );
    agent.followup(createUserMessage({
      content: [{ type: "text", text: TERMINAL_RECOVERY_PROMPT }],
      source: { kind: "user" },
    }));
    await agent.whenIdle();
    await sessions.flush(agent.session);
    outcome = summarize(agent.session.events, firstSeq);
    submittedResponse = consumeTerminalResponse(sessionId);
  }
  const terminalOutput = selectTerminalOutput(submittedResponse, outcome);
  if (terminalOutput) io.stderr.write(formatResultLine(terminalOutput));
  io.stdout.write(`${outcome.text}\n`);
  if (outcome.reason?.kind === "error") {
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`);
  } else if (!terminalOutput) {
    io.stderr.write(
      `dsh: TERMINAL_RESPONSE_MISSING: turn ended with ${outcome.reason?.kind ?? "no reason"}\n`,
    );
  }
  io.exit(outcome.reason?.kind === "completed" && terminalOutput ? 0 : 1);
}

export function shouldRetryTerminalResponse(submittedResponse, outcome) {
  if (submittedResponse) return false;
  if (outcome?.reason?.kind === "max-tokens") return true;
  return outcome?.reason?.kind === "completed";
}

export function selectTerminalOutput(submittedResponse, outcome) {
  if (outcome?.reason?.kind !== "completed") return "";
  return submittedResponse ?? outcome.text ?? "";
}

export function summarize(events, firstSeq) {
  let started = false;
  let text = "";
  let reason;
  for (const event of events) {
    if (event.seq < firstSeq) continue;
    if (event.type === "turn/start") {
      started = true;
      continue;
    }
    if (!started) continue;
    if (event.type === "assistant/message") {
      const joined = event.data.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      if (joined) text = joined;
    }
    if (event.type === "turn/end") reason = event.data.reason;
  }
  return { text, reason };
}
