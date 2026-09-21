import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import * as reports from "../../../Services/apiCalling/reportApis";
import { DataTable, DateText, EmptyState, ErrorState, Modal, Money, Pagination, Skeleton, StatusBadge } from "../../custom/ui";
import { timeText } from "./constants";
import { formatCount } from "../../../constants/chart.constants";

/*
 * Generic by design: the server sends the column set, the rows and the deep link
 * for each dimension, so adding a dimension needs no change here. `type` on a
 * column picks the renderer; anything else prints as given.
 */
const renderers = {
  date: (value) => <DateText value={value} />,
  time: (value, _row, timeZone) => timeText(value, timeZone),
  badge: (value) => <StatusBadge value={value} />,
  money: (value) => <Money value={value} />,
};

const toSearch = (query) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) if (value) params.set(key, String(value));
  const search = params.toString();
  return search ? `?${search}` : "";
};

export default function WorkforceDrilldownModal({ open, request, timeZone, onClose }) {
  const [data, setData] = useState();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const requestRef = useRef(0);

  const signature = request ? JSON.stringify(request) : "";
  useEffect(() => { setPage(1); }, [signature]);

  const load = useCallback(async () => {
    if (!open || !request) return;
    const requestId = ++requestRef.current;
    setLoading(true); setError("");
    try {
      const next = await reports.handleGetAdminDashboardDrilldown({ ...request.params, dimension: request.dimension, ...(request.value ? { value: request.value } : {}), page, limit: 25 });
      if (requestId === requestRef.current) setData(next);
    } catch (requestError) {
      if (requestId === requestRef.current) { setError(requestError.message); setData(undefined); }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [open, page, request, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const columns = (data?.columns || []).map((column) => ({
    ...column,
    render: renderers[column.type] ? (value, row) => renderers[column.type](value, row, timeZone) : undefined,
  }));
  const title = request?.label || data?.label || "Records";
  const seeAll = data?.seeAll;

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="modal--drilldown"
      title={title}
      description={data ? `${formatCount(data.total)} record${data.total === 1 ? "" : "s"} behind this figure.` : "Loading the records behind this figure."}
      footer={seeAll ? <Link className="button button--secondary" to={`${seeAll.path}${toSearch(seeAll.query)}`} onClick={onClose}>Open in {seeAll.path.replace(/^\//, "").replace(/\/.*$/, "")} <ArrowUpRight size={15} /></Link> : null}
    >
      {error ? <ErrorState message={error} onRetry={load} />
        : loading && !data ? <Skeleton rows={5} />
          : data?.items?.length ? <><DataTable rows={data.items} columns={columns} /><Pagination page={data.page} pages={data.pages} onChange={setPage} /></>
            : <EmptyState title="Nothing here" description="No records matched this figure for the selected period and filters." />}
    </Modal>
  );
}
