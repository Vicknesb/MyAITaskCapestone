"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/apiClient";

export interface Repo {
  id: string;
  github_repo_id: number;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  is_private: boolean;
  default_branch: string;
  role: string;
  last_synced_at: string | null;
  sync_status: string | null;
}

export function useRepos() {
  const qc = useQueryClient();

  const { data: repos = [], isLoading } = useQuery<Repo[]>({
    queryKey: ["repos"],
    queryFn: async () => {
      const result = await api.get<{ repositories: Repo[] }>("/api/repos");
      return result.repositories;
    },
  });

  const connectMutation = useMutation({
    mutationFn: (body: { full_name: string; github_token: string }) =>
      api.post<Repo>("/api/repos/connect", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/repos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.post<{ sync_log_id: string; status: string }>(`/api/sync/${id}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });

  return {
    repos,
    isLoading,
    connectRepo: connectMutation.mutateAsync,
    disconnectRepo: disconnectMutation.mutateAsync,
    syncRepo: syncMutation.mutateAsync,
    isConnecting: connectMutation.isPending,
    connectError: connectMutation.error,
  };
}
