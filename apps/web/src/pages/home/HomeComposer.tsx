import type { Bot } from "@corvo/contracts";
import {
  BotAvatar,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { ArrowUp, ChevronDown } from "lucide-react";
import type { Ref } from "react";
import { useState } from "react";

/** The prompt of the page: pick an agent in an inline chip, type, send with Enter or Command+Enter. */
export function HomeComposer({
  bots,
  target,
  onTarget,
  text,
  onText,
  sending,
  error,
  onSend,
  inputRef,
  suggestions = true,
}: {
  bots: readonly Bot[];
  target: Bot;
  onTarget: (id: string) => void;
  text: string;
  onText: (text: string) => void;
  sending: boolean;
  error: string | null;
  onSend: () => void;
  inputRef: Ref<HTMLTextAreaElement>;
  /** The generic starter chips; a partner's Home has shortcuts of its own instead. */
  suggestions?: boolean;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const agentName = target.name;
  const ready = text.trim().length > 0 && !sending;
  return (
    <div className="flex flex-col gap-3">
      <form
        data-testid="home-composer"
        className="rk-home-glow flex flex-col gap-1 rounded-3xl border border-border bg-card p-3 shadow-raised focus-within:border-foreground/30"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            aria-label={t`Agent`}
            disabled={bots.length < 2}
            className="rk-home-lift flex h-9 w-fit shrink-0 items-center gap-2 rounded-full border border-border bg-background ps-1.5 pe-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
          >
            <BotAvatar color={target.color} identity={target.id} size={24} />
            <span className="max-w-40 truncate">{agentName}</span>
            {bots.length > 1 ? (
              <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
            ) : null}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <Command>
              <CommandInput placeholder={t`Find an agent`} />
              <CommandList>
                <CommandEmpty>{t`No agent found`}</CommandEmpty>
                <CommandGroup>
                  {bots.map((bot) => (
                    <CommandItem
                      key={bot.id}
                      value={`${bot.name} ${bot.id}`}
                      onSelect={() => {
                        onTarget(bot.id);
                        setOpen(false);
                      }}
                    >
                      <BotAvatar color={bot.color} identity={bot.id} size={20} />
                      <span className="truncate">{bot.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            aria-label={t`Ask ${agentName} for something`}
            placeholder={t`Ask ${agentName} for something`}
            rows={2}
            value={text}
            disabled={sending}
            className="field-sizing-content max-h-48 min-h-14 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none placeholder:text-muted-foreground md:text-[15px]"
            onChange={(event) => onText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSend();
              }
            }}
          />
          {ready ? <Kbd className="mb-3 hidden sm:inline-flex">⌘↵</Kbd> : null}
          <button
            type="submit"
            aria-label={t`Send`}
            disabled={!ready}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition-[opacity,transform] duration-150 hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring disabled:scale-95 disabled:opacity-30"
          >
            <ArrowUp aria-hidden className="size-4" />
          </button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {suggestions ? (
        <ul className="flex flex-wrap gap-2" aria-label={t`Suggestions`}>
          {[t`Summary of the day`, t`What is stuck?`, t`Plan the week`].map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                className="rk-home-lift rounded-full border border-border bg-card/60 px-3 py-1.5 text-[13px] text-muted-foreground outline-none hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onText(suggestion)}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
