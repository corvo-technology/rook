import { AGENT_LOADER_WORKING_AFTER_MS } from "@corvo/core";
import { useEffect, useState } from "react";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { agentLoaderMotion } from "../lib/agent-loader";
import { useI18n } from "../lib/i18n";
import { BotAvatar } from "./bot-avatar";

/**
 * The mobile wait: the agent's own mascot (the rook until it is known) breathing, then a little
 * faster once the wait runs long. The engine that animates the avatars on the web does not run in
 * React Native, so the bundled picture moves instead; under reduced motion it holds still. It is
 * one accessible status with the app's loading label.
 */
export function AgentLoader({ color = "", size = 40 }: { color?: string; size?: number }) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [working, setWorking] = useState(false);
  const pulse = useSharedValue(1);

  useEffect(() => {
    const timer = setTimeout(() => setWorking(true), AGENT_LOADER_WORKING_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    const { periodMs, scale } = agentLoaderMotion(working);
    pulse.value = withRepeat(
      withSequence(
        withTiming(scale, { duration: periodMs / 2, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: periodMs / 2, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
    return () => cancelAnimation(pulse);
  }, [working, reducedMotion, pulse]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("Loading…")}
      style={style}
    >
      <BotAvatar color={color} size={size} />
    </Animated.View>
  );
}
