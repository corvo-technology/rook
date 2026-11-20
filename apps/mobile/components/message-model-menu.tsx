import { keepMessageModel, modelOptionKey, pickMessageModel } from "@corvo/core";
import type { MenuAction } from "@expo/ui/community/menu";
import { MenuView } from "@expo/ui/community/menu";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { useI18n } from "../lib/i18n";
import { messageModels, useMessageModel, useMessageModelOptions } from "../lib/message-model";
import { openModelPicker } from "../lib/model-picker-selection";
import { useMobileTokens, useResolvedAppearance } from "../lib/native";
import { GlassSurface } from "./glass-surface";
import { NativeSymbol } from "./native-symbol";

/**
 * A native menu beside the composer for the next message's model. Absent when there is nothing
 * to pick; the choice never changes the agent's saved model.
 */
export function MessageModelMenu({
  botId,
  styles,
}: {
  botId: string;
  styles: { circleButton: object; composerFill: object };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const options = useMessageModelOptions(botId);
  const state = useMessageModel(botId);
  if (!options) return null;

  const value = state.model
    ? modelOptionKey(state.model.provider, state.model.modelId)
    : options.agentKey;
  const current = options.choices.find((choice) => choice.key === value);
  const actions: MenuAction[] = [
    { id: "pick", title: current?.label ?? t("Model") },
    { id: "keep", title: t("For this conversation"), state: state.keep ? "on" : "off" },
  ];

  function pick() {
    if (!options) return;
    const requestId = openModelPicker({
      choices: options.choices,
      selectedKey: value,
      onSelect: (choice) =>
        messageModels.set(
          botId,
          pickMessageModel(messageModels.get(botId), choice.key, options.agentKey),
        ),
    });
    router.push({ pathname: "/model-picker", params: { requestId } });
  }

  return (
    <MenuView
      actions={actions}
      colorScheme={colorScheme}
      onPressAction={(event) => {
        if (event.nativeEvent.event === "pick") pick();
        else messageModels.set(botId, keepMessageModel(messageModels.get(botId), !state.keep));
      }}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={current?.label ?? t("Model")}
        style={{ width: 44, height: 44 }}
      >
        <GlassSurface
          shape="circle"
          style={styles.circleButton}
          fallbackStyle={styles.composerFill}
        >
          <NativeSymbol
            ios="cpu"
            android="hardware-chip-outline"
            size={18}
            color={tokens.mutedForeground}
          />
        </GlassSurface>
      </View>
    </MenuView>
  );
}
