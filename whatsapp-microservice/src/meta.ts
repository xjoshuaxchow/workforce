import { openAsBlob } from "node:fs";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
export class ProviderError extends AppError {
  constructor(
    message: string,
    status: number,
    public retryable: boolean,
    public ambiguous: boolean,
    details?: unknown,
  ) {
    super(status, "META_ERROR", message, details);
  }
}
export interface MetaGateway {
  send(payload: Record<string, any>): Promise<any>;
  markRead(metaId: string): Promise<any>;
  listTemplates(query?: Record<string, any>): Promise<any>;
  getTemplate(id: string): Promise<any>;
  createTemplate(body: Record<string, any>): Promise<any>;
  updateTemplate(id: string, body: Record<string, any>): Promise<any>;
  deleteTemplate(id: string, name: string): Promise<any>;
  uploadMedia(path: string, mime: string): Promise<string>;
  getMedia(id: string): Promise<any>;
  uploadSample(path: string, mime: string, size: number): Promise<string>;
}
export class MetaClient implements MetaGateway {
  constructor(
    private config: Config,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    path: string,
    init: RequestInit = {},
    send = false,
    query: Record<string, any> = {},
  ): Promise<any> {
    const url = new URL(
      `https://graph.facebook.com/${this.config.graphVersion}/${path}`,
    );
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) url.searchParams.set(key, String(value));
    const headers = new Headers(init.headers);
    if (!headers.has("Authorization"))
      headers.set("Authorization", `Bearer ${this.config.accessToken}`);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        redirect: "error",
      });
    } catch {
      throw new ProviderError(
        "Meta request did not return a response",
        502,
        true,
        send,
      );
    }
    let data: any;
    try {
      data = JSON.parse(await response.text());
    } catch {
      throw new ProviderError("Invalid Meta response", 502, true, send);
    }
    if (!response.ok || data.error) {
      const error = data.error ?? {};
      const throttled =
        response.status === 429 ||
        [4, 17, 32, 613, 80007, 130429, 131056].includes(error.code);
      const retryable =
        throttled || response.status >= 500 || error.is_transient === true;
      const details = JSON.parse(
        JSON.stringify(error).replaceAll(this.config.accessToken, "[REDACTED]"),
      );
      throw new ProviderError(
        "Meta rejected the operation",
        response.status >= 400 ? response.status : 502,
        retryable,
        send && response.status >= 500,
        details,
      );
    }
    return data;
  }
  private json(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }
  send(payload: Record<string, any>) {
    return this.request(
      `${this.config.phoneNumberId}/messages`,
      this.json("POST", payload),
      true,
    );
  }
  markRead(metaId: string) {
    return this.request(
      `${this.config.phoneNumberId}/messages`,
      this.json("POST", {
        messaging_product: "whatsapp",
        status: "read",
        message_id: metaId,
      }),
    );
  }
  async listTemplates(query: Record<string, any> = {}) {
    const data = await this.request(
      `${this.config.businessAccountId}/message_templates`,
      {},
      false,
      {
        fields: "id,name,language,status,category,components,last_updated_time",
        limit: query.limit ?? 50,
        after: query.cursor,
        name: query.name,
        status: query.status,
        language: query.language,
      },
    );
    // Never relay provider paging URLs, which can contain access tokens.
    return {
      data: data.data ?? [],
      nextCursor: data.paging?.next
        ? (data.paging?.cursors?.after ?? null)
        : null,
    };
  }
  getTemplate(id: string) {
    return this.request(encodeURIComponent(id), {}, false, {
      fields: "id,name,language,status,category,components,last_updated_time",
    });
  }
  createTemplate(body: Record<string, any>) {
    return this.request(
      `${this.config.businessAccountId}/message_templates`,
      this.json("POST", body),
    );
  }
  updateTemplate(id: string, body: Record<string, any>) {
    return this.request(encodeURIComponent(id), this.json("POST", body));
  }
  deleteTemplate(id: string, name: string) {
    return this.request(
      `${this.config.businessAccountId}/message_templates`,
      { method: "DELETE" },
      false,
      { hsm_id: id, name },
    );
  }
  async uploadMedia(path: string, mime: string): Promise<string> {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", mime);
    form.set("file", await openAsBlob(path, { type: mime }), "media");
    const data = await this.request(`${this.config.phoneNumberId}/media`, {
      method: "POST",
      body: form,
    });
    if (typeof data.id !== "string")
      throw new ProviderError("Missing media ID", 502, true, false);
    return data.id;
  }
  getMedia(id: string) {
    return this.request(encodeURIComponent(id), {}, false, {
      phone_number_id: this.config.phoneNumberId,
    });
  }
  async uploadSample(
    path: string,
    mime: string,
    size: number,
  ): Promise<string> {
    const session = await this.request(
      `${this.config.appId}/uploads`,
      { method: "POST" },
      false,
      { file_length: size, file_type: mime },
    );
    if (typeof session.id !== "string" || !session.id.startsWith("upload:"))
      throw new ProviderError("Missing upload session", 502, true, false);
    const result = await this.request(
      session.id,
      {
        method: "POST",
        headers: {
          file_offset: "0",
          "Content-Type": mime,
          Authorization: `OAuth ${this.config.accessToken}`,
        },
        body: await openAsBlob(path, { type: mime }),
      },
    );
    if (typeof result.h !== "string")
      throw new ProviderError(
        "Missing template sample handle",
        502,
        true,
        false,
      );
    return result.h;
  }
}
