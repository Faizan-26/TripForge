import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  clearSessionPlaces,
  enrichHotelSelection,
} from "../shared/session-places.mjs";

const MAX_RESULT_BYTES = 512_000;
const terminalResponses = new Map();

export const name = "tripforge-result";
export const inject = ["tools", "systemPrompt"];

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: "tool:submit_trip_response",
    order: 120,
    text: [
      "Finish every TripForge turn by calling submit_trip_response exactly once.",
      "Pass outcome and the response fields directly; a nested response object is also accepted.",
      "The tool validates the terminal envelope and ends the turn; do not print the JSON separately.",
    ].join(" "),
  });
  ctx.tools.register(createTripResultTool());
}

export function createTripResultTool() {
  return defineTool({
    name: "submit_trip_response",
    description:
      "Submit the complete TripForge response fields and end this turn. " +
      "Use outcome 'clarification' with questions or outcome 'general' with a message.",
    parameters: {
      response: {
        type: "object",
        additionalProperties: true,
        description: "Compatibility wrapper for the complete response object.",
      },
      outcome: {
        type: "string",
        enum: ["clarification", "general"],
        description: "Whether this turn asks questions or returns a final message.",
      },
      message: { type: "string", description: "Required for a general response." },
      presentation: {
        type: "object",
        additionalProperties: true,
        description: "Optional compact travel presentation for the TripForge UI.",
      },
      questions: {
        type: "array",
        items: { type: "object", additionalProperties: true },
        description: "Required for a clarification response.",
      },
      draft: { type: "object", additionalProperties: true },
      ui_schema_version: { type: "string" },
      conversation_title: { type: "string" },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => [{
        type: "text",
        text: `TripForge ${value.outcome} response submitted.`,
      }],
      presentationMeta: (_args, value) => ({ outcome: value.outcome }),
    },
    presentCall: () => ({
      card: "generic",
      title: "Finalizing the TripForge response",
      kind: "other",
    }),
    presentResult: (_args, result) => result.isError ? undefined : ({
      card: "generic",
      title: "TripForge response ready",
    }),
    async execute(args, exec) {
      const sessionId = String(
        exec.agent?.session?.id ?? process.env.TRIPFORGE_DSH_SESSION_ID ?? "",
      );
      if (!sessionId) throw new Error("TripForge terminal response has no session identity");
      const response = toLosslessJson(enrichHotelSelection(
        validateTerminalResponse(args.response ?? directResponse(args)),
        sessionId,
      ));
      const output = JSON.stringify(response);
      if (Buffer.byteLength(output, "utf8") > MAX_RESULT_BYTES) {
        throw new Error("TripForge response exceeds the terminal result limit");
      }
      terminalResponses.set(sessionId, output);
      clearSessionPlaces(sessionId);
      exec.concludeTurn();
      return response;
    },
  });
}

function toLosslessJson(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("TripForge terminal response is not JSON serializable");
  }
  return JSON.parse(serialized);
}

export function consumeTerminalResponse(sessionId) {
  const key = String(sessionId);
  const output = terminalResponses.get(key);
  terminalResponses.delete(key);
  return output;
}

function directResponse(args) {
  const { response: _response, ...value } = args;
  return value;
}

export function validateTerminalResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TripForge terminal response must be an object");
  }
  if (value.outcome === "general") {
    if (typeof value.message !== "string" || !value.message.trim()) {
      throw new Error("A general TripForge response requires a message");
    }
    return value;
  }
  if (value.outcome === "clarification") {
    if (!Array.isArray(value.questions) || value.questions.length === 0) {
      throw new Error("A clarification response requires questions");
    }
    return value;
  }
  throw new Error("TripForge terminal response has an unsupported outcome");
}
