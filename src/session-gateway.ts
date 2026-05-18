export type SessionGatewayClient = {
  session?: any;
  v2?: { session?: any };
};

export function unwrap<T>(result: T | { data?: T }): T {
  if (result && typeof result === "object" && "data" in result) return (result as { data?: T }).data as T;
  return result as T;
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

  constructor(clientOrSessionApi: SessionGatewayClient | any) {
    this.session = clientOrSessionApi?.session ?? clientOrSessionApi;
    this.v2Session = clientOrSessionApi?.v2?.session;
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
    let session: any;
    try {
      session = unwrap<any>(await this.session.create({ body: { title: safeTitle } }));
    } catch {
      session = unwrap<any>(await this.session.create({ title: safeTitle }));
    }
    return { id: requireSessionID(session, "create"), session };
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
    try {
      await this.session.update?.({ path: { id: sessionID }, body: { title: safeTitle } });
    } catch {
      await this.session.update?.({ sessionID, title: safeTitle });
    }
  }

  async sendPrompt(sessionID: string, prompt: string) {
    const body = {
      parts: [{ type: "text", text: prompt }],
    };
    const legacyPayload = {
      path: { id: sessionID },
      body,
    };
    const flatPayload = {
      sessionID,
      ...body,
    };

    if (typeof this.session.promptAsync === "function") {
      try {
        await this.session.promptAsync(legacyPayload);
      } catch {
        await this.session.promptAsync(flatPayload);
      }
      return;
    }

    if (typeof this.session.prompt_async === "function") {
      try {
        await this.session.prompt_async(legacyPayload);
      } catch {
        await this.session.prompt_async(flatPayload);
      }
      return;
    }

    try {
      await this.session.prompt(legacyPayload);
    } catch {
      await this.session.prompt(flatPayload);
    }
  }

  async abort(sessionID: string) {
    await this.session.abort?.({ sessionID });
  }

  async delete(sessionID: string) {
    await this.session.delete?.({ sessionID });
  }

  async archive(sessionID: string) {
    try {
      await this.session.update?.({ sessionID, time: { archived: Date.now() } });
    } catch {
      await this.session.update?.({ path: { id: sessionID }, body: { time: { archived: Date.now() } } });
    }
  }
}
