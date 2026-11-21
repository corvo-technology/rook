import { AVATAR_COLORS, parseAvatar } from "@corvo/contracts";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { pickAvatarPhoto } from "../lib/avatar-photo";
import { useI18n } from "../lib/i18n";
import { errorText } from "../lib/user-error";
import { AvatarMark } from "./avatar-mark";
import { SettingsRow } from "./settings-group";

/** Picks a color or a photo for a person or a space, and saves the choice at once. */
export function AvatarPicker({
  name,
  value,
  shape,
  onSave,
}: {
  name: string;
  value?: string | null;
  shape: "person" | "space";
  onSave: (avatar: string | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = parseAvatar(value);

  async function save(next: () => Promise<string | null | undefined>) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const avatar = await next();
      if (avatar !== undefined) await onSave(avatar);
    } catch (err) {
      setError(errorText(err, t("Could not save")));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <SettingsRow
        title={t("Avatar")}
        trailing={<AvatarMark name={name} value={value} shape={shape} size={40} />}
      />
      <View style={styles.colors}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.swatches}
          accessibilityRole="radiogroup"
        >
          {AVATAR_COLORS.map((color, index) => {
            const selected = current.kind === "color" && current.color === color;
            return (
              <Pressable
                key={color}
                accessibilityRole="radio"
                accessibilityLabel={t("Color {number}", { number: index + 1 })}
                accessibilityState={{ checked: selected, disabled: pending }}
                disabled={pending}
                onPress={() => void save(async () => color)}
                style={[
                  styles.swatch,
                  {
                    backgroundColor: color,
                    borderColor: selected ? tokens.foreground : "transparent",
                  },
                ]}
              />
            );
          })}
        </ScrollView>
      </View>
      <SettingsRow
        accessibilityRole="button"
        title={t("Photo library")}
        disabled={pending}
        onPress={() => void save(async () => (await pickAvatarPhoto()) ?? undefined)}
      />
      {current.kind === "none" ? null : (
        <SettingsRow
          accessibilityRole="button"
          destructive
          title={t("Remove")}
          disabled={pending}
          onPress={() => void save(async () => null)}
        />
      )}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: tokens.destructive }]}>
          {error}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  colors: { paddingVertical: 4 },
  swatches: { gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 3 },
  error: { paddingHorizontal: 16, paddingVertical: 8, fontSize: 13 },
});
