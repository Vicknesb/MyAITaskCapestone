"use client";

import { useAuth } from "@/hooks/useAuth";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export default function SettingsPage() {
  const { user, logout } = useAuth();

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <Badge variant="success">Active</Badge>
        </CardHeader>
        <div className="space-y-4">
          <Input
            label="Name"
            defaultValue={user?.name ?? ""}
            disabled
            id="name"
          />
          <Input
            label="Email"
            defaultValue={user?.email ?? ""}
            disabled
            id="email"
          />
          <p className="text-xs text-gray-400">
            Member since {user?.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <p className="mb-4 text-sm text-gray-500">
          Sign out of your account. Your data and repositories will be preserved.
        </p>
        <Button variant="danger" onClick={logout}>
          Sign out
        </Button>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About DevPulse</CardTitle>
        </CardHeader>
        <div className="space-y-1 text-sm text-gray-500">
          <p>Version 1.0.0</p>
          <p>Next.js 15 · Prisma · PostgreSQL · Recharts</p>
        </div>
      </Card>
    </div>
  );
}
