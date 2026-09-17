import { useEffect, useState } from "react";

import {
  DEFAULT_THEME,
  loadTheme,
  subscribeTheme,
  type AppTheme,
} from "@/lib/theme";

/**
 * The active app-wide theme, kept in step with Settings.
 *
 * Renders as the default on the server (localStorage isn't readable there) and
 * corrects on mount. Only the palette differs, so the swap is invisible — and
 * the inline boot script has already put the right theme on <html>, so the page
 * chrome never flashes regardless of what this returns on the first pass.
 */
export function useAppTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(DEFAULT_THEME);

  useEffect(() => {
    setTheme(loadTheme());
    return subscribeTheme(setTheme);
  }, []);

  return theme;
}
