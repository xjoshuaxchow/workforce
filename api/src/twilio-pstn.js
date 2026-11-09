import twilio from "twilio";

export function parsePstnConfig(env = process.env) {
  const mode = env.MESSAGING_MODE ?? "mock";
  if (mode === "mock") return { mode };
  if (mode !== "twilio-pstn")
    throw Error("MESSAGING_MODE must be mock or twilio-pstn");
  const required = (name) => {
    const value = env[name]?.trim();
    if (!value) throw Error(name + " is required");
    return value;
  };
  const accountSid = required("TWILIO_ACCOUNT_SID"),
    authToken = required("TWILIO_AUTH_TOKEN"),
    fromNumber = required("TWILIO_FROM_NUMBER");
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid))
    throw Error("TWILIO_ACCOUNT_SID must be an Account SID");
  if (!/^\+[1-9]\d{7,14}$/.test(fromNumber))
    throw Error("TWILIO_FROM_NUMBER must be E.164");
  let url;
  try {
    url = new URL(required("TWILIO_PUBLIC_BASE_URL"));
  } catch {
    throw Error("TWILIO_PUBLIC_BASE_URL must be a public HTTPS origin");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("TWILIO_PUBLIC_BASE_URL must be a public HTTPS origin");
  return { mode, accountSid, authToken, fromNumber, publicBaseUrl: url.origin };
}

function appendVoice(target, payload, kind) {
  const content = payload?.voice;
  // Submitted calls keep their immutable recording snapshot.
  if (content?.audio) {
    const url = content.audio[kind];
    // Old information calls only stored main; a later cancellation must hang up.
    if (kind !== "main" && !url) return;
    const urls = Array.isArray(url) ? url : [url];
    if (!urls.length || urls.some(value => typeof value !== "string" || !value.startsWith("https://"))) throw Error("Missing voice audio");
    for (const value of urls) target.play(value);
    return;
  }
  const text = kind === "main" ? content?.script : content?.prompts?.[kind];
  if (!text || !content.voice || !content.language) throw Error("Missing voice speech");
  target.say({ voice: content.voice, language: content.language }, text);
}
export function voiceTwiml(payload, actionUrl) {
  const response = new twilio.twiml.VoiceResponse();
  const target = payload.options?.length
    ? response.gather({
        input: "dtmf",
        numDigits: 1,
        timeout: 5,
        method: "POST",
        action: actionUrl,
        actionOnEmptyResult: true,
      })
    : response;
  appendVoice(target, payload, "main");
  response.hangup();
  return response.toString();
}
export function voiceMessage(payload, kind = "ack") {
  const response = new twilio.twiml.VoiceResponse();
  if (payload) appendVoice(response, payload, kind);
  response.hangup();
  return response.toString();
}
export function mapDigits(digits) {
  if (digits === "1") return { type: "reply", option_id: "ACCEPT" };
  if (digits === "2") return { type: "reply", option_id: "DECLINE" };
  if (digits === "9") return { type: "repeat" };
  if (!digits) return { type: "no_input" };
  return { type: "invalid" };
}
export function mapTwilioStatus(status) {
  return (
    {
      queued: "sent",
      initiated: "sent",
      ringing: "sent",
      "in-progress": "answered",
      "no-answer": "no_answer",
      busy: "busy",
      failed: "failed",
      completed: "completed",
      canceled: "cancelled",
    }[status] ?? null
  );
}
export function validateTwilioWebhook(config, signature, originalUrl, params) {
  if (
    typeof signature !== "string" ||
    !signature ||
    params.AccountSid !== config.accountSid
  )
    return false;
  if (!/^CA[0-9a-f]{32}$/i.test(params.CallSid ?? "")) return false;
  return twilio.validateRequest(
    config.authToken,
    signature,
    config.publicBaseUrl + originalUrl,
    params,
  );
}
export const createTwilioClient = (config) =>
  twilio(config.accountSid, config.authToken, {
    autoRetry: false,
    timeout: 10000,
  });

export function createPstnGateway(config, client = createTwilioClient(config)) {
  const callbackUrl = (id, kind) =>
    `${config.publicBaseUrl}/integrations/twilio/voice/${encodeURIComponent(id)}/${kind}`;
  return {
    callbackUrl,
    createCall(payload) {
      return client.calls.create({
        to: payload.to,
        from: config.fromNumber,
        url: callbackUrl(payload.correlation_id, "twiml"),
        method: "POST",
        statusCallback: callbackUrl(payload.correlation_id, "status"),
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        timeout: 30,
        timeLimit: 180,
        record: false,
      });
    },
    fetchCall(sid) {
      return client.calls(sid).fetch();
    },
    cancelCall(sid) {
      return client.calls(sid).update({ status: "canceled" });
    },
    completeCall(sid) {
      return client.calls(sid).update({ status: "completed" });
    },
  };
}
