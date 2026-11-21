import type { MessageBlock } from "@corvo/contracts";
import { Badge } from "@corvo/ui-web/components/ui/badge";
import { Card, CardContent } from "@corvo/ui-web/components/ui/card";
import { Trans } from "@lingui/react/macro";
import { Shimmer } from "./ai/primitives";

export function ResearchCard({ block }: { block: Extract<MessageBlock, { kind: "research" }> }) {
  return (
    <Card size="sm" className="w-80 max-w-full" data-testid="research-card">
      <CardContent className="flex items-start justify-between gap-3">
        <span className="font-medium" dir="auto">
          {block.status === "running" ? <Shimmer>{block.question}</Shimmer> : block.question}
        </span>
        <Badge
          variant="secondary"
          className={
            block.status === "failed"
              ? "text-destructive"
              : block.status === "finished"
                ? "text-success"
                : "text-muted-foreground"
          }
        >
          {block.status === "running" ? (
            <Trans>running</Trans>
          ) : block.status === "finished" ? (
            <Trans>finished</Trans>
          ) : block.status === "cancelled" ? (
            <Trans>cancelled</Trans>
          ) : (
            <Trans>failed</Trans>
          )}
        </Badge>
      </CardContent>
    </Card>
  );
}
