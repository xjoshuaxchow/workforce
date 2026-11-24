const cantonese = {
  button: "回覆工作邀請",
  title: "工作邀請",
  label: "你可以返呢個更嗎？",
  accept: "接受",
  decline: "拒絕",
  notice: "提交後，你嘅選擇就唔可以再改。",
  submit: "提交",
};

const english = {
  button: "Respond to shift",
  title: "Shift invitation",
  label: "Can you work this shift?",
  accept: "Accept",
  decline: "Decline",
  notice: "Once submitted, your choice cannot be changed.",
  submit: "Submit",
};

export function shiftOfferFlowButton(language) {
  const copy = language === "zh_HK" ? cantonese : english;
  return {
    type: "FLOW",
    text: copy.button,
    flow_json: JSON.stringify({
      version: "7.3",
      screens: [{
        id: "SHIFT_REPLY",
        title: copy.title,
        terminal: true,
        success: true,
        data: {},
        layout: {
          type: "SingleColumnLayout",
          children: [{
            type: "Form",
            name: "shift_reply",
            children: [
              {
                type: "RadioButtonsGroup",
                name: "decision",
                label: copy.label,
                required: true,
                "data-source": [
                  { id: "ACCEPT", title: copy.accept },
                  { id: "DECLINE", title: copy.decline },
                ],
              },
              { type: "TextBody", text: copy.notice },
              {
                type: "Footer",
                label: copy.submit,
                "on-click-action": {
                  name: "complete",
                  payload: { decision: "${form.decision}" },
                },
              },
            ],
          }],
        },
      }],
    }),
  };
}
