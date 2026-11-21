import type { NativeTimePickerProps } from "../lib/native-controls";

/** iOS uses a SwiftUI time picker. Android keeps the default window until it has a native one. */
export function NativeTimePicker(_props: NativeTimePickerProps) {
  return null;
}
