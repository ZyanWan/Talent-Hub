// =====================================================================
// React 入口：挂载应用根组件到 #root 容器，供 Vite 构建使用。
// =====================================================================

import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root container");
}

createRoot(container).render(<App />);
