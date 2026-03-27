"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldAlert, UserCog } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { withCsrfHeaders } from "@/lib/utils/csrf";

const ASSIGNABLE_ROLES = [
  { value: "moderator", label: "Moderator" },
  { value: "governance_controller", label: "Governance Controller" },
  { value: "member", label: "Member (revoke staff)" },
] as const;

export function RoleAssignForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [targetEmail, setTargetEmail] = useState("");
  const [newRole, setNewRole] = useState<string>("");
  const [reason, setReason] = useState("");

  const isValid = targetEmail.includes("@") && newRole !== "" && reason.trim().length >= 5;

  function handleSubmitClick() {
    if (!isValid) return;
    setShowConfirm(true);
  }

  async function handleConfirm() {
    setShowConfirm(false);
    setSubmitting(true);

    try {
      const res = await fetch("/api/admin/governance/roles", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ targetEmail, newRole, reason: reason.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      toast({
        title: "Role updated",
        description: `Changed to ${newRole} successfully.`,
      });

      setTargetEmail("");
      setNewRole("");
      setReason("");

      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      toast({
        title: "Role change failed",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const busy = isPending || submitting;

  return (
    <>
      <Card className="border-amber-200 dark:border-amber-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            Assign Role
            <Badge variant="outline" className="ml-auto text-xs">
              <ShieldAlert className="h-3 w-3 mr-1" />
              Admin only
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ra-email">User email</Label>
            <Input
              id="ra-email"
              type="email"
              placeholder="user@example.com"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              disabled={busy}
              maxLength={254}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ra-role">New role</Label>
            <select
              id="ra-role"
              aria-label="New role"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              disabled={busy}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select a role…</option>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ra-reason">Reason</Label>
            <Textarea
              id="ra-reason"
              placeholder="Briefly explain the role change (min 5 chars)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              maxLength={500}
              rows={2}
            />
          </div>

          <Button onClick={handleSubmitClick} disabled={!isValid || busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {busy ? "Processing…" : "Assign Role"}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Role Change</DialogTitle>
            <DialogDescription>
              You are about to change the role for{" "}
              <strong className="text-foreground">{targetEmail}</strong> to{" "}
              <Badge variant="outline">{newRole}</Badge>.
              <br />
              This action will be audited and cannot be undone automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted p-3 text-sm">
            <strong>Reason:</strong> {reason}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>Confirm Assignment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
