import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Card, Dialog, FormField, TextInput } from "@isdlc.ai/ui";
import { useScreens } from "./context.js";

export type Msg = { tone: "success" | "danger"; text: string } | null;

/** Loads a value from the proxy; reload() fetches it again. */
export function useLoad<T>(path: string | null): { data: T | undefined; error: string | null; loading: boolean; reload: () => void } {
  const { api } = useScreens();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api.get<T>(path).then(
      (d) => live && (setData(d), setError(null), setLoading(false)),
      (e: Error) => live && (setError(e.message), setLoading(false)),
    );
    return () => {
      live = false;
    };
  }, [api, path, n]);
  return { data, error, loading, reload: useCallback(() => setN((x) => x + 1), []) };
}

export function Section({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          {hint ? <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.75 }}>{hint}</p> : null}
        </div>
        {children}
      </div>
    </Card>
  );
}

export function Note({ msg }: { msg: Msg }) {
  return msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null;
}

/** Asks for a fresh proof (password or authenticator code), then runs it. */
export function ProofDialog({ trigger, onProof, title }: { trigger: ReactNode; title?: string; onProof: (p: { password: string } | { code: string }) => Promise<void> }) {
  const { t } = useScreens();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr(null);
    setBusy(true);
    try {
      await onProof(password ? { password } : { code });
      setOpen(false);
      setPassword("");
      setCode("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} title={title ?? t("common.confirmTitle")}
      footer={<Button variant="primary" onClick={go} disabled={busy || (!password && !code)}>{t("common.continue")}</Button>}>
      {err ? <Alert tone="danger">{err}</Alert> : null}
      <FormField label={t("common.password")}>
        <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </FormField>
      <FormField label={t("common.orCode")}>
        <TextInput value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
      </FormField>
    </Dialog>
  );
}
