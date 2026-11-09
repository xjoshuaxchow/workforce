import { z } from "zod";
import { validatePublicUrl } from "./media/download.js";
export const uuid = z.uuid();
export const phone = z
  .string()
  .regex(/^\+?[1-9]\d{6,14}$/)
  .transform((v) => v.replace(/^\+/, ""));
export const publicUrl = z.url().refine((value) => {
  try {
    validatePublicUrl(value);
    return true;
  } catch {
    return false;
  }
}, "Expected a public HTTPS URL without credentials");
const mediaReference = { url: publicUrl.optional(), id: uuid.optional() };
const oneMediaSource = (value: { url?: string; id?: string }) =>
  Boolean(value.url) !== Boolean(value.id);
const mediaInput = z
  .object({
    ...mediaReference,
    caption: z.string().max(1024).optional(),
    filename: z.string().max(255).optional(),
  })
  .strict()
  .refine(oneMediaSource, "Provide exactly one of url or id");
const parameter = z
  .object({
    type: z.enum([
      "text",
      "currency",
      "date_time",
      "image",
      "document",
      "video",
      "payload",
    ]),
    text: z.string().max(32768).optional(),
    currency: z.record(z.string(), z.unknown()).optional(),
    date_time: z.record(z.string(), z.unknown()).optional(),
    image: z
      .object(mediaReference)
      .strict()
      .refine(oneMediaSource, "Provide exactly one of url or id")
      .optional(),
    document: z
      .object({ ...mediaReference, filename: z.string().max(255).optional() })
      .strict()
      .refine(oneMediaSource, "Provide exactly one of url or id")
      .optional(),
    video: z
      .object(mediaReference)
      .strict()
      .refine(oneMediaSource, "Provide exactly one of url or id")
      .optional(),
    payload: z.string().max(2048).optional(),
    parameter_name: z.string().max(100).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p[p.type] === undefined)
      ctx.addIssue({
        code: "custom",
        message: `Missing ${p.type} parameter value`,
      });
  });
export const templateComponent = z
  .object({
    type: z.enum(["header", "body", "button"]),
    sub_type: z.enum(["quick_reply", "url", "copy_code"]).optional(),
    index: z
      .union([z.string().regex(/^\d$/), z.number().int().min(0).max(9)])
      .optional(),
    parameters: z.array(parameter).max(100),
  })
  .strict();
const template = z
  .object({
    name: z.string().regex(/^[a-z0-9_]{1,512}$/),
    language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
    components: z.array(templateComponent).max(20).default([]),
  })
  .strict();
const common = { to: phone, replyTo: z.string().min(1).max(512).optional() };
export const messageSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("text"),
      text: z
        .object({
          body: z.string().min(1).max(4096),
          preview_url: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ ...common, type: z.literal("template"), template }).strict(),
  ...(["image", "document", "audio", "video"] as const).map((type) =>
    z.object({ ...common, type: z.literal(type), media: mediaInput }).strict(),
  ),
]);
export type MessageInput = z.infer<typeof messageSchema>;
export const batchSchema = z
  .object({
    messages: z
      .array(
        messageSchema.refine(
          (x) => x.type !== "template",
          "Use the template batch endpoint",
        ),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export const templateBatchSchema = z
  .object({
    name: template.shape.name,
    language: template.shape.language,
    recipients: z
      .array(
        z
          .object({
            to: phone,
            components: z.array(templateComponent).max(20).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
const definition = z
  .object({
    type: z.enum(["HEADER", "BODY", "FOOTER", "BUTTONS"]),
    format: z
      .enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION"])
      .optional(),
    text: z.string().max(32768).optional(),
    example: z.record(z.string(), z.unknown()).optional(),
    buttons: z.array(z.record(z.string(), z.unknown())).max(10).optional(),
    sampleUrl: publicUrl.optional(),
    sampleMediaId: uuid.optional(),
  })
  .passthrough();
export const createTemplateSchema = z
  .object({
    name: template.shape.name,
    language: template.shape.language,
    category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]),
    components: z.array(definition).min(1).max(20),
  })
  .strict();
export const updateTemplateSchema = createTemplateSchema
  .omit({ name: true, language: true })
  .partial()
  .refine((x) => Object.keys(x).length > 0, "At least one field is required");
export const listMessagesSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(512).optional(),
    contact: z.string().max(100).optional(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    type: z.string().max(100).optional(),
    status: z.string().max(100).optional(),
    batchId: uuid.optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
