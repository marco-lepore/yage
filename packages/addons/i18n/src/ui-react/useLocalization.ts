import { useEngine } from "@yagejs/ui-react";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { localizationOf } from "../core/Localization.js";
import type { MessageResolver } from "../core/message.js";

export interface LocalizationHandle {
  /** Current locale; `"und"` without a `LocalizationPlugin`. */
  readonly locale: string;
  /** Resolve a message for the current locale. New identity after each locale change. */
  readonly t: MessageResolver;
}

/**
 * The localization service as a React store: the component re-renders on
 * each locale change. Without a `LocalizationPlugin`, `t` formats fallbacks
 * and `locale` is `"und"`. Must run inside a `UIRoot` tree.
 */
export function useLocalization(): LocalizationHandle {
  const localization = localizationOf(useEngine());
  const subscribe = useCallback(
    (onChange: () => void) => localization.subscribe(onChange),
    [localization],
  );
  const getLocale = useCallback(() => localization.locale, [localization]);
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  const t = useCallback<MessageResolver>(
    (message, values) => localization.resolve(message, values),
    // `locale` is a dependency on purpose: a new `t` after each change lets
    // memoized consumers recompute.
    [localization, locale],
  );
  return useMemo(() => ({ locale, t }), [locale, t]);
}
