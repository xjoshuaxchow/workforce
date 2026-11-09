import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";

export class AppError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    Object.assign(this, details);
  }
}
export const fail = (status, message, details) => {
  throw new AppError(status, message, details);
};
export const validation = (field, message) =>
  fail(400, "Validation failed", { errors: [{ field, message }] });
const phone = z
  .string()
  .transform((x) => x.replace(/[\s-]/g, ""))
  .refine(
    (x) => x.startsWith("+") && parsePhoneNumberFromString(x)?.isValid(),
    "Must be a valid E.164 phone number",
  );
const languages = new Set(
  "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(
    " ",
  ),
);
const staffSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    mobile: phone,
    landline: phone.nullable().default(null),
    language: z
      .string()
      .refine(
        (x) => x === "yue" || languages.has(x),
        "Must be an ISO 639-1 code or yue",
      )
      .default("en"),
    preferred_channel: z.enum(["whatsapp", "voice"]).default("whatsapp"),
    status: z
      .enum(["active", "on_leave", "blocked", "inactive"])
      .default("active"),
    whatsapp_opt_in: z.boolean().default(false),
    whatsapp_opt_in_source: z.string().trim().min(1).nullable().default(null),
  })
  .superRefine((v, c) => {
    if (v.whatsapp_opt_in && !v.whatsapp_opt_in_source)
      c.addIssue({
        code: "custom",
        path: ["whatsapp_opt_in_source"],
        message: "Source is required when opting in",
      });
  });
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success)
    fail(400, "Validation failed", {
      errors: result.error.issues.map((x) => ({
        field: x.path.join("."),
        message: x.message,
      })),
    });
  return result.data;
}
export const validateStaff = (input) => parse(staffSchema, input);
export const validateSite = (input) =>
  parse(
    z.object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9-]{2,20}$/),
      name: z.string().trim().min(1).max(100),
      address: z.string().default(""),
      voice_name_en: z.string().trim().max(100).default(""),
      voice_address_en: z.string().trim().max(1000).default(""),
      timezone: z.string().refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Must be an IANA timezone"),
      status: z.enum(["active", "inactive"]).default("active"),
    }),
    input,
  );
export const contactable = (staff) =>
  staff.status === "active"
    ? [
        ...(staff.whatsapp_opt_in ? ["whatsapp"] : []),
        ...(staff.mobile ? ["voice"] : []),
      ]
    : [];
export const overlaps = (a, b, c, d) =>
  new Date(a) < new Date(d) && new Date(c) < new Date(b);
export function utc(value, field) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    validation(field, "Must be ISO 8601 UTC ending in Z");
  if (new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19))
    validation(field, "Invalid calendar date or time");
  return new Date(value);
}
export function validateRange(start, end) {
  const a = utc(start, "start_at"),
    b = utc(end, "end_at");
  if (b <= a || b - a > 24 * 60 * 60 * 1000)
    validation("end_at", "Must be after start_at and within 24 hours");
  return { start_at: a.toISOString(), end_at: b.toISOString() };
}
export const mapResponse = (option) =>
  option === "ACCEPT" ? "accept" : option === "DECLINE" ? "decline" : null;
export function pagination(query = {}) {
  const page = Number(query.page ?? 1),
    limit = Number(query.limit ?? 50);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    validation("pagination", "page must be positive; limit must be 1–200");
  return { page, limit, offset: (page - 1) * limit };
}
