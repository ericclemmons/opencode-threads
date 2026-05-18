/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { SessionGateway } from "./session-gateway";
import { AgentViewRoute } from "./tui-route";

const id = "opencode.threads";
const routeName = "threads";

const tui: TuiPlugin = async (api) => {
  api.command?.register(() => [
    {
      title: "Threads",
      value: "threads.open",
      description: "Manage sessions as threads",
      category: "Plugin",
      slash: { name: "threads" },
      onSelect: () => {
        const current = api.route.current;
        api.route.navigate(
          routeName,
          current.name === "session" && current.params?.sessionID
            ? { fromSessionID: current.params.sessionID }
            : undefined,
        );
      },
    },
    {
      title: "Archive Thread",
      value: "threads.archive-current",
      description: "Archive the current session and open threads",
      category: "Plugin",
      slash: { name: "archive-thread" },
      enabled:
        api.route.current.name === "session"
        && typeof api.route.current.params?.sessionID === "string",
      onSelect: async () => {
        const current = api.route.current;
        const sessionID = current.name === "session" ? current.params?.sessionID : undefined;
        if (typeof sessionID !== "string") {
          api.ui.toast({ variant: "warning", message: "Open a session before archiving a thread." });
          api.route.navigate(routeName);
          return;
        }

        await new SessionGateway(api.client).archive(sessionID);
        api.ui.toast({ variant: "warning", message: "Session archived." });
        api.route.navigate(routeName);
      },
    },
  ]);

  api.route.register([
    {
      name: routeName,
      render: ({ params }) => (
        <AgentViewRoute
          api={api}
          fromSessionID={typeof params?.fromSessionID === "string" ? params.fromSessionID : undefined}
        />
      ),
    },
  ]);
};

export default {
  id,
  tui,
} satisfies TuiPluginModule & { id: string };
