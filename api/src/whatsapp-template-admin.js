import { z } from "zod";
import { admin } from "./service.js";
import { fail, validation } from "./domain.js";
import { createWhatsAppClient } from "./whatsapp-client.js";
const input = z
  .object({
    name: z.string().regex(/^[a-z0-9_]{1,512}$/),
    language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
    category: z.enum(["UTILITY", "MARKETING"]),
    body: z.string().min(1).max(32768),
    examples: z.array(z.string().max(1000)).max(100),
    offer: z.boolean(),
  })
  .strict();
function parse(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) validation("template", "Invalid template fields");
  return r.data;
}
export function registerWhatsAppTemplates(app, { settings }) {
  async function client(user) {
    admin(user);
    const { config } = await settings.current();
    if (!config.whatsapp.url || !config.whatsapp.key)
      fail(503, "Save the WhatsApp service URL and API key first");
    return createWhatsAppClient(config.whatsapp);
  }
  app.get("/api/settings/whatsapp/templates", async (req, res) => {
    const api = await client(req.user);
    const q = parse(
      z
        .object({
          language: z.string().max(20).optional(),
          cursor: z.string().max(2048).optional(),
        })
        .strict(),
      req.query,
    );
    res.json(
      await api.request("GET", "/templates", { params: { ...q, limit: 50 } }),
    );
  });
  async function write(req, res) {
    const api = await client(req.user),
      value = parse(input, req.body),
      matches = [...value.body.matchAll(/\{\{(\d+)\}\}/g)].map((x) =>
        Number(x[1]),
      ),
      count = matches.length ? Math.max(...matches) : 0;
    if (count !== value.examples.length || new Set(matches).size !== count)
      validation("examples", "Fill every positional variable example");
    const body = {
      type: "BODY",
      text: value.body,
      ...(count ? { example: { body_text: [value.examples] } } : {}),
    };
    const components = [
      body,
      ...(value.offer
        ? [
            {
              type: "BUTTONS",
              buttons: [
                {
                  type: "QUICK_REPLY",
                  text:
                    value.language === "zh_HK"
                      ? "接受"
                      : value.language.startsWith("zh")
                        ? "接受"
                        : "Accept",
                },
                {
                  type: "QUICK_REPLY",
                  text:
                    value.language === "zh_HK"
                      ? "拒絕"
                      : value.language.startsWith("zh")
                        ? "拒绝"
                        : "Decline",
                },
              ],
            },
          ]
        : []),
    ];
    if (req.params.id) {
      const id = parse(z.string().regex(/^\d{1,80}$/), req.params.id);
      res.json(
        await api.request("PATCH", "/templates/" + id, {
          data: { category: value.category, components },
        }),
      );
    } else
      res
        .status(201)
        .json(
          await api.request("POST", "/templates", {
            data: {
              name: value.name,
              language: value.language,
              category: value.category,
              components,
            },
          }),
        );
  }
  app.post("/api/settings/whatsapp/templates", write);
  app.patch("/api/settings/whatsapp/templates/:id", write);
  app.delete("/api/settings/whatsapp/templates/:id", async (req, res) => {
    const api = await client(req.user),
      id = parse(z.string().regex(/^\d{1,80}$/), req.params.id);
    res.json(await api.request("DELETE", "/templates/" + id));
  });
}
