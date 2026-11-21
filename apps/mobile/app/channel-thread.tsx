import { useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { AgentLoader } from "../components/agent-loader";
import { ChannelThread } from "../components/thread/channel-thread-screen";
import { integrationsCacheScope } from "../lib/integrations-cache";
import { useMobileTokens } from "../lib/native";
import { currentReadySessionGeneration, subscribeSessionGeneration } from "../lib/session";

/** A channel message and its replies, pushed over the channel. */
export default function ChannelThreadRoute() {
  const tokens = useMobileTokens();
  const ready = useSyncExternalStore(subscribeSessionGeneration, currentReadySessionGeneration);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void integrationsCacheScope()
      .then((scope) => {
        if (!cancelled) setUserId(scope.userId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ready]);
  if (!userId) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <AgentLoader />
      </View>
    );
  }
  return <ChannelThread sessionEpoch={ready} userId={userId} />;
}
