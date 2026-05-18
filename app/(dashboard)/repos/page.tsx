"use client";

import { useRepos } from "@/hooks/useRepos";
import { RepoCard } from "@/components/repos/RepoCard";
import { ConnectRepoModal } from "@/components/repos/ConnectRepoModal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useState } from "react";

export default function ReposPage() {
  const { repos, isLoading, syncRepo, disconnectRepo } = useRepos();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Repositories</h1>
          <p className="text-sm text-gray-500">{repos.length} connected</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>Connect Repository</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : repos.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
          <p className="text-gray-400">No repositories connected yet</p>
          <Button className="mt-4" onClick={() => setModalOpen(true)}>
            Connect your first repository
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {repos.map((repo) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              onSync={syncRepo}
              onDisconnect={disconnectRepo}
            />
          ))}
        </div>
      )}

      <ConnectRepoModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {}}
      />
    </div>
  );
}
