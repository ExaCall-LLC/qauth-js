import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTransport, type Transport } from "./transport.js";
import { translator, type Locale, type MessageKey, type T } from "./i18n.js";

interface Ctx {
  api: Transport;
  t: T;
  locale: Locale;
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
  children: ReactNode;
}

/** Wrap the screens once; they talk to your backend's proxy. */
export function QAuthScreens({ basePath = "/qauth", locale = "en", messages, transport, children }: QAuthScreensProps) {
  const value = useMemo(() => ({ api: transport ?? createTransport(basePath), t: translator(locale, messages), locale }), [basePath, locale, messages, transport]);
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
