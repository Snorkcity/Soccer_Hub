import { useAssistant } from "@/contexts/AssistantContext";
import { CoachAssistantChat } from "@/components/assistant/CoachAssistantChat";
import { Bot, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { NoAccess } from "@/components/NoAccess";

// Coach Assistant is a paid add-on: shown only with the "assistant" module in some league.
export default function CoachAssistant() {
  const { isSuperadmin, hasModuleAnywhere, ready } = useLeagueModules();
  if (ready && !isSuperadmin && !hasModuleAnywhere("assistant")) return <NoAccess />;
  if (!ready) return null;
  return <CoachAssistantInner />;
}

function CoachAssistantInner() {
  const { messages, reset } = useAssistant();

  return (
    <div className="p-4 md:p-6 flex flex-col max-w-4xl mx-auto h-[calc(100dvh-1rem)] md:h-[calc(100dvh-2rem)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 shrink-0">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" /> Coach Assistant
          </h1>
          <p className="text-sm text-muted-foreground">
            Answers come straight from the Belconnen development curriculum — coach packs, session plans and the framework library (U11 to 16+).
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> New chat
          </Button>
        )}
      </div>

      <CoachAssistantChat variant="full" />
    </div>
  );
}
