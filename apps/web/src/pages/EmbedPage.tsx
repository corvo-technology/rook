import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth";
import {
  clearEmbedFragment,
  exchangeEmbedCode,
  initialEmbedLaunch,
  installEmbedToken,
  scheduleEmbedRefresh,
  tellParent,
} from "../lib/embed";
import { EmbedSkeleton } from "./shell/embed-tabs";

/**
 * Where the partner's frame lands: trades the one-use code from the address for a session token,
 * then opens the app. Without a good code it shows nothing and tells the partner's page, which
 * asks its backend for a new one.
 */
export function EmbedPage() {
  const navigate = useNavigate();
  const session = authClient.useSession();
  const started = useRef(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = initialEmbedLaunch?.code;
    clearEmbedFragment();
    if (!code) return tellParent({ type: "corvo:expired" });
    void exchangeEmbedCode(code).then(async (result) => {
      if (!result) return tellParent({ type: "corvo:expired" });
      installEmbedToken(result.token);
      scheduleEmbedRefresh(result.expiresAt);
      await session.refetch();
      setSignedIn(true);
    });
  }, [session]);

  useEffect(() => {
    if (signedIn && session.data?.user) {
      tellParent({ type: "corvo:ready" });
      navigate("/app", { replace: true });
    }
  }, [signedIn, session.data?.user, navigate]);

  return <EmbedSkeleton />;
}
