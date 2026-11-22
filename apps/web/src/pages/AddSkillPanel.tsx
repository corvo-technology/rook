import { ATTACHMENT_MAX_BYTES } from "@corvo/contracts";
import { Button, Input, SidePanel, Tabs, TabsList, TabsTrigger, Textarea } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type Way = "link" | "zip" | "write";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * A side panel (`?panel=add-skill`) to add a skill three ways: a GitHub link, a zipped skill folder
 * or by writing it. The server fetches, reads and checks what comes from outside; this only says
 * which way the person chose.
 */
export function AddSkillPanel({ onAdded, onClose }: { onAdded: () => void; onClose: () => void }) {
  const { t } = useLingui();
  const [way, setWay] = useState<Way>("link");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const ready =
    way === "link"
      ? url.trim() !== ""
      : way === "zip"
        ? file !== null
        : name.trim() !== "" && description.trim() !== "";

  async function add() {
    setSaving(true);
    setError(null);
    try {
      if (way === "link") {
        await rpc.agentSkills.import({ kind: "url", url });
      } else if (way === "zip" && file) {
        if (file.size > ATTACHMENT_MAX_BYTES) throw new Error(t`That file is too large.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        await rpc.agentSkills.import({ kind: "zip", dataBase64: toBase64(bytes) });
      } else {
        await rpc.agentSkills.create({
          name: name.trim(),
          description: description.trim(),
          body,
        });
      }
      onAdded();
    } catch (reason) {
      setError(errorText(reason, t`Could not add the skill`));
      setSaving(false);
    }
  }

  return (
    <SidePanel
      open
      onClose={saving ? () => undefined : onClose}
      title={t`Add skill`}
      closeLabel={t`Close`}
      data-testid="add-skill-panel"
      footer={
        <>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button disabled={saving || !ready} onClick={() => void add()}>
            {saving ? <Trans>Adding…</Trans> : <Trans>Add skill</Trans>}
          </Button>
        </>
      }
    >
      <Tabs
        value={way}
        onValueChange={(next) => {
          setWay(next as Way);
          setError(null);
        }}
      >
        <TabsList>
          <TabsTrigger value="link">
            <Trans>Paste link</Trans>
          </TabsTrigger>
          <TabsTrigger value="zip">
            <Trans>Upload .zip</Trans>
          </TabsTrigger>
          <TabsTrigger value="write">
            <Trans>Write</Trans>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {way === "link" ? (
        <Input
          data-autofocus
          type="url"
          aria-label={t`GitHub link`}
          placeholder="https://github.com/…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      ) : null}
      {way === "zip" ? (
        <>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            aria-label={t`Upload .zip`}
            data-testid="add-skill-zip"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Button
            variant="outline"
            data-autofocus
            className="justify-start"
            onClick={() => fileInput.current?.click()}
          >
            {file ? file.name : <Trans>Choose a .zip</Trans>}
          </Button>
        </>
      ) : null}
      {way === "write" ? (
        <>
          <Input
            data-autofocus
            aria-label={t`Name`}
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Textarea
            aria-label={t`When to use`}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Textarea
            aria-label={t`Instructions`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </SidePanel>
  );
}
