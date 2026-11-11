import { botAvatarCharacter, composeBotAvatarValue } from "@corvo/contracts";
import {
  DEFAULT_BOT_AVATAR_COLOR,
  isPresetAvatarColor,
  MASCOT_COLORS,
  mascotForColorDef,
} from "@corvo/core";
import {
  BOT_CHARACTERS,
  BotAvatar,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  defaultBotAvatarValue,
  parseBotAvatar,
  resolvePersonaColorDef,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@corvo/ui-web";
import { Button } from "@corvo/ui-web/components/ui/button";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Check, Pencil, Plus, Upload, X } from "lucide-react";
import type { ClipboardEvent, DragEvent } from "react";
import { useEffect, useRef, useState } from "react";

/** How long a color chosen with the picker waits for the next step of the drag before it is kept. */
const CUSTOM_COLOR_SETTLE_MS = 350;

/** `#rgb` or `#rrggbb` as the six digits a color input takes, in lower case. */
function colorInputValue(hex: string): string {
  const digits = hex.replace("#", "").toLowerCase();
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
  return /^[0-9a-f]{6}$/.test(full) ? `#${full}` : DEFAULT_BOT_AVATAR_COLOR.toLowerCase();
}

/**
 * The colors a bot can wear, each one its own mascot, and one of the person's own: the picker
 * of the system, kept once the drag settles since each color is saved as it is chosen.
 */
export function BotLookPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const parsed = parseBotAvatar(value);
  const current = mascotForColorDef(resolvePersonaColorDef("preview", parsed.color)).toString();
  // A character worn stays when another color is chosen, and each swatch shows it in that color.
  const character = botAvatarCharacter(value);
  // The character worn, kept where the picker may close before a choice is committed.
  const characterRef = useRef(character);
  characterRef.current = character;
  const custom = !parsed.isImage && !isPresetAvatarColor(parsed.color);
  const [draft, setDraft] = useState<string | null>(null);
  const settle = useRef<number | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const keep = useRef(onChange);
  keep.current = onChange;

  function commit() {
    window.clearTimeout(settle.current);
    const next = pending.current;
    pending.current = null;
    setDraft(null);
    if (next) keep.current(composeBotAvatarValue(next, characterRef.current));
  }
  // A choice still waiting when the picker goes away is kept rather than lost.
  useEffect(() => commit, []);

  const shown = draft ?? (parsed.isImage ? DEFAULT_BOT_AVATAR_COLOR : parsed.color);
  const customShown = draft !== null || custom;
  return (
    <>
      <fieldset
        className="m-0 grid grid-cols-5 place-items-center gap-2 border-0 p-0"
        data-testid="avatar-studio-colors"
      >
        <legend className="sr-only">
          <Trans>Color</Trans>
        </legend>
        {MASCOT_COLORS.map(({ id, hex }) => {
          const selected = !parsed.isImage && !customShown && current === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(composeBotAvatarValue(hex, character))}
              aria-label={t`Color ${hex}`}
              aria-pressed={selected}
              className={`rounded-xl p-0.5 transition-transform hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring ${
                selected ? "ring-2 ring-primary ring-offset-2 ring-offset-popover" : ""
              }`}
            >
              <BotAvatar color={composeBotAvatarValue(hex, character)} size={44} />
            </button>
          );
        })}
      </fieldset>
      <div className="mt-3 flex items-center gap-3">
        <label
          className={`relative rounded-xl p-0.5 transition-transform focus-within:ring-2 focus-within:ring-ring hover:scale-105 active:scale-95 ${
            customShown ? "ring-2 ring-primary ring-offset-2 ring-offset-popover" : ""
          }`}
        >
          {customShown ? (
            <BotAvatar color={composeBotAvatarValue(shown, character)} size={44} />
          ) : (
            <span className="grid size-11 place-items-center rounded-xl border border-dashed border-border text-muted-foreground">
              <Plus size={18} aria-hidden="true" />
            </span>
          )}
          <input
            type="color"
            aria-label={t`Custom color`}
            value={colorInputValue(shown)}
            onChange={(event) => {
              const next = event.target.value.toUpperCase();
              pending.current = next;
              setDraft(next);
              window.clearTimeout(settle.current);
              settle.current = window.setTimeout(commit, CUSTOM_COLOR_SETTLE_MS);
            }}
            onBlur={commit}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        {customShown ? (
          <span data-custom-color className="text-xs tabular-nums text-muted-foreground">
            {shown.toUpperCase()}
          </span>
        ) : null}
      </div>
    </>
  );
}

