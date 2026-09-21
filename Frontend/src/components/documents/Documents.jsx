import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Download } from "lucide-react";
import * as employees from "../../Services/apiCalling/employeeApis";
import * as documents from "../../Services/apiCalling/documentApis";
import { unwrapCollection } from "../custom/apiBridge";
import { Button, DataTable, DateText, EmptyState, ErrorState, PageHeading, Skeleton, StatusBadge } from "../custom/ui";

export default function Documents() {
  const employeeId = useSelector((state) => state.auth.user?.employee?._id);
  const [rows, setRows] = useState();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!employeeId) { setRows([]); return; }
    try { setRows(unwrapCollection(await employees.handleGetEmployeeDocuments(employeeId)).items); setError(""); }
    catch (requestError) { setError(requestError.message); }
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);
  return <main className="page-content"><PageHeading meta="Private documents" title="My documents" description="Owner-shared files available through short-lived download links." />{error ? <ErrorState message={error} onRetry={load} /> : !rows ? <Skeleton rows={5} /> : rows.length ? <section className="surface"><DataTable rows={rows} columns={[{key:"filename",label:"File",render:(value,row)=>value||row.originalName||row.category},{key:"category",label:"Category"},{key:"scanStatus",label:"Scan",render:StatusBadge},{key:"createdAt",label:"Uploaded",render:DateText}]} actions={(row)=><Button variant="quiet" icon={Download} disabled={row.scanStatus!=="CLEAN"} onClick={()=>documents.handleDownloadDocument(row._id)}>Download</Button>} /></section> : <EmptyState title="No documents" description="Documents shared with you will appear here." />}</main>;
}
