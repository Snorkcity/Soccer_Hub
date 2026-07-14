import { Router, type IRouter } from "express";
import healthRouter from "./health";
import playersRouter from "./players";
import teamsRouter from "./teams";
import seasonsRouter from "./seasons";
import matchesRouter from "./matches";
import playerStatsRouter from "./playerStats";
import goalsRouter from "./goals";
import gpsSessionsRouter from "./gpsSessions";
import athleticTestsRouter from "./athleticTests";
import analyticsRouter from "./analytics";
import clubsRouter from "./clubs";
import authRouter from "./auth";
import entryRouter from "./entry";

const router: IRouter = Router();

router.use(healthRouter);
router.use(playersRouter);
router.use(teamsRouter);
router.use(seasonsRouter);
router.use(matchesRouter);
router.use(playerStatsRouter);
router.use(goalsRouter);
router.use(gpsSessionsRouter);
router.use(athleticTestsRouter);
router.use(analyticsRouter);
router.use(clubsRouter);
router.use(authRouter);
router.use(entryRouter);

export default router;
