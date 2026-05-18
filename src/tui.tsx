/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
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
