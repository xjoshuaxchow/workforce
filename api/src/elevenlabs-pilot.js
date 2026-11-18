import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";

export const shiftAgentId = "agent_3701m7hshn01e7rtqj5np2nn3c85";
const audioFormat = "ulaw_8000";
const replyTool = "record_shift_reply";

export function pilotConfig(env = process.env) {
  const key = env.WORKFORCE_ELEVENLABS_API_KEY?.trim();
  const to = env.WORKFORCE_ELEVENLABS_TEST_NUMBER?.trim();
  return key && /^\+[1-9]\d{7,14}$/.test(to ?? "") ? { key, to } : null;
}

export function pilotAllowed(config, draft, staff) {
  return Boolean(config && draft.status === "draft" && draft.mode === "direct" &&
    draft.headcount === 1 && draft.channels.length === 1 && draft.channels[0] === "voice" &&
    staff.length === 1 && staff[0].mobile === config.to && staff[0].status === "active" &&
    ["yue", "en"].includes(staff[0].language));
}

const accepts = new Set(["返到", "我返到", "可以返", "我可以返", "我會返", "可以返工", "我可以返工",
  "yes", "yes i can", "yes i can work", "i can work", "i accept"]);
const declines = new Set(["返唔到", "我返唔到", "唔返", "我唔返", "唔可以返", "我唔可以返", "唔返工", "我唔返工",
  "no", "no i can't", "no i can't work", "i can't work", "i cannot work", "i decline"]);

export function spokenDecision(text) {
  if (typeof text !== "string" || /[?？]/u.test(text)) return null;
  const normalized = text.normalize("NFKC").toLowerCase().replaceAll("’", "'")
    .replace(/[。！!.,，]/gu, " ").trim().replace(/\s+/gu, " ");
  if (accepts.has(normalized)) return "accept";
  if (declines.has(normalized)) return "decline";
  return null;
}

export function agentInitiation(payload) {
  const { site_name, site_address, date, start_time, end_time, message } = payload.variables;
  const language = payload.language === "yue" ? "yue" : "en";
  const site = [site_name, site_address].filter(Boolean).join(", ");
  const opening = language === "yue"
    ? `你好，我係 Workforce 嘅 AI 語音助手。有一個工作邀請，地點係 ${site}，香港時間 ${date}，由 ${start_time} 到 ${end_time}。${message ? message + "。" : ""}呢個更你返唔返到？請講「返到」或者「返唔到」。`
    : `Hello, I am the Workforce AI voice assistant. Your shift offer is at ${site} on ${date}, from ${start_time} to ${end_time} Hong Kong time.${message ? " " + message + "." : ""} Please say "I can work" or "I can't work".`;
  return {
    type: "conversation_initiation_client_data",
    conversation_config_override: { agent: { language } },
    dynamic_variables: { shift_opening: opening },
  };
}

export function pilotTwiml(publicBaseUrl, attemptId) {
  const url = new URL(`/integrations/twilio/voice/${attemptId}/stream`, publicBaseUrl);
  url.protocol = "wss:";
  const response = new twilio.twiml.VoiceResponse();
  response.connect().stream({ url: url.href });
  response.hangup();
  return response.toString();
}

async function signedAgentUrl(key) {
  const endpoint = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
  endpoint.searchParams.set("agent_id", shiftAgentId);
  const response = await fetch(endpoint, { headers: { "xi-api-key": key },
    signal: AbortSignal.timeout(8000), redirect: "error" });
  if (!response.ok) throw Error("ElevenLabs rejected the voice session");
  const url = new URL((await response.json()).signed_url);
  if (url.origin !== "wss://api.elevenlabs.io" || url.pathname !== "/v1/convai/conversation" ||
      url.searchParams.get("agent_id") !== shiftAgentId) throw Error("Unexpected ElevenLabs session URL");
  return url.href;
}

function send(socket, data) {
  if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 256 * 1024) return false;
  socket.send(JSON.stringify(data));
  return true;
}

function mediaMessage(raw, binary) {
  if (binary) throw Error("Expected JSON audio event");
  return JSON.parse(raw.toString("utf8"));
}

