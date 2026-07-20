import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from '@/components/layout/Shell';
import { AuthGate } from '@/components/AuthGate';
import { DevBadge } from '@/components/DevBadge';

import Home from '@/pages/Home';
import SeasonStats from '@/pages/SeasonStats';
import GpsInsights from '@/pages/GpsInsights';
import Testing from '@/pages/Testing';
import DataEntry from '@/pages/DataEntry';
import SessionLibrary from '@/pages/SessionLibrary';
import Sessions from '@/pages/Sessions';
import SessionEditor from '@/pages/SessionEditor';
import SessionPrint from '@/pages/SessionPrint';
import Reflections from '@/pages/Reflections';
import MatchPrep from '@/pages/MatchPrep';
import CoachAssistant from '@/pages/CoachAssistant';
import ReflectionCycle from '@/pages/ReflectionCycle';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      {/* Print view renders without the app shell (clean for PDF export) */}
      <Route path="/sessions/:id/print" component={SessionPrint} />
      <Route>
        <Shell>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/season-stats" component={SeasonStats} />
            <Route path="/gps" component={GpsInsights} />
            <Route path="/testing" component={Testing} />
            <Route path="/library" component={SessionLibrary} />
            <Route path="/sessions" component={Sessions} />
            <Route path="/sessions/:id" component={SessionEditor} />
            <Route path="/reflections" component={Reflections} />
            <Route path="/match-prep" component={MatchPrep} />
            <Route path="/assistant" component={CoachAssistant} />
            <Route path="/reflections/:id" component={ReflectionCycle} />
            <Route path="/data-entry" component={DataEntry} />
            <Route component={NotFound} />
          </Switch>
        </Shell>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthGate>
            <Router />
          </AuthGate>
        </WouterRouter>
        <Toaster />
        <DevBadge />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
