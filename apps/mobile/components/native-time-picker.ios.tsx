import { DatePicker, Host } from "@expo/ui/swift-ui";
import {
  accessibilityLabel as accessibilityLabelModifier,
  labelsHidden,
} from "@expo/ui/swift-ui/modifiers";
import { useResolvedAppearance } from "../lib/native";
import type { NativeTimePickerProps } from "../lib/native-controls";
import { dateToMinutes, minutesToDate } from "../lib/quiet-hours";

/** SwiftUI time picker. The visible label stays in the surrounding row. */
export function NativeTimePicker({ minutes, onChange, accessibilityLabel }: NativeTimePickerProps) {
  const scheme = useResolvedAppearance();
  return (
    <Host colorScheme={scheme} ignoreSafeArea="container" matchContents>
      <DatePicker
        title={accessibilityLabel}
        selection={minutesToDate(minutes)}
        displayedComponents={["hourAndMinute"]}
        onDateChange={(date) => onChange(dateToMinutes(date))}
        modifiers={[labelsHidden(), accessibilityLabelModifier(accessibilityLabel)]}
      />
    </Host>
  );
}
