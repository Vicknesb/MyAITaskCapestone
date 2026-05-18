"use client";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const t = localStorage.getItem("devpulse_token");
  // Guard against the literal string "undefined" from an earlier bug
  return t && t !== "undefined" ? t : null;
}
export function setToken(t: string | undefined | null) {
  if (typeof window === "undefined" || !t || t === "undefined") return;
  localStorage.setItem("devpulse_token", t);
}
export function clearToken() { localStorage.removeItem("devpulse_token"); }

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  // Honour sliding-renewal header sent by the API
  const renewed = res.headers.get("X-Renewed-Token");
  if (renewed) setToken(renewed);

  const json = await res.json();
  if (!json.success) throw new ApiError(json.error, json.code ?? "UNKNOWN", res.status);
  return json.data as T;
}

export const api = {
  get:    <T>(path: string)                  => request<T>(path),
  post:   <T>(path: string, body: unknown)   => request<T>(path, { method: "POST",   body: JSON.stringify(body) }),
  delete: <T>(path: string)                  => request<T>(path, { method: "DELETE" }),
};
