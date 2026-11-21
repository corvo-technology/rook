import { avatarInk, parseAvatar } from "@corvo/contracts";
import { personInitials } from "@corvo/core";
import { Image, StyleSheet, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";

/**
 * A person (a circle of initials) or a space (a rounded square of its initial), wearing a picture
 * or a chosen color. Agents have their own avatars; people and spaces never wear characters.
 */
export function AvatarMark({
  name,
  value,
  size = 36,
  shape = "person",
}: {
  name: string;
  /** The stored avatar: a color, a picture or nothing. */
  value?: string | null;
  size?: number;
  shape?: "person" | "space";
}) {
  const tokens = mobileTokens();
  const avatar = parseAvatar(value);
  const color = avatar.kind === "color" ? avatar.color : null;
  const label =
    shape === "space" ? (Array.from(name.trim())[0]?.toUpperCase() ?? "?") : personInitials(name);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          borderRadius: shape === "space" ? Math.round(size * 0.3) : size / 2,
          backgroundColor: color ?? (shape === "space" ? tokens.primary : tokens.muted),
        },
      ]}
    >
      {avatar.kind === "image" ? (
        <Image source={{ uri: avatar.src }} style={styles.fill} resizeMode="cover" />
      ) : (
        <Text
          style={{
            fontSize: Math.round(size * 0.4),
            fontWeight: "600",
            color: color
              ? avatarInk(color)
              : shape === "space"
                ? tokens.primaryForeground
                : tokens.foreground,
          }}
        >
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
});
