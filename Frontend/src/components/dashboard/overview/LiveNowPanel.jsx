import { RefreshCw } from "lucide-react";
import { Button, ErrorState, Skeleton } from "../../custom/ui";
import useLiveWorkforce from "./useLiveWorkforce";
import LiveCounterStrip from "./LiveCounterStrip";
import LiveEmployeeBoard from "./LiveEmployeeBoard";
import { dateText } from "./constants";

const agoText = (seconds) => (seconds < 5 ? "just now" : seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`);

/*
 * The top of the page and the only part of it that is live. It answers "what is
 * happening right now" and is deliberately immune to the date filter below —
 * hence the explicit "today" label, so the two are never confused.
 */
export default function LiveNowPanel({ onDrill, onSelectEmployee }) {
  const { rows, counters, data, error, loading, refresh, timeZone, secondsSinceUpdate } = useLiveWorkforce();

  return (
    <section className="surface surface--floating live-panel">
      <header className="live-panel__head">
        <div>
          <h2>Right now</h2>
          <p>
            {data ? `${dateText(data.businessDate)} · ${timeZone}` : "Today"}
            {data ? <> · updated <span className="tabular">{agoText(secondsSinceUpdate)}</span></> : null}
          </p>
        </div>
        <Button variant="quiet" icon={RefreshCw} onClick={refresh} aria-label="Refresh the live view">Refresh</Button>
      </header>

      {error ? <div className="live-panel__body"><ErrorState message={error} onRetry={refresh} /></div>
        : loading && !data ? <div className="live-panel__body"><Skeleton rows={5} /></div>
          : (
            <div className="live-panel__body">
              <LiveCounterStrip counters={counters} onDrill={onDrill} />
              <LiveEmployeeBoard rows={rows} timeZone={timeZone} truncated={data?.truncated} onSelect={onSelectEmployee} />
            </div>
          )}
    </section>
  );
}
