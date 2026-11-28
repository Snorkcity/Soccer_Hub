import { useEffect, useState } from "react";

/** Match the tablet-only reading size in index.css, including orientation changes. */
export function useTabletChart() {
  const [tablet, setTablet] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 600px) and (min-height: 600px) and (max-width: 1399px) and (hover: none) and (pointer: coarse)");
    const update = () => setTablet(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return tablet;
}
