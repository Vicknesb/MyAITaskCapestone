"use client";

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const json = await res.json();
  if (!json.success) throw new ApiError(json.error, json.code ?? "UNKNOWN", res.status);
  return json.data as T;
}

export const api = {
  get:    <T>(path: string)                  => request<T>(path),
  post:   <T>(path: string, body: unknown)   => request<T>(path, { method: "POST",   body: JSON.stringify(body) }),
  delete: <T>(path: string)                  => request<T>(path, { method: "DELETE" }),
};
