import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, MessageSquare, Zap, LogOut, Server, Trash2,
} from "lucide-react";
import { useStore, useConnectionStatus } from "../lib/store.js";
import { StatusIndicator } from "./ui/StatusIndicator.js";
import { SearchInput } from "./ui/SearchInput.js";
import { SkillsPanel } from "./skills/SkillsPanel.js";
import type { SidebarTab } from "../lib/store.js";

interface Props {
  onDisconnect: () => void;
}

export function Sidebar({ onDisconnect }: Props) {
  const connectionStatus = useConnectionStatus();
  const sidebarTab = useStore((s) => s.sidebarTab);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const switchConversation = useStore((s) => s.switchConversation);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const newConversation = useStore((s) => s.newConversation);
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);

  const filteredConversations = useMemo(() => {
    if (!searchQuery) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) =>
      c.title.toLowerCase().includes(q)
    );
  }, [conversations, searchQuery]);

  return (
    <div
      className="w-[288px] bg-[#0b0d10] border-r border-zinc-800/80 flex flex-col select-none shrink-0"
      data-tauri-drag-region
    >
      <div className="px-4 pt-9 pb-4 border-b border-zinc-800/70" data-tauri-drag-region>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <Server className="w-4 h-4 text-emerald-300" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100 tracking-tight">
              anton
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Personal cloud workspace
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 mt-4 mb-2">
        <button
          onClick={() => newConversation()}
          className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-xl bg-zinc-100 text-zinc-900 text-sm font-semibold hover:bg-white transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Task
        </button>
      </div>

      <div className="flex mx-4 mb-3 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1">
        <TabButton
          active={sidebarTab === "history"}
          onClick={() => setSidebarTab("history")}
          icon={<MessageSquare className="w-3.5 h-3.5" />}
          label="Chats"
        />
        <TabButton
          active={sidebarTab === "skills"}
          onClick={() => setSidebarTab("skills")}
          icon={<Zap className="w-3.5 h-3.5" />}
          label="Skills"
        />
      </div>

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <AnimatePresence mode="wait">
          {sidebarTab === "history" ? (
            <motion.div
              key="history"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="flex flex-col flex-1 min-h-0"
            >
              <div className="px-4 pb-2">
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Find a conversation"
                />
              </div>

              <div className="flex-1 overflow-y-auto px-3">
                {filteredConversations.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <MessageSquare className="w-8 h-8 text-zinc-700 mb-3" />
                    <p className="text-xs text-zinc-500">
                      {conversations.length === 0
                        ? "No chats yet"
                        : "No matches"}
                    </p>
                  </div>
                )}

                {filteredConversations.map((conv) => (
                  <div
                    key={conv.id}
                    className="group relative mb-1"
                  >
                    <button
                      onClick={() => switchConversation(conv.id)}
                      className={`flex items-center w-full px-3 py-2.5 rounded-xl text-left transition-colors ${
                        conv.id === activeId
                          ? "bg-zinc-100 text-zinc-900"
                          : "text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-200"
                      }`}
                    >
                      <span className="truncate flex-1 text-xs font-medium">{conv.title}</span>
                      <span className="text-[10px] text-zinc-500 shrink-0 ml-2">
                        {formatTime(conv.updatedAt)}
                      </span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(conv.id);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="skills"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="flex-1 min-h-0"
            >
              <SkillsPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="px-4 py-3 border-t border-zinc-800/70 space-y-2.5">
        <div className="px-2.5 py-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
          <StatusIndicator type="connection" status={connectionStatus} />
        </div>
        <button
          onClick={onDisconnect}
          className="flex items-center gap-2 w-full px-2.5 py-2 rounded-xl text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
        >
          <LogOut className="w-3 h-3" />
          Disconnect
        </button>
      </div>
    </div>
  );
}

function TabButton({
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
      className={`flex items-center justify-center gap-1.5 flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
        active
          ? "bg-zinc-100 text-zinc-900"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
