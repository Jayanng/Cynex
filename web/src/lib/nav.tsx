/* Tiny hash-router glue: a Link that writes the hash, and a useRoute hook.
   Routing rules live in routes.ts. This is just the React binding. */

import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { parseHash, pageForRoute, applyLegacyRedirect, titleForPage } from "./routes";

const locShim = {
  get hash() {
    return window.location.hash;
  },
  replace(url: string) {
    // replaceState only, so a legacy slug swap never pushes a history entry.
    history.replaceState(null, "", url);
  },
};

export function currentPath(): string {
  applyLegacyRedirect(locShim, parseHash(window.location.hash));
  return pageForRoute(parseHash(window.location.hash));
}

export function useRoute(): string {
  const [route, setRoute] = useState(currentPath);
  useEffect(() => {
    const onHash = () => {
      const r = currentPath();
      setRoute(r);
      document.title = titleForPage(r);
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export function Link({
  to,
  children,
  className,
  style,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <a href={`#${to}`} className={className} style={style}>
      {children}
    </a>
  );
}
