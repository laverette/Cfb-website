import { useMemo, useState } from "react";
import { useCfbdGames } from "../hooks/useCfbd";

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

export default function CfbdApiTest() {
  const [year, setYear] = useState(2026);
  const [week, setWeek] = useState(1);

  const params = useMemo(
    () => ({ year, week, seasonType: "regular" }),
    [year, week]
  );

  const { data, loading, error, refetch } = useCfbdGames(params, { enabled: true });

  return (
    <div style={{ padding: 16, border: "1px solid #8D6E63", borderRadius: 12 }}>
      <h3 style={{ marginTop: 0 }}>CFBD Proxy Test: /games</h3>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label>
          Year
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ marginLeft: 8 }}
          />
        </label>
        <label>
          Week
          <input
            type="number"
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
            style={{ marginLeft: 8 }}
          />
        </label>
        <button onClick={refetch} disabled={loading}>
          {loading ? "Loading..." : "Fetch"}
        </button>
      </div>

      {error ? (
        <pre style={{ marginTop: 12, whiteSpace: "pre-wrap", color: "#b00020" }}>
          {String(error?.message || error)}
        </pre>
      ) : null}

      {loading ? <div style={{ marginTop: 12 }}>Loading games...</div> : null}

      {Array.isArray(data) ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ opacity: 0.85, marginBottom: 8 }}>Games: {data.length}</div>
          <div style={{ display: "grid", gap: 10 }}>
            {data.map((g) => (
              <div
                key={g?.id ?? `${g?.awayTeam}-${g?.homeTeam}-${g?.startDate}`}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid rgba(141, 110, 99, 0.5)",
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {g?.awayTeam} @ {g?.homeTeam}
                </div>
                <div style={{ opacity: 0.9 }}>
                  {formatDate(g?.startDate)} · {g?.venue || "TBD"}
                </div>
                <div style={{ opacity: 0.85 }}>
                  Completed: {String(!!g?.completed)} · Conference game:{" "}
                  {String(!!g?.conferenceGame)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

