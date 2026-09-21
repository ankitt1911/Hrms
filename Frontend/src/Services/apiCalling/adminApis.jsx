import { CompanyApi, UpdateCompanyApi } from "../apiMethod";
import { toData, toResult } from "./responseHandlers";

export const handleGetCompany = () => toData(CompanyApi());
export const handleUpdateCompany = (params) => toResult(UpdateCompanyApi(params));
