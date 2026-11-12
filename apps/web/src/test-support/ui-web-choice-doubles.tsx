import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext } from "react";

/**
 * Plain stand-ins for the radio group and alert dialog of `@corvo/ui-web`, for tests that mock the
 * whole package. The dialog renders its content only while `open`, so a test sees what a person sees.
 */
const Group = createContext<{ value?: string; disabled?: boolean; set?: (v: string) => void }>({});
const Dialog = createContext<(open: boolean) => void>(() => undefined);

export const choiceDoubles = {
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
  RadioGroup: ({
    value,
    onValueChange,
    disabled,
    children,
    ...props
  }: Omit<ComponentProps<"div">, "onChange"> & {
    value?: string;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
  }) => (
    <Group.Provider value={{ value, disabled, set: onValueChange }}>
      <div role="radiogroup" {...props}>
        {children}
      </div>
    </Group.Provider>
  ),
  RadioGroupItem: ({ value, id }: { value: string; id?: string }) => {
    const group = useContext(Group);
    return (
      // biome-ignore lint/a11y/useSemanticElements: a stand-in for the Base UI radio
      <button
        id={id}
        type="button"
        role="radio"
        aria-checked={group.value === value}
        disabled={group.disabled}
        data-value={value}
        onClick={() => group.set?.(value)}
      />
    );
  },
  AlertDialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }) => (
    <Dialog.Provider value={onOpenChange ?? (() => undefined)}>
      {open ? children : null}
    </Dialog.Provider>
  ),
  AlertDialogContent: ({ children }: { children?: ReactNode }) => (
    <div role="alertdialog">{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  AlertDialogCancel: ({ children }: { children?: ReactNode }) => {
    const setOpen = useContext(Dialog);
    return (
      <button type="button" onClick={() => setOpen(false)}>
        {children}
      </button>
    );
  },
  AlertDialogAction: ({
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & { variant?: string }) => <button type="button" {...props} />,
};
