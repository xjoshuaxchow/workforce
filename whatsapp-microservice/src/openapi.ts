import { z } from "zod";
import {
  messageSchema,
  batchSchema,
  templateBatchSchema,
  createTemplateSchema,
  updateTemplateSchema,
  uuid,
} from "./validation.js";
const json = (schema: any) => ({ "application/json": { schema } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const response = (
  description: string,
  schema: any = { type: "object", additionalProperties: true },
) => ({ description, content: json(schema) });
const id = {
  in: "path",
  name: "id",
  required: true,
  schema: { type: "string" },
};
const key = {
  in: "header",
  name: "Idempotency-Key",
  required: true,
  schema: { type: "string", minLength: 1, maxLength: 200 },
};
const query = (name: string, type = "string") => ({
  in: "query",
  name,
  schema: { type },
});
function operation(
  summary: string,
  options: {
    body?: string;
    params?: any[];
    status?: string;
    schema?: any;
    public?: boolean;
  } = {},
) {
  return {
    summary,
    ...(options.public ? { security: [] } : {}),
    parameters: options.params ?? [],
    ...(options.body
      ? { requestBody: { required: true, content: json(ref(options.body)) } }
      : {}),
    responses: {
      [options.status ?? "200"]: response("Success", options.schema),
      ...Object.fromEntries(
        ["400", "401", "403", "404", "409", "413", "422", "502", "503"].map(
          (s) => [s, response("Request failed", ref("Error"))],
        ),
      ),
    },
  };
}
export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "WhatsApp microservice",
    version: "1.0.0",
    description:
      "Durable WhatsApp messaging for one business number. All sends are asynchronous. Supply Idempotency-Key for every send request.",
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/v1/conversations": {
      get: operation("List conversation summaries and shared unread counts", {
        params: [
          query("q"),
          query("contacts"),
          query("unread"),
          query("cursor"),
          query("limit", "integer"),
        ],
      }),
    },
    "/v1/conversations/{contact}": {
      get: operation("Get the conversation and customer service window", {
        params: [{ ...id, name: "contact" }],
      }),
    },
    "/v1/conversations/{contact}/read": {
      post: {
        ...operation("Mark the specified incoming messages as read", {
          params: [{ ...id, name: "contact" }],
        }),
        requestBody: {
          required: true,
          content: json({
            type: "object",
            required: ["messageIds"],
            properties: {
              messageIds: {
                type: "array",
                minItems: 1,
                maxItems: 100,
                items: { type: "string", format: "uuid" },
              },
            },
          }),
        },
      },
    },
    "/v1/message-requests/{key}": {
      get: operation(
        "Look up an accepted single-message, batch, or template-batch request",
        {
          params: [
            { ...id, name: "key" },
            {
              in: "query",
              name: "scope",
              schema: {
                type: "string",
                enum: ["single", "batch", "template-batch"],
                default: "single",
              },
            },
          ],
        },
      ),
    },
    "/v1/media": {
      post: {
        ...operation("Archive an uploaded image or document", {
          status: "201",
          params: [
            query("kind"),
            {
              in: "header",
              name: "X-Media-Type",
              required: true,
              schema: { type: "string" },
            },
          ],
        }),
        requestBody: {
          required: true,
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
      },
    },
    "/v1/messages": {
      post: operation("Queue one message", {
        body: "MessageInput",
        params: [key],
        status: "202",
        schema: ref("Queued"),
      }),
      get: operation("List saved messages", {
        params: [
          "contact",
          "direction",
          "type",
          "status",
          "batchId",
          "from",
          "to",
          "cursor",
        ]
          .map((n) => query(n))
          .concat([query("limit", "integer")]),
      }),
    },
    "/v1/messages/batch": {
      post: operation("Queue up to 1,000 text/media messages", {
        body: "BatchInput",
        params: [key],
        status: "202",
        schema: ref("Queued"),
      }),
    },
    "/v1/messages/templates/batch": {
      post: operation("Queue personalized template messages", {
        body: "TemplateBatchInput",
        params: [key],
        status: "202",
        schema: ref("Queued"),
      }),
    },
    "/v1/messages/{id}": {
      get: operation("Read a saved message and its history", { params: [id] }),
    },
    "/v1/messages/{id}/read": {
      post: operation("Mark an incoming message as read", { params: [id] }),
    },
    "/v1/batches/{id}": {
      get: operation(
        "Read batch totals grouped by submission/delivery status",
        { params: [id] },
      ),
    },
    "/v1/batches/{id}/messages": {
      get: operation("List batch messages", {
        params: [id, query("limit", "integer"), query("cursor")],
      }),
    },
    "/v1/templates": {
      post: operation("Create a Meta template", {
        body: "CreateTemplate",
        status: "201",
      }),
      get: operation("List Meta templates and mirror them locally", {
        params: ["name", "language", "status", "cursor"]
          .map((n) => query(n))
          .concat([query("limit", "integer")]),
      }),
    },
    "/v1/templates/{id}": {
      get: operation("Get a Meta template", { params: [id] }),
      patch: operation("Edit a Meta template", {
        body: "UpdateTemplate",
        params: [id],
      }),
      delete: operation("Delete one template variant", { params: [id] }),
    },
    "/v1/templates/{id}/default-image": {
      put: operation("Save an uploaded image as the template's default header", {
        body: "DefaultTemplateImage",
        params: [id],
      }),
    },
    "/v1/media/{id}": {
      get: operation("Read archive metadata", { params: [id] }),
    },
    "/v1/media/{id}/content": {
      get: {
        summary: "Download an archived file",
        parameters: [id],
        responses: {
          "200": {
            description: "Archived bytes",
            content: {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "409": response("Archive pending or failed", ref("Error")),
        },
      },
    },
    "/v1/media/{id}/retry": {
      post: operation("Retry a failed media archive", {
        params: [id],
        status: "202",
      }),
    },
    "/v1/webhook-deliveries/{id}/retry": {
      post: operation(
        "Replay a failed incoming notification with the same event ID",
        { params: [id], status: "202" },
      ),
    },
    "/webhooks/whatsapp": {
      get: operation("Meta webhook verification", {
        public: true,
        params: ["hub.mode", "hub.verify_token", "hub.challenge"].map((n) => ({
          ...query(n),
          required: true,
        })),
      }),
      post: operation("Receive signed Meta messages and status updates", {
        public: true,
        params: [
          {
            in: "header",
            name: "X-Hub-Signature-256",
            required: true,
            schema: { type: "string" },
          },
        ],
      }),
    },
    "/health/live": { get: operation("Process liveness", { public: true }) },
    "/health/ready": {
      get: operation("Database and media volume readiness", { public: true }),
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: {
      MessageInput: z.toJSONSchema(messageSchema, {
        io: "input",
        unrepresentable: "any",
      }),
      BatchInput: z.toJSONSchema(batchSchema, {
        io: "input",
        unrepresentable: "any",
      }),
      TemplateBatchInput: z.toJSONSchema(templateBatchSchema, {
        io: "input",
        unrepresentable: "any",
      }),
      CreateTemplate: z.toJSONSchema(createTemplateSchema, {
        io: "input",
        unrepresentable: "any",
      }),
      UpdateTemplate: z.toJSONSchema(updateTemplateSchema, {
        io: "input",
        unrepresentable: "any",
      }),
      DefaultTemplateImage: z.toJSONSchema(z.object({ mediaId: uuid }), {
        io: "input",
        unrepresentable: "any",
      }),
      Queued: {
        type: "object",
        required: ["batchId", "messageIds", "status"],
        properties: {
          batchId: { type: ["string", "null"], format: "uuid" },
          messageIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
          },
          status: { const: "queued" },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: {},
            },
          },
        },
      },
    },
  },
};
