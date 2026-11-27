import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { createTransport, ScreenError, type Transport } from "./transport.js";
import { translator, type Locale, type MessageKey, type T } from "./i18n.js";

interface Ctx {
  api: Transport;
  t: T;
  locale: Locale;
  onSignInAgain?: () => void;
}
const C = createContext<Ctx | null>(null);

export interface QAuthScreensProps {
  /** Where your backend mounted qauthProxy. Default "/qauth". */
  basePath?: string;
  locale?: Locale;
  /** Your own wording for any text. */
  messages?: Partial<Record<MessageKey, string>>;
  /** For tests or custom transports. */
  transport?: Transport;
  /**
   * Sends the person to sign in again (your app's sign-in). Changes to how
   * they sign in (password, authenticator app, phone, passkeys, recovery
   * codes, personal tokens) need a recent sign-in when made from your app
   * (403 FRESH_SIGN_IN_REQUIRED): the screens then offer this.
   */
  onSignInAgain?: () => void;
  children: ReactNode;
}

/** Wrap the screens once; they talk to your backend's proxy. */
export function QAuthScreens({ basePath = "/qauth", locale = "en", messages, transport, onSignInAgain, children }: QAuthScreensProps) {
  // the callback by reference: a new arrow on each render never rebuilds the transport (or reloads the screens)
  const signIn = useRef(onSignInAgain);
  signIn.current = onSignInAgain;
  const hasSignIn = !!onSignInAgain;
  const value = useMemo(() => {
    const t = translator(locale, messages);
    return { api: plainFresh(transport ?? createTransport(basePath), t), t, locale, onSignInAgain: hasSignIn ? () => signIn.current?.() : undefined };
  }, [basePath, locale, messages, transport, hasSignIn]);
  return (
    <C.Provider value={value}>
      <div dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>{children}</div>
    </C.Provider>
  );
}

export function useScreens(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("Wrap qAuth screens in <QAuthScreens>.");
  return c;
}

/**
 * FRESH_SIGN_IN_REQUIRED (a change to how the person signs in, from your
 * app without a recent sign-in) says so in the screens' own words, on
 * every screen.
 */
function plainFresh(api: Transport, t: T): Transport {
  const plain = (e: unknown): never => {
    if (e instanceof ScreenError && e.code === "FRESH_SIGN_IN_REQUIRED") throw new ScreenError(e.status, e.code, t("fresh.body"), e.data);
    throw e;
  };
  return {
    get: <R,>(path: string) => api.get<R>(path).catch(plain),
    send: <R,>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown) => api.send<R>(method, path, body).catch(plain),
    ...(api.stream ? { stream: api.stream.bind(api) } : {}),
  };
}
