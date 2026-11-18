import { test } from "node:test";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { spokenDecision, agentInitiation, pilotAllowed, attachPilotStreams } from "../src/elevenlabs-pilot.js";

test("only explicit speech authorizes the matching decision", () => {
  for (const text of ["返到。", "我返到！", "Yes, I can work."])
    assert.equal(spokenDecision(text), "accept");
  for (const text of ["返唔到。", "我唔返。", "No, I can't work."])
    assert.equal(spokenDecision(text), "decline");
  for (const text of ["", "唔肯定返唔返到", "返到但要遲半個鐘", "返到嗎？", "Yes, if the time changes", "你幫我記錄返到"])
    assert.equal(spokenDecision(text), null);
});

test("the one-number pilot cannot enable broadcast, mixed channels, or other numbers", () => {
  const config = { to: "+85255551234" };
  const staff = { mobile: config.to, language: "yue", status: "active" };
  const draft = { status: "draft", mode: "direct", channels: ["voice"], headcount: 1 };
  assert.equal(pilotAllowed(config, draft, [staff]), true);
  assert.equal(pilotAllowed(config, draft, [{...staff, mobile:"+85255554321"}]), false);
  assert.equal(pilotAllowed(config, draft, [staff, staff]), false);
  assert.equal(pilotAllowed(config, {...draft, mode:"broadcast"}, [staff]), false);
  assert.equal(pilotAllowed(config, {...draft, channels:["voice","whatsapp"]}, [staff]), false);
});

test("call context supplies the opening variable in the selected language without private identifiers", () => {
  const payload = {
    to: "+85255551234",
    correlation_id: "private-id",
    variables: { site_name: "Test Depot", site_address: "Test Address", date: "20 Nov",
      start_time: "09:00", end_time: "10:00", message: "Bring your badge" },
  };
  for (const [language, question] of [["yue", /返唔返到/], ["en", /I can work/]]) {
    const result = agentInitiation({ ...payload, language });
    assert.deepEqual(result.conversation_config_override, { agent: { language } });
    assert.match(result.dynamic_variables.shift_opening, /Test Depot.*09:00.*10:00/);
    assert.match(result.dynamic_variables.shift_opening, question);
    assert.doesNotMatch(JSON.stringify(result), /55551234|private-id/);
  }
});


test("the public Stream route rejects an unsigned Upgrade without opening a session", () => {
  const server = new EventEmitter();
  const socket = new EventEmitter();
  let reply;
  socket.end = data => { reply = data; };
  socket.destroy = () => {};
  const close = attachPilotStreams(server, {
    config: { key: "test", to: "+85255551234" },
    authorize: () => assert.fail("Unsigned requests must not reach session authorization"),
  });
  server.emit("upgrade", {
    url: "/integrations/twilio/voice/00000000-0000-4000-8000-000000000000/stream",
    headers: {},
  }, socket, Buffer.alloc(0));
  assert.match(reply, /^HTTP\/1\.1 401 Unauthorized\r\n/);
  assert.match(reply, /X-Workforce-Stream: rejected\r\n/i);
  close();
});
