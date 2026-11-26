import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Card, Dialog, FormField, TextInput } from "@isdlc.ai/ui";
import { useScreens } from "./context.js";
import { ScreenError } from "./transport.js";
import { answerPasskey, passkeysAvailable } from "./webauthn.js";

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

/** What qAuth asks to confirm it's you (CONFIRM_NEEDED). */
export interface ConfirmNeeds {
  email: string;
  password: boolean;
  code: boolean;
  passkey: boolean;
  /** A code by SMS to this (masked) number is asked, with the password. */
  phone?: string;
}
export type Proof = { password?: string; code?: string; passkey?: unknown; phoneCode?: string };

/**
 * "Confirm it's you": runs a change, and only when qAuth answers
 * CONFIRM_NEEDED (no recent sign-in) asks for exactly what the person has
 * (their password, plus a code when they have an authenticator app, or an
 * existing passkey alone), in a small dialog that keeps the page, then
 * runs it again with that proof. Never asks to set anything up.
 */
export function useConfirm(): { confirm: <T>(run: (p?: Proof) => Promise<T>, title?: string) => Promise<T | undefined>; dialog: ReactNode } {
  const { t, api } = useScreens();
  const [state, setState] = useState<{ needs: ConfirmNeeds; title?: string; run: (p: Proof) => Promise<void>; cancel: () => void } | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useCallback(<T,>(run: (p?: Proof) => Promise<T>, title?: string): Promise<T | undefined> => {
    return run().catch((e) => {
      if (!(e instanceof ScreenError) || e.code !== "CONFIRM_NEEDED") throw e;
      return new Promise<T | undefined>((resolve, reject) => {
        setPassword(""), setCode(""), setPhoneCode(""), setSentTo(""), setErr(null);
        setState({
          needs: e.data as ConfirmNeeds,
          title,
          cancel: () => resolve(undefined),
          run: async (p: Proof) => {
            try {
              const out = await run(p);
              setState(null);
              resolve(out);
            } catch (e2) {
              if (e2 instanceof ScreenError && e2.code === "CONFIRM_NEEDED") {
                setState((st) => (st ? { ...st, needs: e2.data as ConfirmNeeds } : st));
                setErr(t("confirm.more"));
                return;
              }
              if (!(e2 instanceof ScreenError)) reject(e2);
              setErr((e2 as Error).message);
            }
          },
        });
      });
    });
  }, [t]);
  const go = async (p: Proof) => {
    if (!state) return;
    setErr(null);
    setBusy(true);
    try {
      await state.run(p);
    } finally {
      setBusy(false);
    }
  };
  const withPasskey = async () => {
    setErr(null);
    try {
      const { options } = await api.send<{ options: unknown }>("POST", "/v1/me/confirm/passkey");
      await go({ passkey: await answerPasskey(options) });
    } catch (e) {
      setErr(e instanceof ScreenError ? e.message : t("passkey.failed"));
    }
  };
  const sendSms = async () => {
    setErr(null);
    try {
      const r = await api.send<{ codeSentTo: string }>("POST", "/v1/me/confirm/phone");
      setSentTo(r.codeSentTo);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const n = state?.needs;
  // a passkey-only person confirms with the passkey (a password alone would skip their second step)
  const fields = !!n && (!n.passkey || n.code || !passkeysAvailable()) && (n.password || n.code);
  const ready = !!n && fields && (!n.password || !!password) && (!n.code || !!code) && (!n.phone || !!phoneCode);
  const dialog = (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o && state) { state.cancel(); setState(null); } }} title={state?.title ?? t("common.confirmTitle")}
      footer={fields ? <Button variant="primary" onClick={() => void go({ password: password || undefined, code: code || undefined, phoneCode: phoneCode || undefined })} disabled={busy || !ready}>{t("common.continue")}</Button> : null}>
      {err ? <Alert tone="danger">{err}</Alert> : null}
      {n ? (
        <div style={{ display: "grid", gap: 12 }}>
          <FormField label={t("common.email")}>
            <TextInput value={n.email} readOnly dir="ltr" />
          </FormField>
          {n.passkey && passkeysAvailable() ? (
            <>
              <div><Button onClick={() => void withPasskey()} disabled={busy}>{t("confirm.usePasskey")}</Button></div>
              {fields ? <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>{t("confirm.orBelow")}</p> : null}
            </>
          ) : null}
          {fields && n.password ? (
            <FormField label={t("common.password")}>
              <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </FormField>
          ) : null}
          {fields && n.phone ? (
            sentTo ? (
              <FormField label={t("confirm.smsCode", { phone: sentTo })}>
                <TextInput value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
              </FormField>
            ) : (
              <div><Button onClick={() => void sendSms()} disabled={busy}>{t("confirm.sendSms", { phone: n.phone })}</Button></div>
            )
          ) : null}
          {fields && n.code ? (
            <FormField label={t("confirm.appCode")}>
              <TextInput value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
            </FormField>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
  return { confirm, dialog };
}
