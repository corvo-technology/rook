import { Button, Input } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";

function download(file: { filename: string; contentType: string; content: string }) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** What one organization used between two days, as a file, for answering a card dispute. */
export function UsageEvidenceExport({ organizationId }: { organizationId: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const exportFile = useMutation({
    ...queries.platform.usageEvidence.export.mutationOptions(),
    onSuccess: download,
  });
  const ask = (format: "csv" | "json") => exportFile.mutate({ organizationId, from, to, format });
  return (
    <div className="flex flex-col gap-3" data-testid="platform-usage-evidence">
      <h2 className="text-lg font-light tracking-tight">{t`Usage evidence`}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          className="w-40"
          aria-label={t`From`}
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <Input
          type="date"
          className="w-40"
          aria-label={t`To`}
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={!from || !to || exportFile.isPending}
          onClick={() => ask("csv")}
        >
          {t`CSV`}
        </Button>
        <Button
          variant="outline"
          disabled={!from || !to || exportFile.isPending}
          onClick={() => ask("json")}
        >
          {t`JSON`}
        </Button>
      </div>
      {exportFile.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(exportFile.error, t`Could not export`)}
        </p>
      ) : null}
    </div>
  );
}
