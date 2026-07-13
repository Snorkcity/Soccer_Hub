import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from '@/components/layout/Shell';

import Home from '@/pages/Home';
import SeasonStats from '@/pages/SeasonStats';
import GpsInsights from '@/pages/GpsInsights';
import Testing from '@/pages/Testing';
import GoalMap from '@/pages/GoalMap';
import DataEntry from '@/pages/DataEntry';

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/season-stats" component={SeasonStats} />
        <Route path="/gps" component={GpsInsights} />
        <Route path="/testing" component={Testing} />
        <Route path="/goal-map" component={GoalMap} />
        <Route path="/data-entry" component={DataEntry} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
