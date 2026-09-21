import { HealthLiveApi, HealthReadyApi } from "../apiMethod";
import { toData } from "./responseHandlers";

export const handleGetHealthLive = () => toData(HealthLiveApi());
export const handleGetHealthReady = () => toData(HealthReadyApi());
