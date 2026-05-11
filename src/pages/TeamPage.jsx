import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useCfbdEndpoint } from "../hooks/useCfbd";

/**
 * Team detail page (Phase 6).
 *
 * This is designed for a future React router route like:
 *   /team/:teamKey
 *
 * For the current static HTML site, see `Client/Frontend/team.html` which is
 * also being wired to the same CFBD proxy.
 */
export default function TeamPage() {
  const { teamKey } = useParams();

  // NOTE: Many CFBD endpoints accept `team` as the *school name* (e.g. "Alabama").
  // If you route by id, you may need a lookup step to map id -> school.
  const teamName = useMemo(() => decodeURIComponent(teamKey || ""), [teamKey]);

  const roster = useCfbdEndpoint("/roster", { year: 2026, team: teamName }, { enabled: !!teamName });
  const records = useCfbdEndpoint("/records", { year: 2026, team: teamName }, { enabled: !!teamName });
  const ratings = useCfbdEndpoint("/ratings/sp", { year: 2026, team: teamName }, { enabled: !!teamName });
  const games = useCfbdEndpoint(
    "/games",
    { year: 2026, team: teamName, seasonType: "regular" },
    { enabled: !!teamName }
  );

  if (!teamName) return <div style={{ padding: 16 }}>Missing team key.</div>;

  const loading = roster.loading || records.loading || ratings.loading || games.loading;
  const error = roster.error || records.error || ratings.error || games.error;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{teamName}</h2>

      {loading ? <div>Loading team data...</div> : null}
      {error ? (
        <pre style={{ whiteSpace: "pre-wrap", color: "#b00020" }}>{String(error.message || error)}</pre>
      ) : null}

      <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
        <section>
          <h3>Record</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(records.data, null, 2)}</pre>
        </section>

        <section>
          <h3>Schedule</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(games.data, null, 2)}</pre>
        </section>

        <section>
          <h3>SP+ Ratings</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(ratings.data, null, 2)}</pre>
        </section>

        <section>
          <h3>Roster (preview)</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(roster.data, null, 2)}</pre>
        </section>
      </div>
    </div>
  );
}

