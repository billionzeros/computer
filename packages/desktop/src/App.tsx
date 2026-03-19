import React, { useState } from "react";
import { Connect } from "./components/Connect.js";
import { Sidebar } from "./components/Sidebar.js";
import { AgentChat } from "./components/AgentChat.js";
import { Terminal } from "./components/Terminal.js";
import { useConnectionStatus } from "./lib/store.js";
import { connection } from "./lib/connection.js";
import { Bot, TerminalSquare, Sparkles } from "lucide-react";

type View = "agent" | "terminal";

export function App() {
  const [connected, setConnected] = useState(false);
  const [activeView, setActiveView] = useState<View>("agent");
  const status = useConnectionStatus();

  const handleDisconnect = () => {
    connection.disconnect();
    setConnected(false);
  };

  // Show connect screen if not connected
  if (!connected) {
    return <Connect onConnected={() => setConnected(true)} />;
  }

  // Disconnected after being connected — show reconnect
  if (status === "disconnected" || status === "error") {
    return (
      <div className="flex items-center justify-center h-full bg-[#0a0b0d] px-5">
        <div className="text-center p-8 max-w-sm rounded-3xl border border-zinc-800/80 bg-zinc-900/75">
          <p className="text-xl font-semibold text-zinc-50 mb-2">
            Connection paused
          </p>
          <p className="text-sm text-zinc-400 mb-6">
            We lost contact with your machine. You can reconnect in one click.
          </p>
          <button
            onClick={handleDisconnect}
            className="px-4 py-2.5 bg-zinc-100 rounded-xl text-sm font-semibold text-zinc-900 hover:bg-white transition-colors"
          >
            Connect to a machine
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-[#090a0c]">
      <Sidebar onDisconnect={handleDisconnect} />

      <div className="flex-1 flex flex-col overflow-hidden bg-[radial-gradient(1000px_600px_at_45%_-120px,rgba(34,197,94,0.12),transparent_65%)]">
        <div className="px-5 pt-3 pb-2 border-b border-zinc-800/70" data-tauri-drag-region>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 mb-1">
                Workspace
              </p>
              <p className="text-sm font-semibold text-zinc-100">
                Personal Cloud Computer
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {activeView === "agent"
                  ? "Describe what you need in plain language."
                  : "Run and monitor commands in real time."}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {activeView === "agent" && (
                <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-zinc-700/80 bg-zinc-900/70 text-[11px] text-zinc-300">
                  <Sparkles className="w-3 h-3 text-emerald-400" />
                  Guided mode
                </div>
              )}
              <div className="flex bg-zinc-900/80 border border-zinc-800 rounded-xl p-1">
                <ViewTab
                  active={activeView === "agent"}
                  onClick={() => setActiveView("agent")}
                  icon={<Bot className="w-3.5 h-3.5" />}
                  label="Assistant"
                />
                <ViewTab
                  active={activeView === "terminal"}
                  onClick={() => setActiveView("terminal")}
                  icon={<TerminalSquare className="w-3.5 h-3.5" />}
                  label="Terminal"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {activeView === "agent" && <AgentChat />}
          {activeView === "terminal" && <Terminal />}
        </div>
      </div>
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        active
          ? "bg-zinc-100 text-zinc-900"
          : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/90"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
