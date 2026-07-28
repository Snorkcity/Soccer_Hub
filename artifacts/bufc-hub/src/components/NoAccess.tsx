import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Lock } from "lucide-react";

/**
 * Friendly empty state shown when the signed-in user has no team with access to
 * the current page's module.
 */
export function NoAccess({ title = "No access", description = "You don't have access to this page for this team." }: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="py-16">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Lock className="h-5 w-5" />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
