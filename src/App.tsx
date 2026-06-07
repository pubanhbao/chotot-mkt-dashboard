import { useState, useEffect, createContext } from "react";
import Dashboard from "./Dashboard";
import { parseValuesFromRows } from "./useSheetData";
import type { ParsedSheetData } from "./useSheetData";

export const SheetCtx = createContext<ParsedSheetData | null>(null);
export const SyncCtx  = createContext<{
  status: string; lastSync: string; errorMsg: string; onRefresh: () => void;
  liveData: any;
}>({ status: "idle", lastSync: "", errorMsg: "", onRefresh: () => {}, liveData: null });

export { parseValuesFromRows };

export default function App() {
  const [sheetData, setSheetData] = useState<ParsedSheetData | null>(null);
  const [liveData,  setLiveData]  = useState<any>(null);
  const [status,    setStatus]    = useState("loading");
  const [lastSync,  setLastSync]  = useState("");
  const [errorMsg,  setErrorMsg]  = useState("");

  const load = async () => {
    // 1) Load public/data.json (written by cron sync script)
    try {
      const res = await fetch(`/data.json?t=${Date.now()}`);
      if (res.ok) {
        const d = await res.json();
        setLiveData(d);
        setStatus("ok");
        const ts = d.timestamp ? new Date(d.timestamp).toLocaleTimeString("vi-VN") : "unknown";
        setLastSync(ts);
        return;
      }
    } catch {}

    // 2) CSV file uploaded by user
    const stored = sessionStorage.getItem("csvData");
    if (stored) {
      try {
        const rows = JSON.parse(stored) as string[][];
        setSheetData(parseValuesFromRows(rows));
        setStatus("ok");
        setLastSync(new Date().toLocaleTimeString("vi-VN"));
        return;
      } catch {}
    }

    // 3) Use embedded data
    setStatus("idle");
    setErrorMsg("Sử dụng embedded data. Cron sync chạy mỗi 30 phút.");
  };

  useEffect(() => { load(); }, []);

  return (
    <SheetCtx.Provider value={sheetData}>
      <SyncCtx.Provider value={{ status, lastSync, errorMsg, onRefresh: load, liveData }}>
        <div style={{ height:"100vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <Dashboard liveData={liveData} />
        </div>
      </SyncCtx.Provider>
    </SheetCtx.Provider>
  );
}
