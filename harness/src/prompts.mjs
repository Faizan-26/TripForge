import fs from "node:fs";

export function loadPromptFile(filePath) {
  const prompt = fs.readFileSync(filePath, "utf8").trim();
  if (!prompt) throw new Error(`Prompt file is empty: ${filePath}`);
  if (Buffer.byteLength(prompt, "utf8") > 64 * 1024) {
    throw new Error(`Prompt file exceeds 64 KiB: ${filePath}`);
  }
  return prompt;
}

export function renderPrompt(template, values) {
  let output = template;
  for (const [name, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${name}}}`, String(value));
  }
  const unresolved = output.match(/\{\{[A-Z][A-Z0-9_]*\}\}/u)?.[0];
  if (unresolved) throw new Error(`Prompt placeholder was not supplied: ${unresolved}`);
  return output;
}
