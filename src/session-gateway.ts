export type SessionGatewayClient = {
  session?: any;
  v2?: { session?: any };
};

export function unwrap<T>(result: T | { data?: T }): T {
  if (result && typeof result === "object" && "data" in result) return (result as { data?: T }).data as T;
  return result as T;
}

function resultError(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("error" in result)) return undefined;
  return (result as { error?: unknown }).error;
}

function archivedAt(session: any): number | undefined {
  const archived = session?.time?.archived;
  return typeof archived === "number" ? archived : undefined;
}

export function sessionID(session: any): string | undefined {
  const id = session?.id ?? session?.data?.id;
  return typeof id === "string" && id ? id : undefined;
}

function requireSessionID(session: any, action: string): string {
  const id = sessionID(session);
  if (!id) throw new Error(`${action} did not return a valid session ID`);
  return id;
}

export class SessionGateway {
  readonly session: any;
  readonly v2Session: any;
  readonly usesFlatParams: boolean;

  constructor(clientOrSessionApi: SessionGatewayClient | any) {
    this.session = clientOrSessionApi?.session ?? clientOrSessionApi;
    this.v2Session = clientOrSessionApi?.v2?.session;
    this.usesFlatParams = typeof this.session?.create === "function" && this.session.create.length > 1;
  }

  async list(): Promise<any[]> {
    return unwrap<any[]>(await this.session.list()) ?? [];
  }

  async status(): Promise<Record<string, any>> {
    return unwrap<Record<string, any>>(await this.session.status?.().catch(() => ({}))) ?? {};
  }

  async messages(sessionID: string, limit: number): Promise<any[]> {
    try {
      const result = await this.session.messages?.({ sessionID, limit });
      const payload = unwrap<any[] | { items?: any[] }>(result);
      const messages = Array.isArray(payload) ? payload : payload?.items;
      if (messages) return messages;
    } catch {
      // Fall through to v2 if the legacy transcript endpoint is unavailable.
    }

    const result = await this.v2Session?.messages?.({ sessionID, limit, order: "desc" });
    const payload = unwrap<any[] | { items?: any[] }>(result);
    return Array.isArray(payload) ? payload : payload?.items ?? [];
  }

  async contextMessages(sessionID: string, limit: number): Promise<any[]> {
    let result: unknown;
    try {
      result = await this.session.messages?.({ path: { id: sessionID }, query: { limit } });
    } catch {
      result = await this.session.messages?.({ sessionID, limit });
    }
    const payload = unwrap<any[] | { items?: any[] }>(result as any);
    return Array.isArray(payload) ? payload : payload?.items ?? [];
  }

  async create(title: string): Promise<{ id: string; session: any }> {
    const safeTitle = title.slice(0, 120);
    const payloads = this.usesFlatParams
      ? [{ title: safeTitle }, { body: { title: safeTitle } }]
      : [{ body: { title: safeTitle } }, { title: safeTitle }];

    let lastError: unknown;
    for (const payload of payloads) {
      try {
        const result = await this.session.create(payload);
        const error = resultError(result);
        if (error) {
          lastError = error;
          continue;
        }

        const session = unwrap<any>(result);
        return { id: requireSessionID(session, "create"), session };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  async createOrFork(title: string, sourceSessionID: string): Promise<{ id: string; session: any }> {
    const safeTitle = title.slice(0, 120);

    if (typeof this.session.fork === "function") {
      for (const payload of [
        { path: { id: sourceSessionID }, body: {} },
        { path: { sessionID: sourceSessionID }, body: {} },
        { sessionID: sourceSessionID },
      ]) {
        try {
          const session = unwrap<any>(await this.session.fork(payload));
          const id = sessionID(session);
          if (!id) continue;
          await this.updateTitle(id, safeTitle);
          return { id, session };
        } catch {
          // Try the next SDK shape before falling back to creating a fresh root session.
        }
      }
    }

    return this.create(safeTitle);
  }

  async updateTitle(sessionID: string, title: string) {
    const safeTitle = title.slice(0, 120);
    let lastError: unknown;

    for (const payload of [
      { path: { id: sessionID }, body: { title: safeTitle } },
      { path: { sessionID }, body: { title: safeTitle } },
      { sessionID, title: safeTitle },
    ]) {
      try {
        const result = await this.session.update?.(payload);
        const error = resultError(result);
        if (!error) return;
        lastError = error;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("session update unavailable");
  }

  async sendPromptParts(sessionID: string, parts: any[]) {
    const body = { parts };
    const legacyPayload = {
      path: { id: sessionID },
      body,
    };
    const v2Payload = {
      path: { sessionID },
      body,
    };
    const flatPayload = {
      sessionID,
      ...body,
    };
    const payloads = this.usesFlatParams
      ? [flatPayload, legacyPayload, v2Payload]
      : [legacyPayload, v2Payload, flatPayload];

    if (typeof this.session.promptAsync === "function") {
      let lastError: unknown;
      for (const payload of payloads) {
        try {
          const result = await this.session.promptAsync(payload);
          const error = resultError(result);
          if (!error) return;
          lastError = error;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    }

    if (typeof this.session.prompt_async === "function") {
      let lastError: unknown;
      for (const payload of payloads) {
        try {
          const result = await this.session.prompt_async(payload);
          const error = resultError(result);
          if (!error) return;
          lastError = error;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    }

    let lastError: unknown;
    for (const payload of payloads) {
      try {
        const result = await this.session.prompt(payload);
        const error = resultError(result);
        if (!error) return;
        lastError = error;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async sendPrompt(sessionID: string, prompt: string) {
    return this.sendPromptParts(sessionID, [{ type: "text", text: prompt }]);
  }

  async abort(sessionID: string) {
    await this.session.abort?.({ sessionID });
  }

  async delete(sessionID: string) {
    await this.session.delete?.({ sessionID });
  }

  async archive(sessionID: string) {
    const archived = Date.now();
    let lastError: unknown;

    for (const payload of [
      { sessionID, time: { archived } },
      { path: { id: sessionID }, body: { time: { archived } } },
    ]) {
      try {
        const result = await this.session.update?.(payload);
        const error = resultError(result);
        if (error) {
          lastError = error;
          continue;
        }

        const session = unwrap<any>(result);
        if (archivedAt(session)) return;
        lastError = new Error("archive did not return an archived session");
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }
}
