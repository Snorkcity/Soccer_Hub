import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAssistant } from '@/contexts/AssistantContext';
import { Bot, Maximize2, Minus, X, RotateCcw } from 'lucide-react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { CoachAssistantChat } from '@/components/assistant/CoachAssistantChat';
import { useLeagueModules } from '@/hooks/useLeagueModules';

export function CoachAssistantOverlay() {
  const [location, setLocation] = useLocation();
  const { isVisible, setVisible, messages, reset } = useAssistant();
  const { hasModuleAnywhere, ready, isSuperadmin } = useLeagueModules();
  const [lastViewedMsgCount, setLastViewedMsgCount] = useState(messages.length);

  // Track unread messages for the FAB indicator
  useEffect(() => {
    if (isVisible) {
      setLastViewedMsgCount(messages.length);
    }
  }, [isVisible, messages.length]);

  // If they don't have access to the assistant, don't show the overlay at all.
  if (ready && !isSuperadmin && !hasModuleAnywhere("assistant")) return null;
  if (!ready) return null;

  // Don't show the overlay when already on the full page.
  if (location.startsWith('/assistant')) return null;

  const hasUnread = !isVisible && messages.length > lastViewedMsgCount;

  const handleExpand = () => {
    setVisible(false);
    setLocation('/assistant');
  };

  // Portal viewport-fixed UI out of the app shell. Replit's preview host can
  // apply transforms to the artifact root, which otherwise turns `fixed` into
  // ancestor-relative positioning and clips the launcher/panel.
  return createPortal(
    <>
      {/* FAB Launcher */}
      {!isVisible && (
        <div className="fixed bottom-6 right-6 z-[100]">
          <Button
            onClick={() => setVisible(true)}
            className="h-14 w-14 rounded-full shadow-xl flex items-center justify-center hover-elevate group bg-primary hover:bg-primary/90 text-primary-foreground"
            title="Coach Assistant"
          >
            <Bot className="h-6 w-6 transition-transform group-hover:scale-110" />
            {hasUnread && (
              <span className="absolute top-0 right-0 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive border border-background"></span>
              </span>
            )}
          </Button>
        </div>
      )}

      {/* Overlay Panel */}
      <div className={`fixed z-50 flex flex-col bg-card shadow-2xl transition-transform duration-300 ease-out
        md:inset-y-0 md:left-auto md:right-0 md:w-[420px] md:border-l md:border-border
        inset-x-0 bottom-0 top-[10vh] rounded-t-2xl border-t border-border md:rounded-none md:border-t-0
        ${isVisible ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-y-0 md:translate-x-full'}
      `}>
        {/* Header */}
        <div className="bg-card/95 backdrop-blur-sm rounded-t-2xl md:rounded-none border-b shrink-0 flex flex-col z-30">
          <div className="md:hidden flex justify-center pt-2 pb-1">
            <div className="h-1 w-12 bg-border rounded-full" />
          </div>
          <div className="flex items-center justify-between px-4 pb-3 pt-1 md:pt-3">
            <div className="flex items-center gap-2.5">
              <div className="bg-primary/10 p-1.5 rounded-md text-primary">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm leading-none text-foreground">Coach Assistant</h3>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">BUFC Curriculum</p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              {messages.length > 0 && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={reset} title="New chat">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hidden md:flex" onClick={handleExpand} title="Expand to full page">
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground md:hidden" onClick={() => setVisible(false)} title="Close">
                <X className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hidden md:flex" onClick={() => setVisible(false)} title="Minimize">
                <Minus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Chat Content */}
        <CoachAssistantChat variant="overlay" />
      </div>

      {/* Backdrop (mobile only) */}
      {isVisible && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden animate-in fade-in"
          onClick={() => setVisible(false)}
        />
      )}
    </>,
    document.body,
  );
}