function relay(twilioSocket, session, config, connectAgent) {
  let agent;
  let streamSid;
  let ready = false;
  let finished = false;
  let confirmed;
  let writing = false;
  let speech;
  let playbackMark;
  const timer = setTimeout(end, 90_000);
  const setupTimer = setTimeout(() => failed("setup_timeout"), 15_000);
  function failed(reason) {
    if (finished) return;
    console.warn(JSON.stringify({ level: "warn", event: "elevenlabs_pilot.stream_failed",
      attempt_id: session.payload.correlation_id, reason }));
    end();
  }
  function end() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    clearTimeout(setupTimer);
    for (const socket of [agent, twilioSocket]) socket?.terminate();
  }
  async function onAgent(raw, binary) {
    if (finished) return;
    const event = mediaMessage(raw, binary);
    switch (event.type) {
      case "conversation_initiation_metadata": {
        const metadata = event.conversation_initiation_metadata_event;
        if (metadata?.user_input_audio_format !== audioFormat || metadata?.agent_output_audio_format !== audioFormat)
          return failed("audio_format");
        ready = true;
        clearTimeout(setupTimer);
        break;
      }
      case "audio":
        if (ready && typeof event.audio_event?.audio_base_64 === "string" &&
            !send(twilioSocket, { event: "media", streamSid, media: { payload: event.audio_event.audio_base_64 } })) end();
        break;
      case "interruption":
        playbackMark = undefined;
        send(twilioSocket, { event: "clear", streamSid });
        break;
      case "ping":
        send(agent, { type: "pong", event_id: event.ping_event?.event_id });
        break;
      case "user_transcript":
        if (ready) speech = spokenDecision(event.user_transcription_event?.user_transcript);
        break;
      case "client_tool_call": {
        const tool = event.client_tool_call;
        if (!ready || tool?.tool_name !== replyTool || typeof tool.tool_call_id !== "string") return;
        const reply = tool.parameters?.reply;
        if (!["accept", "decline"].includes(reply) || speech !== reply || writing) {
          send(agent, { type: "client_tool_result", tool_call_id: tool.tool_call_id, is_error: true,
            result: "No clear matching reply. Ask the person to say exactly 返到 or 返唔到 (English: I can work / I can't work). Do not say it was recorded." });
          return;
        }
        writing = true;
        try {
          const status = await session.recordReply(reply);
          if (!status) throw Error("No outcome was stored");
          confirmed = status;
          send(agent, { type: "client_tool_result", tool_call_id: tool.tool_call_id, is_error: false,
            result: JSON.stringify({ status }) });
        } catch {
          send(agent, { type: "client_tool_result", tool_call_id: tool.tool_call_id, is_error: true,
            result: "Workforce could not confirm the result. Do not promise a shift was booked." });
        } finally {
          writing = false;
        }
        break;
      }
      case "agent_response_complete":
        if (confirmed && !writing && !playbackMark) {
          playbackMark = "shift-reply-finished";
          send(twilioSocket, { event: "mark", streamSid, mark: { name: playbackMark } });
        }
        break;
      case "client_error":
        failed("agent_error");
        break;
    }
  }

  async function onTwilio(raw, binary) {
    if (finished) return;
    const event = mediaMessage(raw, binary);
    if (event.event === "start") {
      const start = event.start;
      if (streamSid || typeof start?.streamSid !== "string" || start.callSid !== session.callSid ||
          start.accountSid !== session.accountSid || start.mediaFormat?.encoding !== "audio/x-mulaw" ||
          start.mediaFormat.sampleRate !== 8000 || start.mediaFormat.channels !== 1) return end();
      streamSid = start.streamSid;
      const url = await connectAgent(config.key);
      if (finished) return;
      agent = new WebSocket(url, { handshakeTimeout: 8000, maxPayload: 1024 * 1024, followRedirects: false });
      agent.once("open", () => send(agent, agentInitiation(session.payload)));
      agent.once("error", () => failed("agent_connection"));
      agent.once("close", () => confirmed ? end() : failed("agent_closed_without_reply"));
      agent.on("message", (raw, binary) => onAgent(raw, binary).catch(() => failed("agent_event")));
    } else if (event.event === "stop") end();
    else if (event.event === "mark" && playbackMark && event.mark?.name === playbackMark) end();
    else if (ready && event.event === "media" && event.streamSid === streamSid &&
             typeof event.media?.payload === "string" &&
             !send(agent, { user_audio_chunk: event.media.payload })) end();
  }

  twilioSocket.on("message", (raw, binary) => onTwilio(raw, binary).catch(() => failed("phone_event")));
  twilioSocket.once("error", end);
  twilioSocket.once("close", end);
}

export function attachPilotStreams(server, { config, authorize, connectAgent = signedAgentUrl }) {
  const active = new Set();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", async (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    const match = /^\/integrations\/twilio\/voice\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/stream$/.exec(request.url);
    if (!match) return socket.destroy();
    // An explicit rejection distinguishes this handler from a proxy that drops Upgrade.
    const reject = () => socket.end(
      "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\nX-Workforce-Stream: rejected\r\n\r\n",
    );
    const signature = request.headers["x-twilio-signature"];
    if (!config || typeof signature !== "string" || !signature || active.has(match[1])) return reject();
    try {
      const session = await authorize(match[1], signature, request.url);
      if (socket.destroyed) return;
      if (!session || active.has(match[1])) return reject();
      sockets.handleUpgrade(request, socket, head, connection => {
        active.add(match[1]);
        connection.once("close", () => active.delete(match[1]));
        relay(connection, session, config, connectAgent);
      });
    } catch {
      socket.destroy();
    }
  });
  return () => { for (const socket of sockets.clients) socket.terminate(); };
}
