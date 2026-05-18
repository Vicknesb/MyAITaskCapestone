"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, clearToken, setToken } from "@/lib/apiClient";

export interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

interface AuthTokenResponse {
  token: string;
  user?: { id: string; email: string; name: string | null };
}

interface LoginInput    { email: string; password: string }
interface RegisterInput { email: string; password: string; name?: string }

export function useAuth() {
  const qc = useQueryClient();

  const { data: user, isLoading } = useQuery<User, ApiError>({
    queryKey: ["auth", "me"],
    queryFn:  () => api.get<User>("/api/auth/me"),
    retry:    false,
    throwOnError: false,
  });

  const loginMutation = useMutation({
    mutationFn: (body: LoginInput) => api.post<AuthTokenResponse>("/api/auth/login", body),
    onSuccess: ({ token }) => {
      setToken(token);
      qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: (body: RegisterInput) => api.post<AuthTokenResponse>("/api/auth/register", body),
    onSuccess: ({ token }) => {
      setToken(token);
      qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.delete<void>("/api/auth/logout"),
    onSettled: () => {
      clearToken();
      qc.clear();
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login:             loginMutation.mutateAsync,
    register:          registerMutation.mutateAsync,
    logout:            () => logoutMutation.mutate(),
    loginError:        loginMutation.error as ApiError | null,
    registerError:     registerMutation.error as ApiError | null,
    isLoginPending:    loginMutation.isPending,
    isRegisterPending: registerMutation.isPending,
  };
}
