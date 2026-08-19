// Anthropic Messages API hivas kozvetlen fetch-csel, streameles + tool loop.

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOOL_ROUNDS = 3;

async function streamOnce({ apiKey, model, system, messages, tools, maxTokens, onTextDelta }) {
  const body = {
    model,
    system,
    messages,
    max_tokens: maxTokens,
    stream: true,
  };
  if (tools && tools.length) {
    body.tools = tools;
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Anthropic API hiba (${response.status}): ${text}`);
  }

  const blocks = {};
  let stopReason = null;
  const usage = { input_tokens: 0, output_tokens: 0 };
  let buffer = "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const jsonStr = dataLine.slice(5).trim();
      if (!jsonStr) continue;

      let evt;
      try {
        evt = JSON.parse(jsonStr);
      } catch {
        continue;
      }

      switch (evt.type) {
        case "message_start":
          usage.input_tokens = evt.message?.usage?.input_tokens || 0;
          break;
        case "content_block_start":
          blocks[evt.index] =
            evt.content_block.type === "tool_use"
              ? { type: "tool_use", id: evt.content_block.id, name: evt.content_block.name, jsonBuffer: "" }
              : { type: "text", text: "" };
          break;
        case "content_block_delta":
          if (evt.delta.type === "text_delta") {
            blocks[evt.index].text += evt.delta.text;
            if (onTextDelta) onTextDelta(evt.delta.text);
          } else if (evt.delta.type === "input_json_delta") {
            blocks[evt.index].jsonBuffer += evt.delta.partial_json;
          }
          break;
        case "message_delta":
          if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
          if (evt.usage?.output_tokens) usage.output_tokens = evt.usage.output_tokens;
          break;
        case "error":
          throw new Error(evt.error?.message || "Anthropic streaming hiba");
        default:
          break;
      }
    }
  }

  const assistantContent = [];
  const toolBlocks = [];
  for (const idx of Object.keys(blocks).sort((a, b) => Number(a) - Number(b))) {
    const b = blocks[idx];
    if (b.type === "text") {
      assistantContent.push({ type: "text", text: b.text });
    } else {
      let input = {};
      try {
        input = b.jsonBuffer ? JSON.parse(b.jsonBuffer) : {};
      } catch {
        input = {};
      }
      assistantContent.push({ type: "tool_use", id: b.id, name: b.name, input });
      toolBlocks.push({ id: b.id, name: b.name, input });
    }
  }

  return { stopReason, usage, assistantContent, toolBlocks };
}

// executeTool(name, input) => JSON-szerializalhato eredmeny. Ha nincs megadva es a modell
// mégis tool_use-t ad vissza, hibaeredmenyt kap a modell es folytatja szoveggel.
export async function runChat({ apiKey, model, system, messages, tools, maxTokens = 800, executeTool, onTextDelta }) {
  const conversation = messages.map((m) => ({ role: m.role, content: m.content }));
  const totalUsage = { input_tokens: 0, output_tokens: 0 };
  let stopReason = null;

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    const result = await streamOnce({ apiKey, model, system, messages: conversation, tools, maxTokens, onTextDelta });
    totalUsage.input_tokens += result.usage.input_tokens;
    totalUsage.output_tokens += result.usage.output_tokens;
    stopReason = result.stopReason;

    if (stopReason !== "tool_use" || !result.toolBlocks.length) {
      return { usage: totalUsage, stopReason };
    }

    conversation.push({ role: "assistant", content: result.assistantContent });

    const toolResults = [];
    for (const tu of result.toolBlocks) {
      let output;
      try {
        output = executeTool ? await executeTool(tu.name, tu.input) : { error: "Nincs elérhető eszköz." };
      } catch (err) {
        output = { error: err.message };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(output),
      });
    }
    conversation.push({ role: "user", content: toolResults });
  }

  return { usage: totalUsage, stopReason: "max_tool_rounds" };
}
