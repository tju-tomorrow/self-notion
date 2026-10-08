import { commands } from "./bindings.ts";
document.getElementById("app").textContent = "cmd=" + (commands ? Object.keys(commands).join(",") : "-");
if (import.meta.hot) { import.meta.hot.accept(() => console.log("HMR accepted main.js")); }