/** The default rook and the characters of Open Bot Avatar, each in the color the agent wears. */
export function BotCharacterPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const parsed = parseBotAvatar(value);
  const color = parsed.isImage ? DEFAULT_BOT_AVATAR_COLOR : parsed.color;
  const worn = parsed.characterId;
  const tileClass = (selected: boolean) =>
    `rounded-xl p-0.5 transition-transform hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring ${
      selected ? "ring-2 ring-primary ring-offset-2 ring-offset-popover" : ""
    }`;
  const plain = !parsed.isImage && !worn;
  return (
    <fieldset
      className="m-0 grid grid-cols-5 place-items-center gap-2 border-0 p-0"
      data-testid="avatar-studio-characters"
    >
      <legend className="sr-only">
        <Trans>Character</Trans>
      </legend>
      <button
        type="button"
        onClick={() => onChange(color)}
        aria-label={t`Default`}
        aria-pressed={plain}
        className={tileClass(plain)}
      >
        <BotAvatar color={color} size={44} />
      </button>
      {BOT_CHARACTERS.map(({ id, name }) => {
        const selected = worn === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(composeBotAvatarValue(color, id))}
            aria-label={name}
            aria-pressed={selected}
            className={tileClass(selected)}
          >
            <BotAvatar color={composeBotAvatarValue(color, id)} size={44} />
          </button>
        );
      })}
    </fieldset>
  );
}

export interface AvatarStudioPopoverProps {
  value: string;
  identity?: string;
  status?: string;
  size?: number;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function AvatarStudioPopover({
  value,
  identity,
  status,
  size = 72,
  onChange,
  disabled = false,
}: AvatarStudioPopoverProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"bot" | "character" | "upload">("bot");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function restoreDefaultAvatar() {
    const next = defaultBotAvatarValue(value);
    if (next !== value) onChange(next);
  }

  function processImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const targetSize = 256;
        canvas.width = targetSize;
        canvas.height = targetSize;
        if (!ctx) return;

        ctx.beginPath();
        ctx.arc(targetSize / 2, targetSize / 2, targetSize / 2, 0, Math.PI * 2);
        ctx.clip();

        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);

        onChange(canvas.toDataURL("image/webp", 0.9));
        setOpen(false);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  }

  function handlePaste(event: ClipboardEvent<HTMLButtonElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item?.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) {
        processImageFile(file);
        break;
      }
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="group relative cursor-pointer rounded-2xl outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t`Customize bot avatar`}
        data-testid="avatar-studio-trigger"
      >
        <BotAvatar color={value} identity={identity} size={size} status={status} />
        <div className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border-2 border-background bg-secondary text-foreground shadow-md transition-transform group-hover:scale-110">
          <Pencil size={12} strokeWidth={2.2} />
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="w-[360px] max-w-full gap-4 rounded-3xl p-5 sm:max-w-[360px]"
          data-testid="avatar-studio"
        >
          <DialogHeader className="flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-[14px] font-semibold tracking-tight">
              <Trans>Avatar Studio</Trans>
            </DialogTitle>
            <DialogDescription className="sr-only">
              <Trans>Choose a color or upload an image</Trans>
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full text-muted-foreground"
              aria-label={t`Close`}
            >
              <X size={16} />
            </Button>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center py-2">
            <BotAvatar color={value} identity={identity} size={78} status={status} />
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(next) => setActiveTab(next as "bot" | "character" | "upload")}
            className="gap-4"
          >
            <div className="flex items-center justify-between border-b border-border pb-1">
              <TabsList className="rounded-full">
                <TabsTrigger value="bot" className="rounded-full px-3 text-xs">
                  <Trans>Bot</Trans>
                </TabsTrigger>
                <TabsTrigger value="character" className="rounded-full px-3 text-xs">
                  <Trans>Character</Trans>
                </TabsTrigger>
                <TabsTrigger value="upload" className="rounded-full px-3 text-xs">
                  <Trans>Upload</Trans>
                </TabsTrigger>
              </TabsList>

              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={restoreDefaultAvatar}
                className="text-xs text-muted-foreground"
              >
                <Trans>Reset</Trans>
              </Button>
            </div>

            <TabsContent value="bot" className="pt-1" data-testid="avatar-studio-bot-tab">
              <BotLookPicker value={value} onChange={onChange} />
            </TabsContent>
            <TabsContent
              value="character"
              className="pt-1"
              data-testid="avatar-studio-character-tab"
            >
              <BotCharacterPicker value={value} onChange={onChange} />
            </TabsContent>
            <TabsContent value="upload">
              <button
                type="button"
                aria-label={t`Image upload area`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onPaste={handlePaste}
                onClick={() => fileInputRef.current?.click()}
                className={`flex w-full flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors ${
                  dragOver
                    ? "border-primary bg-primary/10"
                    : "border-border bg-muted hover:border-foreground/30"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) processImageFile(file);
                  }}
                />
                <div className="mb-2 grid size-10 place-items-center rounded-full bg-secondary text-muted-foreground">
                  <Upload size={18} strokeWidth={1.8} />
                </div>
                <p className="text-[12.5px] font-medium text-muted-foreground">
                  <Trans>Drag, drop, or paste an image</Trans>
                </p>
                <span className="mt-3 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground">
                  <Trans>Choose file</Trans>
                </span>
              </button>
            </TabsContent>
          </Tabs>

          <DialogFooter className="border-border sm:justify-end">
            <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)}>
              <Check size={14} />
              <Trans>Done</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
