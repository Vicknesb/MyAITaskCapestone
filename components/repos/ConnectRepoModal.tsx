"use client";

import { useRepos } from "@/hooks/useRepos";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";

const schema = z.object({
  full_name: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/, "Format must be owner/repo"),
  github_token: z.string().min(1, "GitHub token is required"),
});
type FormData = z.infer<typeof schema>;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ConnectRepoModal({ isOpen, onClose, onSuccess }: Props) {
  const { connectRepo, isConnecting, connectError } = useRepos();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => { if (!isOpen) reset(); }, [isOpen, reset]);

  const onSubmit = async (data: FormData) => {
    try {
      await connectRepo(data);
      onSuccess();
      onClose();
    } catch {
      // connectError is set by useRepos
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Connect a Repository</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            id="full_name"
            label="Repository (owner/repo)"
            placeholder="acme-corp/frontend-app"
            error={errors.full_name?.message}
            {...register("full_name")}
          />
          <Input
            id="github_token"
            label="GitHub Personal Access Token"
            type="password"
            placeholder="ghp_..."
            error={errors.github_token?.message}
            {...register("github_token")}
          />
          <p className="text-xs text-gray-400">
            Token requires <code>repo</code> scope. It is encrypted before storage.
          </p>
          {connectError && (
            <p className="text-sm text-red-600">
              {(connectError as { message?: string }).message ?? "Failed to connect repository"}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={isConnecting}>
              Connect
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
