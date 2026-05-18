"use client";

import { Repo } from "@/hooks/useRepos";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useState } from "react";

interface Props {
  repo: Repo;
  onSync: (id: string) => Promise<unknown>;
  onDisconnect: (id: string) => Promise<unknown>;
}

export function RepoCard({ repo, onSync, onDisconnect }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try { await onSync(repo.id); } finally { setSyncing(false); }
  };

  const handleDisconnect = async () => {
    if (!confirming) { setConfirming(true); return; }
    setDisconnecting(true);
    try { await onDisconnect(repo.id); } finally { setDisconnecting(false); setConfirming(false); }
  };

  const lastSync = repo.last_synced_at
    ? new Date(repo.last_synced_at).toLocaleDateString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "Never";

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{repo.full_name}</h3>
            <Badge variant={repo.is_private ? "default" : "info"}>
              {repo.is_private ? "Private" : "Public"}
            </Badge>
            <Badge variant={repo.role === "owner" ? "success" : "default"}>{repo.role}</Badge>
          </div>
          {repo.description && (
            <p className="mt-1 text-sm text-gray-500 truncate">{repo.description}</p>
          )}
          <p className="mt-2 text-xs text-gray-400">
            Branch: <code className="font-mono">{repo.default_branch}</code> · Last synced: {lastSync}
          </p>
          {repo.sync_status && (
            <Badge
              className="mt-2"
              variant={
                repo.sync_status === "SUCCESS" ? "success"
                : repo.sync_status === "FAILED" ? "danger"
                : repo.sync_status === "RUNNING" ? "warning"
                : "default"
              }
            >
              {repo.sync_status}
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <Button size="sm" variant="secondary" loading={syncing} onClick={handleSync}>
            Sync Now
          </Button>
          <Button
            size="sm"
            variant={confirming ? "danger" : "ghost"}
            loading={disconnecting}
            onClick={handleDisconnect}
            onBlur={() => setConfirming(false)}
          >
            {confirming ? "Confirm?" : "Disconnect"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
